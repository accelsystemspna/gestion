// Utilidades compartidas para hablar con WooCommerce (webhook y panel de Tiendas).
// Sin dependencias de Deno ni de Supabase: se puede probar directo con Node.

/** Estados nativos de un pedido de WooCommerce que el programa muestra y permite cambiar. */
export const ESTADOS_WOO = ['pending', 'on-hold', 'processing', 'completed', 'cancelled', 'refunded', 'failed'] as const
export type EstadoWoo = typeof ESTADOS_WOO[number]

/** Estados que WooCommerce usa internamente y que nunca son un pedido real. */
export const ESTADOS_BORRADOR = new Set(['checkout-draft', 'auto-draft', 'draft'])

/** Estado de WooCommerce -> fase del pedido en la sección Tiendas. */
export const ESTADO_WEB: Record<string, string> = {
  'on-hold': 'esperando_pago', 'pending': 'esperando_pago',
  'processing': 'en_preparacion', 'completed': 'completado',
  'cancelled': 'cancelado', 'refunded': 'cancelado', 'failed': 'cancelado',
}

/** URL base de la tienda (agrega http:// a los dominios locales y https:// al resto). */
export function baseUrl(url: string): string {
  let base = String(url || '').trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(base)) {
    base = (esLocal(base) ? 'http://' : 'https://') + base
  }
  return base
}

/** ¿Es un sitio de desarrollo (localhost, .local, .test)? Desde internet no se puede llegar a esos. */
export function esLocal(url: string): boolean {
  const host = String(url || '').trim().replace(/^https?:\/\//i, '').split('/')[0].split(':')[0].toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || /\.(local|test|localhost)$/.test(host)
}

export type ResultadoWoo = { ok: boolean, status: number, data: any, total: number | null, paginas: number | null, error?: string }

/**
 * Llama a la API REST de WooCommerce (v3). Nunca lanza: devuelve { ok, status, data, error }.
 * Las claves van en la URL (WooCommerce solo lo permite por HTTPS).
 */
export async function wooFetch(
  tienda: { url: string, consumer_key?: string | null, consumer_secret?: string | null },
  path: string,
  opts: { method?: string, body?: unknown, query?: Record<string, string | number | undefined>, fetchFn?: typeof fetch } = {},
): Promise<ResultadoWoo> {
  const fetchFn = opts.fetchFn ?? fetch
  if (!tienda.url) return { ok: false, status: 0, data: null, total: null, paginas: null, error: 'La tienda no tiene URL.' }
  if (!tienda.consumer_key || !tienda.consumer_secret) {
    return { ok: false, status: 0, data: null, total: null, paginas: null, error: 'La tienda no tiene las claves de API de WooCommerce cargadas en Integraciones.' }
  }
  const base = baseUrl(tienda.url)
  if (esLocal(base)) {
    return { ok: false, status: 0, data: null, total: null, paginas: null, error: 'Es un sitio local: el servidor no puede llegar a él desde internet. Probalo desde la tienda real (HTTPS).' }
  }
  const qs = new URLSearchParams({ consumer_key: tienda.consumer_key, consumer_secret: tienda.consumer_secret })
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== '') qs.set(k, String(v))
  try {
    const res = await fetchFn(`${base}/wp-json/wc/v3/${path.replace(/^\/+/, '')}?${qs}`, {
      method: opts.method ?? 'GET',
      headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(25000),
    })
    let data: any = null
    try { data = await res.json() } catch { /* sin cuerpo */ }
    const total = res.headers.get('x-wp-total')
    const paginas = res.headers.get('x-wp-totalpages')
    if (!res.ok) {
      const msg = data?.message ? `${data.message}` : `HTTP ${res.status}`
      return { ok: false, status: res.status, data, total: null, paginas: null, error: explicarError(res.status, msg) }
    }
    return { ok: true, status: res.status, data, total: total ? Number(total) : null, paginas: paginas ? Number(paginas) : null }
  } catch (err) {
    return { ok: false, status: 0, data: null, total: null, paginas: null, error: `No se pudo conectar con la tienda (${(err as Error)?.message ?? 'error de red'}).` }
  }
}

function explicarError(status: number, msg: string): string {
  if (status === 401) return 'WooCommerce rechazó las claves de API (401). Revisá que sean de esta tienda y tengan permiso de Lectura/Escritura.'
  if (status === 403) return 'Las claves de API no tienen permiso para esta acción (403). Generá una con Lectura/Escritura.'
  if (status === 404) return 'WooCommerce no encontró lo pedido (404).'
  return `WooCommerce respondió: ${msg}`
}

