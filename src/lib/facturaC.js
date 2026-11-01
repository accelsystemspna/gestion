/**
 * facturaC.js
 * Genera el PDF oficial de Factura C (Monotributo Argentina) usando jsPDF.
 * Incluye QR de verificación AFIP/ARCA.
 */
import QRCode   from 'qrcode'
import { fmtMoney } from './format'
import { crearFicha, armarDocumento, filaCeldas, bloqueTotal, dibujarCelda, logoEn, texto, altoTabla } from './fichaPDF'
import { FORMAS_PAGO } from './comprobanteVenta'
import { fmtCuit, NOMBRE_DOC, DOC_CONSUMIDOR } from './cuit'


const fmtFecha = (iso) => {
  if (!iso) return ''
  const [y, m, d] = String(iso).slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

/**
 * Genera la URL del QR de verificación AFIP.
 * https://www.afip.gob.ar/fe/qr/?p=BASE64_JSON
 */
function buildQrUrl({ cuit, ptoVta, nroCmp, importe, cae, fecha, docTipo = 99, docNro = 0 }) {
  const obj = {
    ver:        1,
    fecha:      String(fecha).slice(0, 10),
    cuit:       Number(cuit),
    ptoVta:     Number(ptoVta),
    tipoCmp:    11,          // Factura C
    nroCmp:     Number(nroCmp),
    importe:    Number(importe),
    moneda:     'PES',
    ctz:        1,
    tipoDocRec: Number(docTipo),
    nroDocRec:  Number(docNro),
    tipoCodAut: 'E',
    codAut:     Number(cae),
  }
  return 'https://www.afip.gob.ar/fe/qr/?p=' + btoa(JSON.stringify(obj))
}

/**
 * Genera el PDF de Factura C con la ficha: media hoja si todo entra, A4 si no.
 * Usa los datos guardados: no le pide nada a ARCA.
 *
 * @param {object} params
 * @param {object} params.venta         - Registro de la venta (con venta_items)
 * @param {object} params.arcaConfig    - { cuit, punto_venta, razon_social, domicilio, iibb, inicio_actividades }
 * @param {object} params.branding      - Logo y contacto
 * @param {boolean} params.download     - true = descargar, false = devolver blob URL
 */
export async function generarFacturaC({ venta, arcaConfig, branding = {}, download = true, comoBlob = false }) {
  const nroPv    = String(arcaConfig.punto_venta ?? 3).padStart(4, '0')
  const nroComp  = String(venta.nro_factura ?? 0).padStart(8, '0')
  const cuit     = String(arcaConfig.cuit ?? '').replace(/\D/g, '')
  const fecha    = venta.factura_fecha || venta.fecha
  const filas = (venta.venta_items ?? []).map((it) => ({
    nombre: it.descripcion,
    cantidad: Number(it.cantidad ?? 1),
    precio: Number(it.subtotal ?? 0) / (Number(it.cantidad) || 1),
    subtotal: Number(it.subtotal ?? 0),
  }))

  const nombreDoc = NOMBRE_DOC[venta.factura_doc_tipo]
  const qr = await QRCode.toDataURL(buildQrUrl({
    cuit,
    ptoVta:  arcaConfig.punto_venta ?? 3,
    nroCmp:  venta.nro_factura ?? 0,
    importe: venta.total,
    cae:     venta.cae,
    fecha,
    docTipo: nombreDoc ? venta.factura_doc_tipo : DOC_CONSUMIDOR,
    docNro:  nombreDoc ? venta.factura_doc_nro : 0,
  }), { width: 220, margin: 1 }).catch(() => null)

  const receptor = [
    { f: 2, celda: [{ et: 'Cliente' }, { t: venta.cliente_nombre || 'Consumidor Final', bold: true }] },
    { celda: [{ et: 'Documento' }, nombreDoc ? { t: `${nombreDoc} ${fmtCuit(venta.factura_doc_nro)}`, mono: true } : { t: 'Sin identificar' }] },
    { celda: [{ et: 'Condición IVA' }, { t: venta.factura_cond_iva || 'Consumidor Final' }] },
  ]
  const domicilio = arcaConfig.domicilio || branding?.direccion
  const razon = arcaConfig.razon_social || branding?.nombre || ''
  const importe = fmtMoney(Number(venta.total))
  const datosCae = [
    { et: 'CAE' }, { t: venta.cae ?? '', mono: true },
    { et: 'Vencimiento del CAE' }, { t: fmtFecha(venta.cae_vto), mono: true },
    { t: 'Comprobante autorizado por ARCA' },
  ]
  const dibujarQr = (c, x, y, lado) => { if (qr) c.doc.addImage(qr, 'PNG', x, y, lado, lado, 'qr') }

  // La media hoja solo se usa si entra todo en una
  const prueba = await crearFicha({ tamano: 'media' })
  const entraEnMedia = altoTabla(prueba, filas) <= prueba.y1 - prueba.y0 - 72 - 38 - 66
  const c = await crearFicha({ tamano: entraEnMedia ? 'media' : 'a4', branding })

  const cabeceraFactura = (y, emisor) => {
    const anchos = c.media ? [70, 54] : [104, 62]
    const alto = c.media ? 72 : 96
    const x1 = c.x0 + anchos[0]
    const x2 = x1 + anchos[1]
    logoEn(c, c.x0 + 6, y + 5, anchos[0] - 12, alto - 10)
    c.doc.setDrawColor(29, 30, 32)
    c.doc.setLineWidth(0.7)
    c.doc.line(x1, y, x1, y + alto)
    c.doc.line(x2, y, x2, y + alto)
    texto(c, 'C', (x1 + x2) / 2, y + alto / 2 + c.fs * 0.5, { mono: true, bold: true, size: c.fs * (c.media ? 2.4 : 3), align: 'center' })
    texto(c, 'COD. 011', (x1 + x2) / 2, y + alto / 2 + c.fs * 1.75, { mono: true, size: c.fs * 0.72, align: 'center' })
    const xd = x2 + c.pad
    if (!c.media) {
      // Igual que el presupuesto y el ticket: título y número arriba, campos abajo
      const altoTit = 40
      const xm = (x2 + c.x1) / 2
      c.doc.line(x2, y + altoTit, c.x1, y + altoTit)
      c.doc.line(xm, y + altoTit, xm, y + alto)
      texto(c, 'FACTURA', xd, y + altoTit - 13, { bold: true, size: c.fs * 1.9 })
      texto(c, `N° ${nroPv}-${nroComp}`, c.x1 - c.pad, y + altoTit - 13, { mono: true, align: 'right' })
      dibujarCelda(c, [{ et: 'Fecha de emisión' }, { t: fmtFecha(fecha), mono: true }], xd, y + altoTit + c.pad * 0.5)
      dibujarCelda(c, [{ et: 'Punto de venta' }, { t: nroPv, mono: true }], xm + c.pad, y + altoTit + c.pad * 0.5)
    } else {
      const bt = y + c.pad + c.fs * 1.1
      texto(c, 'FACTURA', xd, bt, { bold: true, size: c.fs * 1.4 })
      dibujarCelda(c, [{ t: `N° ${nroPv}-${nroComp}`, mono: true }, { et: 'Fecha de emisión' }, { t: fmtFecha(fecha), mono: true }], xd, bt + 1)
    }
    if (emisor) {
      const xe = (x2 + c.x1) / 2 - 8
      c.doc.line(xe, y, xe, y + alto)
      dibujarCelda(c, emisor, xe + c.pad, y + c.pad * 0.4)
    }
    c.doc.setLineWidth(1.1)
    c.doc.line(c.x0, y + alto, c.x1, y + alto)
    return y + alto
  }

  if (c.media) {
    const emisor = [
      { t: razon, bold: true },
      ...(domicilio ? [{ t: domicilio }] : []),
      { t: `Resp. Monotributo · ${fmtCuit(cuit)}` },
      ...(arcaConfig.iibb ? [{ t: `IIBB: ${arcaConfig.iibb}` }] : []),
      ...(arcaConfig.inicio_actividades ? [{ t: `Inicio: ${fmtFecha(arcaConfig.inicio_actividades)}` }] : []),
    ]
    armarDocumento(c, {
      cabecera: (y) => filaCeldas(c, cabeceraFactura(y, emisor), receptor),
      filas,
      altoFinal: 66,
      final: (y) => bloqueTotal(c, y, 66, {
        dibujarIzquierda: () => {
          dibujarQr(c, c.x0 + c.pad, y + 7, 52)
          dibujarCelda(c, datosCae, c.x0 + c.pad + 62, y + 2)
        },
        etiqueta: 'Importe total',
        total: importe,
      }),
    })
  } else {
    const altoCae = 88
    armarDocumento(c, {
      cabecera: (y) => {
        const conEmisor = filaCeldas(c, cabeceraFactura(y), [
          { celda: [{ et: 'Emisor' }, { t: razon, bold: true }, ...(domicilio ? [{ t: domicilio }] : []), { t: 'Responsable Monotributo' }] },
          { celda: [
            { et: 'CUIT' }, { t: fmtCuit(cuit), mono: true },
            ...(arcaConfig.iibb ? [{ et: 'Ingresos Brutos' }, { t: arcaConfig.iibb, mono: true }] : []),
            ...(arcaConfig.inicio_actividades ? [{ et: 'Inicio de actividades' }, { t: fmtFecha(arcaConfig.inicio_actividades), mono: true }] : []),
          ] },
        ])
        return filaCeldas(c, conEmisor, receptor)
      },
      filas,
      altoFinal: 46 + altoCae,
      final: (y) => {
        const fin = bloqueTotal(c, y, 46, {
          izquierda: [{ et: 'Forma de pago' }, { t: FORMAS_PAGO[venta.forma_pago] ?? venta.forma_pago ?? '—' }],
          etiqueta: 'Importe total',
          total: importe,
        })
        c.doc.setDrawColor(29, 30, 32)
        c.doc.setLineWidth(0.7)
        c.doc.line(c.x0, fin, c.x1, fin)
        dibujarQr(c, c.x0 + c.pad, fin + 8, 72)
        dibujarCelda(c, datosCae, c.x0 + c.pad + 84, fin + 6)
      },
      contacto: [branding?.telefono, branding?.web_minorista || branding?.web_mayorista, branding?.instagram ? `@${branding.instagram.replace(/^@/, '')}` : null],
    })
  }

  // ── Salida ────────────────────────────────────────────────────────────────
  const { doc } = c
  if (comoBlob) return doc.output('blob')
  const nombre = `factura-C-${nroPv}-${nroComp}.pdf`
  if (download) {
    doc.save(nombre)
    return null
  }
  return doc.output('bloburl')
}

/**
 * Construye el texto para compartir por WhatsApp.
 */
export function buildWhatsAppText({ venta, arcaConfig }) {
  const nroPv   = String(arcaConfig.punto_venta ?? 3).padStart(4, '0')
  const nroComp = String(venta.nro_factura ?? 0).padStart(8, '0')
  const fecha   = fmtFecha(venta.fecha)
  const lines   = [
    `🏛️ *Factura C — ${arcaConfig.razon_social || 'CC DISEÑOS'}*`,
    `📄 Nro: ${nroPv}-${nroComp}`,
    `📅 Fecha: ${fecha}`,
    venta.cliente_nombre ? `👤 Cliente: ${venta.cliente_nombre}` : '',
    `💰 Total: *${fmtMoney(Number(venta.total))}*`,
    ``,
    `✅ CAE: ${venta.cae}`,
    `Vto: ${fmtFecha(venta.cae_vto)}`,
    ``,
    `Verificá en: https://www.afip.gob.ar/fe/qr/`,
  ].filter(l => l !== undefined)
  return lines.join('\n')
}
