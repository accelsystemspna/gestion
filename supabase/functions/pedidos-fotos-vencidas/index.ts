// Borra las fotos de los PEDIDOS a los 90 días de cargadas. El pedido queda; solo se van sus fotos.
// La llama una vez por día la tarea programada (supabase_pedidos_fotos_vencidas.sql).
// Se despliega con --no-verify-jwt: la protege el secreto PEDIDOS_LIMPIEZA_SECRET.
//
//   · Solo toca archivos dentro de productos/pedidos/. Nunca imágenes de productos, aunque un pedido las use.
//   · Por defecto SIMULA: para borrar de verdad hay que mandar { "simular": false }.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DIAS = 90
const CARPETA = 'pedidos'
const MARCA_URL = '/storage/v1/object/public/productos/'
const CAMPOS = ['imagenes_referencia', 'imagenes_resultado'] as const

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/** Ruta dentro del bucket si la URL es una foto de pedido; si no (ej. imagen de un producto), null. */
function rutaDeFoto(url: string) {
  const i = String(url).indexOf(MARCA_URL)
  if (i < 0) return null
  const ruta = decodeURI(String(url).slice(i + MARCA_URL.length))
  return ruta.startsWith(`${CARPETA}/`) ? ruta : null
}

serve(async (req) => {
  const secreto = Deno.env.get('PEDIDOS_LIMPIEZA_SECRET')
  if (!secreto || req.headers.get('x-limpieza-secreto') !== secreto) return json({ error: 'No autorizado' }, 401)
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  let body: any = {}
  try { body = await req.json() } catch { /* sin cuerpo: simula */ }
  const simular = body.simular !== false

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
  const bucket = admin.storage.from('productos')

  const listar = async (ruta: string) => {
    const todo: any[] = []
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await bucket.list(ruta, { limit: 1000, offset })
      if (error) throw new Error(`No se pudo listar ${ruta}: ${error.message}`)
      todo.push(...(data || []))
      if (!data || data.length < 1000) return todo
    }
  }

  try {
    const limite = Date.now() - DIAS * 86400_000
    const vencidas: { ruta: string; creado: string; bytes: number }[] = []
    for (const carpeta of (await listar(CARPETA)).filter((x) => x.id === null)) {
      for (const a of await listar(`${CARPETA}/${carpeta.name}`)) {
        if (a.id === null || a.name === '.emptyFolderPlaceholder' || !a.created_at) continue
        if (new Date(a.created_at).getTime() < limite) {
          vencidas.push({ ruta: `${CARPETA}/${carpeta.name}/${a.name}`, creado: a.created_at, bytes: Number(a.metadata?.size) || 0 })
        }
      }
    }
    const rutas = new Set(vencidas.map((v) => v.ruta))

    // Pedidos que todavía muestran esas fotos
    const { data: pedidos, error } = await admin.from('pedidos').select('id, codigo, imagenes_referencia, imagenes_resultado')
    if (error) throw new Error(error.message)
    const afectados = (pedidos || []).flatMap((p: any) => {
      const cambios: Record<string, string[]> = {}
      let quitadas = 0
      for (const campo of CAMPOS) {
        const antes: string[] = p[campo] || []
        const quedan = antes.filter((u) => !rutas.has(rutaDeFoto(u) ?? ''))
        if (quedan.length !== antes.length) { cambios[campo] = quedan; quitadas += antes.length - quedan.length }
      }
      return quitadas ? [{ id: p.id, codigo: p.codigo, cambios, quitadas }] : []
    })

    const resumen = {
      simulacion: simular, dias: DIAS, archivos: vencidas.length,
      megas: Math.round(vencidas.reduce((n, v) => n + v.bytes, 0) / 10485.76) / 100,
      pedidos: afectados.map((a) => ({ codigo: a.codigo, fotos: a.quitadas })),
      rutas: vencidas.map((v) => v.ruta),
    }
    if (simular) return json(resumen)

    // Primero el pedido y después el archivo: si algo falla, un archivo suelto se borra en la próxima pasada.
    const ahora = new Date().toISOString()
    for (const a of afectados) {
      const { error: e } = await admin.from('pedidos').update({ ...a.cambios, imagenes_vencidas_en: ahora }).eq('id', a.id)
      if (e) throw new Error(`Pedido ${a.codigo}: ${e.message}`)
    }
    const lista = [...rutas]
    for (let i = 0; i < lista.length; i += 100) {
      const { error: e } = await bucket.remove(lista.slice(i, i + 100))
      if (e) throw new Error(`No se pudieron borrar archivos: ${e.message}`)
    }
    return json(resumen)
  } catch (err) {
    console.error('[pedidos-fotos-vencidas]', err)
    return json({ error: String((err as Error)?.message || err) }, 500)
  }
})
