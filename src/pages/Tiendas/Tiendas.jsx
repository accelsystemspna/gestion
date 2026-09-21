import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { fmtMoney } from '../../lib/format'
import VentaDetalle from '../Ventas/VentaDetalle'
import ImageThumb from '../../components/ImageThumb'
import WooPanel from './woo/WooPanel'
import {
  ESTADOS_WEB, FASES, estadoWebDe, ordenWooId, perteneceATienda,
  cambiarEstadoWeb, cargarItemsDeVentas, cargarItemsPedidos, estadisticasClientes, guardarComoCliente,
  eliminarPedidosCancelados,
} from '../../lib/pedidosWeb'

const TIPOS = {
  woocommerce:  { label: 'WooCommerce',   color: '#7c3aed', bg: 'rgba(124,58,237,0.12)', sigla: 'WC' },
  mercadolibre: { label: 'Mercado Libre', color: '#d97706', bg: 'rgba(217,119,6,0.12)',  sigla: 'ML' },
  mayorista:    { label: 'Mayorista',     color: '#0f766e', bg: 'rgba(15,118,110,0.12)', sigla: 'MY' },
}

const FORMA_LABEL = {
  efectivo: 'Efectivo', debito: 'Débito', credito: 'Crédito',
  transferencia: 'Transferencia', cuenta_corriente: 'Cta. corriente',
}

const COLUMNAS_BASE = 'id, numero, fecha, hora, created_at, cliente_id, cliente_nombre, cliente_email, cliente_telefono, cliente_direccion, total, forma_pago, estado, estado_web, origen_estado, origen_pago, origen_ref, tienda_id, factura_emitida, notas'
// Datos del pedido del portal mayorista (supabase_mayorista_pedidos.sql)
const COLUMNAS = COLUMNAS_BASE + ', origen_numero, origen_logistica, origen_tracking, origen_tracking_url, origen_estado_portal, cliente_dni, cliente_empresa, cliente_direccion_envio, contacto_preferido'

// Número con el que se reconoce el pedido: el del portal (2026-0014) o el de WooCommerce (#123)
const numeroPedido = (v) => v.origen_numero ? `Pedido ${v.origen_numero}` : ordenWooId(v) ? `Pedido #${ordenWooId(v)}` : `Venta N° ${v.numero}`

const ESTADO_PORTAL = {
  pendiente: 'Pendiente', confirmado: 'Confirmado', en_produccion: 'En producción',
  despachado: 'Despachado', cancelado: 'Cancelado',
}

const fmtFecha = (f) => (f ? f.slice(0, 10).split('-').reverse().join('/') : '—')

function Badge({ children, color, bg }) {
  return (
    <span style={{
      display: 'inline-block', fontSize: 11, fontWeight: 700, padding: '2px 8px',
      borderRadius: 999, background: bg, color, whiteSpace: 'nowrap',
    }}>{children}</span>
  )
}

// Qué se puede hacer con un pedido según la fase en la que está.
// Facturar y despachar recién se habilitan cuando el pedido está listo.
const SIGUIENTE = {
  esperando_pago: { a: 'en_preparacion', label: 'Confirmar pago' },
  en_preparacion: { a: 'listo',          label: 'Marcar listo para despachar' },
  listo:          { a: 'completado',     label: 'Marcar despachado' },
}

// Foto + código + cantidad de cada producto del pedido
function ItemsPedido({ items, grande = false }) {
  if (!items) return <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Cargando productos…</div>
  if (!items.length) return <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Este pedido no tiene productos cargados.</div>
  const foto = grande ? 76 : 48
  return (
    <div style={{ display: 'flex', flexDirection: grande ? 'column' : 'row', gap: grande ? 10 : 8, flexWrap: 'wrap' }}>
      {items.map(it => (
        <div key={it.id} style={{
          display: 'flex', gap: 10, alignItems: 'center',
          ...(grande
            ? { padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)' }
            : { padding: '4px 10px 4px 4px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg)' }),
        }}>
          {it.imagen ? (
            <ImageThumb src={it.imagen} size={foto} radius={6} alt={it.descripcion} />
          ) : (
            <div style={{ width: foto, height: foto, borderRadius: 6, background: 'var(--bg-muted)', color: 'var(--text-muted)', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', flexShrink: 0 }}>
              Sin foto
            </div>
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: grande ? 15 : 13 }}>{it.codigo || 'Sin código'}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: grande ? 'normal' : 'nowrap', maxWidth: grande ? 'none' : 170 }}>{it.descripcion}</div>
          </div>
          <div style={{ fontWeight: 800, fontSize: grande ? 22 : 16, color: 'var(--primary)', flexShrink: 0 }}>×{it.cantidad}</div>
        </div>
      ))}
    </div>
  )
}

