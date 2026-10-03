// Notificaciones de Mercado Libre (configuradas en la app de ML → "URL de notificaciones").
// ML manda { topic, resource, user_id, application_id }. No confiamos en el contenido:
// solo lo usamos para saber QUÉ mirar y lo pedimos de nuevo a la API de ML con el token del
// negocio, así una notificación falsa no puede inventar ventas.
// Se despliega con --no-verify-jwt.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { mlFetch } from '../_shared/ml.ts'
import { procesarOrdenML } from '../_shared/ml_orders.ts'
import { sendPushToOrg } from '../_shared/webpush.ts'

const ok = () => new Response('ok', { status: 200 })

async function procesar(admin: any, n: any) {
  const { data: cuenta } = await admin.from('ml_cuentas').select('org_id, ml_user_id, tienda_id').eq('ml_user_id', n.user_id).maybeSingle()
  if (!cuenta) return
  const id = String(n.resource ?? '').split('/').filter(Boolean).pop()
  if (!id) return

  if (n.topic === 'orders_v2' || n.topic === 'orders') {
    const r = await procesarOrdenML(admin, cuenta, id)
    if (!r.ok) console.warn('[ml-webhook] orden', id, r.error)
    return
  }

  if (n.topic === 'questions') {
    const q = await mlFetch(admin, cuenta.org_id, `/questions/${id}?api_version=4`)
    if (!q.ok || q.data?.status !== 'UNANSWERED') return
    const it = await mlFetch(admin, cuenta.org_id, `/items/${q.data.item_id}?attributes=title`)
    await sendPushToOrg(admin, cuenta.org_id, {
      title: '❓ Nueva pregunta en Mercado Libre',
      body: `${it.data?.title ?? 'Una publicación'}: ${String(q.data.text ?? '').slice(0, 120)}`,
      url: '/tiendas',
      tag: 'pregunta-ml-' + id,
    })
    return
  }

  if (n.topic === 'messages') {
    await sendPushToOrg(admin, cuenta.org_id, {
      title: '💬 Mensaje nuevo en Mercado Libre',
      body: 'Un comprador te escribió.',
      url: '/tiendas',
      tag: 'mensaje-ml-' + id,
    })
  }
}

serve(async (req) => {
  if (req.method !== 'POST') return ok()
  let n: any
  try { n = await req.json() } catch { return ok() }
  if (!n?.user_id || !n?.topic) return ok()

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
  // ML pide responder rápido (menos de 500 ms) o reintenta: se procesa en segundo plano.
  const tarea = procesar(admin, n).catch((err) => console.warn('[ml-webhook]', err))
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime
  if (rt?.waitUntil) rt.waitUntil(tarea)
  else await tarea
  return ok()
})
