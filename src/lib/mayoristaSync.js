import { supabase } from './supabase'
import { precioVenta } from './pricing'

// Cantidad de productos por request al sitio (el plugin acepta hasta 500).
const TANDA = 100

// Endpoint de sync a partir de la URL cargada en la tienda. Si se cargó sin
// "http(s)://", el navegador la trataría como una ruta de la propia app (y daría
// 404), así que se le agrega el protocolo: http para sitios locales (.local,
// localhost), https para el resto.
function endpointSync(url) {
  let base = String(url || '').trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(base)) {
    const host = base.split('/')[0].split(':')[0].toLowerCase()
    const local = host === 'localhost' || host === '127.0.0.1' || /\.(local|test|localhost)$/.test(host)
    base = (local ? 'http://' : 'https://') + base
  }
  return base + '/wp-json/mayorista/v1/sync'
}

/**
 * Envía productos al portal mayorista (plugin mayorista-panel en WordPress).
 *
 * Modelo push, igual que wooSync: acá se calcula el precio con la lista de la
 * tienda y se le manda al sitio ya listo, autenticado con el header
 * x-webhook-secret. WordPress no necesita acceso a esta base de datos.
 *
 * Qué productos van: todos. Los que quedan fuera de las subcategorías elegidas
 * en la tienda, o están inactivos, se envían con activo=false para que el
 * portal los oculte (si todavía no existen allá, el plugin los ignora).
 *
 * Nunca lanza: los errores se devuelven en el resultado para no interrumpir el
 * flujo de guardado.
 *
 * @param {object}   [opts]
 * @param {number[]} [opts.ids]     - solo estos productos (por id)
 * @param {string[]} [opts.skus]    - solo estos productos (por SKU)
 * @param {object}   [opts.tienda]  - forzar una tienda puntual (botón "Sincronizar ahora")
 * @returns {Promise<{ total:number, enviados:number, errores:number, sinTienda?:boolean, detalle?:string }>}
 */
