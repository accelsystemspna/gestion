function csvEscape(value) {
  const str = value == null ? '' : String(value)
  return '"' + str.replace(/"/g, '""') + '"'
}

export function exportCatalogoCSV(productos, lista, categorias, precioVentaFn, _opts = {}) {
  const headers = ['sku', 'sku_base', 'nombre', 'descripcion', 'categoria', 'precio', 'ancho_cm', 'alto_cm', 'imagen_url']

  // Ordenar: agrupar variantes junto a su base
  const sorted = [...productos].sort((a, b) => {
    const aBase = (a.sku || '').replace(/-V\d+$/, '')
    const bBase = (b.sku || '').replace(/-V\d+$/, '')
    if (aBase !== bBase) return aBase.localeCompare(bBase, 'es', { sensitivity: 'base' })
    const av = a.sku?.match(/-V(\d+)$/)?.[1]
    const bv = b.sku?.match(/-V(\d+)$/)?.[1]
    if (!av &&  bv) return -1
    if ( av && !bv) return  1
    if ( av &&  bv) return Number(av) - Number(bv)
    return 0
  })

  const rows = sorted.map((p) => {
    const categoria = p.categoria_id
      ? (categorias.find((c) => String(c.id) === String(p.categoria_id))?.nombre || '')
      : ''

    const precio = lista
      ? precioVentaFn(Number(p.costo_base), lista).toFixed(2)
      : ''

    // Dimensiones del producto (columnas alto_producto / ancho_producto)
    const ancho   = p.ancho_producto != null && p.ancho_producto !== '' ? String(p.ancho_producto) : ''
    const alto    = p.alto_producto  != null && p.alto_producto  !== '' ? String(p.alto_producto)  : ''
    // sku_base solo se completa para variantes; para el producto base queda vacío
    const isVariant = /-V\d+$/.test(p.sku || '')
    const skuBase   = isVariant ? (p.sku || '').replace(/-V\d+$/, '') : ''

    return [
      csvEscape(p.sku),
      csvEscape(skuBase),
      csvEscape(p.nombre),
      csvEscape(p.descripcion),
      csvEscape(categoria),
      csvEscape(precio),
      csvEscape(ancho),
      csvEscape(alto),
      csvEscape(p.imagen_url),
    ].join(';')
  })

  const bom = '﻿'
  const csvContent = bom + [headers.map(csvEscape).join(';'), ...rows].join('\r\n')

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)

  const fecha = new Date().toLocaleDateString('es-AR').replace(/\//g, '-')
  const a = document.createElement('a')
  a.href = url
  a.download = `catalogo-${fecha}.csv`
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
