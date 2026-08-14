import { supabase } from './supabase'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)))
}

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && !!VAPID_PUBLIC_KEY
}

// Pide permiso, crea (o reusa) la suscripción push del navegador y la guarda
// en Supabase para que el backend le pueda mandar notificaciones a este
// dispositivo — incluso con la app cerrada.
export async function subscribeToPush(orgId) {
  if (!pushSupported()) throw new Error('Este navegador no soporta notificaciones push')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Permiso de notificaciones denegado')

  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    })
  }

  const json = sub.toJSON()
  const { error } = await supabase.from('push_subscriptions').upsert({
    org_id:     orgId,
    endpoint:   json.endpoint,
    p256dh:     json.keys.p256dh,
    auth:       json.keys.auth,
    user_agent: navigator.userAgent,
  }, { onConflict: 'endpoint' })
  if (error) throw error

  return sub
}
