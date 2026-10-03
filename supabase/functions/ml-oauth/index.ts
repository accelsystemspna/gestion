// Vuelta del OAuth de Mercado Libre: ML redirige acá con ?code=...&state=...
// Canjea el código por tokens, guarda la cuenta del negocio y vuelve a la app.
// Se despliega con --no-verify-jwt (lo llama el navegador del usuario, redirigido por ML).
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ML_API, appUrl, canjearCodigo, mensajeError } from '../_shared/ml.ts'

function volver(ok: boolean, msg?: string) {
  const u = new URL('/configuracion', appUrl())
  u.searchParams.set('ml', ok ? 'ok' : 'error')
  if (msg) u.searchParams.set('msg', msg.slice(0, 200))
  return new Response(null, { status: 302, headers: { Location: u.toString() } })
}

serve(async (req) => {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (url.searchParams.get('error')) return volver(false, 'Mercado Libre canceló la autorización.')
  if (!code || !state) return volver(false, 'Faltan datos de la autorización.')

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  try {
    // El state lo creó ml-api para un negocio puntual: sirve una sola vez y vence a los 15 minutos.
    const { data: est } = await admin.from('ml_estados_oauth').select('org_id, created_at').eq('state', state).maybeSingle()
    if (!est) return volver(false, 'La autorización venció. Probá de nuevo.')
    await admin.from('ml_estados_oauth').delete().eq('state', state)
    if (Date.now() - new Date(est.created_at).getTime() > 15 * 60_000) return volver(false, 'La autorización venció. Probá de nuevo.')
    const org: string = est.org_id

    const t = await canjearCodigo(code)
    if (!t.ok || !t.data?.access_token) return volver(false, mensajeError(t.data, 0))

    const me = await fetch(`${ML_API}/users/me`, { headers: { Authorization: `Bearer ${t.data.access_token}` } })
    const yo = await me.json()
    if (!me.ok || !yo?.id) return volver(false, 'No se pudo leer la cuenta de Mercado Libre.')

    // Una cuenta de ML solo puede estar conectada a un negocio.
    const { data: otra } = await admin.from('ml_cuentas').select('org_id').eq('ml_user_id', yo.id).maybeSingle()
    if (otra && otra.org_id !== org) return volver(false, `La cuenta ${yo.nickname} ya está conectada a otro negocio.`)

    // Tienda "Mercado Libre" del negocio (para que las ventas y las publicaciones tengan dónde colgarse).
    const nombreTienda = `Mercado Libre — ${yo.nickname}`
    const { data: previa } = await admin.from('ml_cuentas').select('tienda_id').eq('org_id', org).maybeSingle()
    let tiendaId: number | null = previa?.tienda_id ?? null
    if (tiendaId) {
      await admin.from('tiendas').update({ nombre: nombreTienda, activa: true }).eq('id', tiendaId)
    } else {
      const { data: tienda } = await admin.from('tiendas')
        .insert({ user_id: org, nombre: nombreTienda, tipo: 'mercadolibre', activa: true }).select('id').single()
      tiendaId = tienda?.id ?? null
    }

    const { error: cErr } = await admin.from('ml_cuentas').upsert({
      org_id: org, ml_user_id: yo.id, nickname: yo.nickname, site_id: yo.site_id ?? 'MLA', tienda_id: tiendaId, conectada_en: new Date().toISOString(),
    })
    if (cErr) return volver(false, cErr.message)
    await admin.from('ml_tokens').upsert({
      org_id: org,
      access_token: t.data.access_token,
      refresh_token: t.data.refresh_token,
      expires_at: new Date(Date.now() + (Number(t.data.expires_in) || 21600) * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    return volver(true)
  } catch (err) {
    return volver(false, err instanceof Error ? err.message : String(err))
  }
})
