// Envío de Web Push (notificación real del sistema operativo, incluso con
// la app cerrada) a todos los dispositivos suscriptos de una organización.
// Requiere los secrets VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT.
import webpush from 'npm:web-push@3.6.7'

let vapidConfigurado = false

function asegurarVapid() {
  if (vapidConfigurado) return true
  const pub  = Deno.env.get('VAPID_PUBLIC_KEY')
  const priv = Deno.env.get('VAPID_PRIVATE_KEY')
  const subj = Deno.env.get('VAPID_SUBJECT') || 'mailto:soporte@ccdesign.com.ar'
  if (!pub || !priv) return false
  webpush.setVapidDetails(subj, pub, priv)
  vapidConfigurado = true
  return true
}

export async function sendPushToOrg(
  admin: any,
  orgId: string,
  payload: { title: string; body: string; url?: string; tag?: string },
) {
  if (!asegurarVapid()) {
    console.warn('[webpush] VAPID keys no configuradas — omito envío')
    return { enviados: 0, total: 0 }
  }

  const { data: subs } = await admin.from('push_subscriptions').select('*').eq('org_id', orgId)
  if (!subs?.length) return { enviados: 0, total: 0 }

  let enviados = 0
  await Promise.all(subs.map(async (s: any) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
      )
      enviados++
    } catch (err: any) {
      console.warn('[webpush] error al enviar:', err?.statusCode, err?.message)
      // Suscripción vencida o inválida — limpiarla para no reintentar en vano.
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        await admin.from('push_subscriptions').delete().eq('id', s.id)
      }
    }
  }))

  return { enviados, total: subs.length }
}
