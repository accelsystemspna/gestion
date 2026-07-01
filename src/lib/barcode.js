/**
 * barcode.js
 * Generador de etiquetas con código de barras Code128 B.
 * Implementación pura en Canvas — sin dependencias externas.
 */

// ── Tabla Code128 B ──────────────────────────────────────────────────────────
const C128 = [
  [2,1,2,2,2,2],[2,2,2,1,2,2],[2,2,2,2,2,1],[1,2,1,2,2,3],
  [1,2,1,3,2,2],[1,3,1,2,2,2],[1,2,2,2,1,3],[1,2,2,3,1,2],
  [1,3,2,2,1,2],[2,2,1,2,1,3],[2,2,1,3,1,2],[2,3,1,2,1,2],
  [1,1,2,2,3,2],[1,2,2,1,3,2],[1,2,2,2,3,1],[1,1,3,2,2,2],
  [1,2,3,1,2,2],[1,2,3,2,2,1],[2,2,3,2,1,1],[2,2,1,1,3,2],
  [2,2,1,2,3,1],[2,1,3,2,1,2],[2,2,3,1,1,2],[3,1,2,1,3,1],
  [3,1,1,2,2,2],[3,2,1,1,2,2],[3,2,1,2,2,1],[3,1,2,2,1,2],
  [3,2,2,1,1,2],[3,2,2,2,1,1],[2,1,2,1,2,3],[2,1,2,3,2,1],
  [2,3,2,1,2,1],[1,1,1,3,2,3],[1,3,1,1,2,3],[1,3,1,3,2,1],
  [1,1,2,3,1,3],[1,3,2,1,1,3],[1,3,2,3,1,1],[2,1,1,3,1,3],
  [2,3,1,1,1,3],[2,3,1,3,1,1],[1,1,2,1,3,3],[1,1,2,3,3,1],
  [1,3,2,1,3,1],[1,1,3,1,2,3],[1,1,3,3,2,1],[1,3,3,1,2,1],
  [3,1,3,1,2,1],[2,1,1,3,3,1],[2,3,1,1,3,1],[2,1,3,1,1,3],
  [2,1,3,3,1,1],[2,1,3,1,3,1],[3,1,1,1,2,3],[3,1,1,3,2,1],
  [3,3,1,1,2,1],[3,1,2,1,1,3],[3,1,2,3,1,1],[3,3,2,1,1,1],
  [3,1,4,1,1,1],[2,2,1,4,1,1],[4,3,1,1,1,1],[1,1,1,2,2,4],
  [1,1,1,4,2,2],[1,2,1,1,2,4],[1,2,1,4,2,1],[1,4,1,1,2,2],
  [1,4,1,2,2,1],[1,1,2,2,1,4],[1,1,2,4,1,2],[1,2,2,1,1,4],
  [1,2,2,4,1,1],[1,4,2,1,1,2],[1,4,2,2,1,1],[2,4,1,2,1,1],
  [2,2,1,1,1,4],[4,1,3,1,1,1],[2,4,1,1,1,2],[1,3,4,1,1,1],
  [1,1,1,2,4,2],[1,2,1,1,4,2],[1,2,1,2,4,1],[1,1,4,2,1,2],
  [1,2,4,1,1,2],[1,2,4,2,1,1],[4,1,1,2,1,2],[4,2,1,1,1,2],
  [4,2,1,2,1,1],[2,1,2,1,4,1],[2,1,4,1,2,1],[4,1,2,1,2,1],
  [1,1,1,1,4,3],[1,1,1,3,4,1],[1,3,1,1,4,1],[1,1,4,1,1,3],
  [1,1,4,3,1,1],[4,1,1,1,1,3],[4,1,1,3,1,1],[1,1,3,1,4,1],
  [1,1,4,1,3,1],[3,1,1,1,4,1],[4,1,1,1,3,1],
  [2,1,1,4,1,2],[2,1,1,2,1,4],[2,1,1,2,3,2],  // 103=StartA, 104=StartB, 105=StartC
]
const STOP    = [2,3,3,1,1,1,2]
const START_B = 104

function encode128B(str) {
  const values = []
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    if (code < 32 || code > 127) throw new Error(`Carácter no soportado: ${str[i]}`)
    values.push(code - 32)
  }
  let check = START_B
  for (let i = 0; i < values.length; i++) check += (i + 1) * values[i]
  return { values, checksum: check % 103 }
}

