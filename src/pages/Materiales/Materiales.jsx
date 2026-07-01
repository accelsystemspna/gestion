import { useState } from 'react'
import Insumos from './Placas'
import Tarifas from './Tarifas'

export default function Materiales() {
  const [tab, setTab] = useState('insumos')

  const tabStyle = (active) => ({
    padding: '10px 18px',
    background: 'transparent',
    border: 'none',
    borderBottom: active ? '2px solid var(--primary)' : '2px solid transparent',
    color: active ? 'var(--primary)' : 'var(--text-muted)',
    fontWeight: 600,
    fontSize: 14,
    cursor: 'pointer',
  })

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, marginBottom: 4 }}>Materiales</h1>
        <p style={{ color: 'var(--text-muted)' }}>Insumos y tarifas de fabricación</p>
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 20 }}>
        <button style={tabStyle(tab === 'insumos')} onClick={() => setTab('insumos')}>
          Insumos
        </button>
        <button style={tabStyle(tab === 'tarifas')} onClick={() => setTab('tarifas')}>
          Tarifas de fabricación
        </button>
      </div>

      {tab === 'insumos' ? <Insumos /> : <Tarifas />}
    </div>
  )
}
