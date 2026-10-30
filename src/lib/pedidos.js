import { supabase } from './supabase.js'
import { calcInsumo, precioVenta } from './pricing.js'
import { precioConPromoProducto } from './promos.js'

// Estados de un pedido. "Aceptado" es el momento en que entra la seña (la seña confirma que aceptó).
export const ESTADOS = {
  presupuestado: { label: 'Presupuestado',      color: '#64748b', bg: 'rgba(100,116,139,0.14)' },
  aceptado:      { label: 'Aceptado (con seña)', color: '#0e7490', bg: 'rgba(14,116,144,0.14)' },
  en_produccion: { label: 'En producción',      color: '#b45309', bg: 'rgba(217,119,6,0.14)' },
  listo:         { label: 'Listo para entregar', color: '#6d28d9', bg: 'rgba(109,40,217,0.12)' },
  entregado:     { label: 'Entregado',          color: '#15803d', bg: 'rgba(22,163,74,0.12)' },
  rechazado:     { label: 'Rechazado',          color: '#b91c1c', bg: 'rgba(185,28,28,0.12)' },
  cancelado:     { label: 'Cancelado',          color: '#b91c1c', bg: 'rgba(185,28,28,0.12)' },
}
export const ESTADOS_ABIERTOS = ['presupuestado', 'aceptado', 'en_produccion', 'listo']

/** Últimos 3 números del celular (el PIN por defecto), o '' si no hay. */
export function pinDeTelefono(tel) {
  const d = String(tel || '').replace(/\D/g, '')
  return d.length >= 3 ? d.slice(-3) : ''
}

function costoTarifa(tar, ts) {
  if (!tar) return 0
  const h = ((Number(ts.fab_minutos) || 0) * 60 + (Number(ts.fab_segundos) || 0)) / 3600
  return h * (Number(tar.costo_hora) || 0)
}

/**
 * Vuelve a calcular los renglones de un pedido con los costos de HOY (materiales, tarifas, costo de los
 * productos y lista de precios). Misma cuenta que usa el Presupuesto.
 * @param {object[]} items  renglones guardados (tipo 'medida' | 'producto' | 'libre')
 * @param {{ materiales: object[], tarifas: object[], productos: Map<string, object>, lista: object|null }} datos
 * @returns {{ items: object[], total: number }}
 */
export function recalcularItems(items, { materiales, tarifas, productos, lista }) {
  const nuevos = (items || []).map((it) => {
    if (it.tipo === 'medida') {
      let costo = 0
      for (const p of it.piezas || []) {
        const mat = materiales.find((m) => m.id === Number(p.material_id))
        costo += calcInsumo(mat, p) * (1 + (Number(p.incremento) || 0) / 100)
      }
      for (const ts of it.tarifas_sel || []) {
        const tar = tarifas.find((t) => t.id === Number(ts.tarifa_id))
        costo += costoTarifa(tar, ts) * (1 + (Number(ts.incremento) || 0) / 100)
      }
      const venta = precioVenta(costo, lista)
      return { ...it, costo_unitario: venta, subtotal: venta * (Number(it.cantidad) || 1) }
    }
    if (it.tipo === 'libre') return it   // precio puesto a mano: no cambia solo
    const prod = productos.get(String(it.producto_id))
    if (!prod) return it
    const base = precioVenta(Number(prod.costo_base), lista)
    const { precio } = precioConPromoProducto(prod, 'local', base, it.cantidad)
    return { ...it, precio, subtotal: precio * (Number(it.cantidad) || 1) }
  })
  return { items: nuevos, total: nuevos.reduce((a, it) => a + (Number(it.subtotal) || 0), 0) }
}

/** Trae lo necesario para recalcular precios (materiales, tarifas, listas y los productos de esos renglones). */
export async function cargarDatosDePrecio(pedidos) {
  const ids = [...new Set(pedidos.flatMap((p) => (p.items || []).filter((i) => i.tipo === 'producto' && i.producto_id).map((i) => i.producto_id)))]
  const [{ data: materiales }, { data: tarifas }, { data: listas }, prods] = await Promise.all([
    supabase.from('materiales').select('*'),
    supabase.from('tarifas').select('*'),
    supabase.from('listas_precios').select('*'),
    ids.length ? supabase.from('productos').select('*').in('id', ids) : Promise.resolve({ data: [] }),
  ])
  return {
    materiales: materiales || [], tarifas: tarifas || [], listas: listas || [],
    productos: new Map((prods.data || []).map((p) => [String(p.id), p])),
  }
}

/** Precio actual de UN pedido con los datos dados (null si no tiene renglones para recalcular). */
export function precioActual(pedido, datos) {
  if (!pedido.items?.length) return null
  const lista = datos.listas.find((l) => l.id === pedido.lista_id) || null
  return recalcularItems(pedido.items, { ...datos, lista })
}