// ── Tamaños ──────────────────────────────────────────────────────────────────
const SIZES = {
  pequeno: { canvasW: 340, modW: 1.2, barH: 42, fontNom: 12, fontInfo: 11 },
  mediano: { canvasW: 500, modW: 1.8, barH: 58, fontNom: 15, fontInfo: 13 },
  grande:  { canvasW: 660, modW: 2.4, barH: 76, fontNom: 18, fontInfo: 15 },
}

// Carga una imagen de forma async; devuelve null si falla (CORS, etc.)
function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload  = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

/**
 * Genera un canvas con la etiqueta completa.
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function generateLabelCanvas(producto, opts = {}) {
  const {
    mostrarNombre      = true,
    mostrarDimensiones = false,
    mostrarPrecio      = false,
    precioStr          = '',
    tamano             = 'mediano',
    logoUrl            = null,
  } = opts

  const sz  = SIZES[tamano] || SIZES.mediano
  const PAD = 14
  const LINE_H = sz.fontInfo + 8

  // Cargar logo si hay URL
  const logoImg = logoUrl ? await loadImage(logoUrl) : null

  // ── Calcular alto total ──────────────────────────────────────────────────
  let contentH = 0
  if (mostrarNombre) contentH += sz.fontNom + 10
  const hasDim = mostrarDimensiones &&
    ((producto.ancho_producto != null && producto.ancho_producto !== '') ||
     (producto.alto_producto  != null && producto.alto_producto  !== ''))
  if (hasDim)                     contentH += LINE_H
  if (mostrarPrecio && precioStr) contentH += LINE_H

  const skuTextH    = sz.fontInfo + 6
  const barcodeAreaH = sz.barH + skuTextH
  const totalH      = PAD + contentH + barcodeAreaH + PAD

  // ── Crear canvas ─────────────────────────────────────────────────────────
  const canvas = document.createElement('canvas')
  canvas.width  = sz.canvasW
  canvas.height = totalH
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, sz.canvasW, totalH)
  ctx.strokeStyle = '#d1d5db'
  ctx.lineWidth = 1
  ctx.strokeRect(0.5, 0.5, sz.canvasW - 1, totalH - 1)

  const LOGO_GAP  = 14
  const logoAreaW = logoImg ? Math.round(sz.barH * 2.0) : 0

  // Pre-calcular ancho real del código para centrar el bloque completo
  const sku = producto.sku || 'SKU'
  let preModW = sz.modW, preSymbolMods = 0
  try {
    const { values: pv, checksum: pc } = encode128B(sku)
    preSymbolMods =
      C128[START_B].reduce((a, b) => a + b, 0)
      + pv.reduce((s, v) => s + C128[v].reduce((a, b) => a + b, 0), 0)
      + C128[pc].reduce((a, b) => a + b, 0)
      + STOP.reduce((a, b) => a + b, 0)
    const tentativeAvail = sz.canvasW - 2 * PAD - logoAreaW - (logoImg ? LOGO_GAP : 0)
    preModW = Math.min(sz.modW, tentativeAvail / (preSymbolMods + 20))
  } catch (_) {}

  const barcodeW      = preSymbolMods * preModW
  const totalContentW = logoAreaW + (logoImg ? LOGO_GAP : 0) + barcodeW
  // Margen igual a ambos lados
  const sideMargin    = Math.max(PAD, Math.round((sz.canvasW - totalContentW) / 2))
  const logoDrawX     = sideMargin
  const barcodeLeft   = sideMargin + logoAreaW + (logoImg ? LOGO_GAP : 0)
  const textCenterX   = barcodeLeft + barcodeW / 2   // centro del código

  let y = PAD

  // ── Nombre ───────────────────────────────────────────────────────────────
  if (mostrarNombre) {
    ctx.fillStyle = '#111111'
    ctx.font = `bold ${sz.fontNom}px Arial, sans-serif`
    ctx.textAlign = 'center'
    const nombre = (producto.nombre || '').length > 48
      ? (producto.nombre || '').slice(0, 48) + '…'
      : (producto.nombre || '')
    ctx.fillText(nombre, textCenterX, y + sz.fontNom)
    y += sz.fontNom + 10
  }

  try {
    const { values, checksum } = encode128B(sku)

    const symbolMods =
      C128[START_B].reduce((a, b) => a + b, 0)
      + values.reduce((sum, v) => sum + C128[v].reduce((a, b) => a + b, 0), 0)
      + C128[checksum].reduce((a, b) => a + b, 0)
      + STOP.reduce((a, b) => a + b, 0)

    const modW = preModW  // ya calculado arriba con el mismo criterio

    // Arrancar desde barcodeLeft (margen izquierdo = margen derecho)
    let x = barcodeLeft
    const barTop = y

    const drawSymbol = (pattern) => {
      let isBar = true
      for (const w of pattern) {
        const px = w * modW
        if (isBar) {
          ctx.fillStyle = '#000000'
          ctx.fillRect(Math.round(x), barTop, Math.ceil(px), sz.barH)
        }
        x += px
        isBar = !isBar
      }
    }

    drawSymbol(C128[START_B])
    for (const v of values) drawSymbol(C128[v])
    drawSymbol(C128[checksum])

    // Stop (7 elementos)
    let isBar = true
    for (const w of STOP) {
      const px = w * modW
      if (isBar) {
        ctx.fillStyle = '#000000'
        ctx.fillRect(Math.round(x), barTop, Math.ceil(px), sz.barH)
      }
      x += px
      isBar = !isBar
    }

    // SKU text centrado bajo el barcode
    ctx.fillStyle = '#111111'
    ctx.font = `${sz.fontInfo}px Arial, sans-serif`
    ctx.textAlign = 'center'
    ctx.fillText(sku, textCenterX, barTop + sz.barH + sz.fontInfo + 4)

  } catch (err) {
    ctx.fillStyle = '#ef4444'
    ctx.font = `12px Arial, sans-serif`
    ctx.textAlign = 'center'
    ctx.fillText('Caracteres no soportados', sz.canvasW / 2, y + 30)
  }

  // ── Logo ─────────────────────────────────────────────────────────────────
  if (logoImg && logoAreaW > 0) {
    const logoSize = Math.round(sz.barH * 1.6)
    const logoY    = y + Math.round((sz.barH - logoSize) / 2)
    ctx.drawImage(logoImg, logoDrawX, logoY, logoSize, logoSize)
  }

  y += barcodeAreaH

  // ── Dimensiones ──────────────────────────────────────────────────────────
  if (hasDim) {
    const parts = []
    if (producto.ancho_producto != null && producto.ancho_producto !== '') parts.push(`${producto.ancho_producto} cm`)
    if (producto.alto_producto  != null && producto.alto_producto  !== '') parts.push(`${producto.alto_producto} cm`)
    ctx.fillStyle = '#555555'
    ctx.font = `${sz.fontInfo}px Arial, sans-serif`
    ctx.textAlign = 'center'
    ctx.fillText(parts.join(' × '), textCenterX, y + sz.fontInfo + 2)
    y += LINE_H
  }

  // ── Precio ───────────────────────────────────────────────────────────────
  if (mostrarPrecio && precioStr) {
    ctx.fillStyle = '#16a34a'
    ctx.font = `bold ${sz.fontInfo + 1}px Arial, sans-serif`
    ctx.textAlign = 'center'
    ctx.fillText(precioStr, textCenterX, y + sz.fontInfo + 2)
  }

  return canvas
}

export async function generateLabelDataUrl(producto, opts) {
  const canvas = await generateLabelCanvas(producto, opts)
  return canvas.toDataURL('image/png')
}

export async function downloadLabelPNG(producto, opts) {
  const url = await generateLabelDataUrl(producto, opts)
  const a = document.createElement('a')
  a.href = url
  a.download = `etiqueta-${producto.sku || 'producto'}.png`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

export async function printLabel(producto, opts) {
  const dataUrl = await generateLabelDataUrl(producto, opts)
  const win = window.open('', `print-${producto.sku}`, 'width=700,height=500')
  if (!win) { alert('Permitir ventanas emergentes para imprimir'); return }
  win.document.write(`<!DOCTYPE html>
<html><head>
  <meta charset="utf-8">
  <title>Etiqueta ${producto.sku || ''}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#eee;display:flex;flex-direction:column;align-items:center;
         justify-content:center;min-height:100vh;gap:16px;font-family:Arial,sans-serif}
    .wrap{background:white;padding:20px;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,.15)}
    img{display:block;max-width:100%}
    .btns{display:flex;gap:10px}
    button{padding:8px 22px;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600}
    .p{background:#2563eb;color:white}.c{background:#e5e7eb;color:#374151}
    @media print{body{background:white}.btns{display:none}.wrap{box-shadow:none;padding:0}}
  </style>
</head><body>
  <div class="wrap"><img src="${dataUrl}"/></div>
  <div class="btns">
    <button class="p" onclick="window.print()">🖨️ Imprimir</button>
    <button class="c" onclick="window.close()">Cerrar</button>
  </div>
</body></html>`)
  win.document.close()
}
