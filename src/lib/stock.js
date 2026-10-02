import { supabase } from './supabase.js'

// Si alguno de los producto_id de `items` es un combo (tiene combo_items cargado),
// lo reemplaza por sus componentes reales, multiplicando cantidades — así el stock
// se mueve sobre los productos que de verdad se tocan, no sobre el combo (que no
// tiene stock propio). Los que no son combo pasan sin cambios.
async function expandirCombos(items) {
  const ids = [...new Set(items.map((i) => i.producto_id).filter(Boolean))]
  if (!ids.length) return items
  const { data } = await supabase.from('productos').select('id, combo_items').in('id', ids)
  const combos = {}
  for (const p of data || []) if (Array.isArray(p.combo_items) && p.combo_items.length) combos[p.id] = p.combo_items
  if (!Object.keys(combos).length) return items

  const out = []
  for (const it of items) {
    const combo = it.producto_id ? combos[it.producto_id] : null
    if (!combo) { out.push(it); continue }
    for (const comp of combo) {
      out.push({ producto_id: comp.producto_id, cantidad: (Number(comp.cantidad) || 0) * (Number(it.cantidad) || 0) })
    }
  }
  return out
}

/**
 * Resta item.cantidad del stock_actual de cada producto (pasar cantidad
 * negativa para sumar, ej. al anular/eliminar una venta). Si el ítem es un
 * combo, se descuenta de los productos que lo componen, no de él.
 *
 * El stock acá es solo informativo — nunca bloquea una venta. Si queda en
 * negativo, es una señal de "hay que fabricar lo que falta".
 *
 * @param {{ producto_id: number|string|null, cantidad: number }[]} items
 */
export async function ajustarStock(items) {
  const expandido = await expandirCombos(items)
  const porProducto = {}
  for (const it of expandido) {
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
