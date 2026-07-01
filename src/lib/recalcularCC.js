/**
 * recalcularCC.js
 *
 * Funciones para recalcular precios de ventas CC pendientes
 * cuando cambian precios de productos o materiales.
 */

import { supabase }                                from './supabase'
import { precioVenta, calcInsumo, calcTarifaCost } from './pricing'

/**
 * Recalcula los precios de todas las ventas pendientes en cuenta corriente
 * que contengan alguno de los productos dados.
 */
export async function recalcularCCPorProductos(productoIds) {
  if (!productoIds?.length) return { ventasActualizadas: 0, clientesAfectados: 0 }

  // 1. Ventas que contienen alguno de esos productos
  const { data: itemsRef } = await supabase
    .from('venta_items')
    .select('venta_id')
    .in('producto_id', productoIds)

  if (!itemsRef?.length) return { ventasActualizadas: 0, clientesAfectados: 0 }

  const ventaIdsRef = [...new Set(itemsRef.map(i => i.venta_id))]

  // 2. Filtrar solo CC pendientes / parciales
  const { data: ventasCC } = await supabase
    .from('ventas')
    .select('id, lista_id, total, cliente_id')
    .in('id', ventaIdsRef)
    .eq('forma_pago', 'cuenta_corriente')
    .in('estado', ['pendiente', 'parcial'])

  if (!ventasCC?.length) return { ventasActualizadas: 0, clientesAfectados: 0 }

  const ventasCCIds = ventasCC.map(v => v.id)

  // 3. Todos los items de esas ventas
  const { data: todosItems } = await supabase
    .from('venta_items')
    .select('id, venta_id, producto_id, cantidad, precio_unitario, subtotal')
    .in('venta_id', ventasCCIds)

  // 4. Productos con costo_base actualizado
  const prodIdsUsados = [...new Set((todosItems ?? []).map(i => i.producto_id).filter(Boolean))]
  const { data: productos } = await supabase
    .from('productos')
    .select('id, costo_base')
    .in('id', prodIdsUsados)
  const prodMap = Object.fromEntries((productos ?? []).map(p => [p.id, p]))

  // 5. Listas de precios
  const { data: listas } = await supabase.from('listas_precios').select('*')
  const listaMap = Object.fromEntries((listas ?? []).map(l => [l.id, l]))

  // 6. Recalcular venta por venta
  let ventasActualizadas = 0
  const saldoDeltas = {}

  for (const venta of ventasCC) {
    const lista = listaMap[venta.lista_id] ?? null
    const items = (todosItems ?? []).filter(i => i.venta_id === venta.id)
    let nuevoTotal = 0

    for (const item of items) {
      let nuevoPrecio = item.precio_unitario ?? 0
      if (item.producto_id && prodMap[item.producto_id]) {
        nuevoPrecio = precioVenta(
          Number(prodMap[item.producto_id].costo_base) || 0,
          lista
        )
      }
      const nuevoSubtotal = nuevoPrecio * (item.cantidad ?? 1)
      nuevoTotal += nuevoSubtotal

      if (Math.abs(nuevoPrecio - (item.precio_unitario ?? 0)) > 0.001) {
        await supabase
          .from('venta_items')
          .update({ precio_unitario: nuevoPrecio, subtotal: nuevoSubtotal })
          .eq('id', item.id)
      }
    }

    if (Math.abs(nuevoTotal - (venta.total ?? 0)) > 0.001) {
      await supabase.from('ventas').update({ total: nuevoTotal }).eq('id', venta.id)
      ventasActualizadas++
      if (venta.cliente_id) {
        saldoDeltas[venta.cliente_id] =
          (saldoDeltas[venta.cliente_id] ?? 0) + ((venta.total ?? 0) - nuevoTotal)
      }
    }
  }

  // 7. Actualizar saldo de cada cliente
  const clientesAfectados = Object.keys(saldoDeltas).length
  for (const [clienteId, delta] of Object.entries(saldoDeltas)) {
    if (Math.abs(delta) > 0.001) {
      const { data: cli } = await supabase
        .from('clientes').select('saldo').eq('id', clienteId).single()
      const saldoActual = Number(cli?.saldo) || 0
      await supabase
        .from('clientes')
        .update({ saldo: saldoActual + delta })
        .eq('id', clienteId)
    }
  }

  return { ventasActualizadas, clientesAfectados }
}

/**
 * Cuando cambia el precio de cualquier material, recalcula el costo_base
 * de TODOS los productos que tienen datos de calculo almacenados,
 * luego propaga los cambios a las ventas CC pendientes.
 *
 * No intenta filtrar por material especifico — recalcula todo con los
 * precios actuales de materiales, lo cual es mas robusto ante distintos
 * formatos de almacenamiento (piezas[] vs columnas individuales).
 */
