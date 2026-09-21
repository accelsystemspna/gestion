import { supabase } from './supabase'

// ───────────────────────────────────────────────────────────────────────────
// Panel de WooCommerce dentro de "Tiendas".
// Los pedidos se leen de la tabla pedidos_web (lo que WooCommerce avisa por webhook o lo que
// se importa con "Sincronizar"). Las acciones que necesitan hablar con la tienda (cambiar
// estado, notas, productos...) pasan por la función woo-panel: las claves de API no salen del servidor.
// ───────────────────────────────────────────────────────────────────────────

// Estados nativos de WooCommerce, con los nombres que usa su panel en español.
export const ESTADOS_WOO = {
  pending:    { label: 'Pendiente de pago', color: '#92400e', bg: '#fef3c7' },
  'on-hold':  { label: 'En espera',         color: '#b45309', bg: '#ffedd5' },
  processing: { label: 'Procesando',        color: '#0e7490', bg: '#cffafe' },
  completed:  { label: 'Completado',        color: '#15803d', bg: '#dcfce7' },
  cancelled:  { label: 'Cancelado',         color: '#b91c1c', bg: '#fee2e2' },
  refunded:   { label: 'Reembolsado',       color: '#6b7280', bg: '#e5e7eb' },
  failed:     { label: 'Fallido',           color: '#991b1b', bg: '#fecaca' },
  trash:      { label: 'Papelera',          color: '#6b7280', bg: '#f3f4f6' },
}
// Estados a los que se puede pasar un pedido desde el programa (igual que en WooCommerce)
export const ESTADOS_ELEGIBLES = ['pending', 'on-hold', 'processing', 'completed', 'cancelled', 'refunded', 'failed']

export const estadoWooInfo = (e) => ESTADOS_WOO[e] || { label: e || '—', color: '#6b7280', bg: '#f3f4f6' }

// Estados que no cuentan como venta (para totales y resumen)
export const NO_SUMAN = new Set(['cancelled', 'refunded', 'failed', 'trash', 'pending'])

/** ¿Es un sitio de desarrollo (no accesible desde el servidor)? */
export function esLocalUrl(url) {
  const host = String(url || '').trim().replace(/^https?:\/\//i, '').split('/')[0].split(':')[0].toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || /\.(local|test|localhost)$/.test(host)
}

/** Llama a la función woo-panel. Nunca lanza: devuelve { ok, ... } con el motivo si falla. */
export async function invocarWoo(accion, tiendaId, extra = {}) {
  const { data, error } = await supabase.functions.invoke('woo-panel', { body: { accion, tienda_id: tiendaId, ...extra } })
  if (error) {
    if (error.name === 'FunctionsFetchError') {
      return { ok: false, error: 'No se pudo conectar con la función woo-panel. Lo más probable es que todavía no esté desplegada en Supabase (o no hay conexión a internet).' }
    }
    let mensaje = error.message
    try {
      const j = await error.context?.json?.()
      if (j?.code === 'NOT_FOUND') mensaje = 'Falta desplegar la función woo-panel en Supabase.'
      else if (j?.error) mensaje = j.error
    } catch { /* sin detalle */ }
    return { ok: false, error: mensaje }
  }
  return data ?? { ok: false, error: 'Respuesta vacía.' }
}

/**
 * Importa los pedidos de WooCommerce que nunca llegaron (de a páginas, para no pasarse de tiempo).
 * onProgreso({ pagina, paginas, acumulado }) se llama después de cada página.
 */
export async function sincronizarPedidos(tiendaId, { desde, onProgreso } = {}) {
  const total = { procesados: 0, nuevas_ventas: 0, actualizados: 0, sin_cambios: 0, ignorados: 0, errores: 0 }
  let pagina = 1
  for (let guardia = 0; guardia < 200 && pagina; guardia++) {
    const r = await invocarWoo('sincronizar', tiendaId, { pagina, por_pagina: 25, desde })
    if (!r.ok) return { ok: false, error: r.error, ...total }
    for (const k of Object.keys(total)) total[k] += r[k] || 0
    onProgreso?.({ pagina: r.pagina, paginas: r.paginas, acumulado: { ...total } })
    pagina = r.siguiente
  }
  return { ok: true, ...total }
}

// ── Lectura de pedidos desde la base del programa ───────────────────────────
const COLS_LISTA = 'id, woo_id, numero, estado, fecha_creado, total, moneda, cliente_nombre, cliente_email, cliente_telefono, metodo_pago, metodo_pago_titulo, sincronizado_en, items:datos->line_items'

/**
 * Página de pedidos con filtros. Devuelve { filas, total, error }.
 * estado: 'todos' | estado nativo. q: busca por cliente, email o número.
 */
export async function listarPedidosWoo(tiendaId, { estado = 'todos', q = '', desde, hasta, pagina = 1, porPagina = 25 } = {}) {
  let query = supabase.from('pedidos_web').select(COLS_LISTA, { count: 'exact' }).eq('tienda_id', tiendaId)
  if (estado === 'todos') query = query.neq('estado', 'trash')
  else query = query.eq('estado', estado)
  const txt = q.trim().replace(/[%,()]/g, ' ')
  if (txt) query = query.or(`cliente_nombre.ilike.%${txt}%,cliente_email.ilike.%${txt}%,numero.ilike.%${txt}%`)
  if (desde) query = query.gte('fecha_creado', `${desde}T00:00:00-03:00`)
  if (hasta) query = query.lte('fecha_creado', `${hasta}T23:59:59-03:00`)
  const from = (pagina - 1) * porPagina
  const { data, count, error } = await query.order('fecha_creado', { ascending: false }).range(from, from + porPagina - 1)
  return { filas: data || [], total: count ?? 0, error: error?.message || null }
}

/** Cantidad de pedidos por estado (para los filtros). */
export async function contarPorEstado(tiendaId) {
  const { data, error } = await supabase.from('pedidos_web').select('estado').eq('tienda_id', tiendaId).limit(10000)
  const c = { todos: 0 }
  for (const r of data || []) { c[r.estado] = (c[r.estado] || 0) + 1; if (r.estado !== 'trash') c.todos++ }
  return { conteos: c, error: error?.message || null }
}

/** Un pedido completo (con todo lo que mandó WooCommerce). */
export async function pedidoWooPorId(tiendaId, wooId) {
  const { data, error } = await supabase.from('pedidos_web').select('*').eq('tienda_id', tiendaId).eq('woo_id', wooId).maybeSingle()
  return { fila: data, error: error?.message || null }
}

// ── Helpers de presentación ─────────────────────────────────────────────────
export function direccionLineas(a) {
  if (!a) return []
  return [
    [a.first_name, a.last_name].filter(Boolean).join(' '),
    a.company,
    a.address_1,
    a.address_2,
    [a.city, a.state, a.postcode].filter(Boolean).join(', '),
    a.country && a.country !== 'AR' ? a.country : '',
  ].filter(Boolean)
}
export const hayDireccion = (a) => !!(a && (a.address_1 || a.city || a.postcode))

/** DNI / CUIT del comprador (campo adicional del checkout de la tienda). */
export function dniDe(order) {
  const m = (order?.meta_data || []).find(x => /dni|cuit/i.test(x?.key || ''))
  return m?.value ? String(m.value) : ''
}

const num = (x) => Number(x) || 0

/** Desglose de importes del pedido, como en la pantalla de un pedido de WooCommerce. */
export function totalesPedido(o) {
  const items = (o?.line_items || [])
  const subtotal = items.reduce((s, i) => s + num(i.subtotal), 0)
  const cupones = num(o?.discount_total)
  const cargos = (o?.fee_lines || []).map(f => ({ nombre: String(f.name || 'Cargo').replace(/^[^\p{L}\p{N}]+/u, ''), monto: num(f.total) }))
  const envio = num(o?.shipping_total)
  const impuestos = num(o?.total_tax)
  const reembolsado = (o?.refunds || []).reduce((s, r) => s + Math.abs(num(r.total)), 0)
  return { subtotal, cupones, cargos, envio, impuestos, total: num(o?.total), reembolsado }
}

export const nombreProducto = (li) => li?.name || 'Producto'

/** Enlace a la pantalla del pedido en el administrador de WooCommerce. */
export function urlAdminPedido(tienda, wooId) {
  let base = String(tienda?.url || '').trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(base)) base = (esLocalUrl(base) ? 'http://' : 'https://') + base
  return `${base}/wp-admin/admin.php?page=wc-orders&action=edit&id=${wooId}`
}