export async function syncMayorista({ ids, skus, tienda } = {}) {
  try {
    let tiendas
    if (tienda) {
      tiendas = [tienda]
    } else {
      const { data } = await supabase.from('tiendas').select('*').eq('activa', true)
      tiendas = data || []
    }
    tiendas = tiendas.filter(t => t.tipo === 'mayorista' && t.url && t.webhook_secret)
    if (!tiendas.length) return { total: 0, enviados: 0, errores: 0, sinTienda: true }

    const [productos, { data: listas }, { data: categorias }, { data: subcategorias }] = await Promise.all([
      cargarProductos({ ids, skus }),
      supabase.from('listas_precios').select('*'),
      supabase.from('categorias').select('id, nombre'),
      supabase.from('subcategorias').select('id, nombre'),
    ])
    if (!productos.length) return { total: 0, enviados: 0, errores: 0 }

    const nombreCat = new Map((categorias || []).map(c => [String(c.id), c.nombre]))
    const nombreSub = new Map((subcategorias || []).map(s => [String(s.id), s.nombre]))
    const round2 = (n) => Math.round(n * 100) / 100

    let total = 0, enviados = 0, errores = 0
    let detalle = ''

    for (const t of tiendas) {
      const lista = (listas || []).find(l => String(l.id) === String(t.lista_id))
      const seleccion = (t.subcategorias_ids || []).map(String)

      const records = productos
        .filter(p => p.sku)
        .map(p => {
          const costo = Number(p.costo_base) || 0
          const enSeleccion = !seleccion.length || seleccion.includes(String(p.subcategoria_id))
          const normal = p.imagen_url || ''
          const web    = p.imagen_web_url || ''
          return {
            sku:          p.sku,
            nombre:       p.nombre,
            precio:       round2(lista ? precioVenta(costo, lista) : costo),
            categoria:    nombreCat.get(String(p.categoria_id)) || '',
            subcategoria: nombreSub.get(String(p.subcategoria_id)) || '',
            alto:         Number(p.alto_producto) || 0,
            ancho:        Number(p.ancho_producto) || 0,
            // Múltiplo de compra cargado en el producto (2 o 3). 0 = automático: el portal lo
            // define según el alto.
            multiplo:     [2, 3].includes(Number(p.multiplo_mayorista)) ? Number(p.multiplo_mayorista) : 0,
            // Para el catálogo mayorista manda la foto de catálogo; la "web" queda de respaldo.
            imagen:       normal || web,
            imagen_alt:   normal && web && normal !== web ? web : '',
            activo:       p.activo !== false && enSeleccion && costo > 0,
          }
        })

      const endpoint = endpointSync(t.url)
      for (let i = 0; i < records.length; i += TANDA) {
        const tanda = records.slice(i, i + TANDA)
        total += tanda.length
        try {
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-webhook-secret': t.webhook_secret },
            body: JSON.stringify({ records: tanda }),
            signal: AbortSignal.timeout(60000),
          })
          if (!res.ok) {
            const text = await res.text().catch(() => '')
            console.warn(`[mayoristaSync] ${t.nombre} → HTTP ${res.status}`, text)
            detalle = res.status === 401 ? 'El secret no coincide con el del sitio.'
                    : res.status === 403 ? 'El sitio todavía no tiene un secret configurado.'
                    : `El sitio respondió HTTP ${res.status}.`
            errores += tanda.length
          } else {
            enviados += tanda.length
          }
        } catch (err) {
          console.warn(`[mayoristaSync] No se pudo conectar con "${t.nombre}":`, err.message)
          detalle = 'No se pudo conectar con el sitio (¿URL correcta y enlaces permanentes activados?).'
          errores += tanda.length
        }
      }
    }

    return { total, enviados, errores, detalle }
  } catch (err) {
    console.warn('[mayoristaSync]', err)
    return { total: 0, enviados: 0, errores: 1, detalle: err.message }
  }
}

/**
 * Oculta en el portal mayorista productos que se eliminaron acá (ya no hay
 * datos para recalcular, solo se le avisa al sitio que los desactive).
 * Nunca lanza.
 */
export async function ocultarEnMayorista(skus) {
  try {
    const lista = (skus || []).filter(Boolean)
    if (!lista.length) return
    const { data } = await supabase.from('tiendas').select('*').eq('activa', true)
    const tiendas = (data || []).filter(t => t.tipo === 'mayorista' && t.url && t.webhook_secret)
    for (const t of tiendas) {
      await fetch(endpointSync(t.url), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-webhook-secret': t.webhook_secret },
        body: JSON.stringify({ records: lista.map(sku => ({ sku, activo: false })) }),
        signal: AbortSignal.timeout(30000),
      }).catch(err => console.warn('[mayoristaSync] ocultar:', err.message))
    }
  } catch (err) {
    console.warn('[mayoristaSync] ocultar:', err)
  }
}

// Trae los productos en páginas de 1000 (límite por consulta de PostgREST).
async function cargarProductos({ ids, skus }, conMultiplo = true) {
  const base = 'id, sku, nombre, costo_base, imagen_url, imagen_web_url, alto_producto, ancho_producto, categoria_id, subcategoria_id, activo'
  const cols = conMultiplo ? base + ', multiplo_mayorista' : base
  const out = []
  for (let desde = 0; ; desde += 1000) {
    let q = supabase.from('productos').select(cols).order('id').range(desde, desde + 999)
    if (ids?.length)  q = q.in('id', ids)
    if (skus?.length) q = q.in('sku', skus)
    const { data, error } = await q
    if (error) {
      // Si todavía no se corrió supabase_mayorista.sql, la columna no existe: se envía sin múltiplo.
      if (conMultiplo && /multiplo_mayorista/.test(error.message || '')) return cargarProductos({ ids, skus }, false)
      throw error
    }
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return out
}
