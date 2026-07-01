import { useState } from 'react'

function Toggle({ checked, onChange }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        position: 'relative',
        width: 48,
        height: 26,
        borderRadius: 999,
        border: 'none',
        cursor: 'pointer',
        background: checked ? 'var(--primary)' : 'var(--border)',
        transition: 'background 0.2s',
        flexShrink: 0,
      }}
    >
      <span style={{
        position: 'absolute',
        top: 3,
        left: checked ? 25 : 3,
        width: 20,
        height: 20,
        borderRadius: '50%',
        background: 'white',
        boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        transition: 'left 0.2s',
      }} />
    </button>
  )
}

export default function Apariencia() {
  const [dark, setDark] = useState(() => localStorage.getItem('darkMode') === 'true')

  const handleDark = (val) => {
    setDark(val)
    localStorage.setItem('darkMode', val)
    document.documentElement.classList.toggle('dark', val)
  }

  return (
    <div style={{ maxWidth: 480 }}>
      <h2 style={{ fontSize: 16, marginBottom: 4 }}>Apariencia</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 24, marginTop: 4 }}>
        Personalizá el aspecto visual de la aplicación.
      </p>

      <div className="card" style={{ padding: '0' }}>
        {/* Modo oscuro */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ fontSize: 22 }}>{dark ? '🌙' : '☀️'}</span>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Modo oscuro</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>
                Fondo oscuro para reducir el cansancio visual
              </div>
            </div>
          </div>
          <Toggle checked={dark} onChange={handleDark} />
        </div>

        {/* Info */}
        <div style={{ padding: '12px 20px', background: 'var(--bg)', borderRadius: '0 0 var(--radius) var(--radius)' }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            La preferencia se guarda automáticamente en este dispositivo.
          </div>
        </div>
      </div>
    </div>
  )
}
