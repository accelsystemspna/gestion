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
 * Resta item.cantidad del stock de cada producto (pasar cantidad negativa para
 * sumar, ej. al anular/eliminar una venta). Si el ítem es un combo, se descuenta
 * de los productos que lo componen, no de él.
 *
 * Lo hace la función ajustar_stock de la base (atómica): si el producto es de otro
 * negocio, descuenta del stock original o del stock propio del negocio según lo que
 * el Principal haya configurado al activarle la categoría.
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
  const lista = Object.entries(porProducto).map(([producto_id, cantidad]) => ({ producto_id, cantidad }))
  if (!lista.length) return
  const { error } = await supabase.rpc('ajustar_stock', { p_items: lista })
  if (error) console.error('[ajustarStock]', error.message)
}

/**
 * En los productos que son de otro negocio (los activó el Principal), reemplaza
 * stock_actual por el stock propio del negocio — salvo que la categoría comparta
 * stock, en cuyo caso queda el stock original. Los productos propios no cambian.
 * Los de stock no compartido sin movimientos todavía figuran en 0.
 */
export async function aplicarStockPropio(productos, orgId) {
  if (!orgId || !productos?.some((p) => p.org_id && p.org_id !== orgId)) return productos
  const [{ data: accesos }, { data: propio }] = await Promise.all([
    supabase.from('categorias_acceso').select('categoria_id, comparte_stock').eq('org_id', orgId),
    supabase.from('stock_negocio').select('producto_id, stock_actual').eq('org_id', orgId),
  ])
  const comparte = new Set((accesos || []).filter((a) => a.comparte_stock).map((a) => a.categoria_id))
  const stockPropio = Object.fromEntries((propio || []).map((r) => [r.producto_id, r.stock_actual]))
  return productos.map((p) => {
    if (!p.org_id || p.org_id === orgId || comparte.has(p.categoria_id)) return p
    return { ...p, stock_actual: stockPropio[p.id] ?? 0, stock_propio: true }
  })
}
