import { supabase } from './supabase.js'
import { precioVenta } from './pricing.js'

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
      supabase.from('categorias').select('id, nombre, es_mayorista'),
      supabase.from('subcategorias').select('id, nombre'),
    ])
    if (!productos.length) return { total: 0, enviados: 0, errores: 0 }

    const nombreCat = new Map((categorias || []).map(c => [String(c.id), c.nombre]))
    const nombreSub = new Map((subcategorias || []).map(s => [String(s.id), s.nombre]))
    const catMayorista = new Set((categorias || []).filter(c => c.es_mayorista).map(c => String(c.id)))

    // Composición de los combos: sku y nombre de cada producto componente (el portal la muestra al entrar al combo).
    const idsComp = [...new Set(productos.flatMap(p => (p.combo_items || []).map(i => i.producto_id)).filter(Boolean))]
    const compPorId = new Map()
    for (let i = 0; i < idsComp.length; i += 200) {
      const { data } = await supabase.from('productos').select('id, sku, nombre').in('id', idsComp.slice(i, i + 200))
      for (const c of data || []) compPorId.set(String(c.id), c)
    }
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
          const esCombo = Array.isArray(p.combo_items) && p.combo_items.length > 0
          // Un combo no pertenece a una subcategoría de las que se eligen para la tienda: va si se lo asignó a
          // esta tienda (casilla de tiendas del combo) o si su categoría es mayorista. Lo demás, por subcategoría.
          const enSeleccion = esCombo
            ? (p.tiendas_ids || []).map(String).includes(String(t.id)) || catMayorista.has(String(p.categoria_id))
            : (!seleccion.length || seleccion.includes(String(p.subcategoria_id)))
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
            // define según el alto (entre 24 y 36 cm → 3; el resto → 2).
            multiplo:     [2, 3].includes(Number(p.multiplo_mayorista)) ? Number(p.multiplo_mayorista) : 0,
            // Para el catálogo mayorista manda la foto de catálogo; la "web" queda de respaldo.
            imagen:       normal || web,
            imagen_alt:   normal && web && normal !== web ? web : '',
            activo:       p.activo !== false && enSeleccion && costo > 0,
            // Solo los combos llevan composición: [{ sku, cantidad, nombre }] en el orden del combo.
            ...(esCombo ? {
              combo: p.combo_items
                .map(i => ({ c: compPorId.get(String(i.producto_id)), cantidad: Number(i.cantidad) || 0 }))
                .filter(x => x.c?.sku && x.cantidad > 0)
                .map(x => ({ sku: x.c.sku, cantidad: x.cantidad, nombre: x.c.nombre })),
            } : {}),
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
 * Trae del portal mayorista el múltiplo (= cantidad mínima) REAL de cada producto, tal como lo ve el
 * cliente: el portal respeta lo que se mandó explícito desde acá, las ediciones manuales en WordPress
 * y, si no hay nada, su propia regla por alto. Así el armado de combos usa el mismo número que la web.
 * Solo lectura (no modifica nada en el sitio). Nunca lanza: si el sitio no responde, o todavía no tiene
 * el endpoint (plugin anterior a 1.5.5 → 404), devuelve { mapa: null, motivo }.
 *
 * @param {string[]} [skus] - si falta, trae todos los productos publicados
 * @returns {Promise<{ mapa: Map<string, number> | null, motivo?: string, tienda?: string }>}
 */
export async function traerMultiplosPortal(skus) {
  try {
    const { data } = await supabase.from('tiendas').select('*').eq('activa', true)
    const t = (data || []).find(x => x.tipo === 'mayorista' && x.url && x.webhook_secret)
    if (!t) return { mapa: null, motivo: 'No hay una tienda mayorista activa configurada.' }
    const endpoint = endpointSync(t.url).replace(/\/sync$/, '/multiplos')
    const lista = [...new Set((skus || []).filter(Boolean))]
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-webhook-secret': t.webhook_secret },
      body: JSON.stringify(lista.length && lista.length <= 1000 ? { skus: lista } : {}),
      signal: AbortSignal.timeout(20000),
    })
    if (res.status === 404) return { mapa: null, tienda: t.nombre, motivo: 'El portal todavía no tiene la versión del plugin que informa los múltiplos.' }
    if (!res.ok) return { mapa: null, tienda: t.nombre, motivo: `El portal respondió HTTP ${res.status}.` }
    const json = await res.json()
    const mapa = new Map()
    for (const p of json.productos || []) {
      const m = Number(p.multiplo ?? p.minimo)
      if (p.sku && m > 0) mapa.set(p.sku, m)
    }
    return { mapa, tienda: t.nombre }
  } catch (err) {
    return { mapa: null, motivo: 'No se pudo consultar el portal: ' + err.message }
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
  const base = 'id, sku, nombre, costo_base, imagen_url, imagen_web_url, alto_producto, ancho_producto, categoria_id, subcategoria_id, activo, combo_items, tiendas_ids'
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
