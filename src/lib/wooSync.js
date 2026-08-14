import { precioVenta } from './pricing'

/**
 * Envía un producto a todas las tiendas WooCommerce activas que tiene asignadas.
 * Se llama en background después de guardar — los errores no interrumpen el flujo.
 *
 * @param {object[]} tiendas  - Tiendas con: id, tipo, activa, url, webhook_secret, lista_id
 * @param {object[]} listas   - Listas de precios completas (para calcular precio por tienda)
 * @param {object}   producto - { sku, nombre, costo_base, imagen_web_url, imagen_url, activo, tiendas_ids }
 */
export async function syncToWoo({ tiendas, listas, producto }) {
  const ids = (producto.tiendas_ids || []).map(String)

  const wooTiendas = tiendas.filter(
    t =>
      t.tipo === 'woocommerce' &&
      t.activa &&
      t.url &&
      t.webhook_secret &&
      ids.includes(String(t.id))
  )

  for (const tienda of wooTiendas) {
    const lista  = listas.find(l => String(l.id) === String(tienda.lista_id))
    const costo  = Number(producto.costo_base) || 0
    const precio = lista ? precioVenta(costo, lista) : costo

    const payload = {
      type: 'UPDATE',
      record: {
        sku:              producto.sku,
        name:             producto.nombre,
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
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        console.warn(`[wooSync] ${tienda.nombre} → HTTP ${res.status}`, text)
      } else {
        console.log(`[wooSync] ${tienda.nombre} → OK (SKU: ${producto.sku})`)
      }
    } catch (err) {
      console.warn(`[wooSync] No se pudo conectar con "${tienda.nombre}":`, err.message)
    }
  }
}
