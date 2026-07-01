import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fmtMoney, padId } from '../../lib/format'
import { recalcularProductosPorMaterial } from '../../lib/recalcularCC'

const TIPOS = {
  placa:    { label: 'Placa (ancho × alto)', unidad: 'placa' },
  peso:     { label: 'Por peso',             unidad: 'gr'    },
  unidad:   { label: 'Por unidad',           unidad: 'u'     },
  longitud: { label: 'Por metro lineal',     unidad: 'm'     },
}

const blank = {
  nombre: '', tipo_medida: 'placa',
  precio_placa: 0, ancho_cm: 0, alto_cm: 0, desperdicio: 0,
  precio_unitario: 0,
  notas: '',
}

function precioLabel(m) {
  const tipo = m.tipo_medida || 'placa'
  if (tipo === 'placa') {
    const area = (Number(m.ancho_cm) || 0) * (Number(m.alto_cm) || 0)
    const cm2 = area > 0 ? Number(m.precio_placa) / area : 0
    return `${fmtMoney(m.precio_placa)} / placa · ${fmtMoney(cm2)}/cm²`
  }
  if (tipo === 'peso')     return `${fmtMoney(m.precio_unitario)} / kg`
  if (tipo === 'unidad')   return `${fmtMoney(m.precio_unitario)} / u`
  if (tipo === 'longitud') return `${fmtMoney(m.precio_unitario)} / m`
  return '—'
}

