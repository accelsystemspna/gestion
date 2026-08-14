import { useState, useEffect, useRef } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabase'
import { fmtMoney } from '../lib/format'
import { playCashRegisterSound, unlockAudio } from '../lib/sound'
import { subscribeToPush, pushSupported } from '../lib/push'

const NOTIF_DISMISSED_KEY = 'notif_banner_dismissed'

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
  const { user, profile, signOut, isAdmin, orgId } = useAuth()
  const navigate  = useNavigate()
  const location  = useLocation()
  const [open, setOpen] = useState(false)
  const [ventasWebPendientes, setVentasWebPendientes] = useState(0)
  const [toast, setToast] = useState(null)
  // 'checking' | 'unsubscribed' | 'subscribed' | 'denied' | 'unsupported'
  const [subState, setSubState] = useState('checking')
  const toastTimer = useRef(null)

  // Estado real de la suscripción push — no alcanza con mirar
  // Notification.permission, porque puede haber quedado "granted" de una
  // prueba vieja sin que exista una suscripción guardada de verdad.
  useEffect(() => {
    if (!pushSupported()) { setSubState('unsupported'); return }
    if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
      setSubState('denied')
      return
    }
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setSubState(sub ? 'subscribed' : 'unsubscribed'))
      .catch(() => setSubState('unsubscribed'))
  }, [])

  // Cerrar drawer al cambiar de ruta
  useEffect(() => { setOpen(false) }, [location.pathname])

  // Desbloquear el audio del aviso de venta con el primer toque en la app
  // (los navegadores, sobre todo en celular, no dejan sonar nada disparado
  // por el servidor si antes no hubo una interacción directa del usuario)
  useEffect(() => {
    const handler = () => unlockAudio()
    window.addEventListener('pointerdown', handler, { once: true })
    return () => window.removeEventListener('pointerdown', handler)
  }, [])

  // ── Aviso de ventas web pendientes de revisión ───────────────────────────
  useEffect(() => {
    const cargar = () => {
      supabase.from('ventas').select('id', { count: 'exact', head: true })
        .eq('estado', 'pendiente_revision')
        .then(({ count }) => setVentasWebPendientes(count ?? 0))
    }
    cargar()

    const channel = supabase
      .channel('ventas-web-pendientes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ventas' }, cargar)
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  // ── Sonido + toast + notificación de escritorio cuando entra una venta nueva ──
  useEffect(() => {
    const channel = supabase
      .channel('ventas-nuevas-alerta')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'ventas',
        filter: 'estado=eq.pendiente_revision',
      }, ({ new: v }) => {
        playCashRegisterSound()

        clearTimeout(toastTimer.current)
        setToast(v)
        toastTimer.current = setTimeout(() => setToast(null), 8000)
        // La notificación del sistema (aunque la app esté cerrada) la manda
        // el backend por Web Push — acá solo el toast/sonido en primer plano,
        // para no duplicar el aviso cuando la app está abierta.
      })
      .subscribe()

    return () => { supabase.removeChannel(channel); clearTimeout(toastTimer.current) }
  }, [navigate])

  const [activandoPush, setActivandoPush] = useState(false)
  const [dismissedNotif, setDismissedNotif] = useState(false)
  const pedirPermisoNotif = async () => {
    setActivandoPush(true)
    try {
      await subscribeToPush(orgId)
      setSubState('subscribed')
    } catch (err) {
      console.error('[push]', err)
      setSubState(typeof Notification !== 'undefined' && Notification.permission === 'denied' ? 'denied' : 'unsubscribed')
      alert('No se pudo activar la notificación: ' + err.message)
    }
    setActivandoPush(false)
  }

  const descartarBannerNotif = () => {
    try { localStorage.setItem(NOTIF_DISMISSED_KEY, '1') } catch { /* noop */ }
    setDismissedNotif(true)
  }

  const mostrarBannerNotif = subState === 'unsubscribed' && !dismissedNotif && (() => {
    try { return localStorage.getItem(NOTIF_DISMISSED_KEY) !== '1' } catch { return true }
  })()

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
            {item.to === '/ventas' && ventasWebPendientes > 0 && (
              <span style={{
                marginLeft: 'auto', background: '#f59e0b', color: '#1e1b0d',
                borderRadius: 10, fontSize: 11, fontWeight: 800, padding: '1px 7px',
              }}>
                {ventasWebPendientes}
              </span>
            )}
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
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>

      {/* ── Toast: nueva venta web ── */}
      {toast && (
        <div
          onClick={() => { setToast(null); navigate('/ventas?web=1') }}
          style={{
            position: 'fixed', top: 16, right: 16, zIndex: 1000, cursor: 'pointer',
            background: '#0891b2', color: 'white', borderRadius: 10, padding: '14px 18px',
            boxShadow: '0 8px 28px rgba(0,0,0,0.3)', maxWidth: 320,
            display: 'flex', alignItems: 'flex-start', gap: 10,
            animation: 'slideIn 0.25s ease-out',
          }}
        >
          <span style={{ fontSize: 24, flexShrink: 0 }}>💰</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 14 }}>Nueva venta desde la web</div>
            <div style={{ fontSize: 13, opacity: 0.95, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {toast.cliente_nombre || 'Consumidor Final'} · {fmtMoney(toast.total)}
            </div>
            <div style={{ fontSize: 11, opacity: 0.8, marginTop: 4 }}>Tocá para revisarla →</div>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); setToast(null) }}
            style={{ background: 'none', border: 'none', color: 'white', opacity: 0.8, cursor: 'pointer', fontSize: 15, padding: 0, flexShrink: 0 }}
          >✕</button>
        </div>
      )}

      {/* ── Banner: activar notificaciones de escritorio ── */}
      {mostrarBannerNotif && (
        <div style={{
          position: 'fixed', bottom: 16, right: 16, zIndex: 999, maxWidth: 300,
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
          padding: '12px 14px', boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>🔔 Notificaciones de ventas</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
            Activalas para enterarte de una venta nueva aunque tengas el celular bloqueado o la app cerrada.
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={descartarBannerNotif} disabled={activandoPush}
              style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontSize: 12 }}>
              Ahora no
            </button>
            <button onClick={pedirPermisoNotif} disabled={activandoPush}
              style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: 'none', background: '#0891b2', color: 'white', cursor: activandoPush ? 'default' : 'pointer', fontSize: 12, fontWeight: 700, opacity: activandoPush ? 0.7 : 1 }}>
              {activandoPush ? 'Activando…' : 'Activar'}
            </button>
          </div>
        </div>
      )}

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
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>

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
