// Arma UNA imagen con varias (la miniatura de un combo: todos los cuadros que lo forman, más chicos).
// Se dibuja en un <canvas> del navegador: no usa ningún servicio externo.

function cargar(url) {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'   // el storage de Supabase responde con CORS abierto: así el canvas no queda "contaminado"
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

/**
 * Distribuye n elementos en una grilla casi cuadrada (4 → 2×2, 7 → 3×3 con la última fila centrada, 13 → 4×4…).
 * @returns {{ filas: number, cols: number, porFila: number[] }}
 */
export function grilla(n) {
  if (n <= 0) return { filas: 0, cols: 0, porFila: [] }
  const cols = Math.ceil(Math.sqrt(n))
  const filas = Math.ceil(n / cols)
  const porFila = Array.from({ length: filas }, (_, i) => (i < filas - 1 ? cols : n - cols * (filas - 1)))
  return { filas, cols, porFila }
}

/**
 * @param {string[]} urls   imágenes (se ignoran las que no carguen)
 * @param {{ tam?: number, fondo?: string, margen?: number, separacion?: number }} [opts]
 * @returns {Promise<{ blob: Blob, usadas: number }>}
 */
export async function armarCollage(urls, { tam = 1200, fondo = '#ffffff', margen = 0.05, separacion = 0.025 } = {}) {
  const imgs = (await Promise.all(urls.map(cargar))).filter(Boolean)
  if (imgs.length === 0) throw new Error('No se pudo cargar ninguna imagen.')

  const { filas, cols, porFila } = grilla(imgs.length)
  const canvas = document.createElement('canvas')
  canvas.width = tam
  canvas.height = tam
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = fondo
  ctx.fillRect(0, 0, tam, tam)
  ctx.imageSmoothingQuality = 'high'

  const m = Math.round(tam * margen)
  const gap = Math.round(tam * separacion)
  // Casillero cuadrado: entra el más chico entre lo que da el ancho y lo que da el alto.
  const celda = Math.floor(Math.min((tam - 2 * m - gap * (cols - 1)) / cols, (tam - 2 * m - gap * (filas - 1)) / filas))
  const altoTotal = filas * celda + (filas - 1) * gap
  const y0 = Math.round((tam - altoTotal) / 2)

  let k = 0
  for (let f = 0; f < filas; f++) {
    const enFila = porFila[f]
    const anchoFila = enFila * celda + (enFila - 1) * gap
    const x0 = Math.round((tam - anchoFila) / 2)   // la última fila (incompleta) queda centrada
    for (let c = 0; c < enFila; c++) {
      const img = imgs[k++]
      const esc = Math.min(celda / img.naturalWidth, celda / img.naturalHeight)   // "contain": nunca se deforma
      const w = Math.round(img.naturalWidth * esc)
      const h = Math.round(img.naturalHeight * esc)
      ctx.drawImage(img, x0 + c * (celda + gap) + Math.round((celda - w) / 2), y0 + f * (celda + gap) + Math.round((celda - h) / 2), w, h)
    }
  }

  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo generar la imagen.'))), 'image/jpeg', 0.92))
  return { blob, usadas: imgs.length }
}
