import { fmtMoney } from './format'
import { crearFicha, armarDocumento, cabeceraDoc, filaCeldas, bloqueTotal, contactoDe, fotoDeProducto, fmtFecha } from './fichaPDF'

/** "15 días" desde la fecha, como fecha. Si la validez no es un número de días, null. */
function validoHasta(desde, validez) {
  const dias = /^\s*(\d+)\s*d/i.exec(String(validez ?? ''))?.[1]
  if (!dias) return null
  const f = new Date(desde)
  f.setDate(f.getDate() + Number(dias))
  return f
}

/**
 * PDF del presupuesto. Con un presupuesto guardado usa su número y su fecha, así que exportarlo de nuevo da lo mismo.
 * @param {{ presupuesto?: { numero?: number, created_at?: string }|null, items: object[], cliente?: string, celular?: string, branding?: object, validez?: string, comoBlob?: boolean }} datos
 */
export async function exportPresupuestoPDF({ presupuesto, items, cliente, celular, branding, validez, comoBlob = false }) {
  const c = await crearFicha({ branding })
  const desde = presupuesto?.created_at ? new Date(presupuesto.created_at) : new Date()
  const hasta = validoHasta(desde, validez)
  const filas = await Promise.all(items.map(async (it) => ({
    nombre: it.nombre,
    cantidad: it.cantidad,
    precio: it.precio,
    subtotal: it.precio * it.cantidad,
    foto: await fotoDeProducto(c, it.imagen_url),
  })))
  const total = filas.reduce((s, f) => s + f.subtotal, 0)

  armarDocumento(c, {
    cabecera: (y) => filaCeldas(c, cabeceraDoc(c, y, {
      titulo: 'PRESUPUESTO',
      numero: presupuesto?.numero ? `N° ${String(presupuesto.numero).padStart(5, '0')}` : null,
      campos: [
        [{ et: 'Fecha' }, { t: fmtFecha(desde), mono: true }],
        hasta ? [{ et: 'Válido hasta' }, { t: fmtFecha(hasta), mono: true }] : [{ et: 'Validez' }, { t: validez || '—' }],
      ],
    }), [
      { celda: [{ et: 'Cliente' }, { t: cliente || 'Consumidor final', bold: true }] },
      { celda: [{ et: 'Celular' }, { t: celular || '—', mono: true }] },
    ]),
    filas,
    altoFinal: 46,
    final: (y) => bloqueTotal(c, y, 46, {
      izquierda: [{ et: 'Condiciones' }, { t: `${validez ? `Válido por ${validez}. ` : ''}Documento no válido como factura.` }],
      etiqueta: 'Total',
      total: fmtMoney(total),
    }),
    contacto: contactoDe(branding),
  })

  if (comoBlob) return c.doc.output('blob')
  const nombre = (cliente || 'sin-cliente').replace(/\s+/g, '-')
  c.doc.save(presupuesto?.numero ? `presupuesto-${presupuesto.numero}-${nombre}.pdf` : `presupuesto-${nombre}-${fmtFecha(desde).replace(/\//g, '-')}.pdf`)
}
