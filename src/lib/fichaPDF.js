import { jsPDF } from 'jspdf'
import { fmtNum } from './format'
import { fetchImageAsDataURL, resizeImageToDataURL } from './pdf'

// Estilo "ficha de taller" que comparten el presupuesto, el ticket y la factura.

const TINTA = [29, 30, 32]
const SUAVE = [99, 102, 107]
const LINEA = [217, 217, 214]
const GRIS = [243, 243, 241]
const NARANJA = [245, 138, 51]
export const COLOR_OK = [22, 101, 52]
export const COLOR_ALERTA = [185, 86, 15]

const LINEA_FUERTE = 1.1
const LINEA_FINA = 0.7
const OPACIDAD_SELLO = 0.075

const FUENTES = [
  ['PlexSans-Regular.ttf', 'PlexSans', 'normal'],
  ['PlexSans-SemiBold.ttf', 'PlexSans', 'bold'],
  ['PlexMono-Regular.ttf', 'PlexMono', 'normal'],
  ['PlexMono-SemiBold.ttf', 'PlexMono', 'bold'],
]
let fuentes = null

function aBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let t = ''
  for (let i = 0; i < bytes.length; i += 0x8000) t += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(t)
}

// Sin las fuentes (por ejemplo, sin internet) el documento sale igual, con las de base del PDF.
function cargarFuentes() {
  fuentes ??= Promise.all(FUENTES.map(async ([archivo]) => {
    const r = await fetch(`/fonts/${archivo}`)
    if (!r.ok) throw new Error(archivo)
    return aBase64(await r.arrayBuffer())
  })).catch((err) => {
    console.warn('[pdf] no se pudieron cargar las fuentes', err)
    fuentes = null
    return null
  })
  return fuentes
}

