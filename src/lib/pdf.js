import { jsPDF } from 'jspdf'
import { fmtMoney } from './format'
import { precioVenta } from './pricing'

// ═══════════════════════════════════════════════════════════
// BASE HELPERS
// ═══════════════════════════════════════════════════════════
async function fetchImageAsDataURL(url) {
  if (!url) return null
  try {
    const res = await fetch(url)
    const blob = await res.blob()
    return await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result)
      reader.readAsDataURL(blob)
    })
  } catch { return null }
}

// Resize an image dataURL to maxW×maxH (contain) and re-encode as JPEG at given quality.
// This is the key fix for large PDF sizes: full-resolution PNGs/JPEGs become small JPEGs.
async function resizeImageToDataURL(dataUrl, maxW = 400, maxH = 300, quality = 0.80) {
  return new Promise((resolve) => {
    try {
      const img = new window.Image()
      img.onload = () => {
        const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1)
        const w = Math.round(img.naturalWidth  * scale)
        const h = Math.round(img.naturalHeight * scale)
        const canvas = document.createElement('canvas')
        canvas.width  = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        // Fill white first so PNG transparent areas don't become black in JPEG
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, w, h)
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', quality))
      }
      img.onerror = () => resolve(dataUrl)   // fallback: keep original
      img.src = dataUrl
    } catch { resolve(dataUrl) }
  })
}

