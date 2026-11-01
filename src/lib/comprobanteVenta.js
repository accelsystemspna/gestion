import { fmtMoney } from './format'
import { crearFicha, armarDocumento, cabeceraDoc, filaCeldas, bloqueTotal, contactoDe, fmtFecha, COLOR_OK, COLOR_ALERTA } from './fichaPDF'

export const FORMAS_PAGO = { efectivo: 'Efectivo', debito: 'Débito', credito: 'Crédito', transferencia: 'Transferencia', cuenta_corriente: 'Cuenta corriente' }

const ESTADOS = {
  pagado: { t: 'PAGADO', color: COLOR_OK },
  pendiente: { t: 'PENDIENTE', color: COLOR_ALERTA },
  parcial: { t: 'PAGO PARCIAL', color: COLOR_ALERTA },
  anulado: { t: 'ANULADO', color: COLOR_ALERTA },
  pendiente_revision: { t: 'EN REVISIÓN', color: COLOR_ALERTA },
}

/** Ticket de una venta sin factura. Con `paraCliente` devuelve el PDF para su panel en lugar de descargarlo. */
export async function generarComprobanteVenta({ venta, items, branding, paraCliente = false }) {
  const c = await crearFicha({ tamano: 'media', branding })
  const numero = String(venta.numero ?? 0).padStart(4, '0')
  const estado = ESTADOS[venta.estado] ?? ESTADOS.pendiente
  const filas = items.map((it) => ({
    nombre: it.descripcion,
    cantidad: it.cantidad,
    precio: it.precio_unitario ?? (Number(it.subtotal) || 0) / (Number(it.cantidad) || 1),
    subtotal: it.subtotal,
  }))
  const conDescuento = (venta.descuento_porcentaje ?? 0) > 0

  armarDocumento(c, {
    cabecera: (y) => filaCeldas(c, cabeceraDoc(c, y, {
      titulo: 'TICKET',
      numero: `N° ${numero}`,
      campos: [
        [{ et: 'Fecha' }, { t: `${fmtFecha(venta.fecha)}${venta.hora ? ` ${String(venta.hora).slice(0, 5)}` : ''}`, mono: true }],
        [{ et: 'Forma de pago' }, { t: FORMAS_PAGO[venta.forma_pago] ?? venta.forma_pago ?? '—' }],
        [{ et: 'Estado' }, { t: estado.t, bold: true, color: estado.color }],
      ],
    }), [
      { celda: [{ et: 'Cliente' }, { t: venta.cliente_nombre || 'Consumidor Final', bold: true }] },
      { celda: [{ et: 'Celular' }, { t: venta.cliente_telefono || '—', mono: true }] },
    ]),
    filas,
    altoFinal: 44,
    final: (y) => bloqueTotal(c, y, 44, {
      izquierda: [
        ...(conDescuento ? [{ t: `Descuento ${venta.descuento_porcentaje}%: -${fmtMoney(venta.descuento_monto)}` }] : []),
        { t: 'Documento no válido como factura.' },
      ],
      etiqueta: venta.estado === 'pendiente' ? 'Falta pagar' : 'Total',
      total: fmtMoney(venta.total),
    }),
    contacto: contactoDe(branding),
  })

  if (paraCliente) return c.doc.output('blob')
  c.doc.save(`ticket-${numero}.pdf`)
}
