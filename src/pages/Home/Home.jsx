import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { fmtMoney } from '../../lib/format'

const fmtDate = (d) =>
  d ? new Date(d + 'T00:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) : '—'

const ESTADO_S = {
  pagado:    { color: '#16a34a', bg: '#dcfce7', label: 'Pagado' },
  pendiente: { color: '#d97706', bg: '#fef9c3', label: 'Pendiente' },
  parcial:   { color: '#7c3aed', bg: '#f5f3ff', label: 'Parcial' },
  anulado:   { color: '#64748b', bg: '#f1f5f9', label: 'Anulado' },
}

const FP_LABEL = {
  efectivo:         'Efectivo',
  debito:           'Débito',
  credito:          'Crédito',
  transferencia:    'Transferencia',
  cuenta_corriente: 'Cta. corriente',
}
const FP_COLOR = {
  efectivo:         '#16a34a',
  debito:           '#2563eb',
  credito:          '#7c3aed',
  transferencia:    '#0891b2',
  cuenta_corriente: '#d97706',
}
const FP_ICON = {
  efectivo: '💵', debito: '💳', credito: '💳', transferencia: '🏦', cuenta_corriente: '📒',
}

// ── Sub-componentes ──────────────────────────────────────────────────────────
function Card({ children, style = {} }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, ...style }}>
      {children}
    </div>
  )
}

function CardHeader({ title, sub, action }) {
  return (
    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700 }}>{title}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{sub}</div>}
      </div>
      {action && <div style={{ flexShrink: 0 }}>{action}</div>}
    </div>
  )
}

function KPICard({ icon, label, value, sub, color = 'var(--primary)', badge, badgeOk }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
        <span style={{ fontSize: 20 }}>{icon}</span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color, lineHeight: 1.1 }}>{value}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {sub && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{sub}</span>}
        {badge !== undefined && (
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 8,
            background: badgeOk ? '#dcfce7' : '#fee2e2',
            color:      badgeOk ? '#16a34a' : '#dc2626',
          }}>{badge}</span>
        )}
      </div>
    </div>
  )
}

