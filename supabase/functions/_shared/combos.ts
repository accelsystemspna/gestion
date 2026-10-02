// Si alguno de los producto_id de `items` es un combo (tiene combo_items cargado en
// productos), lo reemplaza por sus componentes reales, multiplicando cantidades — así
// el stock se mueve sobre los productos que de verdad se tocan, no sobre el combo (que
// no tiene stock propio). Mismo criterio que src/lib/stock.js del lado del navegador.
export async function expandirCombos(
  admin: any,
  items: { producto_id: string | null; cantidad: number }[],
): Promise<{ producto_id: string | null; cantidad: number }[]> {
  const ids = [...new Set(items.map((i) => i.producto_id).filter(Boolean))]
  if (!ids.length) return items
  const { data } = await admin.from('productos').select('id, combo_items').in('id', ids)
  const combos: Record<string, any[]> = {}
  for (const p of data ?? []) if (Array.isArray(p.combo_items) && p.combo_items.length) combos[p.id] = p.combo_items
  if (!Object.keys(combos).length) return items

  const out: { producto_id: string | null; cantidad: number }[] = []
  for (const it of items) {
    const combo = it.producto_id ? combos[it.producto_id] : null
    if (!combo) { out.push(it); continue }
    for (const comp of combo) {
      out.push({ producto_id: comp.producto_id, cantidad: (Number(comp.cantidad) || 0) * (Number(it.cantidad) || 0) })
    }
  }
  return out
}
