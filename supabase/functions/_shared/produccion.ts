// Fabricación por producto (portal mayorista) y su relación con las fases del pedido en gestión.
//
//   - Cuando TODOS los productos están "listo" o "en stock", el pedido pasa solo de
//     "En preparación" a "Listo para despachar".
//   - Si después alguno deja de estarlo, vuelve a "En preparación" (salvo que ya esté facturado).

export const ESTADOS_PRODUCCION = new Set(['a_fabricar', 'programado', 'listo', 'en_stock'])
const TERMINADOS = new Set(['listo', 'en_stock'])

// Fase que le corresponde al pedido según el estado de fabricación de sus productos,
// o null si no hay que cambiar nada.
export function faseSegunProduccion(estadoWeb: string | null, estados: (string | null)[]): 'listo' | 'en_preparacion' | null {
  const actual = estadoWeb === 'procesado' ? 'en_preparacion' : estadoWeb
  if (actual !== 'en_preparacion' && actual !== 'listo') return null
  const conocidos = estados.filter((e): e is string => !!e)
  if (!estados.length || !conocidos.length) return null
  const todos = conocidos.length === estados.length && conocidos.every((e) => TERMINADOS.has(e))
  if (actual === 'en_preparacion' && todos) return 'listo'
  if (actual === 'listo' && conocidos.some((e) => !TERMINADOS.has(e))) return 'en_preparacion'
  return null
}

// Lee la venta y sus productos y, si corresponde, le cambia la fase. Devuelve la fase nueva o null.
// Mejor esfuerzo: si todavía no existen las columnas de fabricación, no hace nada.
export async function ajustarFasePorProduccion(admin: any, ventaId: string | number): Promise<string | null> {
  try {
    const { data: venta } = await admin.from('ventas').select('estado_web, factura_emitida').eq('id', ventaId).maybeSingle()
    if (!venta) return null
    const { data: items, error } = await admin.from('venta_items').select('produccion').eq('venta_id', ventaId)
    if (error || !items?.length) return null
    const nueva = faseSegunProduccion(venta.estado_web, items.map((i: any) => i.produccion ?? null))
    if (!nueva) return null
    if (nueva === 'en_preparacion' && venta.factura_emitida) return null
    const { error: e } = await admin.from('ventas').update({ estado_web: nueva }).eq('id', ventaId)
    return e ? null : nueva
  } catch (err) {
    console.warn('[produccion] ajustar fase:', err)
    return null
  }
}
