// Guarda el PDF de las facturas YA EMITIDAS en los documentos del cliente, para que las vea en su panel.
// Usa los datos guardados (CAE incluido): NO le pide nada a ARCA ni emite comprobantes.
// Solo las ventas con ficha de cliente. Se puede correr de nuevo: las que ya están se saltean.
//
//   node scripts/facturas-a-panel.mjs            → simula: muestra qué haría
//   node scripts/facturas-a-panel.mjs --aplicar  → guarda
import fs from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'vite'

for (const f of ['.env', '.env.local']) {
  if (!fs.existsSync(f)) continue
  for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = /^\s*([\w.-]+)\s*=\s*(.*)\s*$/.exec(l)
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
const aplicar = process.argv.includes('--aplicar')

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
try {
  const { supabase } = await vite.ssrLoadModule('/src/lib/supabase.js')
  const { generarFacturaC } = await vite.ssrLoadModule('/src/lib/facturaC.js')
  await supabase.auth.signInWithPassword({ email: process.env.GESTION_EMAIL, password: process.env.GESTION_PASSWORD })

  const { data: arcaConfig, error: errorArca } = await supabase.from('arca_config').select('*').maybeSingle()
  if (errorArca || !arcaConfig) throw new Error('No se pudo leer arca_config: ' + errorArca?.message)
  const { data: ventas, error } = await supabase.from('ventas')
    .select('id, org_id, numero, fecha, total, cliente_id, cliente_nombre, nro_factura, cae, cae_vto, venta_items(descripcion, cantidad, subtotal)')
    .eq('factura_emitida', true).not('cae', 'is', null).not('cliente_id', 'is', null).order('fecha')
  if (error) throw error
  const { data: yaEstan, error: errorDocs } = await supabase.from('cliente_documentos').select('venta_id').eq('tipo', 'factura').not('venta_id', 'is', null)
  if (errorDocs) throw errorDocs
  const hechas = new Set(yaEstan.map((d) => d.venta_id))

  const puntoVenta = String(arcaConfig.punto_venta ?? 3).padStart(4, '0')
  let guardadas = 0
  for (const v of ventas) {
    const titulo = `Factura C ${puntoVenta}-${String(v.nro_factura).padStart(8, '0')}`
    if (hechas.has(v.id)) { console.log(`ya está   V-${v.numero} ${titulo}`); continue }
    console.log(`${aplicar ? 'guardando' : 'guardaría'} V-${v.numero} ${v.fecha} ${titulo} $${v.total} · ${v.cliente_nombre}`)
    if (!aplicar) continue
    const blob = await generarFacturaC({ venta: v, arcaConfig, download: false, comoBlob: true })
    const ruta = `${createHash('sha256').update(v.org_id).digest('hex')}/${randomUUID()}.pdf`
    const { error: e1 } = await supabase.storage.from('documentos-clientes').upload(ruta, blob, { contentType: 'application/pdf' })
    if (e1) throw e1
    const { error: e2 } = await supabase.from('cliente_documentos').insert({ org_id: v.org_id, cliente_id: v.cliente_id, venta_id: v.id, tipo: 'factura', titulo, fecha: v.fecha, total: Number(v.total) || 0, ruta })
    if (e2) { await supabase.storage.from('documentos-clientes').remove([ruta]); throw e2 }
    guardadas++
  }
  console.log(aplicar ? `Listo: ${guardadas} guardadas.` : 'Simulación: no se guardó nada. Para guardar: --aplicar')
} finally {
  await vite.close()
}
