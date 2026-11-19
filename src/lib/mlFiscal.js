import { supabase } from './supabase'
import { mlApi } from './mlApi'
import { generarFacturaC } from './facturaC'

// Facturas y notas de crédito de ventas de Mercado Libre: se arman en PDF acá (el diseño usa
// fuentes e imágenes del navegador) y se suben a la venta en ML.

// Desde cuándo se suben solas. Las facturas anteriores pueden haberse cargado a mano en ML:
// esas se suben solo con el botón de la venta.
export const SUBIR_DESDE = '2026-11-19'

const fmtFecha = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '')
const nro = (pv, n) => `${String(pv ?? 0).padStart(4, '0')}-${String(n ?? 0).padStart(8, '0')}`

/** Texto de la factura que anula una nota de crédito. */
export const facturaAsociada = (nota) => `Factura C N° ${nro(nota.asoc_pto_vta, nota.asoc_nro)}${nota.asoc_fecha ? ' del ' + fmtFecha(nota.asoc_fecha) : ''}`
export const numeroNota = (nota) => nro(nota.punto_venta, nota.nro)

/** La nota de crédito con la forma que espera el PDF: un renglón con el motivo. */
export function ventaParaNota(nota, venta) {
  return {
    ...venta,
    total: Number(nota.importe),
    venta_items: [{ descripcion: nota.motivo, cantidad: 1, subtotal: Number(nota.importe) }],
    nro_factura: nota.nro, cae: nota.cae, cae_vto: nota.cae_vto, factura_fecha: nota.fecha,
    factura_doc_tipo: nota.doc_tipo, factura_doc_nro: nota.doc_nro, factura_cond_iva: nota.cond_iva,
  }
}

const aBase64 = (blob) => new Promise((ok, mal) => {
  const r = new FileReader()
  r.onload = () => ok(String(r.result).split(',')[1] ?? '')
  r.onerror = () => mal(r.error)
  r.readAsDataURL(blob)
})

export async function pdfNota({ nota, venta, arcaConfig, branding, download = false }) {
  return generarFacturaC({
    venta: ventaParaNota(nota, venta), arcaConfig: { ...arcaConfig, punto_venta: nota.punto_venta ?? arcaConfig.punto_venta },
    branding: branding ?? {}, download, comoBlob: !download, notaCredito: { asociada: facturaAsociada(nota) },
  })
}

/** Sube la factura de la venta a Mercado Libre. */
export async function subirFacturaML({ venta, items, arcaConfig, branding }) {
  const blob = await generarFacturaC({ venta: { ...venta, venta_items: items }, arcaConfig, branding: branding ?? {}, download: false, comoBlob: true })
  return mlApi('subir_fiscal', { venta_id: venta.id, pdf_base64: await aBase64(blob) })
}

/** Sube una nota de crédito a la venta de Mercado Libre. */
export async function subirNotaML({ nota, venta, arcaConfig, branding }) {
  const blob = await pdfNota({ nota, venta, arcaConfig, branding })
  return mlApi('subir_fiscal', { venta_id: venta.id, nota_id: nota.id, pdf_base64: await aBase64(blob) })
}

let corriendo = false
/**
 * Sube a ML las facturas y notas de crédito que todavía no se subieron (desde SUBIR_DESDE).
 * Se llama al abrir el programa. Los errores quedan guardados en la venta y no se reintentan solos.
 */
export async function subirPendientesML(orgId) {
  if (corriendo || !orgId) return
  corriendo = true
  try {
    const [{ data: arca }, { data: branding }, { data: ventas }, { data: notas }] = await Promise.all([
      supabase.from('arca_config').select('cuit, punto_venta, razon_social, domicilio, iibb, inicio_actividades, modo').eq('user_id', orgId).maybeSingle(),
      supabase.from('branding').select('*').eq('user_id', orgId).maybeSingle(),
      supabase.from('ventas').select('*').like('origen_ref', 'ML#%').eq('factura_emitida', true)
        .is('ml_factura_subida', null).is('ml_subida_error', null).gte('factura_fecha', SUBIR_DESDE).limit(20),
      supabase.from('notas_credito').select('*, ventas!inner(origen_ref)').like('ventas.origen_ref', 'ML#%').eq('estado', 'emitida').eq('modo', 'produccion')
        .is('ml_subida', null).is('ml_subida_error', null).gte('fecha', SUBIR_DESDE).limit(20),
    ])
    if (!arca || arca.modo !== 'produccion') return
    for (const v of ventas ?? []) {
      const { data: items } = await supabase.from('venta_items').select('*').eq('venta_id', v.id).order('id')
      await subirFacturaML({ venta: v, items: items ?? [], arcaConfig: arca, branding }).catch((e) => console.warn('[ml fiscal] venta', v.id, e.message))
    }
    for (const { ventas: _ref, ...n } of notas ?? []) {
      const { data: v } = await supabase.from('ventas').select('*').eq('id', n.venta_id).maybeSingle()
      if (!v) continue
      await subirNotaML({ nota: n, venta: v, arcaConfig: arca, branding }).catch((e) => console.warn('[ml fiscal] nota', n.id, e.message))
    }
  } catch (e) {
    console.warn('[ml fiscal]', e)
  } finally {
    corriendo = false
  }
}
