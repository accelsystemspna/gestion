// Publicar productos del programa en Mercado Libre.
//
// En vez de adivinar qué pide cada categoría, el producto nuevo se arma COPIANDO la estructura
// de una publicación ya existente del negocio en esa categoría (la "plantilla"): tipo de
// publicación, envío, garantía, tiempo de fabricación y los atributos genéricos (marca,
// material, tipo de panel...). Lo propio del producto (medidas, SKU, modelo, fotos,
// descripción, precio, stock) se pisa con los datos del programa. Todo se puede pisar a mano
// con `atributos`.
import { mlFetch } from './ml.ts'

// Atributos que son propios de CADA producto: nunca se copian de la plantilla.
const ATRIBUTOS_PROPIOS = new Set([
  'SELLER_SKU', 'MODEL', 'HEIGHT', 'WIDTH', 'LENGTH', 'GTIN', 'MPN', 'ALPHANUMERIC_MODEL',
  'SELLER_PACKAGE_WEIGHT', 'SELLER_PACKAGE_LENGTH', 'SELLER_PACKAGE_WIDTH', 'SELLER_PACKAGE_HEIGHT',
  'PAINTING_THEME', 'PANEL_TYPE', 'COLOR', 'FILTRABLE_COLOR', 'MAIN_COLOR', 'WITH_PHRASES', 'WITH_GLASS', 'FAMILY_NAME', 'GIFTABLE',
])
// Condiciones de venta que ML maneja solo (no se copian).
const SALE_TERMS_IGNORADOS = new Set(['INSTALLMENTS_CAMPAIGN'])

/** HTML del programa → texto plano (ML no acepta HTML en la descripción). */
export function htmlATexto(html: string | null | undefined): string {
  if (!html) return ''
  return String(html)
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|h[1-6]|ul|ol|tr)\s*>/gi, '\n\n')
    .replace(/<\s*li[^>]*>/gi, '• ')
    .replace(/<\/\s*li\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 50000)
}

/** Título/familia para ML (máx. 60). Si el producto trae un título web con " | Marca", se la saca. */
export function tituloML(producto: any, override?: string): string {
  const base = (override || String(producto.seo_titulo || '').split('|')[0] || producto.nombre || '').trim()
  return base.slice(0, 60).trim()
}

