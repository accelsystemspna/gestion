import { precioVenta } from './pricing'
import { promoDeProducto, calcularLineaConPromo, etiquetaOferta } from './promos'

/**
 * Resuelve categorias_web_ids (ids de subcategorías) a sus nombres, para
 * mandarlos como texto en el payload de sync. Usar antes de syncToWoo /
 * syncManyToWoo en cualquier lugar que dispare un re-sync masivo, para no
 * perder las categorías asignadas de cada producto.
 */
export function conCategoriasWeb(producto, subcategorias) {
  return {
    ...producto,
    categorias_web: (producto.categorias_web_ids || [])
      .map(id => subcategorias.find(s => String(s.id) === String(id))?.nombre)
      .filter(Boolean),
  }
}

/**
 * Envía un producto a todas las tiendas WooCommerce activas que tiene asignadas.
 * Se llama en background después de guardar — los errores no interrumpen el flujo.
 *
 * @param {object[]} tiendas  - Tiendas con: id, tipo, activa, url, webhook_secret, lista_id
 * @param {object[]} listas   - Listas de precios completas (para calcular precio por tienda)
 * @param {object}   producto - { sku, nombre, costo_base, imagen_web_url, imagen_url, activo, tiendas_ids }
 * @returns {Promise<boolean>} true si se sincronizó al menos una tienda sin error
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

  let ok = true

  for (const tienda of wooTiendas) {
    const lista  = listas.find(l => String(l.id) === String(tienda.lista_id))
    const costo  = Number(producto.costo_base) || 0
    const base   = lista ? precioVenta(costo, lista) : costo
    // Las ofertas "por unidad" (%, $) se reflejan como precio tachado + nuevo
    // precio (regular_price/sale_price). Las "por cantidad" (2x1, 3x2, 2da
    // unidad a %) no cambian el precio — se mandan aparte en `oferta` para
    // que WordPress arme la regla de carrito. `oferta_badge` trae el texto
    // ya armado (ej. "-20%", "2x1") para no tener que recalcularlo allá.
    const promo = promoDeProducto(producto, 'web')
    const esOferta = promo && (promo.tipo === 'descuento_pct' || promo.tipo === 'descuento_monto')
    const precioOferta = esOferta ? calcularLineaConPromo(base, 1, promo).subtotal : null
    const round2 = (n) => Math.round(n * 100) / 100
    const pctOff = esOferta && base > 0 ? Math.round((1 - precioOferta / base) * 100) : null

    const esOfertaPorCantidad = promo && (promo.tipo === 'nxm' || promo.tipo === 'segunda_unidad_pct')
    const ofertaCantidad = esOfertaPorCantidad ? {
      tipo:        producto.promo_tipo,
      valor:       producto.promo_valor,
      lleva:       producto.promo_lleva,
      paga:        producto.promo_paga,
      fecha_desde: producto.promo_fecha_desde || null,
      fecha_hasta: producto.promo_fecha_hasta || null,
    } : null

    const payload = {
      type: 'UPDATE',
      record: {
        sku:              producto.sku,
        name:             producto.nombre,
        description:      producto.descripcion || '',
        // Compatibilidad: precio final (con oferta aplicada, si la hay)
        price:            String(round2(esOferta ? precioOferta : base)),
        // Para que WooCommerce muestre precio tachado + nuevo precio + "Sale!":
        // regular_price = precio de lista, sale_price = precio con oferta
        // (vacío = sin oferta, no tocar el precio regular).
        regular_price:    String(round2(base)),
        sale_price:       esOferta ? String(round2(precioOferta)) : '',
        on_sale:          !!esOferta,
        discount_percent: pctOff,
        oferta:           ofertaCantidad,
        oferta_badge:     etiquetaOferta(promo),
        image_url:        producto.imagen_web_url || producto.imagen_url || '',
        gallery_urls:     producto.imagenes_web || [],
        categories:       producto.categorias_web || [],
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
export async function syncManyToWoo(productos, { tiendas, listas }, { batchSize = 5 } = {}) {
  const candidatos = (productos || []).filter(p => p.tiendas_ids?.length)
  let sincronizados = 0
  let errores = 0

  for (let i = 0; i < candidatos.length; i += batchSize) {
    const tanda = candidatos.slice(i, i + batchSize)
    const resultados = await Promise.all(
      tanda.map(producto =>
        syncToWoo({ tiendas, listas, producto }).catch(() => false)
      )
    )
    for (const r of resultados) r ? sincronizados++ : errores++
  }

  return { total: candidatos.length, sincronizados, errores }
}
