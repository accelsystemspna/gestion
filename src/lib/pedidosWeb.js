import { supabase } from './supabase'
import { ajustarStock } from './stock'

// Fases de un pedido de la web. En WooCommerce "en preparación" y "listo para
// despachar" son el mismo estado (processing): la diferencia solo existe acá.
export const ESTADOS_WEB = {
  esperando_pago: { label: 'Esperando pago',       color: '#b45309', bg: '#fef3c7', woo: 'on-hold' },
  en_preparacion: { label: 'En preparación',       color: '#0e7490', bg: '#cffafe', woo: 'processing' },
  listo:          { label: 'Listo para despachar', color: '#6d28d9', bg: '#ede9fe', woo: 'processing' },
  completado:     { label: 'Despachado',           color: '#15803d', bg: '#dcfce7', woo: 'completed' },
  cancelado:      { label: 'Cancelado',            color: '#b91c1c', bg: '#fee2e2', woo: 'cancelled' },
}

// Camino normal de un pedido (para mostrar el avance)
export const FASES = ['esperando_pago', 'en_preparacion', 'listo', 'completado']

// Se puede facturar recién cuando el pedido está armado.
export const FASES_FACTURABLES = ['listo', 'completado']

// "procesado" es el nombre viejo de "en preparación". Los pedidos importados
// antes de existir estado_web se deducen de las notas.
export function estadoWebDe(v) {
  if (v.estado_web === 'procesado') return 'en_preparacion'
  if (v.estado_web && ESTADOS_WEB[v.estado_web]) return v.estado_web
  return /pendiente de pago/i.test(v.notas || '') ? 'esperando_pago' : 'en_preparacion'
}

// "WC#123" -> "123"
export function ordenWooId(v) {
  const m = /^WC#(\d+)$/.exec(v?.origen_ref || '')
  return m ? m[1] : null
}

// Los pedidos viejos no tienen tienda_id: se reconocen por el nombre que va al final de
// las notas ("Pedido ... — Nombre" o "... — Nombre (pendiente de pago)"). Tiene que ser el
// nombre COMPLETO: "CC Design" no puede confundirse con "Mayorista CC Design".
function notasTerminanEn(v, tienda) {
  const n = v.notas || ''
  return !!tienda.nombre && (n.endsWith(`— ${tienda.nombre}`) || n.includes(`— ${tienda.nombre} (`))
}

export function perteneceATienda(v, tienda) {
  if (v.tienda_id != null) return String(v.tienda_id) === String(tienda.id)
  return notasTerminanEn(v, tienda)
}

function baseUrl(url) {
  let base = String(url || '').trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(base)) {
    const host = base.split('/')[0].split(':')[0].toLowerCase()
    const local = host === 'localhost' || host === '127.0.0.1' || /\.(local|test|localhost)$/.test(host)
    base = (local ? 'http://' : 'https://') + base
  }
  return base
}

