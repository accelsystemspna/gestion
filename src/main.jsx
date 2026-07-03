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
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return
    reloading = true
    window.location.reload()
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
        const checkForUpdate = () => registration.update().catch(() => {})
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') checkForUpdate()
        })
        window.addEventListener('focus', checkForUpdate)
        setInterval(checkForUpdate, 30 * 60 * 1000)
      },
    })
  })
}
