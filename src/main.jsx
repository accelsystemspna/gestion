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
    // El chequeo NO se dispara al cambiar de pestaña/programa ni al volver a
    // primer plano: alternar entre esta pestaña y otro programa (o simplemente
    // otra pestaña del navegador) es algo normal decenas de veces por hora, y
    // atarlo a eso terminaba recargando la página en medio del trabajo. Solo
    // se revisa por el intervalo periódico, así una actualización nunca
    // interrumpe por el simple hecho de cambiar de ventana.
    registerSW({
      immediate: true,
      onRegisteredSW(_url, registration) {
        if (!registration) return
        const checkForUpdate = () => { reloadIfSafe(); registration.update().catch(() => {}) }
        setInterval(checkForUpdate, 30 * 60 * 1000)
      },
    })
  })
}
