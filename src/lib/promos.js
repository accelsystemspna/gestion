import { fmtMoney } from './format'

const hoyStr = () => new Date().toISOString().slice(0, 10)

// La promo vive directo en el producto (promo_*). Devuelve null si no
// corresponde aplicarla (pausada, vencida, o no es para este canal).
export function promoDeProducto(producto, canal) {
  if (!producto?.promo_activa || !producto.promo_tipo) return null
  const hoy = hoyStr()
  if (producto.promo_fecha_desde && hoy < producto.promo_fecha_desde) return null
  if (producto.promo_fecha_hasta && hoy > producto.promo_fecha_hasta) return null
  const promoCanal = producto.promo_canal || 'ambos'
  if (promoCanal !== 'ambos' && promoCanal !== canal) return null
  return {
    tipo:  producto.promo_tipo,
    valor: producto.promo_valor,
    lleva: producto.promo_lleva,
    paga:  producto.promo_paga,
  }
}

// Calcula el subtotal de una línea (precio unitario base × cantidad)
// aplicando la promo. Devuelve { subtotal, etiqueta, ahorro }.
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

// Atajo: precio unitario promedio para `cantidad` unidades de este
// producto, ya con la promo aplicada (precio × cantidad = subtotal correcto).
export function precioConPromoProducto(producto, canal, precioBase, cantidad) {
  const promo = promoDeProducto(producto, canal)
  const { subtotal, etiqueta } = calcularLineaConPromo(precioBase, cantidad, promo)
  return { precio: cantidad > 0 ? subtotal / cantidad : precioBase, promoEtiqueta: etiqueta }
}
