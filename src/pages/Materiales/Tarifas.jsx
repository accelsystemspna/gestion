import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fmtMoney, padId } from '../../lib/format'

const TIPOS = ['Láser', 'Impresión 3D', 'Otro']
const blank = { nombre: '', tipo: 'Láser', costo_hora: 0, notas: '' }

export default function Tarifas() {
  const [items, setItems] = useState([])
  const [editing, setEditing] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('tarifas').select('*').order('id')
    setItems(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const handleSave = async (form) => {
    const payload = {
      nombre: form.nombre,
      tipo: form.tipo,
      costo_hora: Number(form.costo_hora) || 0,
      notas: form.notas || null,
    }
    const res = form.id
      ? await supabase.from('tarifas').update(payload).eq('id', form.id)
      : await supabase.from('tarifas').insert(payload)
    if (res.error) return alert('Error: ' + res.error.message)
    setEditing(null)
    load()
  }

  const handleDelete = async (id) => {
    if (!confirm('¿Eliminar esta tarifa?')) return
    const { error } = await supabase.from('tarifas').delete().eq('id', id)
    if (error) alert('Error: ' + error.message)
    else load()
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14, alignItems: 'center' }}>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>
          Tarifas de fabricación: corte, impresión 3D, etc. Se cobran por hora de trabajo.
        </p>
        <button className="btn btn-primary btn-sm" onClick={() => setEditing({ ...blank })}>+ Nueva tarifa</button>
      </div>

      {loading ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>Cargando...</div>
      ) : items.length === 0 ? (
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)', border: '1px dashed var(--border)', borderRadius: 8 }}>
          No hay tarifas cargadas.
        </div>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
          <table className="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Nombre</th>
                <th>Tipo</th>
                <th>Costo/hora</th>
                <th>Notas</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id}>
                  <td><code>{padId(t.id)}</code></td>
                  <td><strong>{t.nombre}</strong></td>
                  <td><span className="badge">{t.tipo}</span></td>
                  <td>{fmtMoney(t.costo_hora)}</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t.notas || '—'}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn btn-sm btn-ghost" onClick={() => setEditing(t)}>Editar</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => handleDelete(t.id)} style={{ color: 'var(--danger)' }}>Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && <TarifaForm initial={editing} onCancel={() => setEditing(null)} onSave={handleSave} />}
    </div>
  )
}

function TarifaForm({ initial, onCancel, onSave }) {
  const [form, setForm] = useState(initial)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onCancel])

  const es3D = form.tipo === 'Impresión 3D'

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: es3D ? 800 : 460, width: '100%' }}>
        <div className="modal-header">
          <h3 style={{ fontSize: 16 }}>{form.id ? `Editar tarifa ${padId(form.id)}` : 'Nueva tarifa'}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onCancel}>✕</button>
        </div>

        <div className="modal-body" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Fila superior compacta */}
          <div style={{ display: 'grid', gridTemplateColumns: es3D ? '2fr 1fr' : '2fr 1fr', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Nombre</label>
              <input className="input" placeholder="ej: Impresora Ender 3" value={form.nombre} onChange={(e) => set('nombre', e.target.value)} style={{ fontSize: 14 }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tipo</label>
              <select className="select" value={form.tipo} onChange={(e) => set('tipo', e.target.value)} style={{ fontSize: 14 }}>
                {TIPOS.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
          </div>

          {/* Costo/hora: solo visible si NO es 3D */}
          <div style={{ display: 'grid', gridTemplateColumns: es3D ? '1fr' : '1fr 1fr', gap: 12 }}>
            {!es3D && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Costo / hora</label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: 'var(--text-muted)' }}>$</span>
                  <input className="input" type="number" step="0.01" value={form.costo_hora}
                    onChange={(e) => set('costo_hora', e.target.value)}
                    style={{ paddingLeft: 22, fontSize: 14, fontWeight: 600 }} />
                </div>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Notas</label>
              <input className="input" placeholder="Opcional" value={form.notas || ''} onChange={(e) => set('notas', e.target.value)} style={{ fontSize: 13 }} />
            </div>
          </div>

          {/* Calculadora integrada — solo para Impresión 3D */}
          {es3D && (
            <CalculadoraInline onAplicar={(costo) => set('costo_hora', parseFloat(costo.toFixed(2)))} />
          )}
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onCancel}>Cancelar</button>
          <button className="btn btn-primary" onClick={() => onSave(form)} disabled={!form.nombre}>Guardar tarifa</button>
        </div>
      </div>
    </div>
  )
}

// ─── Calculadora embebida ────────────────────────────────────────────────────
// Definidos FUERA del componente para que React no los desmonte en cada render
function CalcField({ label, unit, hint, value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid #f1f5f9' }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, color: '#374151' }}>{label}</div>
        {hint && <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 1 }}>{hint}</div>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
        <span style={{ fontSize: 11, color: '#9ca3af', minWidth: 14, textAlign: 'right' }}>{unit}</span>
        <input
          type="number" step="any" min="0"
          value={value}
          onChange={onChange}
          style={{ width: 96, padding: '4px 8px', fontSize: 13, textAlign: 'right', border: '1px solid #e5e7eb', borderRadius: 6, outline: 'none', background: 'white' }}
          onFocus={e => e.target.style.borderColor = '#3b82f6'}
          onBlur={e  => e.target.style.borderColor = '#e5e7eb'}
        />
      </div>
    </div>
  )
}

