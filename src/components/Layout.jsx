import { useState, useEffect, useRef, useMemo } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { actualizarCostosCompartidos } from '../lib/materiales'
import { supabase } from '../lib/supabase'
import { fmtMoney } from '../lib/format'
import { playCashRegisterSound, unlockAudio } from '../lib/sound'
import { subscribeToPush, pushSupported } from '../lib/push'
import MenuLateral from './MenuLateral'
import { normalizarMenu } from '../lib/menu'

const NOTIF_DISMISSED_KEY = 'notif_banner_dismissed'

const navItems = [
  { to: '/dashboard',     label: 'Panel',         icono: 'panel', minAdmin: true },
  { to: '/ventas',        label: 'Ventas',        icono: 'ventas' },
  { to: '/pedidos',       label: 'Pedidos',       icono: 'pedidos' },
  { to: '/presupuesto',   label: 'Presupuestos',  icono: 'presupuestos' },
  { to: '/clientes',      label: 'Clientes',      icono: 'clientes' },
  { to: '/productos',     label: 'Productos',     icono: 'productos', minAdmin: true },
  { to: '/materiales',    label: 'Materiales',    icono: 'materiales', minAdmin: true },
  { to: '/tiendas',       label: 'Tiendas',       icono: 'tiendas', minAdmin: true },
  { to: '/facturas',      label: 'Facturas',      icono: 'facturas', minAdmin: true },
  { to: '/configuracion', label: 'Configuración', icono: 'configuracion', minAdmin: true },
]
const RUTAS = navItems.map((n) => n.to)

