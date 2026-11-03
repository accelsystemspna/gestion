import { supabase } from './supabase'

// Seña, saldo y facturas en partes (seña y saldo). Mismo comportamiento en ventas del portal mayorista y en pedidos.

export const FORMAS_COBRO = ['Transferencia', 'Efectivo', 'Débito', 'Crédito', 'Mercado Pago']

// Texto del renglón de cada factura. PROVISORIO hasta que lo confirme el contador: se cambia solo acá.
export const DETALLE_FACTURA = {
  sena:  (ref) => `Seña del pedido ${ref}`,
  saldo: (ref) => `Saldo del pedido ${ref}`,
  total: (ref) => `Pedido ${ref}`,
}

// Facturar por partes en producción (facturas reales) queda apagado hasta que el contador confirme el texto.
// En homologación (pruebas) se puede facturar igual.
export const FACTURAR_PARTES_EN_PRODUCCION = false

export const CONCEPTOS = { sena: 'Seña', saldo: 'Saldo', total: 'Total' }

export const redondear = (n) => Math.round((Number(n) || 0) * 100) / 100

/**
 * Cuánto falta cobrar y facturar. Las facturas de prueba (homologación) no cuentan cuando se factura en producción.
 * `facturadoAntes` es una factura vieja por el total (ventas.factura_emitida).
 */
export function resumen({ total, sena, saldoCobrado, facturas = [], modo, facturadoAntes = false }) {
  const t = redondear(total)
  const s = redondear(sena)
  const validas = facturas.filter((f) => f.modo === modo && f.estado !== 'fallida')
  const facturado = facturadoAntes ? t : redondear(validas.reduce((a, f) => a + Number(f.importe), 0))
  const senaFacturada = redondear(validas.filter((f) => f.concepto === 'sena').reduce((a, f) => a + Number(f.importe), 0))
  return {
    total: t,
    sena: s,
    saldo: saldoCobrado ? 0 : redondear(Math.max(t - s, 0)),
    facturado,
    falta: redondear(Math.max(t - facturado, 0)),
    senaSinFacturar: redondear(Math.max(Math.min(s, t) - senaFacturada, 0)),
  }
}

/** Facturas de una venta o de un pedido. Si todavía falta el SQL, devuelve null. */
export async function cargarFacturas({ ventaId, pedidoId }) {
  let q = supabase.from('facturas').select('*').order('created_at')
  q = ventaId ? q.eq('venta_id', ventaId) : q.eq('pedido_id', pedidoId)
  const { data, error } = await q
  return error ? null : data
}

async function mensajeDeError(error) {
  try {
    const j = await error.context?.json?.()
    if (j?.error) return j.error
  } catch { /* sin cuerpo */ }
  return error.message
}

/**
 * Emite una factura por una parte. `solicitudId` tiene que ser el mismo si se reintenta: así ARCA no la emite dos veces.
 * @returns {Promise<{ ok: boolean, factura?: object, error?: string }>}
 */
export async function emitirParte({ ventaId, pedidoId, concepto, importe, detalle, receptor, solicitudId }) {
  const { data, error } = await supabase.functions.invoke('emitir-factura', {
    body: {
      accion: 'emitir_parcial', venta_id: ventaId ?? null, pedido_id: pedidoId ?? null, concepto,
      importe: redondear(importe), detalle, solicitud_id: solicitudId,
      doc_tipo: receptor.docTipo, doc_nro: receptor.docNro || '0', cond_iva: receptor.condIva,
    },
  })
  if (error) return { ok: false, error: await mensajeDeError(error) }
  return data?.ok ? data : { ok: false, error: data?.error || 'ARCA no autorizó la factura.' }
}

/** La factura de una parte con la forma que espera el PDF: un solo renglón con su detalle. */
export function ventaParaFactura(factura, base) {
  return {
    ...base,
    total: Number(factura.importe),
    venta_items: [{ descripcion: factura.detalle, cantidad: 1, subtotal: Number(factura.importe) }],
    nro_factura: factura.nro_factura,
    cae: factura.cae,
    cae_vto: factura.cae_vto,
    factura_fecha: factura.fecha,
    factura_doc_tipo: factura.doc_tipo,
    factura_doc_nro: factura.doc_nro,
    factura_cond_iva: factura.cond_iva,
  }
}

/** Datos de ARCA para el PDF de esa factura: su punto de venta y, si fue de prueba, la leyenda. */
export function arcaParaFactura(factura, arcaConfig) {
  return {
    ...arcaConfig,
    punto_venta: factura.punto_venta ?? arcaConfig.punto_venta,
    ...(factura.modo === 'homologacion' ? { razon_social: 'PRUEBA · SIN VALIDEZ FISCAL' } : {}),
  }
}

export const numeroFactura = (f) => `${String(f.punto_venta ?? 0).padStart(4, '0')}-${String(f.nro_factura ?? 0).padStart(8, '0')}`