function CalcDesglose({ label, value, bold, divider }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderTop: divider ? '1px solid rgba(255,255,255,0.15)' : 'none', marginTop: divider ? 6 : 0 }}>
      <span style={{ fontSize: bold ? 13 : 12, fontWeight: bold ? 700 : 400, color: bold ? 'white' : 'rgba(255,255,255,0.7)' }}>{label}</span>
      <span style={{ fontSize: bold ? 14 : 12, fontWeight: bold ? 700 : 500, color: 'white', fontFamily: 'monospace' }}>{fmtMoney(value)}</span>
    </div>
  )
}

const calcBlank = { kwh: '', costo: '', vidaUtil: '', consumo: '', repuestos: '', margen: '10' }

function CalculadoraInline({ onAplicar }) {
  const [c, setC] = useState(calcBlank)
  const set = (k, v) => setC(f => ({ ...f, [k]: v }))
  const n = (v) => Number(v) || 0

  const r = useMemo(() => {
    const amort    = n(c.vidaUtil) > 0 ? n(c.costo)     / n(c.vidaUtil) : 0
    const electr   = n(c.vidaUtil) > 0 ? (n(c.consumo) / 1000) * n(c.kwh) : 0
    const rep      = n(c.vidaUtil) > 0 ? n(c.repuestos) / n(c.vidaUtil) : 0
    const subtotal = amort + electr + rep
    const total    = subtotal * (1 + n(c.margen) / 100)
    return { amort, electr, rep, subtotal, total }
  }, [c])

  const listo = r.total > 0

  return (
    <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid #e5e7eb', marginTop: 4 }}>

      {/* Header */}
      <div style={{ background: '#0f2744', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 16 }}>🖨️</span>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'white' }}>Calculadora de costo horario</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 1 }}>Los valores se actualizan en tiempo real</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '55% 45%' }}>

        {/* ── Columna inputs ── */}
        <div style={{ padding: '14px 16px', background: '#fafafa', borderRight: '1px solid #e5e7eb' }}>

          {/* Gastos fijos */}
          <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>⚡ Gastos fijos</div>
          <CalcField label="Precio del kWh" unit="$" hint="Tarifa eléctrica actual" value={c.kwh} onChange={e => set('kwh', e.target.value)} />

          {/* Impresora */}
          <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.07em', marginTop: 14, marginBottom: 6 }}>🖨️ Impresora</div>
          <CalcField label="Costo de la impresora"  unit="$"  hint="Precio de compra"        value={c.costo}     onChange={e => set('costo',     e.target.value)} />
          <CalcField label="Vida útil estimada"      unit="hs" hint="Horas de uso total"      value={c.vidaUtil}  onChange={e => set('vidaUtil',  e.target.value)} />
          <CalcField label="Consumo real por hora"   unit="W"  hint="Ver etiqueta o manual"   value={c.consumo}   onChange={e => set('consumo',   e.target.value)} />
          <CalcField label="Repuestos y consumibles" unit="$"  hint="Boquillas, cama, correas…" value={c.repuestos} onChange={e => set('repuestos', e.target.value)} />
          <CalcField label="Margen de imprevistos"   unit="%"  value={c.margen}   onChange={e => set('margen',    e.target.value)} />
        </div>

        {/* ── Columna resultado ── */}
        <div style={{ background: '#1e3a5f', padding: '14px 16px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Desglose / hora</div>

          <CalcDesglose label="Amortización" value={r.amort} />
          <CalcDesglose label="Electricidad"  value={r.electr} />
          <CalcDesglose label="Repuestos"     value={r.rep} />
          <CalcDesglose label="Subtotal"      value={r.subtotal} bold divider />
          <CalcDesglose label={`Margen +${n(c.margen)}%`} value={r.total - r.subtotal} />

          {/* Total */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', marginTop: 12 }}>
            <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: 8, padding: '12px', textAlign: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 4 }}>Costo total / hora</div>
              <div style={{ fontSize: 26, fontWeight: 900, color: listo ? '#fbbf24' : 'rgba(255,255,255,0.2)', lineHeight: 1 }}>
                {listo ? fmtMoney(r.total) : '—'}
              </div>
            </div>

            <button
              onClick={() => listo && onAplicar(r.total)}
              disabled={!listo}
              style={{
                padding: '9px 12px', borderRadius: 7, border: 'none',
                cursor: listo ? 'pointer' : 'not-allowed',
                background: listo ? '#f59e0b' : 'rgba(255,255,255,0.08)',
                color: listo ? '#0f2744' : 'rgba(255,255,255,0.25)',
                fontWeight: 800, fontSize: 12, transition: 'opacity 0.15s',
              }}
            >
              {listo ? `↑ Usar ${fmtMoney(r.total)}/hs` : 'Completá los campos'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
