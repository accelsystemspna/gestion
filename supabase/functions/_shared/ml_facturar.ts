// Factura C automática de una venta de Mercado Libre cuando ML la marca como despachada.
// Solo si el negocio lo activó (ml_cuentas.facturar_al_despachar) y ARCA está en producción.
// El PDF lo arma el programa y lo sube a la venta de ML (no se puede armar acá).
import { accesoArca, ultimoNro, emitirFactura, fechaHoyARCCYYMMDD, fechaISO } from './arca.ts'
import { mlFetch } from './ml.ts'
import { sendPushToOrg } from './webpush.ts'

const fmtMoney = (n: number) => '$ ' + n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const DOC_DNI = 96
const DOC_CONSUMIDOR = 99

export async function facturarVentaML(admin: any, org: string, ventaId: number, orderId: number | string) {
  const { data: cuenta } = await admin.from('ml_cuentas').select('facturar_al_despachar').eq('org_id', org).maybeSingle()
  if (!cuenta?.facturar_al_despachar) return

  // Se "toma" la venta: si llegan dos avisos a la vez (orden y envío), factura uno solo.
  const { data: venta } = await admin.from('ventas')
    .update({ ml_facturando: new Date().toISOString(), ml_factura_error: null })
    .eq('id', ventaId).eq('org_id', org).eq('factura_emitida', false).is('ml_facturando', null)
    .select('id, total, cliente_nombre').maybeSingle()
  if (!venta) return

  // Si un error deja la venta tomada, no se reintenta sola: se factura a mano desde la venta
  // (así nunca sale dos veces si ARCA llegó a autorizarla).
  const fallar = async (texto: string, liberar = false) => {
    await admin.from('ventas').update({ ml_factura_error: texto, ...(liberar ? { ml_facturando: null } : {}) }).eq('id', ventaId)
    await sendPushToOrg(admin, org, {
      title: 'Venta de Mercado Libre sin facturar',
      body: `${venta.cliente_nombre || 'Venta'} · ${fmtMoney(Number(venta.total))}: ${texto}`,
      url: '/tiendas', tag: 'factura-ml-' + ventaId,
    }).catch(() => {})
  }

  try {
    const { data: partes } = await admin.from('facturas').select('id').eq('venta_id', ventaId).in('estado', ['pendiente', 'emitida']).limit(1)
    if (partes?.length) return await fallar('ya tiene facturas cargadas a mano.', true)

    const a = await accesoArca(admin, org)
    if (a.homo) return await fallar('ARCA está en modo prueba: no se factura sola.', true)

    // Comprador: con CUIT se factura a mano (falta informar su condición de IVA); con DNI va a su nombre.
    const bi = await mlFetch(admin, org, `/orders/${orderId}/billing_info`)
    const info = bi.data?.billing_info ?? {}
    const tipoDoc = String(info.doc_type ?? '').toUpperCase()
    const nroDoc = String(info.doc_number ?? '').replace(/\D/g, '')
    if (tipoDoc === 'CUIT' || tipoDoc === 'CUIL' || nroDoc.length === 11) {
      return await fallar('el comprador pidió factura con CUIT: facturala a mano desde la venta.', true)
    }
    const docTipo = tipoDoc === 'DNI' && nroDoc.length >= 7 ? DOC_DNI : DOC_CONSUMIDOR
    const docNro = docTipo === DOC_DNI ? nroDoc : '0'

    const total = Math.round(Number(venta.total) * 100) / 100
    const nro = (await ultimoNro(a.wsfeUrl, a.token, a.sign, a.cuit, a.ptoVta, 11)) + 1
    const fecha = fechaHoyARCCYYMMDD()
    const r = await emitirFactura({
      url: a.wsfeUrl, token: a.token, sign: a.sign, cuit: a.cuit, ptoVta: a.ptoVta, cbteTipo: 11,
      concepto: a.cfg.concepto ?? 1, docTipo, docNro, importe: total, fecha, nroFactura: nro,
    })
    const { error } = await admin.from('ventas').update({
      cae: r.cae, cae_vto: r.caeVto, nro_factura: r.nroFactura, factura_emitida: true, comprobante: 'factura_c',
      factura_fecha: fechaISO(fecha), factura_doc_tipo: docTipo, factura_doc_nro: docTipo === DOC_DNI ? docNro : null,
      factura_cond_iva: 'Consumidor Final', ml_facturando: null, ml_factura_error: null,
    }).eq('id', ventaId)
    // ARCA ya la autorizó: si no se pudo guardar, queda en el registro para recuperarla.
    if (error) console.error('[ml-facturar] CAE sin guardar', ventaId, r, error)
  } catch (err) {
    console.warn('[ml-facturar]', ventaId, err)
    await fallar('no se pudo facturar (' + (err instanceof Error ? err.message : String(err)).slice(0, 200) + '). Revisala y facturala a mano.')
  }
}
