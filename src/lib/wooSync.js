import { precioVenta } from './pricing'
import { mejorLineaConPromo } from './promos'

/**
 * Envía un producto a todas las tiendas WooCommerce activas que tiene asignadas.
 * Se llama en background después de guardar — los errores no interrumpen el flujo.
 *
 * @param {object[]} tiendas  - Tiendas con: id, tipo, activa, url, webhook_secret, lista_id
 * @param {object[]} listas   - Listas de precios completas (para calcular precio por tienda)
 * @param {object}   producto - { sku, nombre, costo_base, imagen_web_url, imagen_url, activo, tiendas_ids }
 * @returns {Promise<boolean>} true si se sincronizó al menos una tienda sin error
 */
export async function syncToWoo({ tiendas, listas, producto, promos = [] }) {
  const ids = (producto.tiendas_ids || []).map(String)

  const wooTiendas = tiendas.filter(
    t =>
      t.tipo === 'woocommerce' &&
      t.activa &&
      t.url &&
      t.webhook_secret &&
      ids.includes(String(t.id))
  )

  let ok = true

  for (const tienda of wooTiendas) {
    const lista  = listas.find(l => String(l.id) === String(tienda.lista_id))
    const costo  = Number(producto.costo_base) || 0
    const base   = lista ? precioVenta(costo, lista) : costo
    // Solo los tipos de promo "por unidad" (%, $) se reflejan en el precio
    // que ve la web — 2x1/3x2/2da unidad todavía necesitan lógica de
    // carrito del lado de WordPress, así que por ahora quedan afuera.
    const { promo, subtotal } = mejorLineaConPromo(promos, producto, 'web', base, 1)
    const precio = promo && (promo.tipo === 'descuento_pct' || promo.tipo === 'descuento_monto') ? subtotal : base

    const payload = {
      type: 'UPDATE',
      record: {
        sku:              producto.sku,
        name:             producto.nombre,
        description:      producto.descripcion || '',
        price:            String(Math.round(precio * 100) / 100),
        image_url:        producto.imagen_web_url || producto.imagen_url || '',
        gallery_urls:     producto.imagenes_web || [],
        activo:           producto.activo !== false,
        seo_title:        producto.seo_titulo || '',
        seo_description:  producto.seo_descripcion || '',
        weight:           producto.peso_kg ?? '',
        dimensions: {
          length: producto.paquete_largo ?? '',
          width:  producto.paquete_ancho ?? '',
          height: producto.paquete_alto  ?? '',
        },
      },
    }

    const webhookUrl = tienda.url.replace(/\/$/, '') + '/wp-json/accel-sync/v1/webhook'

    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-webhook-secret':  tienda.webhook_secret,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        console.warn(`[wooSync] ${tienda.nombre} → HTTP ${res.status}`, text)
        ok = false
      } else {
        console.log(`[wooSync] ${tienda.nombre} → OK (SKU: ${producto.sku})`)
      }
    } catch (err) {
      console.warn(`[wooSync] No se pudo conectar con "${tienda.nombre}":`, err.message)
      ok = false
    }
  }

  return ok
}

/**
 * Sincroniza en lote una lista de productos (los que tengan tiendas_ids asignadas).
 * Pensado para re-sincronizaciones masivas: cambio de lista de precios, cambio de
 * precio de un material que afecta a muchos productos, botón "Sincronizar todo", etc.
 * Ejecuta los envíos de a poco (en tandas) para no saturar el servidor de WordPress.
 *
 * @returns {Promise<{ total: number, sincronizados: number, errores: number }>}
 */
export async function syncManyToWoo(productos, { tiendas, listas, promos = [] }, { batchSize = 5 } = {}) {
  const candidatos = (productos || []).filter(p => p.tiendas_ids?.length)
  let sincronizados = 0
  let errores = 0

  for (let i = 0; i < candidatos.length; i += batchSize) {
    const tanda = candidatos.slice(i, i + batchSize)
    const resultados = await Promise.all(
      tanda.map(producto =>
        syncToWoo({ tiendas, listas, producto, promos }).catch(() => false)
      )
    )
    for (const r of resultados) r ? sincronizados++ : errores++
  }

  return { total: candidatos.length, sincronizados, errores }
}
