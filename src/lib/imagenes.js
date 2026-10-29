import UPNG from 'upng-js'
import { supabase } from './supabase.js'

// Cada producto tiene su foto en dos versiones:
//   · ORIGINAL (productos.imagen_url): calidad completa. Es la que usan los creativos, Mercado Libre, la web y el portal.
//   · LIVIANA (hasta 1200 px, ~30 KB): solo para mostrar en pantallas (listas, punto de venta, catálogo público),
//     para no gastar ancho de banda. Se genera con scripts/generar-livianas.mjs y vive en productos/lite/v1/.
// El nombre lleva el código Y el nombre del archivo original: si la original cambia, la liviana vieja no coincide
// y la pantalla cae a la original (nunca se muestra una foto desactualizada).
export const VERSION_LIVIANA = 'v1'

/** "<SKU>_<archivo-original-sin-extensión>.png" */
export function nombreLiviana(sku, urlOriginal) {
  const archivo = String(urlOriginal || '').split('?')[0].split('/').pop().replace(/\.[a-z0-9]+$/i, '')
  return `${sku}_${archivo}.png`
}

/** URL pública de la versión liviana (puede no existir todavía: quien la use debe tener un respaldo). */
export function urlLiviana(sku, urlOriginal) {
  if (!sku || !urlOriginal) return null
  return supabase.storage.from('productos').getPublicUrl(`lite/${VERSION_LIVIANA}/${nombreLiviana(sku, urlOriginal)}`).data.publicUrl
}

// ── Generar la liviana desde el navegador ───────────────────────────────────────────────────────

const LADO_LIVIANA = 1200

function cargarImagen(fuente) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'   // el Storage responde con CORS abierto: así el canvas se puede leer
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('No se pudo cargar la imagen original.'))
    img.src = typeof fuente === 'string' ? fuente : URL.createObjectURL(fuente)
  })
}

/**
 * Arma la versión liviana: hasta 1200 px de lado y PNG con paleta de colores (conserva la transparencia).
 * @param {string|Blob} fuente  URL o archivo de la foto original
 * @returns {Promise<Blob|null>} el PNG liviano, o null si no conviene (la original ya es más chica)
 */
export async function generarLiviana(fuente, bytesOriginal = null, colores = 64) {
  const img = await cargarImagen(fuente)
  const k = Math.min(1, LADO_LIVIANA / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k))
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, w, h)
  const { data } = ctx.getImageData(0, 0, w, h)
  const png = UPNG.encode([data.buffer], w, h, colores)   // cuantización a paleta de colores (conserva la transparencia)
  const blob = new Blob([png], { type: 'image/png' })
  // Nunca empeorar: si la liviana no es más chica que la original, no tiene sentido generarla.
  if (bytesOriginal && blob.size >= bytesOriginal) return null
  return blob
}

/**
 * Se asegura de que la foto principal de un producto tenga su liviana en el Storage (la crea o la reemplaza).
 * Es "mejor esfuerzo": nunca lanza ni frena el guardado; si falla, las pantallas usan la original.
 * @returns {Promise<boolean>} true si quedó subida
 */
export async function asegurarLiviana(sku, urlOriginal) {
  try {
    if (!sku || !urlOriginal) return false
    const r = await fetch(urlOriginal)
    if (!r.ok) return false
    const original = await r.blob()
    const liviana = await generarLiviana(original, original.size)
    if (!liviana) return false
    const { error } = await supabase.storage.from('productos').upload(`lite/${VERSION_LIVIANA}/${nombreLiviana(sku, urlOriginal)}`, liviana, {
      upsert: true, contentType: 'image/png', cacheControl: '31536000',
    })
    if (error) { console.warn('[liviana]', error.message); return false }
    return true
  } catch (err) {
    console.warn('[liviana]', err.message || err)
    return false
  }
}

/**
 * Achica una foto (por ejemplo, las que manda un cliente por WhatsApp, de 3-5 MB) a un JPG de hasta `lado` px.
 * Si la imagen no se puede leer, devuelve el archivo tal cual.
 */
export async function optimizarFoto(archivo, lado = 1600, calidad = 0.85) {
  try {
    const img = await cargarImagen(archivo)
    const k = Math.min(1, lado / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k))
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h)        // el JPG no tiene transparencia: fondo blanco
    ctx.drawImage(img, 0, 0, w, h)
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', calidad))
    return blob && blob.size < archivo.size ? blob : archivo
  } catch {
    return archivo
  }
}