/** Firma HMAC-SHA256 en base64, igual que la del webhook nativo de WooCommerce. */
export async function firmar(secret: string, cuerpo: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const buf = await crypto.subtle.sign('HMAC', key, enc.encode(cuerpo))
  let s = ''
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b)
  return btoa(s)
}

/** Dirección en una línea. */
export function lineaDireccion(a: any): string {
  return [a?.address_1, a?.address_2, a?.city, a?.state, a?.postcode].filter(Boolean).join(', ')
}

/** Fila de la tabla pedidos_web a partir del pedido tal cual lo manda WooCommerce. */
export function filaPedido(order: any, tienda: { id: number, user_id: string }) {
  const b = order.billing ?? {}
  const fecha = (s?: string) => (s ? (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + 'Z') : null)
  const nombre = [b.first_name, b.last_name].filter(Boolean).join(' ').trim()
  return {
    org_id:             tienda.user_id,
    tienda_id:          tienda.id,
    woo_id:             Number(order.id),
    numero:             String(order.number ?? order.id),
    estado:             String(order.status ?? ''),
    // WooCommerce da las fechas sin zona; date_created_gmt es la UTC verdadera.
    fecha_creado:       fecha(order.date_created_gmt) ?? fecha(order.date_created),
    fecha_modificado:   fecha(order.date_modified_gmt) ?? fecha(order.date_modified),
    total:              Number(order.total) || 0,
    moneda:             order.currency ?? null,
    cliente_nombre:     nombre || null,
    cliente_email:      b.email || null,
    cliente_telefono:   b.phone || null,
    metodo_pago:        order.payment_method || null,
    metodo_pago_titulo: order.payment_method_title || null,
    datos:              order,
    sincronizado_en:    new Date().toISOString(),
  }
}

/** Resumen de un producto de WooCommerce para el listado del programa. */
export function resumenProducto(p: any) {
  return {
    id:        p.id,
    nombre:    p.name,
    sku:       p.sku || '',
    tipo:      p.type,
    estado:    p.status,
    precio:    p.price === '' || p.price == null ? null : Number(p.price),
    regular:   p.regular_price === '' || p.regular_price == null ? null : Number(p.regular_price),
    oferta:    p.sale_price === '' || p.sale_price == null ? null : Number(p.sale_price),
    en_oferta: !!p.on_sale,
    stock:     p.stock_status,
    gestiona_stock: !!p.manage_stock,
    cantidad:  p.stock_quantity ?? null,
    imagen:    p.images?.[0]?.src ?? null,
    categorias: (p.categories ?? []).map((c: any) => c.name),
    enlace:    p.permalink ?? null,
  }
}

/** Estado de los webhooks de la tienda frente a lo que el programa necesita. */
export function evaluarWebhooks(webhooks: any[], tiendaId: number, supabaseRef: string) {
  const propios = (webhooks ?? []).filter((w) => /woo-order-webhook/.test(w.delivery_url ?? ''))
  const paramDe = (w: any) => { try { return new URL(w.delivery_url).searchParams.get('tienda') } catch { return null } }
  const problemas: string[] = []
  if (!propios.length) problemas.push('No hay ningún webhook que apunte al programa de gestión.')
  const del_id = propios.filter((w) => paramDe(w) === String(tiendaId))
  if (propios.length && !del_id.length) {
    problemas.push(`El webhook apunta a otra tienda del programa (?tienda=${paramDe(propios[0])}) y no a esta (?tienda=${tiendaId}).`)
  }
  if (propios.length && !propios.some((w) => w.status === 'active')) {
    problemas.push(`El webhook está "${propios[0].status}" (WooCommerce lo desactiva solo tras varios fallos de entrega). Hay que activarlo.`)
  }
  const activos = del_id.filter((w) => w.status === 'active')
  const temas = new Set(activos.map((w) => w.topic))
  if (activos.length && !temas.has('order.updated')) problemas.push('Falta un webhook activo con el tema "Pedido actualizado" (order.updated).')
  const conFallos = activos.filter((w) => Number(w.failure_count) > 0)
  if (conFallos.length) problemas.push(`El webhook tuvo ${conFallos[0].failure_count} fallos de entrega seguidos.`)
  return {
    ok: problemas.length === 0,
    problemas,
    webhooks: propios.map((w) => ({
      id: w.id, nombre: w.name, estado: w.status, tema: w.topic, tienda_param: paramDe(w), fallos: Number(w.failure_count) || 0,
    })),
    tiene_updated: temas.has('order.updated'),
    tiene_deleted: temas.has('order.deleted'),
    supabase_ref: supabaseRef,
  }
}
