import { useState } from 'react'

export default function Accordion({ title, subtitle, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="card" style={{ marginBottom: 12, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          padding: '16px 20px',
          background: 'transparent',
          border: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          textAlign: 'left',
        }}
      >
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>{title}</div>
          {subtitle && (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</div>
          )}
        </div>
        <span style={{ fontSize: 18, color: 'var(--text-muted)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▾</span>
      </button>
      {open && (
        <div style={{ padding: '0 20px 20px', borderTop: '1px solid var(--border)' }}>
          <div style={{ paddingTop: 20 }}>{children}</div>
        </div>
      )}
    </div>
  )
}