function BarH({ value, max, color }) {
  return (
    <div style={{ height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden', marginTop: 4 }}>
      <div style={{ height: '100%', width: `${Math.max((value / Math.max(max, 1)) * 100, value > 0 ? 3 : 0)}%`, borderRadius: 3, background: color, transition: 'width 0.6s' }} />
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
export default function Dashboard() {
  const { profile, user } = useAuth()
  const [loading, setLoading]   = useState(true)
  const [kpi,     setKpi]       = useState({})
  const [days30,  setDays30]    = useState([])
  const [days7,   setDays7]     = useState([])
  const [topProd, setTopProd]   = useState([])
  const [pagoList,setPagoList]  = useState([])
  const [horaArr, setHoraArr]   = useState([])
  const [ultimas, setUltimas]   = useState([])
  const [deudas,  setDeudas]    = useState([])

  const hoy       = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` })()
  const mesActual = hoy.slice(0, 7)
  const mesAntStr = (() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1)
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
  })()
  const nombreMes = new Date().toLocaleDateString('es-AR', { month: 'long' })
  const hora      = new Date().getHours()
  const saludo    = hora < 13 ? 'Buenos días' : hora < 20 ? 'Buenas tardes' : 'Buenas noches'

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const hace30 = new Date(); hace30.setDate(hace30.getDate() - 29)
      const desde30 = `${hace30.getFullYear()}-${String(hace30.getMonth()+1).padStart(2,'0')}-${String(hace30.getDate()).padStart(2,'0')}`

      const [v30Res, mesAntRes, cliDeudaRes, prodRes, cliRes] = await Promise.all([
        supabase.from('ventas')
          .select('id, fecha, total, estado, forma_pago, hora, cliente_nombre, comprobante, numero, factura_emitida, venta_items(descripcion, cantidad, subtotal)')
          .gte('fecha', desde30)
          .order('fecha', { ascending: false }),
        supabase.from('ventas').select('total, estado').like('fecha', `${mesAntStr}%`),
        supabase.from('ventas').select('cliente_id, cliente_nombre, total').eq('forma_pago', 'cuenta_corriente').in('estado', ['pendiente', 'parcial']).not('cliente_id', 'is', null),
        supabase.from('productos').select('*', { count: 'exact', head: true }),
        supabase.from('clientes').select('*', { count: 'exact', head: true }),
      ])

      const ventas      = v30Res.data  ?? []
      const ventasOk    = ventas.filter(v => v.estado !== 'anulado')
      // .slice(0,10): cubre tanto 'date' ("2026-04-30") como 'timestamptz' ("2026-04-30T03:00:00+00:00")
      const hoyV        = ventasOk.filter(v => (v.fecha ?? '').slice(0, 10) === hoy)
      const mesV        = ventasOk.filter(v => (v.fecha ?? '').slice(0, 7) === mesActual)
      const pendV       = ventas.filter(v => v.estado === 'pendiente')
      const mesAntV     = (mesAntRes.data ?? []).filter(v => v.estado !== 'anulado')

      // ── KPI ────────────────────────────────────────────────────────────────
      const hoyTotal    = hoyV.reduce((s, v) => s + (v.total ?? 0), 0)
      const mesTotal    = mesV.reduce((s, v) => s + (v.total ?? 0), 0)
      const mesAntTotal = mesAntV.reduce((s, v) => s + (v.total ?? 0), 0)
      const pendTotal   = pendV.reduce((s, v) => s + (v.total ?? 0), 0)
      const ticketProm  = mesV.length > 0 ? mesTotal / mesV.length : 0
      const varPct      = mesAntTotal > 0 ? ((mesTotal - mesAntTotal) / mesAntTotal) * 100 : null

      // ── Facturación ARCA ───────────────────────────────────────────────────
      const facturadoMes   = mesV.filter(v => v.factura_emitida)
      const facturadoTotal = facturadoMes.reduce((s, v) => s + (v.total ?? 0), 0)
      const sinFacturar    = mesV.filter(v => !v.factura_emitida).length

      setKpi({
        hoyTotal, hoyCount: hoyV.length,
        mesTotal, mesCount: mesV.length,
        pendTotal, pendCount: pendV.length,
        mesAntTotal, ticketProm,
        varPct,
        productos: prodRes.count ?? 0,
        clientes:  cliRes.count  ?? 0,
        facturadoCount: facturadoMes.length,
        facturadoTotal,
        sinFacturar,
      })

      // ── Últimas 8 ventas ───────────────────────────────────────────────────
      setUltimas(ventas.slice(0, 8))

      // helper: fecha local sin bug UTC
      const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`

      // ── Tendencia 30 días ─────────────────────────────────────────────────
      const d30 = []
      for (let i = 29; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i)
        const iso = isoLocal(d)
        const dV  = ventasOk.filter(v => (v.fecha ?? '').slice(0, 10) === iso)
        d30.push({
          iso,
          label: d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }),
          total: dV.reduce((s, v) => s + (v.total ?? 0), 0),
          count: dV.length,
          esHoy: i === 0,
        })
      }
      setDays30(d30)

      // ── Semana (últimos 7 días) ────────────────────────────────────────────
      const diaSemana = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb']
      const d7 = []
      for (let i = 6; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i)
        const iso = isoLocal(d)
        const dV  = ventasOk.filter(v => (v.fecha ?? '').slice(0, 10) === iso)
        d7.push({
          iso,
          label: i === 0 ? 'Hoy' : diaSemana[d.getDay()],
          total: dV.reduce((s, v) => s + (v.total ?? 0), 0),
          count: dV.length,
          esHoy: i === 0,
        })
      }
      setDays7(d7)

      // ── Top productos ─────────────────────────────────────────────────────
      const prodMap = {}
      for (const v of ventasOk) {
        for (const it of (v.venta_items ?? [])) {
          const key = it.descripcion ?? '—'
          if (!prodMap[key]) prodMap[key] = { nombre: key, cantidad: 0, total: 0 }
          prodMap[key].cantidad += Number(it.cantidad) || 0
          prodMap[key].total    += Number(it.subtotal)  || 0
        }
      }
      setTopProd(
        Object.values(prodMap).sort((a, b) => b.total - a.total).slice(0, 7)
      )

      // ── Formas de pago (mes actual) ───────────────────────────────────────
      const pagoMap = {}
      for (const v of mesV) {
        const fp = v.forma_pago ?? 'otro'
        if (!pagoMap[fp]) pagoMap[fp] = { count: 0, total: 0 }
        pagoMap[fp].count++
        pagoMap[fp].total += v.total ?? 0
      }
      setPagoList(
        Object.entries(pagoMap)
          .map(([fp, d]) => ({ fp, ...d }))
          .sort((a, b) => b.total - a.total)
      )

      // ── Actividad por hora (hoy, franjas 7-20) ────────────────────────────
      const h14 = Array.from({ length: 14 }, (_, i) => ({ h: i + 7, total: 0, count: 0 }))
      for (const v of hoyV) {
        if (!v.hora) continue
        const h = parseInt(v.hora.split(':')[0], 10)
        const s = h14.find(x => x.h === h)
        if (s) { s.total += v.total ?? 0; s.count++ }
      }
      setHoraArr(h14)

      // ── Clientes en deuda ─────────────────────────────────────────────────
      // Agrupar ventas CC pendientes/parciales por cliente
      const ccMap = {}
      for (const v of (cliDeudaRes.data ?? [])) {
        const id = v.cliente_id
        if (!ccMap[id]) ccMap[id] = { nombre: v.cliente_nombre || 'Sin nombre', saldo: 0 }
        ccMap[id].saldo -= v.total ?? 0  // negativo = debe
      }
      setDeudas(
        Object.values(ccMap)
          .sort((a, b) => a.saldo - b.saldo)   // más deuda primero
          .slice(0, 6)
      )

      setLoading(false)
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', flexDirection: 'column', gap: 14, color: 'var(--text-muted)' }}>
      <div style={{ fontSize: 40 }}>📊</div>
      <div style={{ fontSize: 14, fontWeight: 600 }}>Cargando dashboard...</div>
    </div>
  )

  const maxDay30 = Math.max(...days30.map(d => d.total), 1)
  const maxDay7  = Math.max(...days7.map(d => d.total), 1)
  const maxProd  = topProd.length  > 0 ? topProd[0].total   : 1
  const maxPago  = pagoList.length > 0 ? pagoList[0].total  : 1
  const maxHora  = Math.max(...horaArr.map(h => h.total), 1)

  const varOk    = (kpi.varPct ?? 0) >= 0
  const varLabel = kpi.varPct === null ? null
    : `${varOk ? '▲' : '▼'} ${Math.abs(kpi.varPct).toFixed(1)}% vs ${mesAntStr.slice(5) === mesActual.slice(5) ? 'mes ant.' : 'mes ant.'}`

  const horaPico = horaArr.reduce((mx, h) => h.total > mx.total ? h : mx, horaArr[0] ?? { h: '—', total: 0 })
  const totalDeuda = deudas.reduce((s, c) => s + Math.abs(c.saldo || 0), 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── Encabezado ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 3 }}>
            {saludo}, {(profile?.nombre || user?.email || '').split(' ')[0]} 👋
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            {new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <Link to="/ventas" style={{ padding: '9px 18px', background: 'var(--primary)', color: 'white', borderRadius: 7, fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
          🛒 Ir al punto de venta
        </Link>
      </div>

      {/* ── KPIs ─────────────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: 12 }}>
        <KPICard
          icon="📅" label="Ventas hoy"
          value={kpi.hoyCount}
          sub={kpi.hoyCount > 0 ? fmtMoney(kpi.hoyTotal) : 'Sin ventas aún'}
          color="var(--primary)"
        />
        <KPICard
          icon="📆" label={`Facturación ${nombreMes}`}
          value={fmtMoney(kpi.mesTotal)}
          sub={`${kpi.mesCount} ventas`}
          badge={varLabel}
          badgeOk={varOk}
          color="#0891b2"
        />
        <KPICard
          icon="🧾" label="Ticket promedio"
          value={fmtMoney(kpi.ticketProm)}
          sub={`Este mes · ${kpi.mesCount} ventas`}
          color="#7c3aed"
        />
        <KPICard
          icon="⏳" label="Pendientes de cobro"
          value={kpi.pendCount}
          sub={kpi.pendCount > 0 ? fmtMoney(kpi.pendTotal) : 'Todo cobrado ✓'}
          color={kpi.pendCount > 0 ? '#d97706' : '#16a34a'}
        />
        <KPICard
          icon="📦" label="Catálogo"
          value={kpi.productos}
          sub={`${kpi.clientes} clientes registrados`}
          color="#475569"
        />
        <KPICard
          icon="🏛️" label={`Facturado ARCA ${nombreMes}`}
          value={fmtMoney(kpi.facturadoTotal ?? 0)}
          sub={kpi.facturadoCount > 0
            ? `${kpi.facturadoCount} factura${kpi.facturadoCount !== 1 ? 's' : ''} · ${kpi.sinFacturar} sin facturar`
            : 'Sin facturas emitidas este mes'}
          color="#1d4ed8"
        />
      </div>

      {/* ── Fila 2: tendencia 30 días + top productos ────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>

        {/* Tendencia 30 días */}
        <Card>
          <CardHeader
            title="📈 Tendencia — últimos 30 días"
            sub={`${days30.reduce((s, d) => s + d.count, 0)} ventas · ${fmtMoney(days30.reduce((s, d) => s + d.total, 0))}`}
          />
          <div style={{ padding: '14px 16px 10px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 80 }}>
              {days30.map(d => {
                const pct = (d.total / maxDay30) * 100
                return (
                  <div key={d.iso} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}
                    title={`${d.label}: ${fmtMoney(d.total)} (${d.count} venta${d.count !== 1 ? 's' : ''})`}>
                    <div style={{
                      width: '100%',
                      height: `${Math.max(pct, d.total > 0 ? 5 : 2)}%`,
                      minHeight: 2,
                      borderRadius: '2px 2px 0 0',
                      background: d.esHoy ? 'var(--primary)' : d.total > 0 ? '#93c5fd' : '#e2e8f0',
                      transition: 'height 0.4s',
                    }} />
                  </div>
                )
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5, fontSize: 10, color: 'var(--text-muted)' }}>
              <span>{days30[0]?.label}</span>
              <span>{days30[14]?.label}</span>
              <span style={{ color: 'var(--primary)', fontWeight: 700 }}>Hoy</span>
            </div>
          </div>
        </Card>

        {/* Top productos */}
        <Card>
          <CardHeader title="🏆 Top productos" sub="Últimos 30 días · por facturación" />
          <div style={{ padding: '10px 16px 14px', display: 'flex', flexDirection: 'column', gap: 9 }}>
            {topProd.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: '20px 0' }}>Sin datos en el período</div>
            ) : topProd.map((p, i) => (
              <div key={p.nombre}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                    <span style={{
                      fontSize: 11, fontWeight: 800, minWidth: 18,
                      color: i === 0 ? '#f59e0b' : i === 1 ? '#94a3b8' : i === 2 ? '#b45309' : 'var(--text-muted)',
                    }}>#{i + 1}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nombre}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 10, fontSize: 12, flexShrink: 0 }}>
                    <span style={{ color: 'var(--text-muted)' }}>×{p.cantidad}</span>
                    <span style={{ fontWeight: 700, color: 'var(--primary)' }}>{fmtMoney(p.total)}</span>
                  </div>
                </div>
                <BarH value={p.total} max={maxProd} color={i === 0 ? 'var(--primary)' : i === 1 ? '#60a5fa' : '#93c5fd'} />
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* ── Fila 3: semana + formas de pago + actividad por hora ─────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>

        {/* Semana actual */}
        <Card>
          <CardHeader title="📊 Esta semana" sub="Últimos 7 días" />
          <div style={{ padding: '14px 16px 10px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 72 }}>
              {days7.map(d => {
                const pct = (d.total / maxDay7) * 100
                return (
                  <div key={d.iso} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}
                    title={`${d.label}: ${fmtMoney(d.total)}`}>
                    <div style={{
                      width: '100%',
                      height: `${Math.max(pct, d.total > 0 ? 8 : 3)}%`,
                      minHeight: 3,
                      borderRadius: '3px 3px 0 0',
                      background: d.esHoy ? 'var(--primary)' : d.total > 0 ? '#bfdbfe' : '#e2e8f0',
                      transition: 'height 0.4s',
                    }} />
                    <div style={{ fontSize: 10, color: d.esHoy ? 'var(--primary)' : 'var(--text-muted)', fontWeight: d.esHoy ? 700 : 400, whiteSpace: 'nowrap' }}>
                      {d.label}
                    </div>
                  </div>
                )
              })}
            </div>
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span style={{ color: 'var(--text-muted)' }}>{days7.reduce((s, d) => s + d.count, 0)} ventas</span>
              <span style={{ fontWeight: 700, color: 'var(--primary)' }}>{fmtMoney(days7.reduce((s, d) => s + d.total, 0))}</span>
            </div>
          </div>
        </Card>

        {/* Formas de pago */}
        <Card>
          <CardHeader title="💳 Formas de pago" sub={`${nombreMes} · ${kpi.mesCount} ventas`} />
          <div style={{ padding: '10px 16px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {pagoList.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: '16px 0' }}>Sin ventas este mes</div>
            ) : pagoList.map(p => (
              <div key={p.fp}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{FP_ICON[p.fp] ?? '💰'} {FP_LABEL[p.fp] ?? p.fp}</span>
                  <div style={{ display: 'flex', gap: 10, fontSize: 12 }}>
                    <span style={{ color: 'var(--text-muted)' }}>{p.count} ventas</span>
                    <span style={{ fontWeight: 700 }}>{fmtMoney(p.total)}</span>
                  </div>
                </div>
                <BarH value={p.total} max={maxPago} color={FP_COLOR[p.fp] ?? '#94a3b8'} />
              </div>
            ))}
          </div>
        </Card>

        {/* Actividad por hora */}
        <Card>
          <CardHeader title="🕐 Actividad por hora" sub="Ventas de hoy por franja" />
          <div style={{ padding: '14px 16px 10px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 72 }}>
              {horaArr.map(slot => {
                const pct    = (slot.total / maxHora) * 100
                const activo = new Date().getHours() === slot.h
                return (
                  <div key={slot.h} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}
                    title={`${slot.h}hs: ${fmtMoney(slot.total)}`}>
                    <div style={{
                      width: '100%',
                      height: `${Math.max(pct, slot.total > 0 ? 8 : 3)}%`,
                      minHeight: 3,
                      borderRadius: '2px 2px 0 0',
                      background: activo ? 'var(--primary)' : slot.total > 0 ? '#34d399' : '#e2e8f0',
                      transition: 'height 0.4s',
                    }} />
                  </div>
                )
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5, fontSize: 10, color: 'var(--text-muted)' }}>
              <span>7hs</span><span>13hs</span><span>20hs</span>
            </div>
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span style={{ color: 'var(--text-muted)' }}>
                {horaArr.some(h => h.total > 0) ? `Pico: ${horaPico.h}hs` : 'Sin ventas aún'}
              </span>
              <span style={{ fontWeight: 700, color: '#059669' }}>{fmtMoney(horaArr.reduce((s, h) => s + h.total, 0))}</span>
            </div>
          </div>
        </Card>
      </div>

      {/* ── Fila 4: últimas ventas + clientes con deuda ──────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>

        {/* Últimas ventas */}
        <Card style={{ overflow: 'hidden' }}>
          <CardHeader
            title="🧾 Últimas ventas"
            sub="Más recientes primero"
            action={<Link to="/ventas?historial=1" style={{ fontSize: 12, color: 'var(--primary)', fontWeight: 600, textDecoration: 'none' }}>Ver todas →</Link>}
          />
          {ultimas.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>🛒</div>Sin ventas recientes
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Fecha', 'Cliente', 'Pago', 'Total', 'Estado'].map((h, i) => (
                    <th key={h} style={{ padding: '7px 12px', textAlign: i === 3 ? 'right' : 'left', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ultimas.map((v, i) => {
                  const est = ESTADO_S[v.estado] ?? ESTADO_S.pendiente
                  return (
                    <tr key={v.id} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 1 ? 'var(--bg)' : undefined }}>
                      <td style={{ padding: '8px 12px', color: 'var(--text-muted)', whiteSpace: 'nowrap', fontSize: 12 }}>
                        {fmtDate(v.fecha)}
                      </td>
                      <td style={{ padding: '8px 12px', fontWeight: 500, maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {v.cliente_nombre ?? 'Consumidor Final'}
                      </td>
                      <td style={{ padding: '8px 12px', color: 'var(--text-muted)', fontSize: 12, whiteSpace: 'nowrap' }}>
                        {FP_LABEL[v.forma_pago] ?? '—'}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: 'var(--primary)', whiteSpace: 'nowrap' }}>
                        {fmtMoney(v.total)}
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 8, background: est.bg, color: est.color, whiteSpace: 'nowrap' }}>
                          {est.label}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </Card>

        {/* Clientes con deuda (cuentas corrientes) */}
        <Card>
          <CardHeader
            title="⚠️ Cuentas corrientes pendientes"
            sub={deudas.length > 0 ? `${deudas.length} cliente${deudas.length !== 1 ? 's' : ''} · ${fmtMoney(totalDeuda)} total` : undefined}
          />
          {deudas.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', fontSize: 13 }}>
              <div style={{ fontSize: 30, marginBottom: 8 }}>✅</div>
              <div style={{ color: '#16a34a', fontWeight: 600 }}>Todos los clientes al día</div>
            </div>
          ) : (
            <div style={{ padding: '4px 16px 12px' }}>
              {deudas.map((c, i) => (
                <div key={c.nombre} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: i < deudas.length - 1 ? '1px solid var(--border)' : undefined }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#fee2e2', color: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, flexShrink: 0 }}>
                      {c.nombre.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{c.nombre}</div>
                      <div style={{ fontSize: 11, color: '#dc2626' }}>Debe cobrar</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#dc2626' }}>
                    {fmtMoney(Math.abs(c.saldo))}
                  </div>
                </div>
              ))}
              {deudas.length > 0 && (
                <div style={{ paddingTop: 10, display: 'flex', justifyContent: 'space-between', fontSize: 12, borderTop: '2px solid var(--border)', marginTop: 2 }}>
                  <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Total a cobrar</span>
                  <span style={{ fontWeight: 800, color: '#dc2626' }}>{fmtMoney(totalDeuda)}</span>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* ── Accesos rápidos ──────────────────────────────────────────────────── */}
      <Card style={{ padding: '14px 18px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Accesos rápidos</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {[
            { to: '/ventas',        icon: '🛒', label: 'Nueva venta',    primary: true },
            { to: '/productos',     icon: '📦', label: 'Productos' },
            { to: '/presupuesto',   icon: '📄', label: 'Presupuesto' },
            { to: '/clientes',      icon: '👥', label: 'Clientes' },
            { to: '/configuracion', icon: '⚙️', label: 'Configuración' },
          ].map(a => (
            <Link key={a.to} to={a.to} style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '8px 16px', borderRadius: 7,
              background: a.primary ? 'var(--primary)' : 'var(--bg)',
              border: `1px solid ${a.primary ? 'var(--primary)' : 'var(--border)'}`,
              color: a.primary ? 'white' : 'var(--text)',
              fontSize: 13, fontWeight: 600, textDecoration: 'none',
            }}>
              {a.icon} {a.label}
            </Link>
          ))}
        </div>
      </Card>

    </div>
  )
}
