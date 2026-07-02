import { useState } from 'react'
import { useAuth } from '../../lib/AuthContext'
import Branding from './Branding'
import ListasPrecios from './ListasPrecios'
import Usuarios from './Usuarios'
import Categorias from './Categorias'
import Integraciones from './Integraciones'
import Rubros from './Rubros'
import Backup from './Backup'
import Arca from './Arca'
import Apariencia from './Apariencia'

const TABS = [
  { id: 'branding',      label: 'Branding' },
  { id: 'listas',        label: 'Listas de precios' },
  { id: 'rubros',        label: '🗂 Rubros' },
  { id: 'categorias',    label: 'Categorías' },
  { id: 'integraciones', label: '🔗 Integraciones' },
  { id: 'apariencia',    label: '🌙 Apariencia' },
  { id: 'usuarios',      label: 'Usuarios y roles',      soloMaster: true },
  { id: 'backup',        label: '💾 Backup',             soloMaster: true },
  { id: 'arca',          label: '🏛️ ARCA / Facturación', soloMaster: true },
]

export default function Configuracion() {
  const { isMaster } = useAuth()
  const tabs = TABS.filter(t => !t.soloMaster || isMaster)
  const [tab, setTab] = useState('branding')

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, marginBottom: 4 }}>Configuración</h1>
        <p style={{ color: 'var(--text-muted)' }}>Branding, listas de precios, usuarios y categorías</p>
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 24 }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '10px 20px',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: tab === t.id ? 600 : 400,
              color: tab === t.id ? 'var(--primary)' : 'var(--text-muted)',
              borderBottom: tab === t.id ? '2px solid var(--primary)' : '2px solid transparent',
              marginBottom: -1,
              transition: 'color 0.15s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'branding' && <Branding />}
      {tab === 'listas' && <ListasPrecios />}
      {tab === 'usuarios' && <Usuarios />}
      {tab === 'categorias' && <Categorias />}
      {tab === 'rubros' && <Rubros />}
      {tab === 'integraciones' && <Integraciones />}
      {tab === 'backup' && <Backup />}
      {tab === 'arca' && <Arca />}
      {tab === 'apariencia' && <Apariencia />}
    </div>
  )
}