export default function Layout() {
  const { user, profile, signOut, isAdmin, orgId, negocioNombre } = useAuth()
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

  // ── Materiales compartidos: si otro negocio cambió un precio, los costos de este se recalculan solos ──
  // Al entrar y cada 30 minutos mientras gestión queda abierta.
  useEffect(() => {
    if (!orgId) return
    actualizarCostosCompartidos(orgId)
    const t = setInterval(() => actualizarCostosCompartidos(orgId), 30 * 60 * 1000)
    return () => clearInterval(t)
  }, [orgId])

  // ── Aviso de pedidos web abiertos → menú Tiendas ──
  // Todo pedido de tienda (web, mayorista, Mercado Libre) que todavía necesita atención: esperando pago,
  // pagado por preparar, o listo para despachar. Cuando se despacha/completa o se cancela, deja de contar.
  useEffect(() => {
    const cargar = async () => {
      // Los pedidos de tiendas inactivas no cuentan (esas tiendas ni se muestran en Tiendas).
      const { data: inactivas } = await supabase.from('tiendas').select('id').eq('activa', false)
      const idsInactivas = (inactivas || []).map((t) => t.id)
      let q = supabase.from('ventas').select('id', { count: 'exact', head: true })
        .not('origen_ref', 'is', null)
        .neq('estado', 'anulado')
        .in('estado_web', ['esperando_pago', 'procesado', 'en_preparacion', 'listo'])
      if (idsInactivas.length) q = q.or(`tienda_id.is.null,tienda_id.not.in.(${idsInactivas.join(',')})`)
      let r = await q
      // Si todavía no se corrió el SQL de Tiendas (no existe estado_web), se cuentan los pedidos por revisar.
      if (r.error) {
        r = await supabase.from('ventas').select('id', { count: 'exact', head: true })
          .not('origen_ref', 'is', null).eq('estado', 'pendiente_revision')
      }
      setVentasWebPendientes(r.count ?? 0)
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

  // ── Menú personalizado del usuario (se guarda en su perfil al cerrar el candado) ──
  const [menuEditado, setMenuEditado] = useState(null)
  const [editandoMenu, setEditandoMenu] = useState(false)
  const [guardandoMenu, setGuardandoMenu] = useState(false)
  const menu = useMemo(() => normalizarMenu(menuEditado ?? profile?.menu_config, RUTAS), [menuEditado, profile])
  const guardarMenu = async () => {
    setGuardandoMenu(true)
    const deFabrica = JSON.stringify(menu) === JSON.stringify(normalizarMenu(null, RUTAS))
    const { error } = await supabase.from('profiles').update({ menu_config: deFabrica ? null : menu }).eq('id', user.id)
    setGuardandoMenu(false)
    if (error) { alert('No se pudo guardar el menú: ' + error.message); return }
    setMenuEditado(menu)
    setEditandoMenu(false)
  }
  const pageTitle = navItems.find(n => location.pathname.startsWith(n.to))?.label ?? 'Gestión'

  const sidebarContent = (
    <>
      <div style={{ padding: '22px 20px 14px', fontSize: 13, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {negocioNombre || 'Panel de gestión'}
      </div>

      <MenuLateral
        menu={menu}
        items={items}
        editando={editandoMenu}
        guardando={guardandoMenu}
        insignias={{ '/tiendas': ventasWebPendientes }}
        onCambio={setMenuEditado}
        onAbrir={() => setEditandoMenu(true)}
        onCerrar={guardarMenu}
        onRestablecer={() => setMenuEditado(normalizarMenu(null, RUTAS))}
      />

      <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {profile?.nombre || user?.email}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-light)', textTransform: 'capitalize' }}>
              {profile?.rol || 'usuario'}
            </div>
          </div>
        </div>
        <button
          onClick={handleLogout}
          style={{
            width: '100%', padding: '7px', background: 'transparent', borderRadius: 8,
            border: '1px solid var(--border)', color: 'var(--text-muted)',
            fontSize: 13, cursor: 'pointer',
          }}
        >
          Cerrar sesión
        </button>
        <div style={{ marginTop: 8, fontSize: 10, color: 'var(--text-light)', textAlign: 'center', fontFamily: 'var(--font-mono)' }}>
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
          onClick={() => { setToast(null); navigate('/tiendas') }}
          style={{
            position: 'fixed', top: 16, right: 16, zIndex: 1000, cursor: 'pointer',
            background: 'var(--sidebar)', color: '#ffffff', padding: '14px 18px', borderLeft: '3px solid var(--sidebar-active)',
            boxShadow: '0 8px 28px rgba(0,0,0,0.3)', maxWidth: 320,
            display: 'flex', alignItems: 'flex-start', gap: 10,
            animation: 'slideIn 0.25s ease-out',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Nueva venta desde la web</div>
            <div style={{ fontSize: 13, opacity: 0.95, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {toast.cliente_nombre || 'Consumidor Final'} · {fmtMoney(toast.total)}
            </div>
            <div style={{ fontSize: 11, opacity: 0.8, marginTop: 4 }}>Tocá para verla en Tiendas</div>
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
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          padding: '12px 14px', boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Notificaciones de ventas</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
            Activalas para enterarte de una venta nueva aunque tengas el celular bloqueado o la app cerrada.
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={descartarBannerNotif} disabled={activandoPush}
              className="btn btn-sm" style={{ flex: 1 }}>
              Ahora no
            </button>
            <button onClick={pedirPermisoNotif} disabled={activandoPush}
              className="btn btn-sm btn-primary" style={{ flex: 1 }}>
              {activandoPush ? 'Activando…' : 'Activar'}
            </button>
          </div>
        </div>
      )}

      {/* ── Sidebar desktop ── */}
      <aside className="layout-sidebar" style={{
        width: 232, background: 'var(--bg-card)', color: 'var(--text)', borderRight: '1px solid var(--border)',
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
        background: 'var(--bg-card)', color: 'var(--text)',
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
          background: 'var(--bg-card)', color: 'var(--text)', borderBottom: '1px solid var(--border)',
          position: 'sticky', top: 0, zIndex: 100, flexShrink: 0,
        }}>
          <button
            onClick={() => setOpen(o => !o)}
            style={{
              background: 'none', border: 'none', color: 'var(--text)',
              fontSize: 22, cursor: 'pointer', lineHeight: 1, padding: 4,
            }}
          >
            ☰
          </button>
          <span style={{ fontWeight: 600, fontSize: 15 }}>{pageTitle}</span>
        </header>

        <main className="layout-main" style={{ flex: 1, padding: '28px 32px', overflow: 'auto' }}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
