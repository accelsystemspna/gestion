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