function getImgFormat(dataUrl) {
  if (!dataUrl) return 'PNG'
  if (dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg')) return 'JPEG'
  if (dataUrl.startsWith('data:image/webp')) return 'WEBP'
  return 'PNG'
}

async function getImgSize(dataUrl) {
  return new Promise((resolve) => {
    const img = new window.Image()
    img.onload  = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => resolve(null)
    img.src = dataUrl
  })
}

function containBox(nw, nh, maxW, maxH) {
  if (!nw || !nh) return { w: maxW, h: maxH, dx: 0, dy: 0 }
  const scale = Math.min(maxW / nw, maxH / nh)
  const w = nw * scale, h = nh * scale
  return { w, h, dx: (maxW - w) / 2, dy: (maxH - h) / 2 }
}

// ═══════════════════════════════════════════════════════════
// SOCIAL MEDIA SVGs  (rendered to PNG at runtime via canvas)
// ═══════════════════════════════════════════════════════════
const SOCIAL_SVGS = {
  wa: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <rect width="100" height="100" rx="22" fill="#25D366"/>
    <path fill="white" fill-rule="evenodd" d="M50 19C31.8 19 17 33.8 17 52C17 60 20 67 25 72L20 83L32 79C37 81.5 43 83 50 83C68.2 83 83 68.2 83 50C83 31.8 68.2 19 50 19ZM50 25C64.9 25 77 37.1 77 52C77 66.9 64.9 77 50 77C44.5 77 39.5 75 35.5 71.5L27 74L29.5 65.5C26 61 24 56 24 51C24 37 35.1 25 50 25Z"/>
    <path fill="white" d="M38.5 35C37.5 35 36 35.5 35 36.5L33 39C32 40.5 32 42 33 43L36.5 46C37.5 47 37.5 48.5 36.5 49.5L35 52C34 53.5 34.5 55 35.5 56L39.5 58C40.5 59 42 58.5 43 57.5L45 55C48.5 56.8 52 59 55 62L53 64C52 65 52 66.5 53 67.5L56.5 70C57.5 71 59 71 60 70L62.5 67.5C64 66.5 64 65 63 64C60 60 55 55 49 51C46 49 43 47.5 41.5 47L40 43C39.5 41.5 39 38 38.5 35Z"/>
  </svg>`,

  ig: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <rect width="100" height="100" rx="22" fill="#E1306C"/>
    <rect x="21" y="21" width="58" height="58" rx="14" fill="none" stroke="white" stroke-width="5.5"/>
    <circle cx="50" cy="50" r="14.5" fill="none" stroke="white" stroke-width="5.5"/>
    <circle cx="68" cy="32" r="5" fill="white"/>
  </svg>`,

  fb: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <rect width="100" height="100" rx="22" fill="#1877F2"/>
    <path fill="white" d="M62 18H52C41 18 35 25 35 36v9H23v13h12v32h14V58h11l2-13H49V37c0-3.5 1.8-5 5-5h8V18z"/>
  </svg>`,

  yt: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <rect width="100" height="100" rx="22" fill="#FF0000"/>
    <path fill="white" d="M81 35c-1-3.9-4.1-7-7.9-8C66.3 25 50 25 50 25s-16.3 0-23.1 2c-3.8 1-6.9 4.1-7.9 8C17 41.9 17 50 17 50s0 8.1 2 15c1 3.9 4.1 7 7.9 8C33.7 75 50 75 50 75s16.3 0 23.1-2c3.8-1 6.9-4.1 7.9-8C83 58.1 83 50 83 50s0-8.1-2-15zM42 60.5V39.5L62 50 42 60.5z"/>
  </svg>`,

  tt: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <rect width="100" height="100" rx="22" fill="#010101"/>
    <path fill="white" d="M68.5 17h-13v44c0 6-4.8 10.8-10.8 10.8S34 67 34 61s4.8-10.8 10.8-10.8c1 0 2 .1 3 .4V39c-1-.1-2-.2-3-.2C31.6 38.8 21 49.5 21 62.6S31.6 86.4 44.8 86.4S68.5 75.7 68.5 62.6V38c4.1 2.7 9 4.2 14.2 4.2V30c-6.2 0-11.5-3.4-14.3-8.5V17z"/>
  </svg>`,
}

// Converts an SVG string to PNG data URL via canvas (rendered at size×size px)
async function svgIconToDataUrl(svgStr, size = 128) {
  return new Promise((resolve) => {
    try {
      const canvas = document.createElement('canvas')
      canvas.width  = size
      canvas.height = size
      const ctx  = canvas.getContext('2d')
      const img  = new window.Image()
      const b64  = btoa(unescape(encodeURIComponent(svgStr)))
      img.onload  = () => { ctx.drawImage(img, 0, 0, size, size); resolve(canvas.toDataURL('image/png')) }
      img.onerror = () => resolve(null)
      img.src = `data:image/svg+xml;base64,${b64}`
    } catch { resolve(null) }
  })
}

// Try to load a custom icon PNG from /icons/<key>.png (placed in public/icons/).
// Returns null if the file doesn't exist — callers fall back to the SVG.
async function loadCustomIcon(key) {
  return fetchImageAsDataURL(`/icons/${key}.png`)
}

// Pre-load all contact + social icons once.
// Result is passed to both header and footer so they always show identical icons.
async function preloadIcons(b) {
  const keys = []
  if (b.telefono)  keys.push('wa')
  if (b.instagram) keys.push('ig')
  if (b.tiktok)    keys.push('tt')
  if (b.facebook)  keys.push('fb')
  if (b.youtube)   keys.push('yt')

  const cache = {}
  await Promise.all(
    keys.map(async (k) => {
      const custom = await loadCustomIcon(k)
      cache[k] = custom || await svgIconToDataUrl(SOCIAL_SVGS[k])
    })
  )
  return cache
}

// ═══════════════════════════════════════════════════════════
// DRAWING HELPERS
// ═══════════════════════════════════════════════════════════

// Fallback colored rounded-square badge with white text (used when icon can't load)
function brandBadge(doc, x, y, size, rgb, label) {
  doc.setFillColor(...rgb)
  doc.roundedRect(x, y, size, size, size * 0.22, size * 0.22, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(size * 0.48)
  doc.setTextColor(255, 255, 255)
  doc.text(label, x + size / 2, y + size * 0.69, { align: 'center' })
}

// Location pin: filled circle + downward triangle stem + white inner dot
function locationPin(doc, x, y, size, rgb) {
  const cx = x + size / 2
  const r  = size * 0.40
  doc.setFillColor(...rgb)
  doc.circle(cx, y + r, r, 'F')
  const tw = size * 0.54, th = size * 0.52
  doc.lines([[tw, 0], [-tw / 2, th]], cx - tw / 2, y + r * 1.25, [1, 1], 'F', true)
  doc.setFillColor(255, 255, 255)
  doc.circle(cx, y + r, r * 0.40, 'F')
}

// Draw a contact icon in the header right column.
// iconCache: pre-loaded map of { wa, ig, ... } data URLs (same source as footer).
function headerContactIcon(doc, type, x, y, size, iconCache = {}) {
  const r = size * 0.24
  if (type === 'wa') {
    if (iconCache.wa) {
      try { doc.addImage(iconCache.wa, 'PNG', x, y, size, size); return } catch {}
    }
    // fallback badge
    doc.setFillColor(37, 211, 102)
    doc.roundedRect(x, y, size, size, r, r, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(size * 0.52); doc.setTextColor(255, 255, 255)
    doc.text('WA', x + size / 2, y + size * 0.72, { align: 'center' })
  } else if (type === 'em') {
    doc.setFillColor(14, 165, 233)
    doc.roundedRect(x, y, size, size, r, r, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(size * 0.62); doc.setTextColor(255, 255, 255)
    doc.text('@', x + size / 2, y + size * 0.74, { align: 'center' })
  } else if (type === 'loc') {
    locationPin(doc, x, y, size, [239, 68, 68])
  } else if (type === 'web') {
    doc.setFillColor(100, 116, 139)
    doc.roundedRect(x, y, size, size, r, r, 'F')
    const cx = x + size / 2, cy = y + size / 2, gr = size * 0.33
    doc.setDrawColor(255, 255, 255); doc.setLineWidth(size * 0.1)
    doc.circle(cx, cy, gr, 'S')
    doc.line(cx - gr, cy, cx + gr, cy)
    doc.ellipse(cx, cy, gr * 0.45, gr, 'S')
  }
}

// ═══════════════════════════════════════════════════════════
// SHARED FOOTER  — compact layout
// ═══════════════════════════════════════════════════════════
// Compact single-row footer — no logo (logo is already in the header)
async function drawPdfFooter(doc, b, C, margin, pageW, pageH, _logoData = null, iconCache = {}) {
  const FOOTER_H   = 38         // compact single-line footer
  const BOTTOM_BAR = 4
  const footerTop  = pageH - FOOTER_H
  const ICON_PT    = 13         // icon size
  const GAP        = 4          // icon → text
  const SEP        = '   ·   '

  const BRAND_COLORS   = { wa:[37,211,102], ig:[193,53,132], fb:[24,119,242], yt:[255,0,0], tt:[10,10,10] }
  const BRAND_FALLBACK = { wa:'WA', ig:'IG', fb:'FB', yt:'YT', tt:'TT' }
  const iconData = iconCache

  function drawIcon(key, x, y, size = ICON_PT) {
    const data = iconData[key]
    if (data) {
      try { doc.addImage(data, 'PNG', x, y, size, size) } catch {
        brandBadge(doc, x, y, size, BRAND_COLORS[key], BRAND_FALLBACK[key])
      }
    } else {
      brandBadge(doc, x, y, size, BRAND_COLORS[key], BRAND_FALLBACK[key])
    }
  }

  // ── Background ───────────────────────────────────────────
  doc.setFillColor(247, 249, 252)
  doc.rect(0, footerTop, pageW, FOOTER_H - BOTTOM_BAR, 'F')

  doc.setDrawColor(...C.border)
  doc.setLineWidth(0.4)
  doc.line(0, footerTop, pageW, footerTop)

  doc.setFillColor(30, 41, 59)
  doc.rect(0, pageH - BOTTOM_BAR, pageW, BOTTOM_BAR, 'F')

  // Eje visual central — todo se alinea desde aquí
  const usable  = FOOTER_H - BOTTOM_BAR
  const cy      = footerTop + usable / 2          // línea central exacta
  const iconTop = cy - ICON_PT / 2                // iconos centrados en cy
  const rowY    = cy + ICON_PT * 0.22             // baseline de texto: centro visual ≈ cy

  // ── CONTACT items (left side, centred between margin and social zone) ──
  const contactItems = []
  if (b.telefono)  contactItems.push({ type: 'wa',  label: b.telefono  })
  if (b.email)     contactItems.push({ type: 'em',  label: b.email     })
  if (b.direccion) contactItems.push({ type: 'loc', label: b.direccion })

  // ── SOCIAL icons + handles (right side) ────────────────
  const socialItems = []
  if (b.instagram) socialItems.push({ type: 'ig', label: `@${b.instagram}` })
  if (b.tiktok)    socialItems.push({ type: 'tt', label: `@${b.tiktok}`    })
  if (b.facebook)  socialItems.push({ type: 'fb', label: `/${b.facebook}`  })
  if (b.youtube)   socialItems.push({ type: 'yt', label: b.youtube         })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)

  // ── Helper: draw one item (icon + label) at position x ───
  function drawItem(item, x) {
    if (item.type === 'wa') {
      drawIcon('wa', x, iconTop)
    } else if (item.type === 'em') {
      brandBadge(doc, x, iconTop, ICON_PT, [71, 85, 105], '@')
    } else if (item.type === 'loc') {
      // El pin tiene el círculo a r=0.4*size desde el top, así que lo bajamos
      // para que su centro visual quede en cy igual que los demás íconos
      locationPin(doc, x, iconTop - ICON_PT * 0.10, ICON_PT, [239, 68, 68])
    } else {
      drawIcon(item.type, x, iconTop)
    }
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...C.muted)
    doc.text(item.label, x + ICON_PT + GAP, rowY)
  }

  function itemWidth(item) {
    doc.setFontSize(7.5)
    return ICON_PT + GAP + doc.getTextWidth(item.label)
  }

  // ── Todos los elementos en un solo array ─────────────────
  const allItems = [...contactItems, ...socialItems]
  if (allItems.length === 0) return

  // Medir el ancho total de contenido
  const totalContent = allItems.reduce((sum, item) => sum + itemWidth(item), 0)
  const available    = pageW - margin * 2

  // Gap uniforme entre cada elemento
  const gap = allItems.length > 1
    ? (available - totalContent) / (allItems.length - 1)
    : 0

  let x = margin
  allItems.forEach((item) => {
    drawItem(item, x)
    x += itemWidth(item) + gap
  })
}

// ═══════════════════════════════════════════════════════════
// PRESUPUESTO PDF
// ═══════════════════════════════════════════════════════════
export async function exportPresupuestoPDF({ presupuesto, items, cliente, branding, lista, validez }) {
  const doc    = new jsPDF({ unit: 'pt', format: 'a4' })
  const pageW  = doc.internal.pageSize.getWidth()
  const pageH  = doc.internal.pageSize.getHeight()
  const margin = 40
  const contentW = pageW - margin * 2

  const b = branding || {}

  const C = {
    primary: [30,  41,  59],   // dark navy — neutral, works with any brand colour
    stripe:  [148, 163, 184],  // light slate — subtle row-left accent stripes
    dark:    [15,  23,  42],
    muted:   [100, 116, 139],
    border:  [226, 232, 240],
    surface: [248, 250, 252],
    white:   [255, 255, 255],
    green:   [21,  128,  61],  // darker, more professional green for prices
    navy:    [30,   41,  59],
  }

  // Fetch logo, thumbnails and icons — all in parallel, shared between header + footer
  const [logoData, iconCache] = await Promise.all([
    fetchImageAsDataURL(b.logo_url),
    preloadIcons(b),
  ])
  const thumbMap = {}
  await Promise.all(
    items.map(async (it) => {
      if (it.imagen_url && !thumbMap[it.imagen_url]) {
        const d = await fetchImageAsDataURL(it.imagen_url)
        if (d) thumbMap[it.imagen_url] = d
      }
    })
  )

  let y = 0

  // ─── TOP ACCENT BARS ───────────────────────────────────────
  doc.setFillColor(...C.primary)
  doc.rect(0, 0, pageW, 6, 'F')
  doc.setFillColor(15, 23, 42)
  doc.rect(0, 6, pageW, 2, 'F')
  y = 22

  // ─── HEADER ────────────────────────────────────────────────
  // Left: LOGO (larger when present — it IS the brand name)
  const LOGO_SIZE = 80
  let contentStartX = margin

  if (logoData) {
    const dims = await getImgSize(logoData)
    const box  = containBox(dims?.w, dims?.h, LOGO_SIZE, LOGO_SIZE)
    try { doc.addImage(logoData, getImgFormat(logoData), margin + box.dx, y + box.dy, box.w, box.h) } catch {}
    contentStartX = margin + LOGO_SIZE + 14
  }

  // Company name ONLY when no logo (logo already contains the brand name)
  let hy = y + 14
  if (!logoData && b.nombre) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(20)
    doc.setTextColor(...C.dark)
    doc.text(b.nombre, contentStartX, hy)
    hy += 16
  }

  if (b.slogan) {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(9.5)
    doc.setTextColor(...C.muted)
    doc.text(b.slogan, contentStartX, hy)
    hy += 13
  }

  // Right column: contact details — same icons as footer (from shared iconCache)
  const HICON = 11   // header icon size (pt)
  const rightItems = [
    b.telefono  && { txt: b.telefono,  bold: true,  type: 'wa'  },
    b.email     && { txt: b.email,     bold: false, type: 'em'  },
    b.direccion && { txt: b.direccion, bold: false, type: 'loc' },
    (b.web_minorista || b.web_mayorista) && { txt: b.web_minorista || b.web_mayorista, bold: false, type: 'web' },
  ].filter(Boolean)

  if (rightItems.length) {
    let ry = y + 12
    rightItems.forEach(({ txt, bold, type }) => {
      doc.setFont('helvetica', bold ? 'bold' : 'normal')
      doc.setFontSize(9)
      const tw    = doc.getTextWidth(txt)
      const iconX = pageW - margin - tw - 4 - HICON
      const iconY = ry - HICON * 0.78   // alinea el centro visual del ícono con el texto
      headerContactIcon(doc, type, iconX, iconY, HICON, iconCache)
      doc.setTextColor(...C.muted)
      doc.text(txt, pageW - margin, ry, { align: 'right' })
      ry += 14
    })
  }

  y += LOGO_SIZE + 8

  // Separator
  doc.setDrawColor(...C.border)
  doc.setLineWidth(0.5)
  doc.line(margin, y, pageW - margin, y)
  y += 30   // más aire entre la línea y el título

  // ─── TITLE + DATE ──────────────────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(22)
  doc.setTextColor(...C.primary)
  doc.text('PRESUPUESTO', margin, y)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...C.muted)
  const fecha = new Date().toLocaleDateString('es-AR')
  doc.text(`Fecha: ${fecha}`, pageW - margin, y - 6, { align: 'right' })
  if (presupuesto?.numero) {
    doc.text(`N°: ${String(presupuesto.numero).padStart(5, '0')}`, pageW - margin, y + 8, { align: 'right' })
  }

  y += 26

  // ─── VALIDITY BANNER ──────────────────────────────────────
  const validezText = validez ? `Válido por ${validez} desde la fecha de emisión.` : ''
  if (validezText) {
    // Info band — neutral light gray
    doc.setFillColor(...C.surface)
    doc.setDrawColor(...C.border)
    doc.setLineWidth(0.5)
    doc.roundedRect(margin, y, contentW, 22, 2, 2, 'FD')
    // Left accent
    doc.setFillColor(...C.primary)
    doc.roundedRect(margin, y, 4, 22, 1, 1, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(...C.primary)
    doc.text(validezText, margin + 14, y + 14)
    y += 30
  }

  // ─── CLIENTE BAR ───────────────────────────────────────────
  doc.setFillColor(...C.surface)
  doc.setDrawColor(...C.border)
  doc.setLineWidth(0.5)
  doc.roundedRect(margin, y, contentW, 26, 3, 3, 'FD')
  doc.setFillColor(...C.primary)
  doc.roundedRect(margin, y, 4, 26, 2, 2, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...C.muted)
  doc.text('CLIENTE', margin + 14, y + 17)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10.5)
  doc.setTextColor(...C.dark)
  doc.text(cliente || 'Consumidor final', margin + 62, y + 17)
  y += 36

  // ─── TABLE ─────────────────────────────────────────────────
  const THUMB_W = 40
  const SKU_W   = 68
  // col.cant  = centro del encabezado/valor (align: 'center')
  // col.unit  = borde derecho de P.Unit.   (align: 'right')
  // col.sub   = borde derecho de Subtotal  (align: 'right') — con margen interno de 10pt
  const col = {
    thumb:  margin,
    sku:    margin + THUMB_W + 4,
    nombre: margin + THUMB_W + SKU_W + 8,
    cant:   pageW - margin - 182,   // centro de la columna Cant.
    unit:   pageW - margin - 82,    // borde derecho de P. Unit.
    sub:    pageW - margin - 10,    // borde derecho de Subtotal (10 pt de margen)
  }
  const nombreMaxW = col.cant - 30 - col.nombre   // espacio libre para el texto del producto

  doc.setFillColor(...C.navy)
  doc.roundedRect(margin, y, contentW, 24, 3, 3, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...C.white)
  doc.text('SKU',      col.sku,    y + 15)
  doc.text('Producto', col.nombre, y + 15)
  doc.text('Cant.',    col.cant,   y + 15, { align: 'center' })
  doc.text('P. Unit.', col.unit,   y + 15, { align: 'right'  })
  doc.text('Subtotal', col.sub,    y + 15, { align: 'right'  })
  y += 28

  let total  = 0
  let altRow = false

  for (const it of items) {
    const lines = doc.splitTextToSize(it.nombre, nombreMaxW)
    const rowH  = Math.max(44, lines.length * 13 + 16)

    if (y + rowH > pageH - 54) { doc.addPage(); y = margin }

    if (altRow) { doc.setFillColor(243, 244, 246); doc.rect(margin, y, contentW, rowH, 'F') }
    altRow = !altRow

    doc.setFillColor(...C.stripe)
    doc.rect(margin, y, 3, rowH, 'F')

    const imgData = it.imagen_url ? thumbMap[it.imagen_url] : null
    if (imgData) {
      const dims = await getImgSize(imgData)
      const box  = containBox(dims?.w, dims?.h, THUMB_W - 4, rowH - 8)
      try { doc.addImage(imgData, getImgFormat(imgData), col.thumb + 4 + box.dx, y + 4 + box.dy, box.w, box.h) } catch {}
    }

    const textY = y + rowH / 2 - (lines.length - 1) * 6.5 + 3

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...C.muted)
    doc.text(it.sku || '—', col.sku, textY)

    doc.setFontSize(9.5)
    doc.setTextColor(...C.dark)
    doc.text(lines, col.nombre, textY)

    doc.setFontSize(9.5)
    doc.text(String(it.cantidad),              col.cant, textY, { align: 'center' })
    doc.text(fmtMoney(it.precio),              col.unit, textY, { align: 'right'  })

    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...C.dark)
    doc.text(fmtMoney(it.precio * it.cantidad), col.sub, textY, { align: 'right'  })
    total += it.precio * it.cantidad

    y += rowH
    doc.setDrawColor(...C.border)
    doc.setLineWidth(0.3)
    doc.line(margin, y, pageW - margin, y)
  }

  // ─── TOTAL BOX ─────────────────────────────────────────────
  y += 14
  const totalBoxW = 210
  const totalBoxX = pageW - margin - totalBoxW

  doc.setFillColor(215, 219, 227)
  doc.roundedRect(totalBoxX + 2, y + 2, totalBoxW, 36, 5, 5, 'F')
  doc.setFillColor(...C.surface)
  doc.setDrawColor(...C.primary)
  doc.setLineWidth(1.2)
  doc.roundedRect(totalBoxX, y, totalBoxW, 36, 5, 5, 'FD')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.setTextColor(...C.muted)
  doc.text('TOTAL DEL PRESUPUESTO', totalBoxX + 14, y + 14)
  doc.setFontSize(16)
  doc.setTextColor(...C.dark)
  doc.text(fmtMoney(total), pageW - margin - 12, y + 28, { align: 'right' })

  // ─── FOOTER ────────────────────────────────────────────────
  await drawPdfFooter(doc, b, C, margin, pageW, pageH, logoData, iconCache)

  const fileName = `presupuesto-${(cliente || 'sin-cliente').replace(/\s+/g, '-')}-${fecha.replace(/\//g, '-')}.pdf`
  doc.save(fileName)
}

// ═══════════════════════════════════════════════════════════
// AGRUPAMIENTO DE VARIANTES
// ═══════════════════════════════════════════════════════════
// Agrupa productos que comparten el mismo SKU base (sin sufijo -Vn).
// Retorna array de arrays; cada grupo tiene el base primero y variantes en orden.
function groupByBaseSku(items) {
  const map = new Map()
  for (const p of items) {
    const base = p.sku ? p.sku.replace(/-V\d+$/, '') : String(p.id)
    if (!map.has(base)) map.set(base, [])
    map.get(base).push(p)
  }
  const result = []
  for (const [, group] of map) {
    group.sort((a, b) => {
      const av = a.sku?.match(/-V(\d+)$/)?.[1]
      const bv = b.sku?.match(/-V(\d+)$/)?.[1]
      if (!av &&  bv) return -1
      if ( av && !bv) return  1
      if ( av &&  bv) return Number(av) - Number(bv)
      return 0
    })
    result.push(group)
  }
  result.sort((a, b) => {
    const as = a[0].sku?.replace(/-V\d+$/, '') || ''
    const bs = b[0].sku?.replace(/-V\d+$/, '') || ''
    return as.localeCompare(bs, 'es', { sensitivity: 'base' })
  })
  return result
}

// ═══════════════════════════════════════════════════════════
// CATÁLOGO PDF
// ═══════════════════════════════════════════════════════════
export async function exportCatalogoPDF({ productos, lista, categoriaLabel, branding, categorias = [], subcategorias = [], opts = {} }) {
  // Opciones de exportacion con valores por defecto
  const {
    mostrarCategorias    = true,
    mostrarSubcategorias = true,
    mostrarNombre        = true,
    mostrarSku           = true,
    mostrarDimensiones   = true,
    mostrarPrecio        = true,
    columnas             = 3,
  } = opts
  const doc    = new jsPDF({ unit: 'pt', format: 'a4' })
  const pageW  = doc.internal.pageSize.getWidth()
  const pageH  = doc.internal.pageSize.getHeight()
  const margin = 40
  const contentW = pageW - margin * 2

  const b = branding || {}

  const C = {
    primary: [30,  41,  59],   // dark navy — neutral, works with any brand colour
    stripe:  [148, 163, 184],  // light slate — subtle row-left accent stripes
    dark:    [15,  23,  42],
    muted:   [100, 116, 139],
    border:  [226, 232, 240],
    surface: [248, 250, 252],
    white:   [255, 255, 255],
    green:   [21,  128,  61],  // darker, more professional green for prices
    navy:    [30,   41,  59],
  }

  // Fetch logo + icons in parallel — shared between header and footer
  const [logoData, iconCache2] = await Promise.all([
    fetchImageAsDataURL(b.logo_url),
    preloadIcons(b),
  ])
  const thumbMap = {}
  await Promise.all(
    productos.map(async (p) => {
      if (p.imagen_url && !thumbMap[p.imagen_url]) {
        const d = await fetchImageAsDataURL(p.imagen_url)
        if (d) thumbMap[p.imagen_url] = await resizeImageToDataURL(d, 400, 300, 0.80)
      }
    })
  )

  let y = 0

  doc.setFillColor(...C.primary)
  doc.rect(0, 0, pageW, 6, 'F')
  doc.setFillColor(15, 23, 42)
  doc.rect(0, 6, pageW, 2, 'F')
  y = 22

  // ─── HEADER ────────────────────────────────────────────────
  const LOGO_SIZE = 80
  let contentStartX = margin

  if (logoData) {
    const dims = await getImgSize(logoData)
    const box  = containBox(dims?.w, dims?.h, LOGO_SIZE, LOGO_SIZE)
    try { doc.addImage(logoData, getImgFormat(logoData), margin + box.dx, y + box.dy, box.w, box.h) } catch {}
    contentStartX = margin + LOGO_SIZE + 14
  }

  let hy = y + 14
  if (!logoData && b.nombre) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(20)
    doc.setTextColor(...C.dark)
    doc.text(b.nombre, contentStartX, hy)
    hy += 16
  }
  if (b.slogan) {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(9.5)
    doc.setTextColor(...C.muted)
    doc.text(b.slogan, contentStartX, hy)
  }

  const HICON2 = 11
  const rightItems2 = [
    b.telefono  && { txt: b.telefono,  bold: true,  type: 'wa'  },
    b.email     && { txt: b.email,     bold: false, type: 'em'  },
    b.direccion && { txt: b.direccion, bold: false, type: 'loc' },
    (b.web_minorista || b.web_mayorista) && { txt: b.web_minorista || b.web_mayorista, bold: false, type: 'web' },
  ].filter(Boolean)
  if (rightItems2.length) {
    let ry = y + 12
    rightItems2.forEach(({ txt, bold, type }) => {
      doc.setFont('helvetica', bold ? 'bold' : 'normal')
      doc.setFontSize(9)
      const tw2    = doc.getTextWidth(txt)
      const iconX2 = pageW - margin - tw2 - 4 - HICON2
      const iconY2 = ry - HICON2 + 2
      headerContactIcon(doc, type, iconX2, iconY2, HICON2, iconCache2)
      doc.setTextColor(...C.muted)
      doc.text(txt, pageW - margin, ry, { align: 'right' })
      ry += 14
    })
  }

  y += LOGO_SIZE + 8

  doc.setDrawColor(...C.border)
  doc.setLineWidth(0.5)
  doc.line(margin, y, pageW - margin, y)
  y += 26   // espacio extra para que los acentos (Á) no toquen la línea

  // ─── TITLE ─────────────────────────────────────────────────
  // Título centrado; fecha + lista badge debajo también centrados
  const titleMain = categoriaLabel
    ? categoriaLabel.toUpperCase()
    : 'CATALOGO DE PRODUCTOS'

  const fecha = new Date().toLocaleDateString('es-AR')
  const cx = pageW / 2

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(22)
  doc.setTextColor(...C.primary)
  doc.text(titleMain, cx, y, { align: 'center' })
  y += 16

  // Subtítulo: fecha (izquierda) y lista badge (derecha), ambos en la misma línea centrada
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...C.muted)
  doc.text(fecha, margin, y + 2)

  if (lista) {
    const bText = lista.nombre
    const bW    = doc.getTextWidth(bText) + 20
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setFillColor(...C.primary)
    doc.roundedRect(pageW - margin - bW, y - 6, bW, 14, 3, 3, 'F')
    doc.setTextColor(...C.white)
    doc.text(bText, pageW - margin - bW + 10, y + 3)
  }

  y += 20

  // ─── TABLE ─────────────────────────────────────────────────
  const COLS    = columnas === 2 ? 2 : 3
  const GAP_X   = 6    // espacio horizontal entre cards
  const GAP_Y   = 6    // espacio vertical entre filas
  const CARD_W  = (contentW - GAP_X * (COLS - 1)) / COLS
  const IMG_H   = 72   // imagen compacta
  const SKU_H   = 15   // franja SKU arriba
  const NOM_H   = 13   // franja nombre (opcional)
  const DIM_H   = 26   // franja info abajo: dimensiones + precio en dos líneas
  const PAD     = 3    // padding interno de la card
  const CARD_H  = SKU_H + (mostrarNombre ? NOM_H : 0) + IMG_H + DIM_H + PAD * 2 + 2
  const SAFE    = pageH - 54

  // Pre-build String-keyed lookup maps so the type mismatch (number vs string)
  // between Supabase IDs and React state is always resolved correctly.
  const catMap = Object.fromEntries(categorias.map((c) => [String(c.id), c.nombre]))
  const subMap = Object.fromEntries(subcategorias.map((s) => [String(s.id), s.nombre]))
  const getCatName = (p) => catMap[String(p.categoria_id)] || ''
  const getSubName = (p) => (p.subcategoria_id != null && p.subcategoria_id !== '')
    ? (subMap[String(p.subcategoria_id)] || '')
    : ''

  // Ordenar: categoría A→Z → subcategoría A→Z → SKU A→Z
  const productosSorted = [...productos].sort((a, b) => {
    const dCat = getCatName(a).localeCompare(getCatName(b), 'es', { sensitivity: 'base' })
    if (dCat !== 0) return dCat
    const dSub = getSubName(a).localeCompare(getSubName(b), 'es', { sensitivity: 'base' })
    if (dSub !== 0) return dSub
    return (a.sku || '').localeCompare(b.sku || '', 'es', { sensitivity: 'base' })
  })

  // Agrupar en dos niveles: categoría → subcategoría
  const groups = []
  for (const p of productosSorted) {
    const catNombre = getCatName(p)
    const subNombre = getSubName(p)

    let group = groups.find((g) => g.cat === catNombre)
    if (!group) { group = { cat: catNombre, subgroups: [] }; groups.push(group) }

    let sub = group.subgroups.find((sg) => sg.sub === subNombre)
    if (!sub) { sub = { sub: subNombre, items: [] }; group.subgroups.push(sub) }

    sub.items.push(p)
  }

  for (const group of groups) {
    // ── Banda principal de categoría ─────────────────────────────
    // Se muestra cuando: no hay filtro de categoría activo Y el usuario la tiene habilitada.
    if (!categoriaLabel && mostrarCategorias && group.cat) {
      if (y + 22 > SAFE) { doc.addPage(); y = margin }
      doc.setFillColor(30, 41, 59)
      doc.rect(margin, y, contentW, 22, 'F')
      doc.setFillColor(...C.stripe)
      doc.rect(margin, y, 5, 22, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(255, 255, 255)
      doc.text(group.cat.toUpperCase(), margin + 14, y + 14)
      y += 26
    }

    for (const subgroup of group.subgroups) {
      // ── Título centrado de subcategoría ──────────────────────
      const subLabel = subgroup.sub || ''

      // Solo renderizar si hay nombre de subcategoría Y el usuario la tiene habilitada
      if (subLabel && mostrarSubcategorias) {
        if (y + 28 > SAFE) { doc.addPage(); y = margin }

        const SUB_FONT = 11
        const SUB_GAP  = 10
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(SUB_FONT)
        const subText = subLabel.toUpperCase()
        const subTW   = doc.getTextWidth(subText)
        const subCX   = margin + contentW / 2
        const lineY2  = y + 10
        const textY2  = y + 15

        doc.setDrawColor(...C.border)
        doc.setLineWidth(0.7)
        doc.line(margin,                       lineY2, subCX - subTW / 2 - SUB_GAP, lineY2)
        doc.line(subCX + subTW / 2 + SUB_GAP, lineY2, margin + contentW,            lineY2)
        doc.setTextColor(...C.dark)
        doc.text(subText, subCX, textY2, { align: 'center' })
        y += 26
      }

      // Agrupar variantes por SKU base — cada grupo se renderiza como una sola card
      const skuGroups = groupByBaseSku(subgroup.items)

      // Constantes para cards agrupadas
      const VROH  = 15   // altura de cada fila de variante
      // NAMEH = franja SKU + franja nombre (igual que card individual para consistencia)
      const NAMEH = SKU_H + (mostrarNombre ? NOM_H : 0)
      const IMGHG = 62   // imagen en cards agrupadas (un poco mas compacta)

      // Calcula la altura de una card segun si tiene variantes o no
      const calcCardH = (g) => g.length <= 1
        ? CARD_H
        : NAMEH + IMGHG + 2 + g.length * VROH + PAD * 2 + 4

      // Pre-calcular altura maxima por fila (para que todas las cards de una fila queden alineadas)
      const rowMaxHs = []
      for (let ri = 0; ri < skuGroups.length; ri += COLS) {
        rowMaxHs.push(Math.max(...skuGroups.slice(ri, ri + COLS).map(calcCardH)))
      }

      let col = 0

      for (let gi = 0; gi < skuGroups.length; gi++) {
        const group = skuGroups[gi]
        const rowH  = rowMaxHs[Math.floor(gi / COLS)]
        const p     = group[0]   // producto representativo (base o primer variante)

        if (col === 0 && y + rowH > SAFE) { doc.addPage(); y = margin }

        const cardX = margin + col * (CARD_W + GAP_X)

        // Fondo + borde de la card (altura = rowH para que la fila quede uniforme)
        doc.setFillColor(...C.surface)
        doc.setDrawColor(...C.border)
        doc.setLineWidth(0.5)
        doc.roundedRect(cardX, y, CARD_W, rowH, 4, 4, 'FD')

        if (group.length <= 1) {
          // ─── Card individual: layout clasico ───────────────────
          if (mostrarSku) {
            doc.setFont('helvetica', 'bold')
            doc.setFontSize(9)
            doc.setTextColor(...C.muted)
            doc.text(p.sku || '—', cardX + CARD_W / 2, y + SKU_H - 3, { align: 'center' })
          }
          doc.setDrawColor(...C.border); doc.setLineWidth(0.3)
          doc.line(cardX + PAD, y + SKU_H, cardX + CARD_W - PAD, y + SKU_H)

          // Nombre del producto (franja opcional bajo el SKU)
          if (mostrarNombre && p.nombre) {
            const nomY  = y + SKU_H + NOM_H * 0.75
            const nomTxt = doc.splitTextToSize(p.nombre, CARD_W - PAD * 2 - 4)[0]
            doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...C.dark)
            doc.text(nomTxt, cardX + CARD_W / 2, nomY, { align: 'center' })
            doc.setDrawColor(...C.border); doc.setLineWidth(0.2)
            doc.line(cardX + PAD, y + SKU_H + NOM_H, cardX + CARD_W - PAD, y + SKU_H + NOM_H)
          }

          const imgAreaX = cardX + PAD
          const imgAreaY = y + SKU_H + (mostrarNombre ? NOM_H : 0) + PAD
          const imgBoxW  = CARD_W - PAD * 2

          const imgData = p.imagen_url ? thumbMap[p.imagen_url] : null
          if (imgData) {
            const dims = await getImgSize(imgData)
            const box  = containBox(dims?.w, dims?.h, imgBoxW, IMG_H)
            try { doc.addImage(imgData, 'JPEG', imgAreaX + box.dx, imgAreaY + box.dy, box.w, box.h) } catch {}
          } else {
            doc.setFillColor(241, 245, 249)
            doc.roundedRect(imgAreaX, imgAreaY, imgBoxW, IMG_H, 3, 3, 'F')
            doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(203, 213, 225)
            doc.text('sin imagen', imgAreaX + imgBoxW / 2, imgAreaY + IMG_H / 2 + 3, { align: 'center' })
          }

          const infoY      = y + SKU_H + (mostrarNombre ? NOM_H : 0) + PAD + IMG_H + PAD
          doc.setDrawColor(...C.border); doc.setLineWidth(0.3)
          doc.line(cardX + PAD, infoY, cardX + CARD_W - PAD, infoY)

          const cardCX     = cardX + CARD_W / 2
          const tieneAncho = p.ancho_producto != null && Number(p.ancho_producto) > 0
          const tieneAlto  = p.alto_producto  != null && Number(p.alto_producto)  > 0
          const hasDims    = (tieneAncho || tieneAlto) && mostrarDimensiones
          const hasPrice   = !!lista && mostrarPrecio
          const infoMid    = infoY + DIM_H / 2
          const line1Y     = hasDims && hasPrice ? infoY + 9 : infoMid + 3
          const line2Y     = infoY + 20

          if (hasDims) {
            const dimStr = [
              tieneAncho ? `${p.ancho_producto}` : null,
              tieneAlto  ? `${p.alto_producto}`  : null,
            ].filter(Boolean).join(' x ') + ' cm'
            doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...C.muted)
            doc.text(dimStr, cardCX, line1Y, { align: 'center' })
          }
          if (hasPrice) {
            const precio = precioVenta(Number(p.costo_base), lista)
            doc.setFont('helvetica', 'bold'); doc.setFontSize(hasDims ? 8 : 9); doc.setTextColor(...C.green)
            doc.text(fmtMoney(precio), cardCX, hasDims ? line2Y : line1Y, { align: 'center' })
          }

        } else {
          // ─── Card agrupada: nombre + imagen + tabla de variantes ──

          // 1. Franja de encabezado — igual que card individual: SKU arriba, nombre abajo
          const baseSku = (p.sku || '').replace(/-V\d+$/, '')

          // SKU centrado (franja superior, mismo estilo que card individual)
          doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...C.muted)
          doc.text(baseSku, cardX + CARD_W / 2, y + SKU_H - 3, { align: 'center' })
          doc.setDrawColor(...C.border); doc.setLineWidth(0.3)
          doc.line(cardX + PAD, y + SKU_H, cardX + CARD_W - PAD, y + SKU_H)

          // Nombre centrado (franja inferior del encabezado, si está habilitado)
          if (mostrarNombre && p.nombre) {
            const nomY   = y + SKU_H + NOM_H * 0.75
            const nomTxt = doc.splitTextToSize(p.nombre, CARD_W - PAD * 2 - 4)[0]
            doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...C.dark)
            doc.text(nomTxt, cardX + CARD_W / 2, nomY, { align: 'center' })
            doc.setDrawColor(...C.border); doc.setLineWidth(0.2)
            doc.line(cardX + PAD, y + SKU_H + NOM_H, cardX + CARD_W - PAD, y + SKU_H + NOM_H)
          }

          // 2. Imagen del producto base (area compacta)
          const imgAreaX = cardX + PAD
          const imgAreaY = y + NAMEH + PAD
          const imgBoxW  = CARD_W - PAD * 2

          const imgData = p.imagen_url ? thumbMap[p.imagen_url] : null
          if (imgData) {
            const dims = await getImgSize(imgData)
            const box  = containBox(dims?.w, dims?.h, imgBoxW, IMGHG)
            try { doc.addImage(imgData, 'JPEG', imgAreaX + box.dx, imgAreaY + box.dy, box.w, box.h) } catch {}
          } else {
            doc.setFillColor(241, 245, 249)
            doc.roundedRect(imgAreaX, imgAreaY, imgBoxW, IMGHG, 3, 3, 'F')
            doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(203, 213, 225)
            doc.text('sin imagen', imgAreaX + imgBoxW / 2, imgAreaY + IMGHG / 2 + 3, { align: 'center' })
          }

          // 3. Divisor sobre la tabla de variantes
          const tableTopY = y + NAMEH + PAD + IMGHG + PAD
          doc.setDrawColor(...C.border); doc.setLineWidth(0.3)
          doc.line(cardX, tableTopY, cardX + CARD_W, tableTopY)

          // 4. Tabla de variantes: tag | dimensiones | precio
          const TAG_W       = 22   // columna izquierda: "—" / "V1" / "V2"
          const PRICE_W     = 50   // columna derecha: precio (solo cuando hay lista)
          const hayPrecio   = !!lista && mostrarPrecio
          // Si no hay precio la columna de dims ocupa hasta el borde; si hay precio deja espacio
          const DIM_COL_W   = hayPrecio ? CARD_W - TAG_W - PRICE_W : CARD_W - TAG_W

          let vy = tableTopY
          for (let vi = 0; vi < group.length; vi++) {
            const v      = group[vi]
            const isBase = !/-V\d+$/.test(v.sku || '')
            const vNum   = v.sku?.match(/-V(\d+)$/)?.[1]
            const tag    = isBase ? '—' : (vNum ? `V${vNum}` : '?')

            // Fondo alternado de fila
            if (vi % 2 === 1) {
              doc.setFillColor(243, 244, 246)
              doc.rect(cardX, vy, CARD_W, VROH, 'F')
            }

            const textY = vy + VROH * 0.72   // baseline visual centrada en la fila

            // Tag (columna izquierda, centrado)
            doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...C.muted)
            doc.text(tag, cardX + TAG_W / 2, textY, { align: 'center' })

            // Divisor vertical tras el tag
            doc.setDrawColor(...C.border); doc.setLineWidth(0.2)
            doc.line(cardX + TAG_W, vy + 2, cardX + TAG_W, vy + VROH - 2)

            // Dimensiones (columna central)
            const vA = v.ancho_producto != null && Number(v.ancho_producto) > 0
            const vB = v.alto_producto  != null && Number(v.alto_producto)  > 0
            if (mostrarDimensiones && (vA || vB)) {
              const ds = [vA ? `${v.ancho_producto}` : null, vB ? `${v.alto_producto}` : null]
                .filter(Boolean).join(' x ') + ' cm'
              doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...C.dark)
              doc.text(ds, cardX + TAG_W + DIM_COL_W / 2, textY, { align: 'center' })
            }

            // Precio (columna derecha, solo si hay lista seleccionada)
            if (hayPrecio) {
              const precio = precioVenta(Number(v.costo_base), lista)
              doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...C.green)
              doc.text(fmtMoney(precio), cardX + CARD_W - PAD, textY, { align: 'right' })
            }

            // Separador horizontal entre filas
            doc.setDrawColor(...C.border); doc.setLineWidth(0.2)
            doc.line(cardX + PAD, vy + VROH, cardX + CARD_W - PAD, vy + VROH)

            vy += VROH
          }
        }

        // Avanzar columna
        col++
        if (col === COLS) {
          col = 0
          y += rowH + GAP_Y
        }
      }

      // Fila incompleta del subgrupo: avanzar y
      if (col > 0) { y += (rowMaxHs[rowMaxHs.length - 1] ?? CARD_H) + GAP_Y; col = 0 }
      y += 4  // separación entre subgrupos
    }

    y += 4  // separación extra entre grupos principales
  }

  await drawPdfFooter(doc, b, C, margin, pageW, pageH, logoData, iconCache2)

  // ── Nombre del archivo: Catalogo - Categoria - Lista - Fecha.pdf ──
  const sanitize = (s) => (s || '').replace(/[/\\:*?"<>|]/g, '').trim()
  const partesCat   = categoriaLabel ? sanitize(categoriaLabel) : 'Todos'
  const partesLista = lista          ? ` - ${sanitize(lista.nombre)}`   : ''
  const partesDate  = fecha.replace(/\//g, '-')
  doc.save(`Catalogo - ${partesCat}${partesLista} - ${partesDate}.pdf`)
}