export async function recalcularProductosPorMaterial(_materialId) {
  const TAG = '[CC Material]'
  console.log(TAG + ' inicio — recalculando todos los productos con datos de costo')

  // 1. Todos los materiales actualizados
  const { data: todosMat } = await supabase.from('materiales').select('*')
  if (!todosMat?.length) return { productosActualizados: 0, ventasActualizadas: 0, clientesAfectados: 0 }
  const matMap = Object.fromEntries(todosMat.map(m => [m.id, m]))

  // 2. Todas las tarifas
  const { data: todasTar } = await supabase.from('tarifas').select('*')
  const tarMap = Object.fromEntries((todasTar ?? []).map(t => [t.id, t]))

  // 3. Todos los productos
  const { data: productos, error: errProd } = await supabase
    .from('productos')
    .select('id, sku, piezas, tarifas_producto, material_id, ancho_pieza, alto_pieza, cantidad_piezas, tarifa_id, fab_minutos, fab_segundos, costo_base')

  if (errProd) {
    console.warn(TAG + ' error al leer productos:', errProd)
    return { productosActualizados: 0, ventasActualizadas: 0, clientesAfectados: 0 }
  }
  console.log(TAG + ' productos en DB: ' + (productos?.length ?? 0))

  if (!productos?.length) return { productosActualizados: 0, ventasActualizadas: 0, clientesAfectados: 0 }

  // Diagnostico — revisar los primeros 3 productos para entender el formato real
  console.log(TAG + ' --- muestra de primeros 3 productos ---')
  for (const p of productos.slice(0, 3)) {
    const piezasType = typeof p.piezas
    const piezasIsArr = Array.isArray(p.piezas)
    const piezasLen   = piezasIsArr ? p.piezas.length : (typeof p.piezas === 'string' ? p.piezas.length : -1)
    console.log(
      TAG + ' [' + (p.sku ?? p.id) + ']' +
      ' piezas tipo=' + piezasType +
      ' isArray=' + piezasIsArr +
      ' len=' + piezasLen +
      ' material_id=' + p.material_id +
      ' costo_base=' + p.costo_base
    )
    if (typeof p.piezas === 'string') {
      console.log(TAG + '   piezas raw (primeros 200 chars): ' + p.piezas.substring(0, 200))
    } else if (piezasIsArr && p.piezas.length > 0) {
      console.log(TAG + '   piezas[0]: ' + JSON.stringify(p.piezas[0]))
    }
  }
  console.log(TAG + ' ------------------------------------')

  // 4. Recalcular costo_base para cada producto que tiene datos de calculo
  const productosActualizadosIds = []

  for (const prod of productos) {
    let nuevoCosto = null  // null = no se puede calcular, se omite

    // Normalizar piezas: puede venir como string JSON si la columna es TEXT
    let piezasArr = prod.piezas
    if (typeof piezasArr === 'string') {
      try { piezasArr = JSON.parse(piezasArr) } catch { piezasArr = null }
    }

    // Normalizar tarifas_producto igualmente
    let tarifasArr = prod.tarifas_producto
    if (typeof tarifasArr === 'string') {
      try { tarifasArr = JSON.parse(tarifasArr) } catch { tarifasArr = [] }
    }

    // Solo procesar si al menos una pieza tiene material_id valido (no vacio)
    const piezasConMat = Array.isArray(piezasArr)
      ? piezasArr.filter(p => p.material_id != null && p.material_id !== '' && Number(p.material_id) > 0)
      : []

    if (piezasConMat.length > 0) {
      // Formato nuevo: array de piezas JSON
      const tarifasSel = Array.isArray(tarifasArr) ? tarifasArr : []
      const costoMat = piezasArr.reduce((s, pieza) => {
        const mat  = matMap[Number(pieza.material_id)]
        if (!mat) return s  // pieza sin material configurado — omitir
        const base = calcInsumo(mat, pieza)
        return s + base * (1 + (Number(pieza.incremento) || 0) / 100)
      }, 0)
      const costoTar = tarifasSel.reduce((s, ts) => {
        const tar  = tarMap[Number(ts.tarifa_id)]
        if (!tar) return s  // tarifa no configurada — omitir
        const base = calcTarifaCost(tar, ts)
        return s + base * (1 + (Number(ts.incremento) || 0) / 100)
      }, 0)
      nuevoCosto = costoMat + costoTar

    } else if (prod.material_id != null && prod.material_id !== '' && Number(prod.material_id) > 0) {
      // Formato viejo: columnas individuales
      const mat   = matMap[Number(prod.material_id)]
      const pieza = {
        material_id: prod.material_id,
        ancho:       prod.ancho_pieza     ?? 0,
        alto:        prod.alto_pieza      ?? 0,
        cantidad:    prod.cantidad_piezas ?? 1,
        gramos: 0, metros: 0,
      }
      const costoMat = calcInsumo(mat, pieza)
      const tar      = tarMap[Number(prod.tarifa_id)]
      const costoTar = calcTarifaCost(tar, {
        fab_minutos:  prod.fab_minutos  ?? 0,
        fab_segundos: prod.fab_segundos ?? 0,
        incremento:   0,
      })
      nuevoCosto = costoMat + costoTar
    }

    // Solo actualizar si se pudo calcular Y el costo cambio
    if (nuevoCosto !== null && Math.abs(nuevoCosto - (prod.costo_base ?? 0)) > 0.001) {
      console.log(TAG + ' ' + (prod.sku ?? prod.id) + ': ' + prod.costo_base + ' -> ' + nuevoCosto.toFixed(2))
      const { error } = await supabase
        .from('productos').update({ costo_base: nuevoCosto }).eq('id', prod.id)
      if (!error) productosActualizadosIds.push(prod.id)
    }
  }

  console.log(TAG + ' productos actualizados: ' + productosActualizadosIds.length)

  if (!productosActualizadosIds.length) {
    console.log(TAG + ' ningun producto cambio de costo')
    return { productosActualizados: 0, ventasActualizadas: 0, clientesAfectados: 0 }
  }

  // 5. Propagar a ventas CC pendientes
  const { ventasActualizadas, clientesAfectados } =
    await recalcularCCPorProductos(productosActualizadosIds)

  console.log(TAG + ' fin: ' + productosActualizadosIds.length + ' productos, ' +
    ventasActualizadas + ' ventas, ' + clientesAfectados + ' clientes')

  return {
    productosActualizados: productosActualizadosIds.length,
    ventasActualizadas,
    clientesAfectados,
  }
}
