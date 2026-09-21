import { supabase } from './supabase'

/**
 * Llama a la función `portal-api` (proxy hacia el portal mayorista; el secret nunca llega al navegador).
 * Acciones: order, order-notify, order-tracking, order-item-status, order-label, order-delete,
 *           leads, lead-status, lead-delete.
 * @returns {Promise<{ ok: boolean, error?: string, [k: string]: any }>}
 */
export async function portalApi(accion, datos = {}) {
  const { data, error } = await supabase.functions.invoke('portal-api', { body: { accion, ...datos } })
  if (error) {
    // Sin conexión con la función: lo más común es que todavía no esté desplegada
    // (Supabase responde sin CORS y el navegador bloquea la respuesta).
    if (error.name === 'FunctionsFetchError') {
      return { ok: false, error: 'No se pudo conectar con la función portal-api. Lo más probable es que todavía no esté desplegada en Supabase (o no hay conexión a internet).' }
    }
    let mensaje = error.message
    try {
      const j = await error.context?.json?.()
      if (j?.code === 'NOT_FOUND') mensaje = 'Falta desplegar la función portal-api en Supabase.'
      else if (j?.error) mensaje = j.error
    } catch { /* sin detalle */ }
    return { ok: false, error: mensaje }
  }
  if (!data?.ok) return { ok: false, error: data?.error || 'El portal no aceptó el cambio.' }
  return data
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// HTML de la etiqueta de despacho de 100 × 150 mm. Mismo diseño que la del panel del portal
// (buildPrintHTML en mayorista-panel/admin/templates/etiquetas.php).
export function etiquetaHTML(l) {
  const c = l.destinatario || {}
  const r = l.remitente || {}
  const fila = (lbl, val) => (val ? `<tr><td class="lbl">${lbl}</td><td class="val">${esc(val)}</td></tr>` : '')
  const ciudad = [c.localidad, c.provincia].filter(Boolean).join(', ') + (c.cp ? ` (CP ${c.cp})` : '')
  const dirRem = [r.direccion, r.localidad, r.provincia].filter(Boolean).join(', ')
  const logo = /^https?:\/\//i.test(l.logo_url || '')
    ? `<div class="logo-wrap"><img src="${esc(l.logo_url)}" style="max-height:26px; max-width:100px; object-fit:contain;"></div>` : ''
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Etiqueta #${esc(l.numero)}</title>
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:Arial,sans-serif; background:#fff; color:#111; }
  .etiqueta { width:100mm; min-height:150mm; border:1px solid #bbb; overflow:hidden; }
  .cab { background:#2A2A2A; padding:1.7mm 4mm; display:flex; align-items:center; justify-content:space-between; }
  .cab-log { color:#E8722D; font-size:25px; font-weight:800; letter-spacing:.04em; }
  .cab-meta { color:#aaa; font-size:14px; text-align:right; }
  .cuerpo { padding:1.5mm 5mm; }
  .logo-wrap { margin-bottom:0.8mm; padding-bottom:0.8mm; border-bottom:0.3mm solid #e0e0e0; }
  .seccion-label { font-size:15px; font-weight:800; text-transform:uppercase; letter-spacing:.08em; margin-bottom:0.4mm; }
  .label-dest { color:#E8722D; }
  .label-rem  { color:#999; }
  .dest { border:1.5px solid #2A2A2A; border-radius:2px; padding:1.2mm 4mm; margin-bottom:0.8mm; }
  .rem  { background:#f5f5f5; border-radius:2px; padding:1.2mm 4mm; }
  .nombre { font-size:25px; font-weight:800; margin-bottom:0.8mm; }
  table { width:100%; border-collapse:collapse; }
  td { font-size:17px; font-weight:600; padding:0.3px 0; vertical-align:top; line-height:1.08; }
  td.lbl { color:#888; padding-right:4px; white-space:nowrap; width:21mm; }
  td.val { color:#111; font-weight:700; }
  /* En pantalla: la etiqueta se ve sobre fondo gris, con los botones abajo */
  @media screen {
    body { background:#eee; display:flex; flex-direction:column; align-items:center; gap:16px; padding:20px; }
    .etiqueta { background:#fff; box-shadow:0 2px 12px rgba(0,0,0,.15); }
  }
  .barra { display:flex; gap:10px; }
  .barra button { padding:8px 22px; border:none; border-radius:6px; cursor:pointer; font-size:14px; font-weight:600; }
  .barra button:disabled { opacity:.5; cursor:wait; }
  .b-imp { background:#2563eb; color:#fff; }
  .b-cer { background:#e5e7eb; color:#374151; }
  @media print {
    html, body { width:100mm; }
    .etiqueta { border:none; width:100mm; min-height:150mm; }
    .barra { display:none; }
    @page { size:100mm 150mm; margin:0; }
  }
</style>
</head>
<body>
<div class="etiqueta">
  <div class="cab">
    <span class="cab-log">${esc(String(l.logistica || '').toUpperCase())}</span>
    <span class="cab-meta">N° ${esc(l.numero)} &nbsp;·&nbsp; ${esc(l.fecha)}</span>
  </div>
  <div class="cuerpo">
    ${logo}
    <div class="seccion-label label-dest">Destinatario</div>
    <div class="dest">
      <div class="nombre">${esc(c.nombre)}</div>
      <table>
        ${fila('Dirección', c.direccion)}
        ${fila('Ciudad', ciudad)}
        ${fila('Teléfono', c.telefono)}
        ${fila('DNI', c.dni)}
        ${fila('Email', c.email)}
      </table>
    </div>
    <div class="seccion-label label-rem">Remitente</div>
    <div class="rem">
      <div class="nombre">${esc(r.nombre)}</div>
      <table>
        ${fila('Dirección', dirRem)}
        ${fila('CP', r.cp)}
        ${fila('Teléfono', r.telefono)}
        ${fila('DNI', r.dni)}
        ${fila('Email', r.email)}
      </table>
    </div>
  </div>
</div>
<div class="barra">
  <button id="imp" class="b-imp" onclick="window.print()" disabled>🖨️ Imprimir</button>
  <button class="b-cer" onclick="window.close()">Cerrar</button>
</div>
<script>
// Imprimir se habilita cuando terminó de cargar el logo (o si falla, o a los 4 s como máximo)
(function () {
  var b = document.getElementById('imp');
  var listo = function () { b.disabled = false; };
  var pend = [].filter.call(document.images, function (i) { return !i.complete; });
  if (!pend.length) { listo(); return; }
  var n = pend.length;
  var uno = function () { if (--n <= 0) listo(); };
  pend.forEach(function (i) { i.addEventListener('load', uno); i.addEventListener('error', uno); });
  setTimeout(listo, 4000);
})();
</script>
</body></html>`
}

// La ventana de impresión se abre EN EL CLIC (si no, el navegador la bloquea) y se va completando:
// primero "Preparando…", después la etiqueta o, si el portal falla, el mensaje de error.
// Cada escritura reabre el documento, así nunca queda a medias.
function escribir(win, html) {
  win.document.open()
  win.document.write(html)
  win.document.close()
}

const paginaSimple = (titulo, cuerpo, conCerrar) => `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><title>${esc(titulo)}</title>
<style>
  body { font-family:Arial,sans-serif; background:#eee; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; }
  .caja { background:#fff; padding:24px 28px; border-radius:10px; box-shadow:0 2px 12px rgba(0,0,0,.15); max-width:420px; text-align:center; }
  h3 { margin:0 0 10px; font-size:17px; } p { margin:0 0 16px; font-size:14px; color:#374151; line-height:1.5; }
  button { padding:8px 22px; border:none; border-radius:6px; cursor:pointer; font-size:14px; font-weight:600; background:#e5e7eb; color:#374151; }
</style></head><body><div class="caja"><h3>${esc(titulo)}</h3><p>${esc(cuerpo)}</p>${conCerrar ? '<button onclick="window.close()">Cerrar</button>' : ''}</div></body></html>`

export function ventanaPreparando(win) { escribir(win, paginaSimple('Preparando etiqueta…', 'Pidiendo los datos al portal.', false)) }
export function ventanaError(win, mensaje) { escribir(win, paginaSimple('No se pudo preparar la etiqueta', mensaje || 'El portal no devolvió los datos.', true)) }

// Muestra la etiqueta con los botones Imprimir / Cerrar (sin imprimir ni cerrar sola).
// Si no se pasa ventana, abre una. Devuelve false si el navegador la bloqueó.
export function imprimirEtiqueta(label, win) {
  const w = win || window.open('', '_blank')
  if (!w) return false
  escribir(w, etiquetaHTML(label))
  return true
}
