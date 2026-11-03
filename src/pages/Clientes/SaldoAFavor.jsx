import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { fmtMoney } from '../../lib/format'

const redondear = (n) => Math.round((Number(n) || 0) * 100) / 100
const hoy = () => new Date().toLocaleDateString('en-CA')
const fmtFecha = (d) => new Date(String(d).slice(0, 10) + 'T12:00:00').toLocaleDateString('es-AR')

/** Saldo a favor de un cliente: lo que tiene para usar, con cada carga y cada uso con su motivo. */
export default function SaldoAFavor({ cliente, onCambio }) {
  const { orgId } = useAuth()
  const [movs, setMovs] = useState(null)
  const [falta, setFalta] = useState(false)
  const [form, setForm] = useState(null)     // { signo: 1 | -1, importe, motivo, fecha }
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  const cargar = useCallback(async () => {
    const { data, error: e } = await supabase.from('cliente_saldos').select('*').eq('cliente_id', cliente.id).order('fecha', { ascending: false }).order('created_at', { ascending: false })
    if (e) { setFalta(true); return }
    setMovs(data ?? [])
  }, [cliente.id])
  useEffect(() => { cargar() }, [cargar])

  if (falta) return <div style={{ fontSize: 12, color: '#92400e' }}>Para usar el saldo a favor falta correr supabase_saldo_a_favor.sql en Supabase.</div>
  if (!movs) return <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Cargando…</div>

  const saldo = redondear(movs.reduce((a, m) => a + Number(m.importe), 0))
  const abrir = (signo) => { setForm({ signo, importe: '', motivo: '', fecha: hoy() }); setError('') }

  const guardar = async () => {
    const importe = redondear(form.importe)
    if (importe <= 0) return setError('Escribí un importe mayor a cero.')
    if (!form.motivo.trim()) return setError(form.signo > 0 ? 'Contá de dónde sale el saldo (ej: pagó de más en la venta 1042).' : 'Contá en qué se usó (ej: descontado en la venta 1050).')
    if (form.signo < 0 && importe > saldo) return setError(`No puede superar el saldo a favor (${fmtMoney(saldo)}).`)
    setGuardando(true)
    const { error: e } = await supabase.from('cliente_saldos').insert({ org_id: orgId, cliente_id: cliente.id, fecha: form.fecha, importe: form.signo * importe, motivo: form.motivo.trim() })
    setGuardando(false)
    if (e) return setError('No se pudo guardar: ' + e.message)
    setForm(null)
    await cargar()
    onCambio?.()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: saldo > 0 ? '#15803d' : 'var(--text)' }}>{fmtMoney(saldo)}</span>
        {!form && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-sm" onClick={() => abrir(1)}>+ Cargar</button>
            <button className="btn btn-sm" onClick={() => abrir(-1)} disabled={saldo <= 0}>− Usar o devolver</button>
          </div>
        )}
      </div>

      {form && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{form.signo > 0 ? 'Cargar saldo a favor' : 'Usar o devolver saldo a favor'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <input className="input" type="number" min={0} step="0.01" placeholder="Importe" aria-label="Importe" value={form.importe} onChange={(e) => setForm((f) => ({ ...f, importe: e.target.value }))} />
            <input className="input" type="date" aria-label="Fecha" value={form.fecha} onChange={(e) => setForm((f) => ({ ...f, fecha: e.target.value }))} />
          </div>
          <input className="input" aria-label="Motivo" placeholder={form.signo > 0 ? 'Motivo (ej: pagó de más en la venta 1042)' : 'Motivo (ej: descontado en la venta 1050)'} value={form.motivo} onChange={(e) => setForm((f) => ({ ...f, motivo: e.target.value }))} />
          <div style={{ fontSize: 12, color: '#92400e' }}>El cliente ve este motivo en su panel: no escribas notas internas.</div>
          {error && <div style={{ fontSize: 12, color: '#dc2626' }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-sm" onClick={() => setForm(null)} disabled={guardando}>Cancelar</button>
            <button className="btn btn-sm btn-primary" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </div>
      )}

      {movs.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {movs.map((m) => (
            <div key={m.id} style={{ display: 'flex', gap: 8, fontSize: 13, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{fmtFecha(m.fecha)}</span>
              <span style={{ flex: 1, minWidth: 0 }}>{m.motivo}</span>
              <strong style={{ whiteSpace: 'nowrap', color: m.importe > 0 ? '#15803d' : '#b45309' }}>{m.importe > 0 ? '+' : '−'}{fmtMoney(Math.abs(m.importe))}</strong>
            </div>
          ))}
          <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>Los movimientos no se borran: un error se corrige con otro en sentido contrario.</p>
        </div>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No tiene saldo a favor cargado.</div>
      )}
    </div>
  )
}