/**
 * Actualiza el precio de los pedidos que todavía no tienen seña (precio no congelado), según los costos de hoy.
 * Mejor esfuerzo: nunca lanza. Devuelve cuántos pedidos cambiaron de precio.
 */
export async function recalcularPedidosAbiertos() {
  try {
    const { data: pedidos } = await supabase.from('pedidos').select('id, items, total, lista_id')
      .eq('estado', 'presupuestado').eq('precio_congelado', false)
    const conItems = (pedidos || []).filter((p) => p.items?.length)
    if (!conItems.length) return 0
    const datos = await cargarDatosDePrecio(conItems)
    let cambiados = 0
    for (const p of conItems) {
      const r = precioActual(p, datos)
      if (!r || Math.abs(r.total - Number(p.total)) < 0.5) continue
      const { error } = await supabase.from('pedidos').update({ items: r.items, total: Math.round(r.total * 100) / 100 }).eq('id', p.id)
      if (!error) cambiados++
    }
    return cambiados
  } catch (err) {
    console.warn('[pedidos] no se pudo actualizar precios:', err)
    return 0
  }
}

/** Crea un pedido a partir de un presupuesto guardado. */
export async function crearPedidoDesdePresupuesto(presupuesto, { telefono = '', email = '', clienteId = null } = {}) {
  const items = presupuesto.items || []
  const medida = items.find((i) => i.tipo === 'medida')
  const titulo = (medida?.nombre && medida.nombre !== 'Trabajo a medida' ? medida.nombre : null)
    || items.map((i) => i.nombre).filter(Boolean).slice(0, 2).join(' + ') || 'Pedido'
  const fila = {
    cliente_nombre: presupuesto.cliente || 'Cliente',
    cliente_telefono: telefono || null, cliente_email: email || null, cliente_id: clienteId,
    titulo, descripcion: presupuesto.notas || null,
    presupuesto_id: presupuesto.id, lista_id: presupuesto.lista_id || null,
    items, total: Number(presupuesto.total) || 0,
  }
  const { data, error } = await supabase.from('pedidos').insert(fila).select('*').single()
  if (error) throw new Error(error.message)
  return data
}

/**
 * Sube una foto de un pedido (referencia del cliente o "cómo quedaría") al Storage, achicada. Devuelve la URL pública o null.
 * Se guarda en productos/pedidos/<codigo>/ con nombre único.
 */
export async function subirImagenPedido(codigo, tipo, archivo, optimizar) {
  const blob = await optimizar(archivo)
  const ext = blob.type === 'image/jpeg' ? 'jpg' : (archivo.name.split('.').pop() || 'png').toLowerCase()
  const ruta = `pedidos/${codigo}/${tipo === 'imagenes_referencia' ? 'ref' : 'res'}-${Date.now()}-${Math.round(Math.random() * 1e5)}.${ext}`
  const { error } = await supabase.storage.from('productos').upload(ruta, blob, { contentType: blob.type || 'image/jpeg', cacheControl: '31536000' })
  if (error) throw new Error(error.message)
  return supabase.storage.from('productos').getPublicUrl(ruta).data.publicUrl
}

// ── Link de seguimiento ─────────────────────────────────────────────────────────────────────────
// El cliente entra con un link único (token largo) y el sitio le pide solo el PIN.
// Cada negocio tiene su propio sitio (su dominio y su marca): la dirección vive en la marca del negocio
// (branding.url_seguimiento, se carga en Configuración → Marca). Si no está cargada, no hay link.

/** Dirección base del sitio de seguimiento de un negocio, sin barra final (o null si no la cargó). */
export function baseSeguimiento(branding) {
  const b = String(branding?.url_seguimiento || '').trim().replace(/\/+$/, '')
  if (!b) return null
  return /^https?:\/\//i.test(b) ? b : `https://${b}`
}

/** URL del seguimiento de un pedido (o null si falta el token o el negocio no cargó su sitio). */
export function urlSeguimiento(pedido, branding) {
  const base = baseSeguimiento(branding)
  return pedido?.token && base ? `${base}/?p=${pedido.token}` : null
}

/** URL de acceso al panel del cliente (primer ingreso o PIN olvidado), o null si el negocio no cargó su sitio. */
export function urlAccesoCliente(token, branding) {
  const base = baseSeguimiento(branding)
  return token && base ? `${base}/?a=${token}` : null
}

/** Mensaje listo para mandar al cliente por WhatsApp. */
export function mensajeSeguimiento(pedido, branding) {
  const url = urlSeguimiento(pedido, branding)
  const lineas = [`Hola ${pedido.cliente_nombre}! Tu pedido "${pedido.titulo}" ya está registrado.`]
  if (url) {
    lineas.push(`Podés seguirlo desde este link: ${url}`)
    if (pedido.pin_requerido !== false) lineas.push('Para entrar te pide un PIN: los últimos 3 números de tu celular.')
  }
  lineas.push(`Código de pedido: ${pedido.codigo}`)
  return lineas.join('\n')
}
