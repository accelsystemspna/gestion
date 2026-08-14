import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching'
import { registerRoute, NavigationRoute } from 'workbox-routing'
import { NetworkOnly } from 'workbox-strategies'

// Precache generado por vite-plugin-pwa (injectManifest)
precacheAndRoute(self.__WB_MANIFEST)

// Llamadas a Supabase: siempre red, nunca cache
registerRoute(({ url }) => url.origin.includes('supabase.co'), new NetworkOnly())

// Fallback de navegación SPA (equivalente a navigateFallback del modo generateSW)
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), {
  denylist: [/^\/icon-gen\.html$/],
}))

self.skipWaiting()
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// ── Web Push: notificación real del sistema, incluso con la app cerrada ──
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = {} }

  const title = data.title || '💰 Nueva venta'
  const options = {
    body:  data.body || '',
    icon:  '/icons/pwa/icon-192.png',
    badge: '/icons/pwa/icon-192.png',
    vibrate: [200, 100, 200],
    tag:   data.tag || 'venta-nueva',
    data:  { url: data.url || '/ventas?web=1' },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/ventas?web=1'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      const existing = clientsArr.find((c) => c.url.includes(self.location.origin))
      if (existing) { existing.navigate(url); return existing.focus() }
      return self.clients.openWindow(url)
    })
  )
})
