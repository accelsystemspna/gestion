// API de Mercado Libre para la app (autenticada con el usuario logueado).
// Acciones: connect_url, status, disconnect, import_orders (+ publicaciones y preguntas).
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ML_AUTH, credencialesApp, redirectUri, mlFetch } from '../_shared/ml.ts'
import { procesarOrdenML } from '../_shared/ml_orders.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'No autorizado' }, 401)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )
    const { data: { user }, error: authErr } = await admin.auth.getUser(authHeader.replace('Bearer ', ''))
    if (authErr || !user) return json({ error: 'Token inválido' }, 401)

    const { data: perfil } = await admin.from('profiles').select('rol, org_id').eq('id', user.id).maybeSingle()
    if (!perfil || !['principal', 'master', 'admin'].includes(perfil.rol)) return json({ error: 'No tenés permiso' }, 403)
    const org: string = perfil.org_id ?? user.id
    const esMaster = perfil.rol === 'principal' || perfil.rol === 'master'

    const body = await req.json().catch(() => ({}))
    const { action } = body

    const cuentaDe = async () =>
      (await admin.from('ml_cuentas').select('org_id, ml_user_id, nickname, tienda_id').eq('org_id', org).maybeSingle()).data

    // ── Conectar: devuelve la URL de autorización de ML ─────────────────
    if (action === 'connect_url') {
      if (!esMaster) return json({ error: 'Solo el master puede conectar Mercado Libre' }, 403)
      const { id } = credencialesApp()
      const state = crypto.randomUUID()
      await admin.from('ml_estados_oauth').delete().lt('created_at', new Date(Date.now() - 3600_000).toISOString())
      await admin.from('ml_estados_oauth').insert({ state, org_id: org })
      const u = new URL(ML_AUTH)
      u.searchParams.set('response_type', 'code')
      u.searchParams.set('client_id', id)
      u.searchParams.set('redirect_uri', redirectUri())
      u.searchParams.set('state', state)
      return json({ url: u.toString() })
    }

    // ── Estado de la conexión ───────────────────────────────────────────
    if (action === 'status') {
      const c = await cuentaDe()
      if (!c) return json({ conectada: false })
      const me = await mlFetch(admin, org, '/users/me')
      return json({
        conectada: me.ok, nickname: c.nickname, ml_user_id: c.ml_user_id,
        error: me.ok ? null : me.error,
      })
    }

    // ── Desconectar ─────────────────────────────────────────────────────
    if (action === 'disconnect') {
      if (!esMaster) return json({ error: 'Solo el master puede desconectar Mercado Libre' }, 403)
      const c = await cuentaDe()
      if (!c) return json({ ok: true })
      await admin.from('ml_tokens').delete().eq('org_id', org)
      await admin.from('ml_cuentas').delete().eq('org_id', org)
      if (c.tienda_id) await admin.from('tiendas').update({ activa: false }).eq('id', c.tienda_id)
      return json({ ok: true })
    }

    // ── Importar las ventas de los últimos N días ───────────────────────
    if (action === 'import_orders') {
      const c = await cuentaDe()
      if (!c) return json({ error: 'Mercado Libre no está conectado' }, 400)
      const dias = Math.min(Math.max(Number(body.dias) || 30, 1), 90)
      const desde = new Date(Date.now() - dias * 86400_000).toISOString()
      const resumen = { creadas: 0, actualizadas: 0, sin_cambios: 0, ignoradas: 0, errores: [] as string[] }
      for (let offset = 0; offset < 500; offset += 50) {
        const r = await mlFetch(admin, org,
          `/orders/search?seller=${c.ml_user_id}&order.date_created.from=${encodeURIComponent(desde)}&sort=date_asc&limit=50&offset=${offset}`)
        if (!r.ok) return json({ error: r.error, ...resumen }, 502)
        const ordenes: any[] = r.data?.results ?? []
        for (const o of ordenes) {
          const p = await procesarOrdenML(admin, c, o.id, { sinPush: true })
          if (!p.ok) resumen.errores.push(`#${o.id}: ${p.error}`)
          else if (p.accion === 'creada') resumen.creadas++
          else if (p.accion === 'actualizada') resumen.actualizadas++
          else if (p.accion === 'sin_cambios') resumen.sin_cambios++
          else resumen.ignoradas++
        }
        if (ordenes.length < 50) break
      }
      return json({ ok: true, ...resumen })
    }

    return json({ error: 'Acción desconocida' }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
