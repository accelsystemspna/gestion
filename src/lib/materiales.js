import { supabase } from './supabase'
import { recalcularProductosPorMaterial } from './recalcularCC'
import { recalcularPedidosAbiertos } from './pedidos'

/** Materiales que este negocio ocultó (compartidos que no usa). Si todavía falta el SQL, ninguno. */
export async function materialesOcultos() {
  const { data, error } = await supabase.from('materiales_ocultos').select('material_id')
  return new Set(error ? [] : (data ?? []).map((o) => o.material_id))
}

/** Para elegir: sin los ocultos, salvo el que ya está elegido (así no se pierde al editar). */
export const paraElegir = (materiales, ocultos, elegido) =>
  materiales.filter((m) => !ocultos.has(m.id) || String(m.id) === String(elegido))

let enCurso = false

/**
 * Si otro negocio cambió el precio de un material que comparte con este, recalcula los productos propios,
 * las ventas en cuenta corriente y los pedidos sin seña, igual que al editar un material propio.
 * Corre en la sesión de este negocio, así también se actualizan sus tiendas web. No hace nada si no hubo cambios.
 */
export async function actualizarCostosCompartidos(orgId) {
  if (enCurso || !orgId) return
  enCurso = true
  try {
    const { data: ultimo, error } = await supabase.from('materiales').select('updated_at')
      .neq('org_id', orgId).order('updated_at', { ascending: false }).limit(1)
    if (error || !ultimo?.[0]?.updated_at) return
    const { data: marca, error: errMarca } = await supabase.from('costos_recalculados').select('hecho_en').eq('org_id', orgId).maybeSingle()
    if (errMarca) return
    if (marca?.hecho_en && new Date(marca.hecho_en) >= new Date(ultimo[0].updated_at)) return
    const desde = new Date().toISOString()
    const r = await recalcularProductosPorMaterial(null)
    await recalcularPedidosAbiertos()
    await supabase.from('costos_recalculados').upsert({ org_id: orgId, hecho_en: desde }, { onConflict: 'org_id' })
    if (r?.productosActualizados) console.log(`[costos] materiales compartidos: ${r.productosActualizados} producto(s) recalculados`)
  } catch (err) {
    console.warn('[costos] no se pudieron recalcular los materiales compartidos', err)
  } finally {
    enCurso = false
  }
}