/** Fotos del producto en orden de preferencia, sin repetir. ML las descarga desde la URL (tiene que ser pública). */
export function fotosDe(producto: any, override?: string[]): string[] {
  const lista = override?.length
    ? override
    : [producto.imagen_web_url, ...(producto.imagenes_web ?? []), producto.imagen_url]
  return [...new Set(lista.filter((u: unknown) => typeof u === 'string' && /^https?:\/\//.test(u)))].slice(0, 12) as string[]
}

const cm = (n: unknown) => { const v = Number(n); return v > 0 ? `${Math.max(1, Math.ceil(v))} cm` : null }
const cmDec = (n: unknown) => { const v = Number(n); return v > 0 ? `${Math.round(v * 10) / 10} cm` : null }

/** Atributos que salen de los datos del producto en el programa. */
export function atributosDeProducto(p: any): Record<string, string> {
  const a: Record<string, string> = {}
  if (p.sku) a.SELLER_SKU = p.sku
  if (p.nombre) a.MODEL = String(p.nombre).slice(0, 255)
  const alto = cmDec(p.alto_producto), ancho = cmDec(p.ancho_producto)
  if (alto) a.HEIGHT = alto
  if (ancho) a.WIDTH = ancho
  if (Number(p.peso_kg) > 0) a.SELLER_PACKAGE_WEIGHT = `${Math.round(Number(p.peso_kg) * 1000)} g`
  // Cantidad de paneles del cuadro, por el nombre ("Tríptico", "Díptico"...); si no, panel único.
  const n = String(p.nombre ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  a.PANEL_TYPE = /triptic/.test(n) ? 'Tríptico' : /diptic/.test(n) ? 'Díptico' : /politic|[4-9] paneles/.test(n) ? 'Políptico' : 'Panel único'
  const l = cm(p.paquete_largo), w = cm(p.paquete_ancho), h = cm(p.paquete_alto)
  if (l) a.SELLER_PACKAGE_LENGTH = l
  if (w) a.SELLER_PACKAGE_WIDTH = w
  if (h) a.SELLER_PACKAGE_HEIGHT = h
  return a
}

/** Elige una publicación del negocio para usar de plantilla (la pedida, o una activa de la categoría). */
export async function cargarPlantilla(admin: any, org: string, categoria: string | null, itemId?: string | null) {
  let id = itemId ?? null
  if (!id) {
    let q = admin.from('ml_publicaciones').select('item_id').eq('org_id', org).eq('estado', 'active')
    if (categoria) q = q.eq('ml_categoria_id', categoria)
    const { data } = await q.order('actualizada_en', { ascending: false }).limit(1)
    id = data?.[0]?.item_id ?? null
  }
  if (!id) return { error: 'No hay una publicación tuya activa para usar de modelo en esa categoría. Indicá plantilla_item_id.' }
  const r = await mlFetch(admin, org, `/items/${id}`)
  if (!r.ok) return { error: `No pude leer la publicación modelo ${id}: ${r.error}` }
  return { plantilla: r.data }
}

export type PedidoPublicar = {
  titulo?: string
  precio: number
  stock?: number
  descripcion?: string          // texto plano (si no viene, se usa la del producto, convertida)
  imagenes?: string[]           // URLs públicas (si no vienen, las del producto)
  atributos?: Record<string, string>
  categoria_ml?: string
  plantilla_item_id?: string
  listing_type_id?: string
}

/** Arma el cuerpo de POST /items a partir del producto + la plantilla. */
export function armarItem(producto: any, plantilla: any, pedido: PedidoPublicar) {
  const atributos: Record<string, string> = {}
  for (const a of plantilla.attributes ?? []) {
    if (!a?.id || !a.value_name || ATRIBUTOS_PROPIOS.has(a.id)) continue
    if (['ITEM_CONDITION', 'FAMILY_NAME'].includes(a.id)) continue
    atributos[a.id] = a.value_name
  }
  Object.assign(atributos, atributosDeProducto(producto), pedido.atributos ?? {})

  const fotos = fotosDe(producto, pedido.imagenes)
  const titulo = tituloML(producto, pedido.titulo)
  const usaFamilia = !!plantilla.family_name || (plantilla.tags ?? []).includes('user_product_listing')

  const item: Record<string, unknown> = {
    category_id: pedido.categoria_ml || plantilla.category_id,
    price: Math.round(Number(pedido.precio) * 100) / 100,
    currency_id: plantilla.currency_id || 'ARS',
    available_quantity: Math.max(1, Math.round(Number(pedido.stock ?? plantilla.available_quantity ?? 1))),
    buying_mode: plantilla.buying_mode || 'buy_it_now',
    condition: plantilla.condition || 'new',
    listing_type_id: pedido.listing_type_id || plantilla.listing_type_id,
    pictures: fotos.map((source) => ({ source })),
    attributes: Object.entries(atributos).map(([id, value_name]) => ({ id, value_name })),
    sale_terms: (plantilla.sale_terms ?? [])
      .filter((t: any) => t?.id && !SALE_TERMS_IGNORADOS.has(t.id))
      .map((t: any) => (t.value_id ? { id: t.id, value_id: t.value_id } : { id: t.id, value_name: t.value_name })),
    shipping: {
      mode: plantilla.shipping?.mode || 'me2',
      local_pick_up: plantilla.shipping?.local_pick_up ?? false,
    },
  }
  // Modelo nuevo de ML (productos de usuario): en vez de título se manda el "nombre de familia".
  if (usaFamilia) item.family_name = titulo
  else item.title = titulo
  return { item, titulo, fotos, atributos }
}

/** Valida (sin publicar) o publica. Devuelve el item creado y deja registrada la publicación. */
export async function publicarItem(
  admin: any, org: string, producto: any, pedido: PedidoPublicar, opts: { soloValidar?: boolean } = {},
) {
  const cat = pedido.categoria_ml ?? null
  const { plantilla, error } = await cargarPlantilla(admin, org, cat, pedido.plantilla_item_id)
  if (error || !plantilla) return { ok: false, error }

  const { item, titulo, fotos, atributos } = armarItem(producto, plantilla, pedido)
  if (!fotos.length) return { ok: false, error: 'El producto no tiene fotos con URL pública. Cargale una imagen antes de publicar.' }
  if (!(Number(pedido.precio) > 0)) return { ok: false, error: 'Falta el precio.' }

  const vista = { titulo, categoria: item.category_id, precio: item.price, stock: item.available_quantity, fotos: fotos.length, atributos, plantilla: plantilla.id }

  if (opts.soloValidar) {
    const v = await mlFetch(admin, org, '/items/validate', { method: 'POST', body: item })
    if (v.ok) return { ok: true, valido: true, avisos: [], vista }
    // ML contesta 400 también cuando solo hay AVISOS (ej. "se agregó envío gratis obligatorio"): eso se publica igual.
    const causas: any[] = Array.isArray(v.data?.cause) ? v.data.cause : []
    if (causas.length && causas.every((c) => c.type === 'warning')) {
      return { ok: true, valido: true, avisos: causas.map((c) => c.message), vista }
    }
    return { ok: false, valido: false, error: v.error, errores: causas.filter((c) => c.type !== 'warning').map((c) => c.message), detalle: v.data, vista }
  }

  const r = await mlFetch(admin, org, '/items', { method: 'POST', body: item })
  if (!r.ok) return { ok: false, error: r.error, detalle: r.data, vista }
  const creado = r.data

  // Descripción (se manda aparte, en texto plano). Si falla, la publicación igual quedó creada.
  const texto = pedido.descripcion ? pedido.descripcion : htmlATexto(producto.descripcion)
  let errorDescripcion: string | null = null
  if (texto) {
    const d = await mlFetch(admin, org, `/items/${creado.id}/description`, { method: 'POST', body: { plain_text: texto } })
    if (!d.ok) errorDescripcion = d.error ?? 'No se pudo cargar la descripción'
  }

  await admin.from('ml_publicaciones').upsert({
    org_id: org, item_id: creado.id, producto_id: producto.id, ml_categoria_id: creado.category_id,
    titulo: creado.title ?? titulo, precio: creado.price, estado: creado.status, permalink: creado.permalink,
    thumbnail: creado.secure_thumbnail || creado.thumbnail || null, stock: creado.available_quantity,
    vendidos: creado.sold_quantity ?? 0, sku: producto.sku, error: errorDescripcion, actualizada_en: new Date().toISOString(),
  }, { onConflict: 'item_id' })

  return { ok: true, item_id: creado.id, permalink: creado.permalink, estado: creado.status, error_descripcion: errorDescripcion, vista }
}
