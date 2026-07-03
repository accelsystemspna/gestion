import { useState, useEffect } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'

const navItems = [
  { to: '/ventas',        label: 'Ventas',        icon: '🛒' },
  { to: '/presupuesto',   label: 'Presupuestos',  icon: '📄' },
  { to: '/clientes',      label: 'Clientes',      icon: '👥' },
  { to: '/productos',     label: 'Productos',     icon: '📦', minAdmin: true },
  { to: '/materiales',    label: 'Materiales',    icon: '🪵', minAdmin: true },
  { to: '/facturas',      label: 'Facturas',      icon: '🏛️', minAdmin: true },
  { to: '/dashboard',     label: 'Dashboard',     icon: '📊', minAdmin: true },
  { to: '/configuracion', label: 'Configuración', icon: '⚙️', minAdmin: true },
]

export default function Layout() {
  const { user, profile, signOut, isAdmin } = useAuth()
  const navigate  = useNavigate()
  const location  = useLocation()
  const [open, setOpen] = useState(false)

  // Cerrar drawer al cambiar de ruta
  useEffect(() => { setOpen(false) }, [location.pathname])

  const handleLogout = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }

  const items = navItems.filter(item => !item.minAdmin || isAdmin)
  const pageTitle = navItems.find(n => location.pathname.startsWith(n.to))?.label ?? 'Gestión'

  const sidebarContent = (
    <>
      <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid #334155' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'white' }}>Gestión</div>
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>Carpintería · 3D</div>
      </div>

      <nav style={{ flex: 1, padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' }}>
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            style={({ isActive }) => ({
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 14px', borderRadius: 6, fontSize: 14, fontWeight: 500,
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%', background: 'var(--primary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'white', fontWeight: 600, flexShrink: 0,
          }}>
            {(profile?.nombre || user?.email || '?').charAt(0).toUpperCase()}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'white', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
            width: '100%', padding: '8px', background: 'transparent',
            border: '1px solid #475569', color: '#cbd5e1',
            borderRadius: 6, fontSize: 13, cursor: 'pointer',
          }}
        >
          Cerrar sesión
        </button>
        <div style={{ marginTop: 8, fontSize: 10, color: '#64748b', textAlign: 'center' }}>
          v{__BUILD_TIME__.slice(0, 16).replace('T', ' ')}
        </div>
      </div>
    </>
  )

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>

      {/* ── Sidebar desktop ── */}
      <aside className="layout-sidebar" style={{
        width: 240, background: 'var(--sidebar)', color: '#cbd5e1',
        display: 'flex', flexDirection: 'column',
        position: 'sticky', top: 0, height: '100vh', flexShrink: 0,
      }}>
        {sidebarContent}
      </aside>

      {/* ── Drawer overlay mobile ── */}
      {open && (
        <div
          className="layout-overlay"
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            zIndex: 200,
          }}
        />
      )}
      <aside className={`layout-drawer${open ? ' open' : ''}`} style={{
        position: 'fixed', top: 0, left: 0, height: '100vh', width: 260,
        background: 'var(--sidebar)', color: '#cbd5e1',
        display: 'flex', flexDirection: 'column',
        zIndex: 201, transform: open ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 0.25s ease',
      }}>
        {sidebarContent}
      </aside>

      {/* ── Contenido ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>

        {/* Top bar mobile */}
        <header className="mobile-topbar" style={{
          display: 'none', alignItems: 'center', gap: 12,
          padding: '0 16px', height: 56,
          background: 'var(--sidebar)', color: 'white',
          position: 'sticky', top: 0, zIndex: 100, flexShrink: 0,
        }}>
          <button
            onClick={() => setOpen(o => !o)}
            style={{
              background: 'none', border: 'none', color: 'white',
              fontSize: 22, cursor: 'pointer', lineHeight: 1, padding: 4,
            }}
          >
            ☰
          </button>
          <span style={{ fontWeight: 700, fontSize: 16 }}>{pageTitle}</span>
        </header>

        <main className="layout-main" style={{ flex: 1, padding: 32, overflow: 'auto' }}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
