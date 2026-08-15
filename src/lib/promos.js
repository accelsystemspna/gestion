import { fmtMoney } from './format'

const hoyStr = () => new Date().toISOString().slice(0, 10)

function vigente(promo) {
  if (!promo.activa) return false
  const hoy = hoyStr()
  if (promo.fecha_desde && hoy < promo.fecha_desde) return false
  if (promo.fecha_hasta && hoy > promo.fecha_hasta) return false
  return true
}

function aplicaAProducto(promo, producto) {
  if (!producto) return false
  if (promo.alcance_tipo === 'todos') return true
  const ids = (promo.alcance_ids || []).map(String)
  if (promo.alcance_tipo === 'categoria') return ids.includes(String(producto.categoria_id))
  if (promo.alcance_tipo === 'producto') return ids.includes(String(producto.id))
  return false
}

// Promos vigentes que aplican a este producto en este canal ('local' | 'web')
export function promosParaProducto(promos, producto, canal) {
  return (promos || []).filter((p) =>
    vigente(p) && (p.canal === 'ambos' || p.canal === canal) && aplicaAProducto(p, producto)
  )
}

// Calcula el subtotal de una línea (precio unitario base × cantidad) aplicando
// una promo puntual. Devuelve { subtotal, etiqueta, ahorro }.
export function calcularLineaConPromo(precioBase, cantidad, promo) {
  const full = precioBase * cantidad
  if (!promo || cantidad <= 0) return { subtotal: full, etiqueta: null, ahorro: 0 }

  if (promo.tipo === 'descuento_pct') {
    const pct = Number(promo.valor) || 0
    const subtotal = full * (1 - pct / 100)
    return { subtotal, etiqueta: `🏷️ -${pct}%`, ahorro: full - subtotal }
  }

  if (promo.tipo === 'descuento_monto') {
    const precioUnit = Math.max(0, precioBase - (Number(promo.valor) || 0))
    const subtotal = precioUnit * cantidad
    return { subtotal, etiqueta: `🏷️ -${fmtMoney(promo.valor)}`, ahorro: full - subtotal }
  }

  if (promo.tipo === 'nxm') {
    const lleva = Number(promo.lleva) || 1
    const paga = Number(promo.paga) || lleva
    const grupos = Math.floor(cantidad / lleva)
    const resto = cantidad % lleva
    const cantidadPagada = grupos * paga + resto
    const subtotal = cantidadPagada * precioBase
    return { subtotal, etiqueta: `🏷️ ${lleva}x${paga}`, ahorro: full - subtotal }
  }

  if (promo.tipo === 'segunda_unidad_pct') {
    const pct = Number(promo.valor) || 0
    const pares = Math.floor(cantidad / 2)
    const resto = cantidad % 2
    const subtotal = pares * (precioBase + precioBase * (1 - pct / 100)) + resto * precioBase
    return { subtotal, etiqueta: `🏷️ 2da unidad -${pct}%`, ahorro: full - subtotal }
  }

  return { subtotal: full, etiqueta: null, ahorro: 0 }
}

// Entre todas las promos candidatas, aplica la que le da mejor precio al
// cliente para la cantidad actual del carrito.
export function mejorLineaConPromo(promos, producto, canal, precioBase, cantidad) {
  const candidatas = promosParaProducto(promos, producto, canal)
  const sinPromo = calcularLineaConPromo(precioBase, cantidad, null)
  if (!candidatas.length) return { ...sinPromo, promo: null }

  let mejor = { ...sinPromo, promo: null }
  for (const promo of candidatas) {
    const r = calcularLineaConPromo(precioBase, cantidad, promo)
    if (r.subtotal < mejor.subtotal) mejor = { ...r, promo }
  }
  return mejor
}
