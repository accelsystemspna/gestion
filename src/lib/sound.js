// Sonido de "caja registradora" — archivo real en public/sounds/cash-register.mp3
let _audio = null
let _unlocked = false

function getAudio() {
  if (!_audio) _audio = new Audio('/sounds/cash-register.mp3')
  return _audio
}

// Los navegadores (sobre todo en celular) bloquean cualquier audio que no
// haya sido disparado por una acción directa del usuario. Como el aviso de
// venta nueva llega solo (por Realtime), sin ese "desbloqueo" previo el
// sonido nunca suena — el toast visual sí aparece porque esa restricción
// no le aplica. Se llama una sola vez, en el primer toque/clic en la app.
export function unlockAudio() {
  if (_unlocked) return
  try {
    const el = getAudio()
    el.volume = 0
    el.play()
      .then(() => { el.pause(); el.currentTime = 0; el.volume = 0.6; _unlocked = true })
      .catch(() => { /* seguirá intentando en el próximo toque */ })
  } catch { /* noop */ }
}

export function playCashRegisterSound() {
  try {
    const base = getAudio()
    // Permite que suene de nuevo aunque la anterior todavía no haya terminado
    const el = base.paused ? base : base.cloneNode(true)
    el.volume = 0.6
    el.play().catch(() => { /* el navegador bloqueó el autoplay — no interrumpir el flujo */ })
  } catch { /* audio no disponible — no interrumpir el flujo */ }
}
