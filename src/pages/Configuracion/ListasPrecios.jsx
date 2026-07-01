import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fmtMoney } from '../../lib/format'

const blank = {
  nombre: '',
  adicional: 0,
  campos_extra: [],
  redondeo_valor: 0,
  redondeo_tipo: 'arriba',
  nota_interna: '',
}

const blankCampo = { nombre: '', tipo: '%', valor: 0, incluye_iva: false, es_comision: false }

const SUGERENCIAS = [
  { nombre: 'Comisión ML', tipo: '%', valor: 0, incluye_iva: true, es_comision: true },
  { nombre: 'Publicidad', tipo: '%', valor: 0, incluye_iva: false, es_comision: false },
  { nombre: 'Pasarela de pago', tipo: '%', valor: 0, incluye_iva: true, es_comision: true },
  { nombre: 'Embalaje', tipo: '$', valor: 0, incluye_iva: false, es_comision: false },
  { nombre: 'Envío', tipo: '$', valor: 0, incluye_iva: false, es_comision: false },
]

export default function ListasPrecios() {
  const [items, setItems] = useState([])
  const [editing, setEditing] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('listas_precios').select('*').order('created_at')
    setItems(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const handleSave = async (form) => {
    const payload = {
      nombre: form.nombre,
      tipo: 'Personalizada',
      adicional: Number(form.adicional) || 0,
      campos_extra: form.campos_extra || [],
      redondeo_valor: Number(form.redondeo_valor) || 0,
      redondeo_tipo: form.redondeo_tipo || 'arriba',
      nota_interna: form.nota_interna || null,
    }
    const res = form.id
      ? await supabase.from('listas_precios').update(payload).eq('id', form.id)
      : await supabase.from('listas_precios').insert(payload)
    if (res.error) { alert('Error: ' + res.error.message); return }
    setEditing(null)
    load()
  }

  const handleDelete = async (id) => {
    if (!confirm('¿Eliminar esta lista de precios?')) return
    const { error } = await supabase.from('listas_precios').delete().eq('id', id)
    if (error) alert('Error: ' + error.message)
    else load()
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14, alignItems: 'center' }}>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>
          Configurá los márgenes y costos extra de cada canal de venta.
        </p>
        <button className="btn btn-primary btn-sm" onClick={() => setEditing({ ...blank, campos_extra: [] })}>
          + Nueva lista
        </button>
      </div>

      {loading ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>Cargando...</div>
      ) : items.length === 0 ? (
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)', border: '1px dashed var(--border)', borderRadius: 8 }}>
          No hay listas de precios. Creá la primera.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((l) => {
            const campos = l.campos_extra || []
            return (
              <div key={l.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px', background: 'var(--bg-card)', display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ fontSize: 15 }}>{l.nombre}</strong>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                    <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 4, background: Number(l.adicional) >= 0 ? '#f0fdf4' : '#fef2f2', color: Number(l.adicional) >= 0 ? '#166534' : '#991b1b' }}>
                      {Number(l.adicional) >= 0 ? '+' : ''}{l.adicional}% base
                    </span>
                    {campos.map((c, i) => (
                      <span key={i} style={{ fontSize: 12, padding: '2px 8px', borderRadius: 4, background: 'var(--bg-muted)', color: 'var(--text-muted)' }}>
                        {c.nombre}: {c.tipo === '%' ? `${c.valor}%` : fmtMoney(c.valor)}
                      </span>
                    ))}
                    {Number(l.redondeo_valor) > 0 && (
                      <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 4, background: 'rgba(126,34,206,0.1)', color: '#a855f7' }}>
                        redondeo {l.redondeo_tipo === 'arriba' ? '↑' : l.redondeo_tipo === 'abajo' ? '↓' : '≈'} ${l.redondeo_valor}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button className="btn btn-sm btn-ghost" onClick={() => setEditing(l)}>Editar</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => handleDelete(l.id)} style={{ color: 'var(--danger)' }}>Eliminar</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {editing && <ListaForm initial={editing} onCancel={() => setEditing(null)} onSave={handleSave} />}
    </div>
  )
}

function ListaForm({ initial, onCancel, onSave }) {
  const [form, setForm] = useState(() => ({
    ...blank,
    ...initial,
    campos_extra: initial.campos_extra ? [...initial.campos_extra] : [],
    redondeo_valor: initial.redondeo_valor ?? 0,
    redondeo_tipo: initial.redondeo_tipo ?? 'arriba',
  }))
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onCancel])

  const setCampo = (i, k, v) =>
    setForm((f) => {
      const campos_extra = [...f.campos_extra]
      campos_extra[i] = { ...campos_extra[i], [k]: v }
      return { ...f, campos_extra }
    })

  const addCampo = (base = blankCampo) =>
    setForm((f) => ({ ...f, campos_extra: [...f.campos_extra, { ...base }] }))

  const removeCampo = (i) =>
    setForm((f) => ({ ...f, campos_extra: f.campos_extra.filter((_, idx) => idx !== i) }))

  const [showSugerencias, setShowSugerencias] = useState(false)

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <h3>{form.id ? 'Editar lista' : 'Nueva lista de precios'}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onCancel}>✕</button>
        </div>
        <div className="modal-body">

          {/* Nombre */}
          <div className="field">
            <label>Nombre</label>
            <input
              className="input"
              value={form.nombre}
              onChange={(e) => set('nombre', e.target.value)}
              placeholder="Ej: Minorista, Mercado Libre, Ecommerce..."
            />
          </div>

          {/* Adicional */}
          <div className="field" style={{ marginTop: 14, maxWidth: 200 }}>
            <label>Margen / Descuento base (%)</label>
            <input
              className="input" type="number" step="0.01"
              value={form.adicional}
              onChange={(e) => set('adicional', e.target.value)}
            />
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
              Positivo = recargo · Negativo = descuento
            </span>
          </div>

          {/* Redondeo */}
          <div style={{ marginTop: 16 }}>
            <label style={{ fontWeight: 600, fontSize: 14, display: 'block', marginBottom: 8 }}>Redondeo del precio final</label>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div className="field" style={{ maxWidth: 160 }}>
                <label>Redondear a múltiplo de $</label>
                <input
                  className="input" type="number" min="0" step="1"
                  value={form.redondeo_valor}
                  onChange={(e) => set('redondeo_valor', e.target.value)}
                  placeholder="0 = sin redondeo"
                />
              </div>
              <div className="field" style={{ maxWidth: 160 }}>
                <label>Dirección</label>
                <select className="select" value={form.redondeo_tipo} onChange={(e) => set('redondeo_tipo', e.target.value)}>
                  <option value="arriba">↑ Siempre arriba</option>
                  <option value="abajo">↓ Siempre abajo</option>
                  <option value="cercano">≈ Al más cercano</option>
                </select>
              </div>
              {Number(form.redondeo_valor) > 0 && (
                <div style={{ fontSize: 12, padding: '6px 10px', borderRadius: 5, background: 'rgba(126,34,206,0.1)', color: '#a855f7', marginBottom: 4 }}>
                  {(() => {
                    const rv = Number(form.redondeo_valor)
                    const ejemplos = [1234.5, 2780, 5130]
                    return ejemplos.map((base) => {
                      let r
                      if (form.redondeo_tipo === 'arriba')  r = Math.ceil(base / rv) * rv
                      else if (form.redondeo_tipo === 'abajo') r = Math.floor(base / rv) * rv
                      else r = Math.round(base / rv) * rv
                      return `$${base} → $${r}`
                    }).join('  ·  ')
                  })()}
                </div>
              )}
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Ej: 50 redondea $1.234 a $1.250 (↑) · 0 = sin redondeo
            </span>
          </div>

          {/* Costos extra */}
          <div style={{ marginTop: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <label style={{ fontWeight: 600, fontSize: 14 }}>Costos y cargos adicionales</label>
            </div>

            {form.campos_extra.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 10px' }}>
                Sin costos extra configurados.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 10 }}>
                {form.campos_extra.map((c, i) => {
                  const tasaEfectiva = c.tipo === '%'
                    ? ((Number(c.valor) || 0) * (c.incluye_iva ? 1.21 : 1)).toFixed(2)
                    : null
                  return (
                    <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
                      {/* Fila principal */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 76px 110px 32px', gap: 8, alignItems: 'center', padding: '8px 10px', background: 'var(--bg-card)' }}>
                        <input
                          className="input"
                          value={c.nombre}
                          onChange={(e) => setCampo(i, 'nombre', e.target.value)}
                          placeholder="Nombre del cargo"
                        />
                        <select
                          className="select"
                          value={c.tipo}
                          onChange={(e) => setCampo(i, 'tipo', e.target.value)}
                        >
                          <option value="%">%</option>
                          <option value="$">$</option>
                        </select>
                        <input
                          className="input"
                          type="number" step="0.01"
                          value={c.valor}
                          onChange={(e) => setCampo(i, 'valor', e.target.value)}
                          placeholder="0"
                        />
                        <button
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 18, padding: 0, lineHeight: 1 }}
                          onClick={() => removeCampo(i)}
                        >×</button>
                      </div>

                      {/* Opciones extra para % */}
                      {c.tipo === '%' && (
                        <div style={{ padding: '8px 10px 10px', background: 'var(--bg-muted)', borderTop: '1px solid var(--border)' }}>
                          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 8 }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', userSelect: 'none' }}>
                              <input
                                type="checkbox"
                                checked={!!c.incluye_iva}
                                onChange={(e) => setCampo(i, 'incluye_iva', e.target.checked)}
                              />
                              Incluye IVA (× 1.21)
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', userSelect: 'none' }}>
                              <input
                                type="checkbox"
                                checked={!!c.es_comision}
                                onChange={(e) => setCampo(i, 'es_comision', e.target.checked)}
                              />
                              Es comisión sobre venta
                            </label>
                          </div>

                          {/* Aclaración calculada */}
                          <div style={{ fontSize: 12, padding: '6px 10px', borderRadius: 5, background: c.es_comision ? 'rgba(245,158,11,0.12)' : 'rgba(16,185,129,0.12)', color: c.es_comision ? 'var(--warning)' : 'var(--success)' }}>
                            {c.incluye_iva && (
                              <span>
                                Tasa efectiva: {c.valor}% × 1.21 = <strong>{tasaEfectiva}%</strong>
                                {'  ·  '}
                              </span>
                            )}
                            {c.es_comision ? (
                              <span>
                                Cálculo: precio <strong>÷ (1 − {tasaEfectiva}%)</strong>
                                {' '}— cubre la comisión sin subpreciar
                              </span>
                            ) : (
                              <span>
                                Cálculo: precio <strong>× (1 + {tasaEfectiva}%)</strong>
                                {' '}— recargo sobre el costo acumulado
                              </span>
                            )}
                          </div>

                          {c.es_comision && (
                            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '5px 0 0' }}>
                              Restar {tasaEfectiva}% ≠ dividir por (1−{tasaEfectiva}%). Ejemplo con base $100:
                              sumar {tasaEfectiva}% → ${ (100 * (1 + Number(tasaEfectiva)/100)).toFixed(2) },
                              gross-up → ${ (100 / (1 - Number(tasaEfectiva)/100)).toFixed(2) }.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* Botones agregar */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', position: 'relative' }}>
              <button className="btn btn-sm btn-ghost" onClick={() => addCampo()}>
                + Agregar campo
              </button>
              <div style={{ position: 'relative' }}>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => setShowSugerencias((v) => !v)}
                >
                  Sugerencias ▾
                </button>
                {showSugerencias && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, zIndex: 20, marginTop: 4,
                    background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)', minWidth: 200,
                  }}>
                    {SUGERENCIAS.map((s) => (
                      <div
                        key={s.nombre}
                        onClick={() => { addCampo(s); setShowSugerencias(false) }}
                        style={{ padding: '8px 14px', cursor: 'pointer', fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)' }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-muted)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-card)')}
                      >
                        <span>{s.nombre}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {s.tipo}{s.es_comision ? ' · comisión' : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Nota interna */}
          <div className="field" style={{ marginTop: 16 }}>
            <label>Nota interna</label>
            <textarea
              className="textarea"
              value={form.nota_interna || ''}
              onChange={(e) => set('nota_interna', e.target.value)}
            />
          </div>

        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onCancel}>Cancelar</button>
          <button className="btn btn-primary" onClick={() => onSave(form)} disabled={!form.nombre}>
            Guardar
          </button>
        </div>
      </div>
    </div>
  )
}