// Avisa a WooCommerce del nuevo estado (API REST v3 con las claves de la tienda).
// Nunca lanza: devuelve un texto con el resultado.
async function avisarAWoo({ venta, tienda, nuevo }) {
  const id = ordenWooId(venta)
  if (!id || tienda?.tipo !== 'woocommerce') return { ok: false, motivo: 'no aplica' }
  if (!tienda.url || !tienda.consumer_key || !tienda.consumer_secret) {
    return { ok: false, motivo: 'La tienda no tiene las claves de API de WooCommerce cargadas en Integraciones.' }
  }
  try {
    const qs = `consumer_key=${encodeURIComponent(tienda.consumer_key)}&consumer_secret=${encodeURIComponent(tienda.consumer_secret)}`
    const res = await fetch(`${baseUrl(tienda.url)}/wp-json/wc/v3/orders/${id}?${qs}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: ESTADOS_WEB[nuevo].woo }),
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) return { ok: false, motivo: `WooCommerce respondió HTTP ${res.status}.` }
    return { ok: true }
  } catch (err) {
    return { ok: false, motivo: 'No se pudo conectar con la tienda.' }
  }
}

// Le pide al portal mayorista (vía la función portal-order-status) que cambie el
// estado del pedido. Si el portal lo rechaza, no se cambia nada y se devuelve su mensaje.
async function cambiarEnPortal({ venta, nuevo, tracking, notificar }) {
  const { data, error } = await supabase.functions.invoke('portal-order-status', {
    body: {
      venta_id: venta.id,
      status: ESTADOS_WEB[nuevo].woo,
      tracking: tracking?.trim() || undefined,
      notificar: notificar !== false,
    },
  })
  if (error) {
    let mensaje = error.message
    // Sin conexión con la función: lo más común es que todavía no esté desplegada
    // (Supabase responde sin CORS y el navegador bloquea la respuesta).
    if (error.name === 'FunctionsFetchError') {
      return { ok: false, error: 'No se pudo conectar con la función portal-order-status. Lo más probable es que todavía no esté desplegada en Supabase (o no hay conexión a internet).' }
    }
    try {
      const j = await error.context?.json?.()
      if (j?.code === 'NOT_FOUND') mensaje = 'Falta desplegar la función portal-order-status en Supabase.'
      else if (j?.error) mensaje = j.error
    } catch { /* sin detalle */ }
    return { ok: false, error: mensaje }
  }
  if (!data?.ok) return { ok: false, error: data?.error || 'El portal no aceptó el cambio.' }
  return { ok: true, woo: { ok: true }, portal: data }
}

/**
 * Cambia el estado de un pedido web: lo guarda en el programa y avisa a
 * WooCommerce (si se puede). Si se cancela, anula la venta y devuelve el stock.
 * @returns {Promise<{ ok: boolean, error?: string, woo?: { ok: boolean, motivo?: string } }>}
 */
export async function cambiarEstadoWeb({ venta, tienda, nuevo, tracking, notificar }) {
  const antes = estadoWebDe(venta)

  // Portal mayorista: el cambio lo hace una función del servidor (así el secret
  // del portal no pasa por el navegador) y ella misma actualiza la venta.
  // "En preparación" ↔ "Listo" no cambia nada en el portal: eso sí es solo local.
  if (tienda?.tipo === 'mayorista' && ESTADOS_WEB[antes].woo !== ESTADOS_WEB[nuevo].woo) {
    return cambiarEnPortal({ venta, nuevo, tracking, notificar })
  }

  const cambios = { estado_web: nuevo, origen_estado: ESTADOS_WEB[nuevo].woo }
  const cancelar = nuevo === 'cancelado' && venta.estado !== 'anulado' && !venta.factura_emitida
  if (cancelar) cambios.estado = 'anulado'

  const { error } = await supabase.from('ventas').update(cambios).eq('id', venta.id)
  if (error) {
    const falta = /estado_web_check/.test(error.message)
    return { ok: false, error: falta ? 'Falta correr supabase_tiendas_fases.sql en Supabase (SQL Editor).' : error.message }
  }

  if (cancelar) {
    const { data: items } = await supabase.from('venta_items').select('producto_id, cantidad').eq('venta_id', venta.id)
    ajustarStock((items || []).map(i => ({ producto_id: i.producto_id, cantidad: -i.cantidad })))
      .catch(err => console.error('[stock]', err))
  }

  // "En preparación" y "Listo" son el mismo estado en WooCommerce: no hace falta avisarle.
  if (ESTADOS_WEB[antes]?.woo === ESTADOS_WEB[nuevo].woo) return { ok: true, woo: { ok: false, motivo: 'no aplica' } }
  const woo = await avisarAWoo({ venta, tienda, nuevo })
  return { ok: true, woo }
}

// Trae los renglones de muchas ventas, de a tandas para no pasarse del largo de la URL.
export async function cargarItemsDeVentas(ventaIds) {
  const out = []
  for (let i = 0; i < ventaIds.length; i += 150) {
    const { data } = await supabase
      .from('venta_items')
      .select('venta_id, descripcion, sku, cantidad, subtotal, producto_id')
      .in('venta_id', ventaIds.slice(i, i + 150))
    if (data) out.push(...data)
  }
  return out
}

// Renglones de los pedidos con la foto y el código del producto (para armarlos).
// Devuelve un objeto { [ventaId]: [{ id, descripcion, codigo, cantidad, imagen }] }.
export async function cargarItemsPedidos(ventaIds) {
  const items = []
  for (let i = 0; i < ventaIds.length; i += 150) {
    const { data } = await supabase
      .from('venta_items')
      .select('id, venta_id, descripcion, sku, cantidad, producto_id')
      .in('venta_id', ventaIds.slice(i, i + 150))
      .order('id')
    if (data) items.push(...data)
  }

  const prodIds = [...new Set(items.map(i => i.producto_id).filter(Boolean))]
  const productos = {}
  for (let i = 0; i < prodIds.length; i += 150) {
    const { data } = await supabase
      .from('productos')
      .select('id, sku, imagen_url, imagen_web_url')
      .in('id', prodIds.slice(i, i + 150))
    for (const p of data || []) productos[p.id] = p
  }

  const porVenta = {}
  for (const it of items) {
    const p = it.producto_id ? productos[it.producto_id] : null
    ;(porVenta[it.venta_id] ||= []).push({
      id: it.id,
      descripcion: it.descripcion,
      codigo: it.sku || p?.sku || '',
      cantidad: Number(it.cantidad) || 0,
      imagen: p?.imagen_url || p?.imagen_web_url || null,
    })
  }
  return porVenta
}

// Agrupa las ventas por comprador y calcula sus estadísticas de compra.
// Clave del grupo: cliente vinculado > email > teléfono > nombre.
export function estadisticasClientes(ventas, items) {
  const itemsPorVenta = new Map()
  for (const it of items) {
    if (!itemsPorVenta.has(it.venta_id)) itemsPorVenta.set(it.venta_id, [])
    itemsPorVenta.get(it.venta_id).push(it)
  }

  const grupos = new Map()
  for (const v of ventas) {
    if (estadoWebDe(v) === 'cancelado' || v.estado === 'anulado') continue
    const email = (v.cliente_email || '').trim().toLowerCase()
    const tel = (v.cliente_telefono || '').replace(/\D/g, '')
    const nombre = (v.cliente_nombre || '').trim()
    const key = v.cliente_id ? `c:${v.cliente_id}` : email ? `e:${email}` : tel ? `t:${tel}` : `n:${nombre.toLowerCase()}`

    let g = grupos.get(key)
    if (!g) {
      g = { key, clienteId: v.cliente_id || null, nombre, email: v.cliente_email || '', telefono: v.cliente_telefono || '',
            direccion: v.cliente_direccion || '', pedidos: [], total: 0, productos: new Map() }
      grupos.set(key, g)
    }
    if (!g.email && v.cliente_email) g.email = v.cliente_email
    if (!g.telefono && v.cliente_telefono) g.telefono = v.cliente_telefono
    if (!g.direccion && v.cliente_direccion) g.direccion = v.cliente_direccion
    g.pedidos.push(v)
    g.total += Number(v.total) || 0
    for (const it of itemsPorVenta.get(v.id) || []) {
      const k = it.descripcion || it.sku || 'Ítem'
      const p = g.productos.get(k) || { nombre: k, cantidad: 0, total: 0 }
      p.cantidad += Number(it.cantidad) || 0
      p.total += Number(it.subtotal) || 0
      g.productos.set(k, p)
    }
  }

  return [...grupos.values()].map(g => {
    const fechas = g.pedidos.map(p => p.fecha).filter(Boolean).sort()
    return {
      ...g,
      cantidadPedidos: g.pedidos.length,
      ticketPromedio: g.pedidos.length ? g.total / g.pedidos.length : 0,
      primera: fechas[0] || null,
      ultima: fechas[fechas.length - 1] || null,
      topProductos: [...g.productos.values()].sort((a, b) => b.cantidad - a.cantidad || b.total - a.total),
    }
  }).sort((a, b) => b.total - a.total)
}

// Guarda al comprador en Clientes (o lo vincula si ya existe por email) y
// enlaza todas sus compras web. Devuelve el id del cliente.
export async function guardarComoCliente({ grupo, orgId }) {
  let clienteId = null
  if (grupo.email) {
    const { data } = await supabase.from('clientes').select('id').ilike('email', grupo.email.trim()).limit(1)
    clienteId = data?.[0]?.id ?? null
  }
  if (!clienteId) {
    const { data, error } = await supabase.from('clientes').insert([{
      nombre: grupo.nombre || 'Cliente web',
      email: grupo.email?.trim() || null,
      telefono: grupo.telefono?.trim() || null,
      direccion: grupo.direccion?.trim() || null,
      etiqueta: 'Web',
      org_id: orgId,
    }]).select('id').single()
    if (error) throw new Error(error.message)
    clienteId = data.id
  }
  const ids = grupo.pedidos.map(p => p.id)
  const { error: errUpd } = await supabase.from('ventas').update({ cliente_id: clienteId }).in('id', ids)
  if (errUpd) throw new Error(errUpd.message)
  return clienteId
}

/**
 * Elimina definitivamente pedidos web CANCELADOS. Los que ya tienen factura
 * emitida no se tocan (una factura no se borra). Si alguno quedó sin anular,
 * primero se le devuelve el stock.
 * @returns {Promise<{ eliminadas: number, omitidas: number, error?: string }>}
 */
export async function eliminarPedidosCancelados(ventas) {
  const elegibles = ventas.filter(v => estadoWebDe(v) === 'cancelado' && !v.factura_emitida)
  const omitidas = ventas.length - elegibles.length
  let eliminadas = 0

  for (let i = 0; i < elegibles.length; i += 100) {
    const tanda = elegibles.slice(i, i + 100)
    const ids = tanda.map(v => v.id)

    const sinAnular = tanda.filter(v => v.estado !== 'anulado').map(v => v.id)
    if (sinAnular.length) {
      const { data: items } = await supabase.from('venta_items').select('producto_id, cantidad').in('venta_id', sinAnular)
      await ajustarStock((items || []).map(it => ({ producto_id: it.producto_id, cantidad: -it.cantidad })))
        .catch(err => console.error('[stock]', err))
    }

    const { error: errItems } = await supabase.from('venta_items').delete().in('venta_id', ids)
    if (errItems) return { eliminadas, omitidas, error: errItems.message }
    const { error } = await supabase.from('ventas').delete().in('id', ids)
    if (error) return { eliminadas, omitidas, error: error.message }
    eliminadas += ids.length
  }
  return { eliminadas, omitidas }
}
