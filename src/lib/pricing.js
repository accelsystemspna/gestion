// Cálculo de costo y precio de venta de un producto

// Costo de un insumo según su tipo_medida y los datos de la pieza/uso
export function calcInsumo(mat, pieza) {
  if (!mat) return 0
  const tipo = mat.tipo_medida || 'placa'
  if (tipo === 'placa') {
    const area = (Number(mat.ancho_cm) || 0) * (Number(mat.alto_cm) || 0)
    const pCm2 = area > 0 ? Number(mat.precio_placa) / area : 0
    const aPieza = (Number(pieza.ancho) || 0) * (Number(pieza.alto) || 0)
    const factor = 1 + (Number(mat.desperdicio) || 0) / 100
    return pCm2 * aPieza * (Number(pieza.cantidad) || 0) * factor
  }
  if (tipo === 'peso')     return ((Number(pieza.gramos) || 0) / 1000) * (Number(mat.precio_unitario) || 0)
  if (tipo === 'unidad')   return (Number(pieza.cantidad) || 0) * (Number(mat.precio_unitario) || 0)
  if (tipo === 'longitud') return (Number(pieza.metros)   || 0) * (Number(mat.precio_unitario) || 0)
  return 0
}

export function calcCostoMelamina({ material, tarifa, ancho, alto, cantidad, minutos, segundos }) {
  if (!material || !tarifa) return 0
  const areaPlaca = (Number(material.ancho_cm) || 0) * (Number(material.alto_cm) || 0)
  const precioCm2 = areaPlaca > 0 ? Number(material.precio_placa) / areaPlaca : 0
  const areaPieza = (Number(ancho) || 0) * (Number(alto) || 0)
  const factorDesperdicio = 1 + (Number(material.desperdicio) || 0) / 100
  const costoMaterial = precioCm2 * areaPieza * (Number(cantidad) || 0) * factorDesperdicio
  const horas = ((Number(minutos) || 0) * 60 + (Number(segundos) || 0)) / 3600
  const costoFab = horas * (Number(tarifa.costo_hora) || 0)
  return costoMaterial + costoFab
}

export function calcCosto3D({ tarifa, gramos, horas, minutos, precioGramo = 0 }) {
  if (!tarifa) return 0
  const tiempoH = (Number(horas) || 0) + (Number(minutos) || 0) / 60
  const costoFab = tiempoH * (Number(tarifa.costo_hora) || 0)
  const costoFil = (Number(gramos) || 0) * (Number(precioGramo) || 0)
  return costoFab + costoFil
}

export function precioVenta(costoBase, lista) {
  if (!lista) return costoBase
  const adicional = Number(lista.adicional) || 0
  let precio = costoBase * (1 + adicional / 100)
  for (const campo of lista.campos_extra || []) {
    if (campo.tipo === '%') {
      const tasa = (Number(campo.valor) || 0) * (campo.incluye_iva ? 1.21 : 1)
      if (campo.es_comision) {
        // Comisión sobre venta: el % sale del precio cobrado, hay que hacer gross-up
        const divisor = 1 - tasa / 100
        if (divisor > 0) precio = precio / divisor
      } else {
        // Recargo sobre costo: se suma al precio acumulado
        precio = precio * (1 + tasa / 100)
      }
    } else if (campo.tipo === '$') {
      precio += Number(campo.valor) || 0
    }
  }
  // Redondeo final
  const rv = Number(lista.redondeo_valor) || 0
  if (rv > 0) {
    const tipo = lista.redondeo_tipo || 'arriba'
    if (tipo === 'arriba')   precio = Math.ceil(precio / rv) * rv
    else if (tipo === 'abajo') precio = Math.floor(precio / rv) * rv
    else                     precio = Math.round(precio / rv) * rv
  }

  return precio
}

// Costo de fabricación de una tarifa (tiempo × costo_hora)
// ts = { fab_minutos, fab_segundos, incremento }
export function calcTarifaCost(tar, ts) {
  if (!tar) return 0
  const horas = ((Number(ts.fab_minutos) || 0) * 60 + (Number(ts.fab_segundos) || 0)) / 3600
  return horas * (Number(tar.costo_hora) || 0)
}

export function precioCm2(material) {
  if (!material) return 0
  const area = (Number(material.ancho_cm) || 0) * (Number(material.alto_cm) || 0)
  return area > 0 ? Number(material.precio_placa) / area : 0
}