export default function Insumos() {
  const [items, setItems] = useState([])
  const [editing, setEditing] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('materiales').select('*').order('id')
    setItems(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const handleSave = async (form) => {
    const tipo = form.tipo_medida || 'placa'
    const payload = {
      nombre: form.nombre,
      tipo_medida: tipo,
      precio_placa:    tipo === 'placa' ? Number(form.precio_placa) || 0 : 0,
      ancho_cm:        tipo === 'placa' ? Number(form.ancho_cm) || 0     : 0,
      alto_cm:         tipo === 'placa' ? Number(form.alto_cm) || 0      : 0,
      desperdicio:     tipo === 'placa' ? Number(form.desperdicio) || 0  : 0,
      precio_unitario: tipo !== 'placa' ? Number(form.precio_unitario) || 0 : 0,
      notas: form.notas || null,
    }
    const res = form.id
      ? await supabase.from('materiales').update(payload).eq('id', form.id)
      : await supabase.from('materiales').insert(payload)
    if (res.error) return alert('Error: ' + res.error.message)
    setEditing(null)
    load()

    // Si es edición, recalcular en background productos y ventas CC afectadas
    if (form.id) {
      recalcularProductosPorMaterial(form.id)
        .then(({ productosActualizados, ventasActualizadas, clientesAfectados }) => {
          if (productosActualizados > 0) {
            console.log(
              `[CC Auto] Material actualizado: ${productosActualizados} producto(s) recalculados, ` +
              `${ventasActualizadas} venta(s) de ${clientesAfectados} cliente(s) actualizadas en CC.`
            )
          }
        })
        .catch(err => console.error('[CC Auto] Error al recalcular por material:', err))
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('¿Eliminar este insumo?')) return
    const { error } = await supabase.from('materiales').delete().eq('id', id)
    if (error) alert('Error: ' + error.message)
    else load()
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14, alignItems: 'center' }}>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>
          Placas, filamentos, insumos por unidad o metro. El precio se calcula según el tipo.
        </p>
        <button className="btn btn-primary btn-sm" onClick={() => setEditing({ ...blank })}>
          + Nuevo insumo
        </button>
      </div>

      {loading ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>Cargando...</div>
      ) : items.length === 0 ? (
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)', border: '1px dashed var(--border)', borderRadius: 8 }}>
          No hay insumos cargados.
        </div>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
          <table className="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Nombre</th>
                <th>Tipo</th>
                <th>Precio</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((m) => (
                <tr key={m.id}>
                  <td><code>{padId(m.id)}</code></td>
                  <td><strong>{m.nombre}</strong></td>
                  <td>
                    <span className="badge">
                      {TIPOS[m.tipo_medida || 'placa']?.label || m.tipo_medida}
                    </span>
                  </td>
                  <td style={{ fontSize: 13, color: 'var(--text-muted)' }}>{precioLabel(m)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn btn-sm btn-ghost" onClick={() => setEditing(m)}>Editar</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => handleDelete(m.id)} style={{ color: 'var(--danger)' }}>Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && <InsumoForm initial={editing} onCancel={() => setEditing(null)} onSave={handleSave} />}
    </div>
  )
}

function InsumoForm({ initial, onCancel, onSave }) {
  const [form, setForm] = useState({ ...blank, ...initial })
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onCancel])

  const tipo = form.tipo_medida || 'placa'
  const area = (Number(form.ancho_cm) || 0) * (Number(form.alto_cm) || 0)
  const cm2 = area > 0 ? Number(form.precio_placa) / area : 0

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h3>{form.id ? `Editar insumo ${padId(form.id)}` : 'Nuevo insumo'}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onCancel}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div className="field">
              <label>Nombre</label>
              <input className="input" value={form.nombre} onChange={(e) => set('nombre', e.target.value)} />
            </div>
            <div className="field">
              <label>Tipo de medida</label>
              <select className="select" value={tipo} onChange={(e) => set('tipo_medida', e.target.value)}>
                {Object.entries(TIPOS).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Campos según tipo */}
          {tipo === 'placa' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 14, marginTop: 14 }}>
              <div className="field">
                <label>Precio por placa</label>
                <input className="input" type="number" step="0.01" value={form.precio_placa}
                  onChange={(e) => set('precio_placa', e.target.value)} />
              </div>
              <div className="field">
                <label>Ancho (cm)</label>
                <input className="input" type="number" step="0.1" value={form.ancho_cm}
                  onChange={(e) => set('ancho_cm', e.target.value)} />
              </div>
              <div className="field">
                <label>Alto (cm)</label>
                <input className="input" type="number" step="0.1" value={form.alto_cm}
                  onChange={(e) => set('alto_cm', e.target.value)} />
              </div>
              <div className="field">
                <label>Desperdicio (%)</label>
                <input className="input" type="number" step="1" min="0" max="100" value={form.desperdicio}
                  onChange={(e) => set('desperdicio', e.target.value)} />
              </div>
            </div>
          )}

          {tipo === 'peso' && (
            <div style={{ marginTop: 14, maxWidth: 200 }}>
              <div className="field">
                <label>Precio por kilo ($)</label>
                <input className="input" type="number" step="0.01" value={form.precio_unitario}
                  onChange={(e) => set('precio_unitario', e.target.value)} />
                {Number(form.precio_unitario) > 0 && (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                    = {fmtMoney(Number(form.precio_unitario) / 1000)} / gr
                  </span>
                )}
              </div>
            </div>
          )}

          {tipo === 'unidad' && (
            <div style={{ marginTop: 14, maxWidth: 200 }}>
              <div className="field">
                <label>Precio por unidad ($)</label>
                <input className="input" type="number" step="0.01" value={form.precio_unitario}
                  onChange={(e) => set('precio_unitario', e.target.value)} />
              </div>
            </div>
          )}

          {tipo === 'longitud' && (
            <div style={{ marginTop: 14, maxWidth: 200 }}>
              <div className="field">
                <label>Precio por metro ($)</label>
                <input className="input" type="number" step="0.01" value={form.precio_unitario}
                  onChange={(e) => set('precio_unitario', e.target.value)} />
              </div>
            </div>
          )}

          {/* Preview precio */}
          {tipo === 'placa' && area > 0 && (
            <div style={{ marginTop: 14, padding: 12, background: '#f1f5f9', borderRadius: 6, fontSize: 13 }}>
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'baseline' }}>
                <span>
                  <span style={{ color: 'var(--text-muted)' }}>Precio por cm²: </span>
                  <strong>{fmtMoney(cm2)}</strong>
                </span>
                {Number(form.desperdicio) > 0 && (
                  <span>
                    <span style={{ color: 'var(--text-muted)' }}>Con {form.desperdicio}% desperdicio: </span>
                    <strong style={{ color: 'var(--primary)' }}>
                      {fmtMoney(cm2 * (1 + Number(form.desperdicio) / 100))}
                    </strong>
                    <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 4 }}>
                      (precio efectivo al cortar)
                    </span>
                  </span>
                )}
              </div>
              <div style={{ color: 'var(--text-muted)', marginTop: 4, fontSize: 12 }}>
                {area.toFixed(0)} cm² totales
                {Number(form.desperdicio) > 0 && (
                  <span style={{ marginLeft: 8 }}>
                    · El desperdicio encarece el costo por el material que se pierde al cortar
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="field" style={{ marginTop: 14 }}>
            <label>Notas</label>
            <textarea className="textarea" value={form.notas || ''} onChange={(e) => set('notas', e.target.value)} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onCancel}>Cancelar</button>
          <button className="btn btn-primary" onClick={() => onSave(form)} disabled={!form.nombre}>Guardar</button>
        </div>
      </div>
    </div>
  )
}
