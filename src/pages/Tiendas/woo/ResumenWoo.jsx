// Resumen de ventas de la tienda a partir de los pedidos de WooCommerce.
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { fmtMoney } from '../../../lib/format'
import { resumirVentas, estadoWooInfo, diaAR } from '../../../lib/wooPanel'
import { Aviso, Kpi, Tarjeta, Vacio } from './ui'

const DIAS = 30

export default function ResumenWoo({ tienda }) {
  const [filas, setFilas] = useState(null)
  const [error, setError] = useState('')
  const [ahora] = useState(() => Date.now())   // fecha de referencia fija durante la vida de la pantalla

  useEffect(() => {
    let vivo = true
    ;(async () => {
      const desde = new Date(ahora - 90 * 86400000).toISOString()
      const { data, error: e } = await supabase.from('pedidos_web')
        .select('estado, total, fecha_creado, items:datos->line_items')
        .eq('tienda_id', tienda.id).gte('fecha_creado', desde).limit(5000)
      if (!vivo) return
      setError(e?.message || '')
      setFilas(data || [])
    })()
    return () => { vivo = false }
  }, [tienda.id, ahora])

  const r = useMemo(() => (filas ? resumirVentas(filas) : null), [filas])

  const barras = useMemo(() => {
    if (!r) return []
    const out = []
    for (let i = DIAS - 1; i >= 0; i--) {
      const dia = diaAR(new Date(ahora - i * 86400000).toISOString())
      out.push({ dia, monto: r.dias[dia] || 0 })
    }
    return out
  }, [r, ahora])

  if (error) return <Aviso tipo="aviso">{/pedidos_web/.test(error) ? <>Falta correr <strong>supabase_woo_panel.sql</strong> en Supabase (SQL Editor).</> : error}</Aviso>
  if (!r) return <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>Cargando resumen…</div>
  if (!filas.length) return <Vacio>Todavía no hay pedidos de los últimos 90 días para resumir.</Vacio>

  const maximo = Math.max(1, ...barras.map(b => b.monto))
  const totalPorEstado = Object.entries(r.porEstado).sort((a, b) => b[1] - a[1])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Kpi label="Ventas de hoy" value={fmtMoney(r.montoHoy)} sub={`${r.cuentaHoy} pedido${r.cuentaHoy !== 1 ? 's' : ''}`} />
        <Kpi label="Ventas del mes" value={fmtMoney(r.montoMes)} sub={`${r.cuentaMes} pedido${r.cuentaMes !== 1 ? 's' : ''}`} color="var(--primary)" />
        <Kpi label="Últimos 90 días" value={fmtMoney(r.monto)} sub={`${r.cuenta} pedidos · ticket ${fmtMoney(r.ticket)}`} />
        <Kpi label="Esperando pago" value={r.esperando} sub={r.esperando ? fmtMoney(r.esperandoMonto) : 'nada pendiente'} color={r.esperando ? '#b45309' : undefined} />
      </div>

      <Tarjeta titulo={`Ventas por día (últimos ${DIAS} días)`}>
        <div role="img" aria-label="Gráfico de ventas por día" style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 120 }}>
          {barras.map(b => (
            <div key={b.dia} title={`${b.dia.split('-').reverse().join('/')} · ${fmtMoney(b.monto)}`}
              style={{ flex: 1, minWidth: 4, height: `${Math.max(b.monto ? 4 : 1, (b.monto / maximo) * 100)}%`, background: b.monto ? 'var(--primary)' : 'var(--border)', borderRadius: '3px 3px 0 0' }} />
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
          <span>{barras[0]?.dia.split('-').reverse().join('/')}</span><span>hoy</span>
        </div>
      </Tarjeta>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
        <Tarjeta titulo="Pedidos por estado (90 días)">
          {totalPorEstado.map(([e, n]) => {
            const i = estadoWooInfo(e)
            return (
              <div key={e} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 13 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: i.color }} />
                <span style={{ flex: 1 }}>{i.label}</span><strong>{n}</strong>
              </div>
            )
          })}
        </Tarjeta>
        <Tarjeta titulo="Productos más vendidos (90 días)">
          {r.top.length === 0 ? <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Sin ventas.</div> : r.top.map(p => (
            <div key={p.nombre} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 13 }}>
              {p.imagen ? <img src={p.imagen} alt="" style={{ width: 30, height: 30, borderRadius: 5, objectFit: 'cover' }} /> : <span style={{ width: 30 }} />}
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nombre}</span>
              <strong>{p.cantidad}</strong><span style={{ fontSize: 11, color: 'var(--text-muted)', minWidth: 78, textAlign: 'right' }}>{fmtMoney(p.total)}</span>
            </div>
          ))}
        </Tarjeta>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        Cuentan como venta los pedidos en espera de transferencia, procesando y completados. No suman los pendientes de pago, cancelados, fallidos ni reembolsados.
      </div>
    </div>
  )
}
