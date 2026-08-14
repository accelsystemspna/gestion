// Sonido de "caja registradora" — archivo real en public/sounds/cash-register.mp3
let _audio = null

export function playCashRegisterSound() {
  try {
    if (!_audio) _audio = new Audio('/sounds/cash-register.mp3')
    // Permite que suene de nuevo aunque la anterior todavía no haya terminado
    const el = _audio.paused ? _audio : _audio.cloneNode(true)
    el.volume = 0.6
    el.play().catch(() => { /* el navegador bloqueó el autoplay — no interrumpir el flujo */ })
  } catch { /* audio no disponible — no interrumpir el flujo */ }
}