/** "2026-09-20T15:00:00Z" → "20/09/2026 12:00" (hora argentina). */
export function fmtFechaHora(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}
export function fmtSoloFecha(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric' })
}
/** "hace 5 min" */
export function hace(iso) {
  if (!iso) return 'nunca'
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'hace instantes'
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`
  return `hace ${Math.floor(s / 86400)} d`
}

/** Fecha (YYYY-MM-DD) en hora argentina. */
export const diaAR = (iso) => (iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }) : '')

/**
 * Resumen de ventas a partir de los pedidos. Solo cuentan los pedidos que son venta
 * (procesando, completado y en espera de transferencia).
 */
export function resumirVentas(filas, hoy = diaAR(new Date().toISOString())) {
  const dias = {}
  const porEstado = {}
  const productos = new Map()
  let monto = 0, cuenta = 0, esperandoMonto = 0, esperando = 0
  const mes = hoy.slice(0, 7)
  let montoMes = 0, cuentaMes = 0, montoHoy = 0, cuentaHoy = 0
  for (const p of filas) {
    porEstado[p.estado] = (porEstado[p.estado] || 0) + 1
    if (NO_SUMAN.has(p.estado)) continue
    const dia = diaAR(p.fecha_creado)
    const t = Number(p.total) || 0
    if (p.estado === 'on-hold') { esperando++; esperandoMonto += t }
    monto += t; cuenta++
    dias[dia] = (dias[dia] || 0) + t
    if (dia.startsWith(mes)) { montoMes += t; cuentaMes++ }
    if (dia === hoy) { montoHoy += t; cuentaHoy++ }
    for (const it of (p.items || p.datos?.line_items || [])) {
      const k = it.name || it.sku || 'Producto'
      const a = productos.get(k) || { nombre: k, sku: it.sku || '', cantidad: 0, total: 0, imagen: it.image?.src || null }
      a.cantidad += Number(it.quantity) || 0
      a.total += Number(it.total) || 0
      productos.set(k, a)
    }
  }
  return {
    monto, cuenta, ticket: cuenta ? monto / cuenta : 0, montoMes, cuentaMes, montoHoy, cuentaHoy, esperando, esperandoMonto,
    porEstado, dias,
    top: [...productos.values()].sort((a, b) => b.cantidad - a.cantidad || b.total - a.total).slice(0, 8),
  }
}

/** Texto plano de un fragmento HTML (las notas de WooCommerce pueden traer etiquetas y entidades). Nunca se inyecta HTML. */
export function textoPlano(html) {
  const conSaltos = String(html ?? '').replace(/<br\s*\/?>/gi, '\n')
  if (typeof DOMParser === 'undefined') return conSaltos.replace(/<[^>]*>/g, '')
  return new DOMParser().parseFromString(conSaltos, 'text/html').body.textContent || ''
}