function Kpi({ label, value, sub, color }) {
  return (
    <div style={{ flex: '1 1 150px', padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: color || 'var(--text)', marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{sub}</div>}
    </div>
  )
}

export default function Tiendas() {
  const { orgId } = useAuth()
  const [tiendas, setTiendas]   = useState([])
  const [ventas, setVentas]     = useState([])
  const [loading, setLoading]   = useState(true)
  const [errorSql, setErrorSql] = useState('')
  const [sel, setSel]           = useState('todas')       // 'todas' o id de tienda
  const [tab, setTab]           = useState('pedidos')     // 'pedidos' | 'clientes'
  const [filtro, setFiltro]     = useState('todos')
  const [q, setQ]               = useState('')
  const [limite, setLimite]     = useState(60)
  const [trabajando, setTrabajando] = useState(null)
  const [msg, setMsg]           = useState(null)
  const [detalleId, setDetalleId] = useState(null)
  const [pedidoId, setPedidoId]   = useState(null)        // pedido abierto en el detalle
  const [itemsPedido, setItemsPedido] = useState({})      // { [ventaId]: renglones con foto y código }
  const [items, setItems]       = useState([])
  const [cargandoItems, setCargandoItems] = useState(false)
  const [grupoSel, setGrupoSel] = useState(null)
  const [guardando, setGuardando] = useState(false)
  const [despachoId, setDespachoId] = useState(null)      // pedido del portal que se está despachando
  const [trackingTxt, setTrackingTxt] = useState('')
  const [notificarCli, setNotificarCli] = useState(true)

  const cargar = async (silencioso = false) => {
    if (!silencioso) setLoading(true)
    const pedirVentas = (cols) => supabase.from('ventas').select(cols).not('origen_ref', 'is', null)
      .order('created_at', { ascending: false }).limit(1000)
    const [t, v0] = await Promise.all([
      supabase.from('tiendas').select('*').eq('user_id', orgId).order('created_at'),
      pedirVentas(COLUMNAS),
    ])
    setTiendas(t.data || [])
    // Si todavía falta el SQL del portal mayorista, se cargan los pedidos sin esos datos.
    let v = v0
    let avisoSql = ''
    if (v.error) {
      avisoSql = v.error.message
      v = await pedirVentas(COLUMNAS_BASE)
    }
    if (v.error) {
      setErrorSql(v.error.message)
      setVentas([])
    } else if (avisoSql) {
      setErrorSql(avisoSql)
      setVentas(v.data || [])
    } else {
      setErrorSql('')
      setVentas(v.data || [])
    }
    setLoading(false)
  }
  useEffect(() => { if (orgId) cargar() }, [orgId])

  const tiendaSel = sel === 'todas' ? null : tiendas.find(t => String(t.id) === String(sel))
  const tiendaDeVenta = (v) => tiendas.find(t => perteneceATienda(v, t)) || null

  const ventasSel = useMemo(
    () => (tiendaSel ? ventas.filter(v => perteneceATienda(v, tiendaSel)) : ventas),
    [ventas, tiendaSel],
  )

  // ── KPIs y conteos ────────────────────────────────────────────────────────
  const resumen = (lista) => {
    const mes = new Date().toISOString().slice(0, 7)
    let esperando = 0, montoEsperando = 0, enPrep = 0, listos = 0, pedidosMes = 0, factMes = 0
    for (const v of lista) {
      const e = estadoWebDe(v)
      if (e === 'esperando_pago') { esperando++; montoEsperando += Number(v.total) || 0 }
      if (e === 'en_preparacion') enPrep++
      if (e === 'listo') listos++
      if (e !== 'cancelado' && (v.fecha || '').startsWith(mes)) { pedidosMes++; factMes += Number(v.total) || 0 }
    }
    return { esperando, montoEsperando, enPrep, listos, pedidosMes, factMes }
  }
  const kpi = useMemo(() => resumen(ventasSel), [ventasSel])

  const conteos = useMemo(() => {
    const c = { todos: ventasSel.length, ...Object.fromEntries(Object.keys(ESTADOS_WEB).map(k => [k, 0])) }
    for (const v of ventasSel) c[estadoWebDe(v)]++
    return c
  }, [ventasSel])

  const visibles = useMemo(() => {
    const txt = q.trim().toLowerCase()
    return ventasSel.filter(v => {
      if (filtro !== 'todos' && estadoWebDe(v) !== filtro) return false
      if (!txt) return true
      return [v.cliente_nombre, v.cliente_email, v.origen_ref, String(v.numero ?? '')]
        .some(x => (x || '').toLowerCase().includes(txt))
    })
  }, [ventasSel, filtro, q])

  useEffect(() => { setLimite(60) }, [sel, filtro, q, tab])

  // ── Cambio de estado ──────────────────────────────────────────────────────
  const accionar = async (venta, nuevo, extra = {}) => {
    if (nuevo === 'cancelado' && !window.confirm('¿Cancelar este pedido? Se anula la venta y se devuelve el stock.')) return false
    if (nuevo === 'completado' && !venta.factura_emitida &&
        !window.confirm('Este pedido todavía no está facturado. ¿Marcarlo como despachado igual?')) return false
    setTrabajando(venta.id)
    setMsg(null)
    const r = await cambiarEstadoWeb({ venta, tienda: tiendaDeVenta(venta), nuevo, ...extra })
    setTrabajando(null)
    if (!r.ok) { setMsg({ tipo: 'error', texto: 'No se pudo cambiar el estado: ' + r.error }); return false }
    const etiqueta = ESTADOS_WEB[nuevo].label
    if (r.portal) {
      let texto = `Pedido: ${etiqueta}. Se actualizó en el portal mayorista.`
      if (extra.tracking?.trim()) texto += ` Seguimiento: ${extra.tracking.trim()}.`
      if (r.portal.email_sent === true) texto += ' Se avisó al cliente por email.'
      else if (extra.notificar && r.portal.email_sent === false) texto += ' No se pudo enviar el aviso al cliente.'
      setMsg({ tipo: 'ok', texto })
    }
    else if (r.woo?.ok) setMsg({ tipo: 'ok', texto: `Pedido: ${etiqueta}. También se actualizó en WooCommerce.` })
    else if (r.woo?.motivo === 'no aplica') setMsg({ tipo: 'ok', texto: `Pedido: ${etiqueta}.` })
    else setMsg({ tipo: 'aviso', texto: `Pedido: ${etiqueta} en el programa, pero no se pudo avisar a WooCommerce (${r.woo?.motivo}). Cambialo también allá.` })
    cargar(true)
    return true
  }

  // Despachar un pedido del portal: pide el N° de seguimiento y si se avisa al cliente
  const abrirDespacho = (v) => {
    setTrackingTxt(v.origen_tracking || '')
    setNotificarCli(true)
    setDespachoId(v.id)
  }
  const confirmarDespacho = async () => {
    const v = ventas.find(x => x.id === despachoId)
    if (!v) return
    const ok = await accionar(v, 'completado', { tracking: trackingTxt, notificar: notificarCli })
    if (ok) setDespachoId(null)
  }

  // ── Eliminar pedidos cancelados (uno o todos los de la vista) ─────────────
  const eliminarCancelados = async (lista, pregunta) => {
    if (!lista.length || !window.confirm(pregunta)) return
    setMsg(null)
    const r = await eliminarPedidosCancelados(lista)
    if (r.error) setMsg({ tipo: 'error', texto: `No se pudo eliminar todo (${r.eliminadas} eliminados). ${r.error}` })
    else setMsg({
      tipo: 'ok',
      texto: `${r.eliminadas} pedido${r.eliminadas !== 1 ? 's' : ''} cancelado${r.eliminadas !== 1 ? 's' : ''} eliminado${r.eliminadas !== 1 ? 's' : ''}.` +
             (r.omitidas ? ` ${r.omitidas} no se eliminaron porque ya tienen factura.` : ''),
    })
    setPedidoId(null)
    cargar(true)
  }

  // ── Productos de los pedidos (foto, código, cantidad) ─────────────────────
  // Se cargan solo los de los pedidos que están a la vista y el que está abierto.
  const idsAVer = useMemo(() => {
    const ids = tab === 'pedidos' ? visibles.slice(0, limite).map(v => v.id) : []
    if (pedidoId) ids.push(pedidoId)
    return [...new Set(ids)]
  }, [tab, visibles, limite, pedidoId])

  useEffect(() => {
    const faltan = idsAVer.filter(id => !(id in itemsPedido))
    if (!faltan.length) return
    let vivo = true
    cargarItemsPedidos(faltan).then(r => {
      if (!vivo) return
      setItemsPedido(prev => {
        const sig = { ...prev }
        for (const id of faltan) sig[id] = r[id] || []
        return sig
      })
    })
    return () => { vivo = false }
  }, [idsAVer])   // eslint-disable-line react-hooks/exhaustive-deps

  // ── Clientes: items de los pedidos para las estadísticas ──────────────────
  useEffect(() => {
    if (tab !== 'clientes') return
    let vivo = true
    const ids = ventasSel.filter(v => estadoWebDe(v) !== 'cancelado').map(v => v.id)
    setCargandoItems(true)
    cargarItemsDeVentas(ids).then(r => { if (vivo) { setItems(r); setCargandoItems(false) } })
    return () => { vivo = false }
  }, [tab, ventasSel])

  const grupos = useMemo(() => estadisticasClientes(ventasSel, items), [ventasSel, items])
  const recurrentes = grupos.filter(g => g.cantidadPedidos > 1).length

  const gruposFiltrados = useMemo(() => {
    const txt = q.trim().toLowerCase()
    if (!txt) return grupos
    return grupos.filter(g => [g.nombre, g.email, g.telefono].some(x => (x || '').toLowerCase().includes(txt)))
  }, [grupos, q])

  const guardarCliente = async (g) => {
    setGuardando(true)
    try {
      await guardarComoCliente({ grupo: g, orgId })
      setMsg({ tipo: 'ok', texto: `${g.nombre || 'El comprador'} quedó guardado en Clientes.` })
      setGrupoSel(null)
      cargar(true)
    } catch (err) {
      setMsg({ tipo: 'error', texto: 'No se pudo guardar el cliente: ' + err.message })
    }
    setGuardando(false)
  }

  // El grupo abierto se vuelve a buscar en la lista para reflejar cambios
  const grupoAbierto = grupoSel ? (grupos.find(g => g.key === grupoSel) || null) : null

  const pagoTexto = (v) => v.origen_pago || FORMA_LABEL[v.forma_pago] || v.forma_pago || '—'

  // Resumen de una línea: el detalle completo (fotos, códigos) se ve al abrir el pedido
  const resumenItems = (v) => {
    const its = itemsPedido[v.id]
    if (!its || !its.length) return ''
    const unidades = its.reduce((s, i) => s + i.cantidad, 0)
    return `${its.length} producto${its.length !== 1 ? 's' : ''} · ${unidades} unidad${unidades !== 1 ? 'es' : ''}`
  }

  // Botones según la fase: confirmar pago -> armar -> listo -> facturar y despachar
  const botonesPedido = (v) => {
    const e = estadoWebDe(v)
    const ocupado = trabajando === v.id
    const sig = SIGUIENTE[e]
    const esMay = tiendaDeVenta(v)?.tipo === 'mayorista'
    const abreDespacho = esMay && sig?.a === 'completado'
    return (
      <>
        {sig && (
          <button className="btn btn-sm btn-primary" disabled={ocupado}
            onClick={() => (abreDespacho ? abrirDespacho(v) : accionar(v, sig.a))}>
            {ocupado ? '…' : abreDespacho ? 'Despachar' : sig.label}
          </button>
        )}
        {esMay && e === 'en_preparacion' && (
          <button className="btn btn-sm" disabled={ocupado} onClick={() => abrirDespacho(v)}>Despachar</button>
        )}
        {e === 'listo' && !v.factura_emitida && (
          <button className="btn btn-sm" style={{ borderColor: '#2563eb', color: '#2563eb' }} onClick={() => setDetalleId(v.id)}>
            Facturar
          </button>
        )}
        {e === 'listo' && (
          <button className="btn btn-sm btn-ghost" disabled={ocupado} onClick={() => accionar(v, 'en_preparacion')}>Volver a preparación</button>
        )}
        {sig && (
          <button className="btn btn-sm btn-ghost" disabled={ocupado} style={{ color: 'var(--danger)' }} onClick={() => accionar(v, 'cancelado')}>Cancelar</button>
        )}
        {e === 'cancelado' && !v.factura_emitida && (
          <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }}
            onClick={() => eliminarCancelados([v], '¿Eliminar este pedido cancelado? Se borra definitivamente del programa.')}>
            Eliminar
          </button>
        )}
      </>
    )
  }

  // Cartel de resultado. Se muestra también DENTRO de las ventanas (detalle y despacho),
  // porque si no queda tapado por ellas y parece que el botón no hizo nada.
  const avisoMsg = msg && (
    <div style={{
      display: 'flex', justifyContent: 'space-between', gap: 10, padding: '10px 14px', marginBottom: 14, borderRadius: 8, fontSize: 13,
      background: msg.tipo === 'error' ? '#fee2e2' : msg.tipo === 'aviso' ? '#fef3c7' : '#dcfce7',
      color: msg.tipo === 'error' ? '#7f1d1d' : msg.tipo === 'aviso' ? '#78350f' : '#14532d',
    }}>
      <span>{msg.texto}</span>
      <span style={{ cursor: 'pointer', fontWeight: 700 }} onClick={() => setMsg(null)}>✕</span>
    </div>
  )

  const pedidoAbierto = pedidoId ? (ventas.find(v => v.id === pedidoId) || null) : null

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 24, marginBottom: 4 }}>Tiendas</h1>
          <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: 13 }}>
            Pedidos de tus sitios web, su estado de pago y quiénes te compran. Las tiendas se configuran en Configuración → Integraciones.
          </p>
        </div>
        <button className="btn btn-sm" onClick={() => cargar()} disabled={loading}>Actualizar</button>
      </div>

      {errorSql && (
        <div style={{ padding: '12px 14px', marginBottom: 14, borderRadius: 8, background: '#fef3c7', border: '1px solid #fcd34d', color: '#78350f', fontSize: 13 }}>
          Falta correr un SQL en Supabase (SQL Editor): <strong>supabase_tiendas_pedidos.sql</strong> y, para el portal mayorista, <strong>supabase_mayorista_pedidos.sql</strong>. Detalle: {errorSql}
        </div>
      )}

      {avisoMsg}

      {loading ? (
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>Cargando...</div>
      ) : (
        <>
          {/* Selector de tienda */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10, marginBottom: 18 }}>
            {[{ id: 'todas', nombre: 'Todas las tiendas', tipo: null }, ...tiendas].map(t => {
              const lista = t.id === 'todas' ? ventas : ventas.filter(v => perteneceATienda(v, t))
              const r = resumen(lista)
              const activa = String(sel) === String(t.id)
              const tipo = TIPOS[t.tipo]
              const sinPedidos = t.tipo === 'mercadolibre'
              return (
                <div key={t.id} onClick={() => { setSel(String(t.id)); setFiltro('todos') }}
                  style={{
                    cursor: 'pointer', padding: '12px 14px', borderRadius: 10, background: 'var(--surface)',
                    border: `2px solid ${activa ? 'var(--primary)' : 'var(--border)'}`,
                    opacity: t.activa === false ? 0.55 : 1,
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 14 }}>{t.nombre}</strong>
                    {tipo && <Badge color={tipo.color} bg={tipo.bg}>{tipo.sigla}</Badge>}
                    {t.activa === false && <Badge color="var(--text-muted)" bg="var(--bg-muted)">Inactiva</Badge>}
                  </div>
                  {sinPedidos ? (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Esta plataforma todavía no envía pedidos al programa.</div>
                  ) : (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                      <div>{r.pedidosMes} pedido{r.pedidosMes !== 1 ? 's' : ''} este mes · {fmtMoney(r.factMes)}</div>
                      <div style={{ color: r.esperando ? '#b45309' : 'var(--text-muted)', fontWeight: r.esperando ? 700 : 400 }}>
                        {r.esperando ? `${r.esperando} esperando pago` : 'Sin pagos pendientes'}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* KPIs */}
          {tab !== 'woo' && <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
            <Kpi label="Esperando pago" value={kpi.esperando} sub={kpi.esperando ? fmtMoney(kpi.montoEsperando) : 'nada pendiente'} color={kpi.esperando ? '#b45309' : undefined} />
            <Kpi label="En preparación" value={kpi.enPrep} sub="pagados, por armar" color="#0e7490" />
            <Kpi label="Listos para despachar" value={kpi.listos} sub="para facturar y enviar" color="#6d28d9" />
            <Kpi label="Pedidos del mes" value={kpi.pedidosMes} />
            <Kpi label="Facturación del mes" value={fmtMoney(kpi.factMes)} />
          </div>}

          {/* Pestañas */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 14 }}>
            {[['pedidos', 'Pedidos'], ['clientes', 'Clientes'], ['woo', 'Panel WooCommerce']].map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)} style={{
                padding: '9px 20px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 14,
                fontWeight: tab === id ? 600 : 400, color: tab === id ? 'var(--primary)' : 'var(--text-muted)',
                borderBottom: tab === id ? '2px solid var(--primary)' : '2px solid transparent', marginBottom: -1,
              }}>{label}</button>
            ))}
          </div>

          {/* Filtros */}
          {tab !== 'woo' && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
            {tab === 'pedidos' && [['todos', 'Todos'], ...Object.entries(ESTADOS_WEB).map(([k, v]) => [k, v.label])].map(([k, label]) => (
              <button key={k} onClick={() => setFiltro(k)} className="btn btn-sm" style={{
                background: filtro === k ? 'var(--primary)' : undefined, color: filtro === k ? '#fff' : undefined,
                borderColor: filtro === k ? 'var(--primary)' : undefined,
              }}>{label} ({conteos[k] ?? 0})</button>
            ))}
            <input className="input" style={{ flex: '1 1 200px', maxWidth: 320, padding: '6px 10px', fontSize: 13 }}
              placeholder={tab === 'pedidos' ? 'Buscar por cliente, email o N° de pedido…' : 'Buscar cliente…'}
              value={q} onChange={e => setQ(e.target.value)} />
            {tab === 'pedidos' && filtro === 'cancelado' && (() => {
              const borrables = visibles.filter(v => !v.factura_emitida)
              if (!borrables.length) return null
              return (
                <button className="btn btn-sm" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
                  onClick={() => eliminarCancelados(
                    borrables,
                    `¿Eliminar ${borrables.length} pedido${borrables.length !== 1 ? 's' : ''} cancelado${borrables.length !== 1 ? 's' : ''}? Se borran definitivamente del programa. Los que ya tienen factura no se tocan.`,
                  )}>
                  Eliminar cancelados ({borrables.length})
                </button>
              )
            })()}
          </div>}

          {/* ── PANEL WOOCOMMERCE ─────────────────────────────────────── */}
          {tab === 'woo' && (
            <WooPanel tiendas={tiendas} tiendaSelId={sel} ventas={ventas} onCambio={() => cargar(true)} />
          )}

          {/* ── PEDIDOS ─────────────────────────────────────────────────── */}
          {tab === 'pedidos' && (
            visibles.length === 0 ? (
              <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)', border: '1px dashed var(--border)', borderRadius: 8 }}>
                {ventasSel.length === 0 ? 'Todavía no entró ningún pedido de la web.' : 'No hay pedidos con ese filtro.'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {visibles.slice(0, limite).map(v => {
                  const e = estadoWebDe(v)
                  const est = ESTADOS_WEB[e]
                  const t = tiendaDeVenta(v)
                  return (
                    <div key={v.id} onClick={() => setPedidoId(v.id)} title="Ver el detalle del pedido" style={{
                      display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', padding: '10px 14px', cursor: 'pointer',
                      border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)',
                      opacity: e === 'cancelado' ? 0.6 : 1,
                    }}>
                      <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <strong style={{ fontSize: 14 }}>{v.cliente_nombre || 'Consumidor Final'}</strong>
                          <Badge color={est.color} bg={est.bg}>{est.label}</Badge>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                          {numeroPedido(v)} · {fmtFecha(v.fecha)} {v.hora || ''}
                          {sel === 'todas' && t ? ` · ${t.nombre}` : ''}
                          {resumenItems(v) ? ` · ${resumenItems(v)}` : ''}
                        </div>
                      </div>
                      <div style={{ flex: '0 1 150px', fontSize: 12, color: 'var(--text-muted)' }}>
                        <div>{pagoTexto(v)}</div>
                        <div style={{ color: v.factura_emitida ? '#15803d' : 'var(--text-muted)' }}>{v.factura_emitida ? 'Facturada' : 'Sin facturar'}</div>
                      </div>
                      <div style={{ flex: '0 0 auto', fontWeight: 800, fontSize: 16, minWidth: 90, textAlign: 'right' }}>{fmtMoney(v.total)}</div>
                      <div onClick={(ev) => ev.stopPropagation()} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: '1 1 auto', justifyContent: 'flex-end' }}>
                        {botonesPedido(v)}
                      </div>
                      <span style={{ color: 'var(--text-muted)', fontSize: 22, lineHeight: 1 }}>›</span>
                    </div>
                  )
                })}
                {visibles.length > limite && (
                  <button className="btn btn-sm" style={{ alignSelf: 'center' }} onClick={() => setLimite(l => l + 60)}>
                    Ver más ({visibles.length - limite} restantes)
                  </button>
                )}
              </div>
            )
          )}

          {/* ── CLIENTES ────────────────────────────────────────────────── */}
          {tab === 'clientes' && (
            cargandoItems && !items.length ? (
              <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>Calculando estadísticas…</div>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
                  <Kpi label="Compradores" value={grupos.length} />
                  <Kpi label="Recurrentes" value={recurrentes} sub={grupos.length ? `${Math.round((recurrentes / grupos.length) * 100)}% compró más de una vez` : ''} color="#15803d" />
                  <Kpi label="Ticket promedio" value={fmtMoney(grupos.length ? grupos.reduce((s, g) => s + g.total, 0) / Math.max(1, grupos.reduce((s, g) => s + g.cantidadPedidos, 0)) : 0)} />
                </div>
                {gruposFiltrados.length === 0 ? (
                  <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)', border: '1px dashed var(--border)', borderRadius: 8 }}>
                    Todavía no hay compradores para mostrar.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {gruposFiltrados.slice(0, limite).map(g => (
                      <div key={g.key} onClick={() => setGrupoSel(g.key)} style={{
                        display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', padding: '10px 14px', cursor: 'pointer',
                        border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)',
                      }}>
                        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <strong style={{ fontSize: 14 }}>{g.nombre || 'Sin nombre'}</strong>
                            {g.cantidadPedidos > 1 && <Badge color="#15803d" bg="#dcfce7">Recurrente</Badge>}
                            {g.clienteId && <Badge color="#0e7490" bg="#cffafe">En Clientes</Badge>}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>{g.email || g.telefono || 'Sin datos de contacto'}</div>
                        </div>
                        <div style={{ flex: '0 1 180px', fontSize: 12, color: 'var(--text-muted)' }}>
                          <div>{g.cantidadPedidos} pedido{g.cantidadPedidos !== 1 ? 's' : ''} · última {fmtFecha(g.ultima)}</div>
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            Compra más: {g.topProductos[0]?.nombre || '—'}
                          </div>
                        </div>
                        <div style={{ fontWeight: 800, fontSize: 16, minWidth: 100, textAlign: 'right' }}>{fmtMoney(g.total)}</div>
                      </div>
                    ))}
                    {gruposFiltrados.length > limite && (
                      <button className="btn btn-sm" style={{ alignSelf: 'center' }} onClick={() => setLimite(l => l + 60)}>
                        Ver más ({gruposFiltrados.length - limite} restantes)
                      </button>
                    )}
                  </div>
                )}
              </>
            )
          )}
        </>
      )}

      {/* Detalle de un comprador */}
      {grupoAbierto && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setGrupoSel(null) }}>
          <div className="modal" style={{ maxWidth: 640 }}>
            <div className="modal-header">
              <h3>{grupoAbierto.nombre || 'Comprador'}</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setGrupoSel(null)}>✕</button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.7 }}>
                {grupoAbierto.email && <div>{grupoAbierto.email}</div>}
                {grupoAbierto.telefono && <div>{grupoAbierto.telefono}</div>}
                {grupoAbierto.direccion && <div>{grupoAbierto.direccion}</div>}
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Kpi label="Pedidos" value={grupoAbierto.cantidadPedidos} />
                <Kpi label="Total comprado" value={fmtMoney(grupoAbierto.total)} />
                <Kpi label="Ticket promedio" value={fmtMoney(grupoAbierto.ticketPromedio)} />
                <Kpi label="Primera compra" value={fmtFecha(grupoAbierto.primera)} sub={`última: ${fmtFecha(grupoAbierto.ultima)}`} />
              </div>

              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>Qué compra</div>
                {grupoAbierto.topProductos.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Sin detalle de productos.</div>
                ) : grupoAbierto.topProductos.slice(0, 8).map(p => {
                  const max = grupoAbierto.topProductos[0].cantidad || 1
                  return (
                    <div key={p.nombre} style={{ marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13 }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nombre}</span>
                        <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>×{p.cantidad} · {fmtMoney(p.total)}</span>
                      </div>
                      <div style={{ height: 6, borderRadius: 3, background: 'var(--border)', marginTop: 3, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${Math.max(4, (p.cantidad / max) * 100)}%`, background: 'var(--primary)', borderRadius: 3 }} />
                      </div>
                    </div>
                  )
                })}
              </div>

              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>Pedidos</div>
                {grupoAbierto.pedidos.map(v => {
                  const est = ESTADOS_WEB[estadoWebDe(v)]
                  return (
                    <div key={v.id} onClick={() => setDetalleId(v.id)} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '8px 0',
                      borderBottom: '1px solid var(--border)', cursor: 'pointer', fontSize: 13,
                    }}>
                      <span>{fmtFecha(v.fecha)} · {numeroPedido(v)}</span>
                      <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <Badge color={est.color} bg={est.bg}>{est.label}</Badge>
                        <strong>{fmtMoney(v.total)}</strong>
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setGrupoSel(null)}>Cerrar</button>
              {grupoAbierto.clienteId ? (
                <span style={{ fontSize: 13, color: '#15803d', alignSelf: 'center' }}>Ya está guardado en Clientes</span>
              ) : (
                <button className="btn btn-primary" disabled={guardando} onClick={() => guardarCliente(grupoAbierto)}>
                  {guardando ? 'Guardando…' : 'Guardar en Clientes'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Detalle del pedido: fases + qué preparar (foto, código, cantidad) */}
      {pedidoAbierto && (() => {
        const v = pedidoAbierto
        const e = estadoWebDe(v)
        const est = ESTADOS_WEB[e]
        const idxActual = FASES.indexOf(e)
        const t = tiendaDeVenta(v)
        const esMay = t?.tipo === 'mayorista'
        return (
          <div className="modal-overlay" onClick={(ev) => { if (ev.target === ev.currentTarget) setPedidoId(null) }}>
            <div className="modal" style={{ maxWidth: 680 }}>
              <div className="modal-header">
                <div style={{ minWidth: 0 }}>
                  <h3 style={{ margin: 0 }}>{v.cliente_nombre || 'Consumidor Final'}</h3>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                    {numeroPedido(v)} · {fmtFecha(v.fecha)} {v.hora || ''}{t ? ` · ${t.nombre}` : ''}
                  </div>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => setPedidoId(null)}>✕</button>
              </div>

              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                {avisoMsg}
                {/* Avance del pedido */}
                {e === 'cancelado' ? (
                  <div><Badge color={est.color} bg={est.bg}>{est.label}</Badge></div>
                ) : (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {FASES.map((f, i) => {
                      const fase = ESTADOS_WEB[f]
                      const hecha = i < idxActual
                      const actual = i === idxActual
                      return (
                        <div key={f} style={{
                          flex: '1 1 130px', padding: '8px 10px', borderRadius: 8, fontSize: 12, fontWeight: 700, textAlign: 'center',
                          background: actual ? fase.bg : hecha ? '#dcfce7' : 'var(--bg-muted)',
                          color: actual ? fase.color : hecha ? '#15803d' : 'var(--text-muted)',
                          border: `2px solid ${actual ? fase.color : 'transparent'}`,
                        }}>
                          {hecha ? '✓ ' : `${i + 1}. `}{fase.label}
                        </div>
                      )
                    })}
                  </div>
                )}

                {e === 'listo' && !v.factura_emitida && (
                  <div style={{ padding: '10px 12px', borderRadius: 8, background: '#ede9fe', color: '#4c1d95', fontSize: 13 }}>
                    El pedido está armado. Ahora podés <strong>facturarlo</strong> y despacharlo.
                  </div>
                )}
                {(e === 'esperando_pago' || e === 'en_preparacion') && (
                  <div style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--bg-muted)', color: 'var(--text-muted)', fontSize: 13 }}>
                    {e === 'esperando_pago'
                      ? 'Falta confirmar el pago (transferencia) antes de empezar a preparar el pedido.'
                      : 'Se factura recién cuando el pedido esté listo para despachar.'}
                  </div>
                )}

                {/* Qué hay que preparar */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>Productos del pedido</div>
                  <ItemsPedido items={itemsPedido[v.id]} grande />
                </div>

                {/* Comprador, pago y (portal mayorista) entrega */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, fontSize: 13 }}>
                  {esMay && (
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Pedido del portal</div>
                      <div style={{ lineHeight: 1.7, color: 'var(--text-muted)' }}>
                        <div>N° <strong style={{ color: 'var(--text)' }}>{v.origen_numero || '—'}</strong></div>
                        <div>Fecha: {fmtFecha(v.fecha)} {v.hora || ''}</div>
                        <div>Estado en el portal: <strong style={{ color: 'var(--text)' }}>{ESTADO_PORTAL[v.origen_estado_portal] || v.origen_estado_portal || '—'}</strong></div>
                      </div>
                    </div>
                  )}
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Comprador</div>
                    <div style={{ lineHeight: 1.7, color: 'var(--text-muted)' }}>
                      {esMay && v.cliente_empresa && <div><strong style={{ color: 'var(--text)' }}>{v.cliente_empresa}</strong> (razón social)</div>}
                      {esMay && v.cliente_dni && <div>DNI: {v.cliente_dni}</div>}
                      {v.cliente_email && <div>{v.cliente_email}</div>}
                      {v.cliente_telefono && <div>{v.cliente_telefono}</div>}
                      {esMay && v.contacto_preferido && <div>Contacto preferido: {v.contacto_preferido}</div>}
                      {!esMay && v.cliente_direccion && <div>{v.cliente_direccion}</div>}
                      {!v.cliente_email && !v.cliente_telefono && !v.cliente_direccion && <div>Sin datos de contacto</div>}
                    </div>
                  </div>
                  {esMay && (
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Entrega</div>
                      <div style={{ lineHeight: 1.7, color: 'var(--text-muted)' }}>
                        <div>{v.cliente_direccion_envio || v.cliente_direccion || 'Sin dirección de entrega'}</div>
                        <div>Logística: <strong style={{ color: 'var(--text)' }}>{v.origen_logistica || '—'}</strong></div>
                        <div>
                          Seguimiento:{' '}
                          {v.origen_tracking
                            ? (v.origen_tracking_url
                                ? <a href={v.origen_tracking_url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 700 }}>{v.origen_tracking}</a>
                                : <strong style={{ color: 'var(--text)' }}>{v.origen_tracking}</strong>)
                            : '—'}
                        </div>
                      </div>
                    </div>
                  )}
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Pago</div>
                    <div style={{ lineHeight: 1.7, color: 'var(--text-muted)' }}>
                      <div>{pagoTexto(v)}</div>
                      <div style={{ fontWeight: 800, fontSize: 18, color: 'var(--text)' }}>{fmtMoney(v.total)}</div>
                      <div style={{ color: v.factura_emitida ? '#15803d' : undefined }}>{v.factura_emitida ? 'Facturada' : 'Sin facturar'}</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="modal-footer" style={{ flexWrap: 'wrap' }}>
                {botonesPedido(v)}
                <button className="btn btn-sm" onClick={() => setDetalleId(v.id)}>{v.factura_emitida ? 'Ver factura' : 'Ver venta'}</button>
                <button className="btn btn-sm" onClick={() => setPedidoId(null)}>Cerrar</button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Despachar un pedido del portal mayorista */}
      {despachoId && (() => {
        const v = ventas.find(x => x.id === despachoId)
        if (!v) return null
        const ocupado = trabajando === v.id
        return (
          <div className="modal-overlay" onClick={(ev) => { if (ev.target === ev.currentTarget && !ocupado) setDespachoId(null) }}>
            <div className="modal" style={{ maxWidth: 460 }}>
              <div className="modal-header">
                <h3 style={{ margin: 0 }}>Despachar pedido</h3>
                <button className="btn btn-ghost btn-sm" disabled={ocupado} onClick={() => setDespachoId(null)}>✕</button>
              </div>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {avisoMsg}
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  {numeroPedido(v)} · {v.cliente_nombre || 'Consumidor Final'}
                  {v.origen_logistica ? ` · ${v.origen_logistica}` : ''}
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 5 }}>
                    N° de seguimiento (opcional)
                  </label>
                  <input className="input" style={{ width: '100%' }} autoFocus value={trackingTxt}
                    onChange={e => setTrackingTxt(e.target.value)} placeholder="Ej: TEST123" />
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none', fontSize: 13 }}>
                  <input type="checkbox" checked={notificarCli} onChange={e => setNotificarCli(e.target.checked)} />
                  Avisar al cliente
                </label>
                {!v.factura_emitida && (
                  <div style={{ padding: '8px 10px', borderRadius: 8, background: '#fef3c7', color: '#78350f', fontSize: 12 }}>
                    Este pedido todavía no está facturado.
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button className="btn" disabled={ocupado} onClick={() => setDespachoId(null)}>Cancelar</button>
                <button className="btn btn-primary" disabled={ocupado} onClick={confirmarDespacho}>
                  {ocupado ? 'Despachando…' : 'Despachar'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {detalleId && (
        <VentaDetalle
          ventaId={detalleId}
          onClose={() => setDetalleId(null)}
          onUpdated={() => cargar(true)}
        />
      )}
    </div>
  )
}
