import { supabase } from './supabase'
import { documento } from './etiquetaTermica'

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

// Una etiqueta por bulto ("Bulto 1 de 3"…), con el mismo diseño que el panel del portal; con 0, una sin numerar.
// papel: 'a4' (4 por hoja, impresora común) o 'termica' (una de 100 × 150 mm por hoja).
// Se abre el diálogo de impresión solo, cuando terminó de cargar.
// Si no se pasa ventana, abre una. Devuelve false si el navegador la bloqueó.
export function imprimirEtiqueta(label, win, bultos = 0, papel = 'a4') {
  const w = win || window.open('', '_blank')
  if (!w) return false
  escribir(w, documento(label, bultos, { imprimir: true, papel }))
  return true
}
