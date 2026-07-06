import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

if (localStorage.getItem('darkMode') === 'true') {
  document.documentElement.classList.add('dark')
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if ('serviceWorker' in navigator) {
  // El SW nuevo toma control (skipWaiting + clientsClaim) sin avisarle a esta
  // pestaña ya cargada, que sigue ejecutando el JS viejo en memoria hasta que
  // se recarga. Sin este listener, un celular que solo "reanuda" el proceso
  // (en vez de reiniciarlo) queda corriendo la versión vieja indefinidamente
  // aunque el Service Worker de fondo ya se haya actualizado.
  //
  // Pero recargar de golpe interrumpe una venta en curso (Ventas.jsx guarda
  // ese borrador en localStorage con claves "pos_draft_*"). Si hay una venta
  // sin terminar, pateamos la recarga para el próximo momento en que la app
  // vuelva a primer plano y el carrito ya esté vacío.
  const hayVentaEnCurso = () => Object.keys(localStorage).some(k => k.startsWith('pos_draft_'))

  let reloading = false
  let pendingSince = null
  // Si la traba de "venta en curso" queda activada por un carrito viejo
  // olvidado, no tiene que bloquear la actualización para siempre: pasados
  // unos minutos, se recarga igual.
  const ESPERA_MAX_MS = 3 * 60 * 1000
  const reloadIfSafe = () => {
    if (reloading || !pendingSince) return
    const vencido = Date.now() - pendingSince > ESPERA_MAX_MS
    if (!vencido && hayVentaEnCurso()) return
    reloading = true
    window.location.reload()
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!pendingSince) pendingSince = Date.now()
    reloadIfSafe()
  })

  import('virtual:pwa-register').then(({ registerSW }) => {
    // autoUpdate: detecta versión nueva y recarga sola, sin pedirle nada al usuario.
    // El navegador solo revisa el SW en una navegación nueva; en una PWA que queda
    // abierta en segundo plano (p.ej. al bloquear el celular) eso nunca pasa solo,
    // así que forzamos el chequeo cada vez que la app vuelve a primer plano.
    registerSW({
      immediate: true,
      onRegisteredSW(_url, registration) {
        if (!registration) return
        // En desktop es normal alternar entre esta pestaña y otros programas
        // (p.ej. un software de corte) decenas de veces por hora. Revisar la
        // versión en CADA cambio de ventana terminaba recargando la página
        // seguido (cada chequeo que encuentra una versión nueva dispara la
        // recarga). Se limita a revisar como máximo cada 5 minutos.
        const INTERVALO_MIN_MS = 5 * 60 * 1000
        let ultimoChequeo = 0
        const checkForUpdate = () => {
          reloadIfSafe()
          const ahora = Date.now()
          if (ahora - ultimoChequeo < INTERVALO_MIN_MS) return
          ultimoChequeo = ahora
          registration.update().catch(() => {})
        }
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') checkForUpdate()
        })
        window.addEventListener('focus', checkForUpdate)
        setInterval(checkForUpdate, 30 * 60 * 1000)
      },
    })
  })
}
