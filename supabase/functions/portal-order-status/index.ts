// Supabase Edge Function — portal-order-status
// Le cambia el estado a un pedido del portal mayorista (WordPress) desde el
// programa de gestión, SIN exponer el webhook secret en el navegador.
//
//   Usuario (autenticado) → esta función → POST <portal>/wp-json/mayorista/v1/order-status
//
// Body: { venta_id, status: 'processing'|'completed'|'cancelled'|'on-hold', tracking?, notificar? }
// Si el portal responde bien, la venta se actualiza acá mismo: el portal no le
// devuelve a gestión los cambios que gestión mismo le pidió.
import { serve }        from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

const ESTADO_WEB: Record<string, string> = {
  'on-hold': 'esperando_pago', 'processing': 'en_preparacion', 'completed': 'completado', 'cancelled': 'cancelado',
}

function baseUrl(url: string): string {
  let base = String(url || '').trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(base)) {
    const host = base.split('/')[0].split(':')[0].toLowerCase()
    const local = host === 'localhost' || host === '127.0.0.1' || /\.(local|test|localhost)$/.test(host)
    base = (local ? 'http://' : 'https://') + base
  }
  return base
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'No autorizado' }, 401)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const { data: { user }, error: authErr } = await admin.auth.getUser(authHeader.replace(/^Bearer /i, ''))
    if (authErr || !user) return json({ error: 'Token inválido' }, 401)
    const { data: perfil } = await admin.from('profiles').select('org_id').eq('id', user.id).maybeSingle()
    const orgId = perfil?.org_id ?? user.id

    const body = await req.json().catch(() => ({}))
    const { venta_id, status, tracking, notificar } = body
    if (!venta_id || !ESTADO_WEB[status]) return json({ ok: false, error: 'Faltan datos o el estado no es válido.' }, 400)

    // ── La venta y su tienda ────────────────────────────────────────────────
    const { data: venta } = await admin
      .from('ventas')
      .select('id, origen_ref, tienda_id, estado, estado_web, factura_emitida, notas')
      .eq('id', venta_id).maybeSingle()
    if (!venta) return json({ ok: false, error: 'La venta no existe.' }, 404)

    const m = /^WC#(\d+)$/.exec(venta.origen_ref ?? '')
    if (!m) return json({ ok: false, error: 'Esta venta no viene del portal mayorista.' }, 400)

    // La tienda de la venta. Los pedidos importados antes de guardar tienda_id se reconocen
    // por el nombre COMPLETO al final de las notas ("... — Nombre" / "... — Nombre (pendiente de pago)").
    let tienda: any = null
    if (venta.tienda_id) {
      ;({ data: tienda } = await admin.from('tiendas').select('id, user_id, nombre, tipo, url, webhook_secret').eq('id', venta.tienda_id).maybeSingle())
    } else {
      const { data: propias } = await admin.from('tiendas').select('id, user_id, nombre, tipo, url, webhook_secret').eq('user_id', orgId)
      const notas = venta.notas ?? ''
      tienda = (propias ?? [])
        .filter((t: any) => t.nombre && (notas.endsWith(`— ${t.nombre}`) || notas.includes(`— ${t.nombre} (`)))
        .sort((a: any, b: any) => b.nombre.length - a.nombre.length)[0] ?? null
    }
    if (!tienda || tienda.user_id !== orgId) return json({ error: 'No tenés acceso a esta tienda.' }, 403)
    if (tienda.tipo !== 'mayorista') return json({ ok: false, error: 'La tienda de esta venta no es un portal mayorista.' }, 400)
    if (!tienda.url || !tienda.webhook_secret) {
      return json({ ok: false, error: 'La tienda no tiene URL o webhook secret cargados en Integraciones.' })
    }

    // ── Llamada al portal (el ID va tal cual se guardó: el portal resta el desplazamiento solo) ──
    const payload: Record<string, unknown> = {
      order_id: Number(m[1]),
      status,
      notificar: notificar !== false,
    }
    const seguimiento = typeof tracking === 'string' ? tracking.trim() : ''
    if (seguimiento) payload.tracking = seguimiento

    let res: Response
    try {
      res = await fetch(`${baseUrl(tienda.url)}/wp-json/mayorista/v1/order-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-webhook-secret': tienda.webhook_secret },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(25000),
      })
    } catch {
      return json({ ok: false, error: 'No se pudo conectar con el portal. Revisá la URL de la tienda en Integraciones.' })
    }

    const portal = await res.json().catch(() => ({} as any))
    if (!res.ok || portal?.ok === false) {
      const detalle = portal?.message || portal?.error || ''
      const texto =
        res.status === 404 ? 'El pedido no existe en el portal.' :
        res.status === 400 ? 'El portal no reconoce ese estado.' :
        res.status === 401 ? 'El secret no coincide con el del portal.' :
        res.status === 403 ? 'El portal todavía no tiene un secret configurado.' :
        `El portal respondió HTTP ${res.status}.`
      return json({ ok: false, error: detalle && res.status !== 401 && res.status !== 403 ? `${texto} ${detalle}` : texto })
    }

    // ── El portal aceptó el cambio: se refleja en la venta ──────────────────
    const actual = venta.estado_web === 'procesado' ? 'en_preparacion' : venta.estado_web
    const cambios: Record<string, unknown> = { origen_estado: status }
    if (!venta.tienda_id) cambios.tienda_id = tienda.id
    if (!(status === 'processing' && actual === 'listo')) cambios.estado_web = ESTADO_WEB[status]
    if (seguimiento) cambios.origen_tracking = seguimiento
    if (portal?.tracking_url) cambios.origen_tracking_url = portal.tracking_url
    if (portal?.estado) cambios.origen_estado_portal = String(portal.estado)

    const cancelar = status === 'cancelled' && venta.estado !== 'anulado' && !venta.factura_emitida
    if (cancelar) cambios.estado = 'anulado'

    let { error: errUpd } = await admin.from('ventas').update(cambios).eq('id', venta.id)
    if (errUpd && /column|schema cache/i.test(errUpd.message)) {
      delete cambios.tienda_id
      delete cambios.origen_tracking
      delete cambios.origen_tracking_url
      delete cambios.origen_estado_portal
      ;({ error: errUpd } = await admin.from('ventas').update(cambios).eq('id', venta.id))
    }
    if (errUpd) {
      return json({ ok: false, error: `El portal aceptó el cambio pero no se pudo guardar acá: ${errUpd.message}` })
    }

    // Cancelado: se devuelve el stock, igual que al cancelar cualquier pedido web.
    if (cancelar) {
      const { data: items } = await admin.from('venta_items').select('producto_id, cantidad').eq('venta_id', venta.id)
      const porProducto: Record<string, number> = {}
      for (const it of items ?? []) {
        if (it.producto_id) porProducto[it.producto_id] = (porProducto[it.producto_id] || 0) + Number(it.cantidad)
      }
      const ids = Object.keys(porProducto)
      if (ids.length) {
        const { data: prods } = await admin.from('productos').select('id, stock_actual').in('id', ids)
        await Promise.all((prods ?? []).map((p: any) =>
          admin.from('productos').update({ stock_actual: (Number(p.stock_actual) || 0) + porProducto[p.id] }).eq('id', p.id)
        ))
      }
    }

    return json({
      ok: true,
      estado_web:   (cambios.estado_web as string) ?? actual,
      tracking_url: portal?.tracking_url ?? null,
      email_sent:   portal?.email_sent ?? null,
    })
  } catch (err) {
    console.error('[portal-order-status]', err)
    return json({ ok: false, error: (err as Error).message }, 500)
  }
})
