import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'

const navItems = [
  { to: '/ventas',        label: 'Ventas',        icon: '🛒' },
  { to: '/productos',     label: 'Productos',      icon: '📦' },
  { to: '/materiales',    label: 'Materiales',     icon: '🪵' },
  { to: '/presupuesto',   label: 'Presupuestos',   icon: '📄' },
  { to: '/clientes',      label: 'Clientes',       icon: '👥' },
  { to: '/facturas',      label: 'Facturas',       icon: '🏛️' },
  { to: '/dashboard',     label: 'Dashboard',      icon: '📊' },
  { to: '/configuracion', label: 'Configuración',  icon: '⚙️', soloAdmin: true },
]

export default function Layout() {
  const { user, profile, signOut } = useAuth()
  const esAdmin = profile?.rol === 'admin'
  const navigate = useNavigate()

  const handleLogout = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside
        style={{
          width: 240,
          background: 'var(--sidebar)',
          color: '#cbd5e1',
          display: 'flex',
          flexDirection: 'column',
          position: 'sticky',
          top: 0,
          height: '100vh',
        }}
      >
        <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid #334155' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'white' }}>Gestión</div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
            Carpintería · 3D
          </div>
        </div>

        <nav style={{ flex: 1, padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {navItems.filter(item => !item.soloAdmin || esAdmin).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 14px',
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 500,
                color: isActive ? 'white' : '#cbd5e1',
                background: isActive ? 'var(--sidebar-active)' : 'transparent',
                transition: 'background 0.15s',
              })}
            >
              <span style={{ fontSize: 16 }}>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div style={{ padding: 16, borderTop: '1px solid #334155' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 10,
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                background: 'var(--primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                fontWeight: 600,
              }}
            >
              {(profile?.nombre || user?.email || '?').charAt(0).toUpperCase()}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'white',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {profile?.nombre || user?.email}
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'capitalize' }}>
                {profile?.rol || 'usuario'}
              </div>
            </div>
          </div>
          <button
            onClick={handleLogout}
            style={{
              width: '100%',
              padding: '8px',
              background: 'transparent',
              border: '1px solid #475569',
              color: '#cbd5e1',
              borderRadius: 6,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Cerrar sesión
          </button>
        </div>
      </aside>

      <main style={{ flex: 1, padding: 32, overflow: 'auto' }}>
        <Outlet />
      </main>
    </div>
  )
}