export const fmtFecha = (d) => {
  const s = String(d ?? '')
  if (/^\d{4}-\d{2}-\d{2}/.test(s) && s.length <= 10) return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`
  const f = d ? new Date(d) : new Date()
  return f.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** Una hoja lista para dibujar. `media` es medio A4 apaisado, del mismo ancho que el A4. */
export async function crearFicha({ tamano = 'a4', branding = {} }) {
  const media = tamano === 'media'
  const doc = new jsPDF({ unit: 'pt', format: media ? [595.28, 419.53] : 'a4', orientation: media ? 'landscape' : 'portrait', compress: true })
  const datos = await cargarFuentes()
  if (datos) FUENTES.forEach(([archivo, nombre, estilo], i) => {
    doc.addFileToVFS(archivo, datos[i])
    doc.addFont(archivo, nombre, estilo)
  })
  const logo = await fetchImageAsDataURL(branding?.logo_url)
  let medidas = null
  if (logo) { try { medidas = doc.getImageProperties(logo) } catch { /* el documento sale sin logo */ } }
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const m = media ? 19 : 26
  return {
    doc, media, W, H,
    fs: media ? 10.2 : 10,
    pad: media ? 8 : 9,
    x0: m, x1: W - m, y0: m, y1: H - m,
    sans: datos ? 'PlexSans' : 'helvetica',
    mono: datos ? 'PlexMono' : 'courier',
    logo: medidas ? logo : null,
    medidas,
  }
}

export function texto(c, t, x, y, { mono, bold, size, color = TINTA, align } = {}) {
  c.doc.setFont(mono ? c.mono : c.sans, bold ? 'bold' : 'normal')
  c.doc.setFontSize(size ?? c.fs)
  c.doc.setTextColor(...color)
  c.doc.text(String(t ?? ''), x, y, align ? { align } : undefined)
}

function linea(c, x1, y1, x2, y2, ancho = LINEA_FINA, color = TINTA) {
  c.doc.setDrawColor(...color)
  c.doc.setLineWidth(ancho)
  c.doc.line(x1, y1, x2, y2)
}

/** Dibuja la imagen sin deformarla, centrada en el recuadro. */
function imagenDentro(c, data, medidas, x, y, w, h, alias) {
  const escala = Math.min(w / medidas.width, h / medidas.height)
  const iw = medidas.width * escala
  const ih = medidas.height * escala
  c.doc.addImage(data, medidas.fileType, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih, alias, 'FAST')
}

export function logoEn(c, x, y, w, h) {
  if (c.logo) imagenDentro(c, c.logo, c.medidas, x, y, w, h, 'logo')
}

function selloDeAgua(c) {
  if (!c.logo) return
  const ancho = c.media ? 190 : 365
  const alto = ancho * c.medidas.height / c.medidas.width
  c.doc.saveGraphicsState()
  c.doc.setGState(new c.doc.GState({ opacity: OPACIDAD_SELLO }))
  logoEn(c, (c.W - ancho) / 2, (c.H - alto) / 2, ancho, alto)
  c.doc.restoreGraphicsState()
}

// Una celda es una lista de renglones: { et } es un rótulo; { t } es un valor, con { mono, bold, color }.
const alturaRenglon = (c, r) => (r.et ? c.fs * 1.05 : c.fs * 1.32)

function renglonesPartidos(c, celda, ancho) {
  return celda.flatMap((r) => {
    if (r.et != null || !r.t) return [r]
    c.doc.setFont(r.mono ? c.mono : c.sans, r.bold ? 'bold' : 'normal')
    c.doc.setFontSize(c.fs)
    return c.doc.splitTextToSize(String(r.t), ancho).map((t) => ({ ...r, t }))
  })
}

export function dibujarCelda(c, celda, x, y) {
  let yy = y
  for (const r of celda) {
    yy += alturaRenglon(c, r)
    if (r.et != null) texto(c, String(r.et).toUpperCase(), x, yy - 1, { mono: true, size: c.fs * 0.72, color: SUAVE })
    else texto(c, r.t, x, yy - 2, r)
  }
  return yy
}

/** Fila de recuadros de lado a lado. Cada uno lleva { f: parte del ancho, celda }. Devuelve dónde termina. */
export function filaCeldas(c, y, celdas) {
  const total = celdas.reduce((s, d) => s + (d.f ?? 1), 0)
  const ancho = c.x1 - c.x0
  let x = c.x0
  const armadas = celdas.map((d) => {
    const w = ancho * (d.f ?? 1) / total
    const rs = renglonesPartidos(c, d.celda, w - c.pad * 2)
    const a = { x, w, rs, alto: rs.reduce((s, r) => s + alturaRenglon(c, r), 0) }
    x += w
    return a
  })
  const alto = Math.max(...armadas.map((a) => a.alto)) + c.pad * 1.2
  armadas.forEach((a, i) => {
    if (i) linea(c, a.x, y, a.x, y + alto)
    dibujarCelda(c, a.rs, a.x + c.pad, y + c.pad * 0.5)
  })
  linea(c, c.x0, y + alto, c.x1, y + alto, LINEA_FUERTE)
  return y + alto
}

/** Encabezado de presupuesto y ticket: logo a la izquierda, título y número arriba, campos abajo. */
export function cabeceraDoc(c, y, { titulo, numero, campos }) {
  const anchoLogo = c.media ? 70 : 104
  const alto = c.media ? 72 : 108
  const altoTit = c.media ? 30 : 38
  const xc = c.x0 + anchoLogo
  logoEn(c, c.x0 + 6, y + 5, anchoLogo - 12, alto - 10)
  linea(c, xc, y, xc, y + alto)
  linea(c, xc, y + altoTit, c.x1, y + altoTit)
  texto(c, titulo, xc + c.pad, y + altoTit - (c.media ? 10 : 13), { bold: true, size: c.fs * (c.media ? 1.6 : 1.9) })
  if (numero) texto(c, numero, c.x1 - c.pad, y + altoTit - (c.media ? 10 : 13), { mono: true, align: 'right' })
  const w = (c.x1 - xc) / campos.length
  campos.forEach((celda, i) => {
    const x = xc + w * i
    if (i) linea(c, x, y + altoTit, x, y + alto)
    dibujarCelda(c, celda, x + c.pad, y + altoTit + c.pad * 0.5)
  })
  linea(c, c.x0, y + alto, c.x1, y + alto, LINEA_FUERTE)
  return y + alto
}

// ── Tabla de productos ───────────────────────────────────────────────────────

const ANCHO_CANT = 44
const ANCHO_UNIT = 84
const ANCHO_SUB = 88
const LADO_FOTO = 26

function columnas(c) {
  const sub = c.x1 - c.pad
  const unit = sub - ANCHO_SUB
  const cant = unit - ANCHO_UNIT
  return { nombre: c.x0 + c.pad, cant, unit, sub, anchoNombre: cant - ANCHO_CANT - c.x0 - c.pad }
}

const altoFilaBase = (c) => c.fs * 1.32 + (c.media ? 8 : 14)

function altoFila(c, fila) {
  const col = columnas(c)
  c.doc.setFont(c.sans, 'normal')
  c.doc.setFontSize(c.fs)
  const lineas = c.doc.splitTextToSize(String(fila.nombre ?? ''), col.anchoNombre - (fila.foto ? LADO_FOTO + 6 : 0))
  const alto = altoFilaBase(c) + (lineas.length - 1) * c.fs * 1.25
  return { lineas, alto: Math.max(alto, fila.foto ? LADO_FOTO + 6 : 0) }
}

/** Alto que ocupa la tabla completa: sirve para decidir si entra en media hoja. */
export function altoTabla(c, filas) {
  return c.fs * 1.9 + filas.reduce((s, f) => s + altoFila(c, f).alto, 0)
}

function cabezalTabla(c, y) {
  const col = columnas(c)
  const alto = c.fs * 1.9
  c.doc.setFillColor(...GRIS)
  c.doc.rect(c.x0, y, c.x1 - c.x0, alto, 'F')
  const b = y + alto * 0.66
  const o = { mono: true, size: c.fs * 0.76 }
  texto(c, 'Producto', col.nombre, b, o)
  texto(c, 'Cant.', col.cant, b, { ...o, align: 'right' })
  texto(c, 'P. unit.', col.unit, b, { ...o, align: 'right' })
  texto(c, 'Subtotal', col.sub, b, { ...o, align: 'right' })
  linea(c, c.x0, y + alto, c.x1, y + alto)
  return y + alto
}

function filaTabla(c, y, fila, medida) {
  const col = columnas(c)
  const { lineas, alto } = medida
  const b = y + (alto - (lineas.length - 1) * c.fs * 1.25) / 2 + c.fs * 0.34
  let x = col.nombre
  if (fila.foto) {
    try { imagenDentro(c, fila.foto.data, fila.foto.medidas, x, y + (alto - LADO_FOTO) / 2, LADO_FOTO, LADO_FOTO) } catch { /* sin foto */ }
    x += LADO_FOTO + 6
  }
  lineas.forEach((l, i) => texto(c, l, x, b + i * c.fs * 1.25))
  const o = { mono: true, size: c.fs * 0.95, align: 'right' }
  texto(c, fmtNum(fila.cantidad, Number.isInteger(Number(fila.cantidad)) ? 0 : 2), col.cant, b, o)
  texto(c, fmtNum(fila.precio), col.unit, b, o)
  texto(c, fmtNum(fila.subtotal), col.sub, b, o)
  linea(c, c.x0, y + alto, c.x1, y + alto, LINEA_FINA, LINEA)
  return y + alto
}

/** Foto de un producto, achicada para que el PDF no pese de más. Sin foto o si falla, null. */
export async function fotoDeProducto(c, url) {
  const data = await fetchImageAsDataURL(url)
  if (!data) return null
  const chica = await resizeImageToDataURL(data, 120, 120, 0.8)
  try { return { data: chica, medidas: c.doc.getImageProperties(chica) } } catch { return null }
}

// ── Armado de las hojas ──────────────────────────────────────────────────────

/** Bloque del pie: datos a la izquierda y el total en naranja. Devuelve dónde termina. */
export function bloqueTotal(c, y, alto, { izquierda, dibujarIzquierda, etiqueta, total }) {
  const anchoTotal = 170
  const xt = c.x1 - anchoTotal
  c.doc.setFillColor(...NARANJA)
  c.doc.rect(xt, y, anchoTotal, alto, 'F')
  linea(c, c.x0, y, c.x1, y, LINEA_FUERTE)
  linea(c, xt, y, xt, y + alto, LINEA_FUERTE)
  if (izquierda) dibujarCelda(c, renglonesPartidos(c, izquierda, xt - c.x0 - c.pad * 2), c.x0 + c.pad, y + c.pad * 0.5)
  if (dibujarIzquierda) dibujarIzquierda(xt)
  texto(c, String(etiqueta).toUpperCase(), c.x1 - c.pad, y + c.pad + c.fs * 0.5, { mono: true, size: c.fs * 0.72, align: 'right' })
  texto(c, total, c.x1 - c.pad, y + alto - c.pad * 0.9, { mono: true, bold: true, size: c.fs * 1.6, align: 'right' })
  return y + alto
}

export function lineaContacto(c, y, partes) {
  const b = y + c.fs * 1.2
  const o = { mono: true, size: c.fs * 0.76 }
  const lista = partes.filter(Boolean)
  linea(c, c.x0, y, c.x1, y)
  if (lista[0]) texto(c, lista[0], c.x0 + c.pad, b, o)
  if (lista[2]) texto(c, lista[2], c.x1 - c.pad, b, { ...o, align: 'right' })
  if (lista[1]) texto(c, lista[1], lista[2] ? (c.x0 + c.x1) / 2 : c.x1 - c.pad, b, { ...o, align: lista[2] ? 'center' : 'right' })
}

export const altoContacto = (c) => c.fs * 1.75

export const contactoDe = (b) => [b?.direccion, b?.telefono, b?.web_minorista || b?.web_mayorista]

/**
 * Arma el documento: sello, encabezado, tabla (sigue en otra hoja con el mismo encabezado) y pie en la última.
 * @param {{ cabecera: (y: number) => number, filas: object[], altoFinal: number, final: (y: number) => void, contacto?: string[] }} partes
 */
export function armarDocumento(c, { cabecera, filas, altoFinal, final, contacto }) {
  const altoPie = contacto ? altoContacto(c) : 0
  const cerrarHoja = () => {
    if (contacto) lineaContacto(c, c.y1 - altoPie, contacto)
    c.doc.setDrawColor(...TINTA)
    c.doc.setLineWidth(LINEA_FUERTE)
    c.doc.rect(c.x0, c.y0, c.x1 - c.x0, c.y1 - c.y0, 'S')
  }
  const abrirHoja = () => {
    selloDeAgua(c)
    return cabezalTabla(c, cabecera(c.y0))
  }
  let y = abrirHoja()
  const yFinal = c.y1 - altoPie - altoFinal
  for (const [i, fila] of filas.entries()) {
    const medida = altoFila(c, fila)
    // El último renglón acompaña al total: el total nunca queda solo en una hoja vacía
    const limite = i === filas.length - 1 ? yFinal : c.y1 - altoPie
    if (y + medida.alto > limite) {
      cerrarHoja()
      c.doc.addPage()
      y = abrirHoja()
    }
    y = filaTabla(c, y, fila, medida)
  }
  final(yFinal)
  cerrarHoja()
  const hojas = c.doc.getNumberOfPages()
  if (hojas > 1) {
    for (let i = 1; i <= hojas; i++) {
      c.doc.setPage(i)
      texto(c, `Hoja ${i} de ${hojas}`, c.x1, c.y0 - 5, { mono: true, size: c.fs * 0.72, color: SUAVE, align: 'right' })
    }
  }
}
