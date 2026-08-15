import { supabase } from './supabase'

/**
 * Resta item.cantidad del stock_actual de cada producto (pasar cantidad
 * negativa para sumar, ej. al anular/eliminar una venta).
 *
 * El stock acá es solo informativo — nunca bloquea una venta. Si queda en
 * negativo, es una señal de "hay que fabricar lo que falta".
 *
 * @param {{ producto_id: number|string|null, cantidad: number }[]} items
 */
export async function ajustarStock(items) {
  const porProducto = {}
  for (const it of items) {
    if (!it.producto_id) continue
    porProducto[it.producto_id] = (porProducto[it.producto_id] || 0) + (Number(it.cantidad) || 0)
  }
  const ids = Object.keys(porProducto)
  if (!ids.length) return

  const { data: productos } = await supabase.from('productos').select('id, stock_actual').in('id', ids)
  await Promise.all((productos || []).map((p) =>
    supabase.from('productos')
      .update({ stock_actual: (Number(p.stock_actual) || 0) - porProducto[p.id] })
      .eq('id', p.id)
  ))
}
