/**
 * facturaC.js
 * Genera el PDF oficial de Factura C (Monotributo Argentina) usando jsPDF.
 * Incluye QR de verificación AFIP/ARCA.
 */
import { jsPDF } from 'jspdf'
import QRCode   from 'qrcode'
import { fmtMoney } from './format'

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
 * Genera y descarga el PDF de Factura C.
 *
 * @param {object} params
 * @param {object} params.venta         - Registro de la venta (con items)
 * @param {object} params.arcaConfig    - { cuit, punto_venta, razon_social }
 * @param {boolean} params.download     - true = descargar, false = devolver blob URL
 */
export async function generarFacturaC({ venta, arcaConfig, download = true }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const PW  = 210
  const ML  = 15   // margen izquierdo
  const MR  = 15   // margen derecho
  const CW  = PW - ML - MR   // ancho contenido

  const nroPv    = String(arcaConfig.punto_venta ?? 3).padStart(4, '0')
  const nroComp  = String(venta.nro_factura ?? 0).padStart(8, '0')
  const cuit     = String(arcaConfig.cuit ?? '').replace(/\D/g, '')
  const razon    = arcaConfig.razon_social || 'CC DISEÑOS'
  const fecha    = fmtFecha(venta.fecha)
  const items    = venta.venta_items ?? []

  // ── Tipografías ───────────────────────────────────────────────────────────
  doc.setFont('helvetica')

  // ── Encabezado izquierdo (datos del emisor) ──────────────────────────────
  let y = 18
  doc.setFontSize(16).setFont('helvetica', 'bold')
  doc.text(razon, ML, y)

  y += 6
  doc.setFontSize(9).setFont('helvetica', 'normal')
  doc.text(`CUIT: ${cuit.replace(/(\d{2})(\d{8})(\d{1})/, '$1-$2-$3')}`, ML, y)
  y += 5
  doc.text('Monotributista', ML, y)
  y += 5
  doc.text(`Punto de venta: ${nroPv}`, ML, y)

  // ── Caja central "C" ─────────────────────────────────────────────────────
  const boxX = PW / 2 - 10
  doc.setDrawColor(0).setLineWidth(0.8)
  doc.rect(boxX, 12, 20, 20)
  doc.setFontSize(22).setFont('helvetica', 'bold')
  doc.text('C', boxX + 10, 26, { align: 'center' })

  // ── Encabezado derecho (número y fecha) ──────────────────────────────────
  const RX = PW - MR
  doc.setFontSize(12).setFont('helvetica', 'bold')
  doc.text('FACTURA', RX, 18, { align: 'right' })
  doc.setFontSize(10).setFont('helvetica', 'normal')
  doc.text(`Nro: ${nroPv}-${nroComp}`, RX, 25, { align: 'right' })
  doc.text(`Fecha: ${fecha}`, RX, 31, { align: 'right' })

  // ── Línea separadora ─────────────────────────────────────────────────────
  y = 38
  doc.setLineWidth(0.5).setDrawColor(180)
  doc.line(ML, y, PW - MR, y)

  // ── Datos del receptor ───────────────────────────────────────────────────
  y += 6
  doc.setFontSize(9).setFont('helvetica', 'bold')
  doc.text('Receptor:', ML, y)
  doc.setFont('helvetica', 'normal')
  const receptor = venta.cliente_nombre || 'Consumidor Final'
  doc.text(receptor, ML + 20, y)

  y += 5
  doc.setFont('helvetica', 'bold')
  doc.text('Condición IVA:', ML, y)
  doc.setFont('helvetica', 'normal')
  doc.text('Consumidor Final', ML + 30, y)

  // ── Línea separadora ─────────────────────────────────────────────────────
  y += 7
  doc.setLineWidth(0.3).setDrawColor(180)
  doc.line(ML, y, PW - MR, y)

  // ── Tabla de ítems ───────────────────────────────────────────────────────
  y += 6
  doc.setFillColor(240, 240, 240)
  doc.rect(ML, y - 4, CW, 7, 'F')
  doc.setFontSize(9).setFont('helvetica', 'bold')
  doc.text('Descripción',    ML + 2,       y)
  doc.text('Cant.',          ML + 95,      y, { align: 'right' })
  doc.text('Precio unit.',   ML + 125,     y, { align: 'right' })
  doc.text('Subtotal',       ML + CW - 2,  y, { align: 'right' })

  y += 2
  doc.setLineWidth(0.3).setDrawColor(180)
  doc.line(ML, y, PW - MR, y)

  y += 5
  doc.setFont('helvetica', 'normal').setFontSize(9)

  for (const item of items) {
    const desc     = String(item.descripcion || '').slice(0, 50)
    const cant     = Number(item.cantidad ?? 1)
    const precio   = Number(item.subtotal ?? 0) / cant
    const subtotal = Number(item.subtotal ?? 0)

    doc.text(desc,                   ML + 2,      y)
    doc.text(String(cant),           ML + 95,     y, { align: 'right' })
    doc.text(fmtMoney(precio),       ML + 125,    y, { align: 'right' })
    doc.text(fmtMoney(subtotal),     ML + CW - 2, y, { align: 'right' })
    y += 6

    if (y > 240) {        // salto de página si hay muchos items
      doc.addPage()
      y = 20
    }
  }

  // ── Línea + Total ────────────────────────────────────────────────────────
  y += 2
  doc.setLineWidth(0.5).setDrawColor(0)
  doc.line(ML + CW * 0.55, y, PW - MR, y)
  y += 6
  doc.setFontSize(12).setFont('helvetica', 'bold')
  doc.text('Total:', ML + CW * 0.55, y)
  doc.text(fmtMoney(Number(venta.total)), PW - MR, y, { align: 'right' })

  // ── CAE ──────────────────────────────────────────────────────────────────
  y += 12
  doc.setLineWidth(0.3).setDrawColor(180)
  doc.line(ML, y - 4, PW - MR, y - 4)
  doc.setFontSize(8).setFont('helvetica', 'normal').setTextColor(80)
  doc.text(`CAE: ${venta.cae ?? ''}`, ML, y)
  doc.text(`Vto. CAE: ${fmtFecha(venta.cae_vto)}`, ML + 70, y)
  doc.text('Comprobante autorizado por ARCA (ex-AFIP)', ML, y + 5)
  doc.setTextColor(0)

  // ── QR de verificación ───────────────────────────────────────────────────
  try {
    const qrUrl  = buildQrUrl({
      cuit,
      ptoVta:  arcaConfig.punto_venta ?? 3,
      nroCmp:  venta.nro_factura ?? 0,
      importe: venta.total,
      cae:     venta.cae,
      fecha:   venta.fecha,
    })
    const qrDataUrl = await QRCode.toDataURL(qrUrl, { width: 80, margin: 1 })
    doc.addImage(qrDataUrl, 'PNG', PW - MR - 28, y - 12, 28, 28)
  } catch (_) {
    // QR no crítico, continuar sin él
  }

  // ── Pie ──────────────────────────────────────────────────────────────────
  doc.setFontSize(7).setTextColor(150)
  doc.text('Generado por CC Gestión', PW / 2, 290, { align: 'center' })
  doc.setTextColor(0)

  // ── Salida ────────────────────────────────────────────────────────────────
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
