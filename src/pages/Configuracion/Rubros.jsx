import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

const COLORES_SUGERIDOS = [
  '#0ea5e9', '#7c3aed', '#f97316', '#10b981',
  '#ef4444', '#d97706', '#ec4899', '#64748b',
]

const EMOJIS = ['🪵', '🖨️', '⚡', '🔧', '💎', '🎨', '📦', '🔩']

const blank = { nombre: '', color: '#0ea5e9', emoji: '', descripcion: '' }

export default function Rubros() {
  const [rubros, setRubros]   = useState([])
  const [editing, setEditing] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('rubros').select('*').order('created_at')
    setRubros(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const handleSave = async (form) => {
    const payload = {
      nombre:      form.nombre.trim(),
      color:       form.color || '#0ea5e9',
      emoji:       form.emoji || null,
      descripcion: form.descripcion || null,
    }
    const res = form.id
      ? await supabase.from('rubros').update(payload).eq('id', form.id)
      : await supabase.from('rubros').insert(payload)
    if (res.error) { alert('Error: ' + res.error.message); return }
    setEditing(null)
    load()
  }

  const handleDelete = async (id) => {
    if (!confirm('¿Eliminar este rubro? Las categorías asociadas quedarán sin rubro.')) return
    const { error } = await supabase.from('rubros').delete().eq('id', id)
    if (error) alert('Error: ' + error.message)
    else load()
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14, alignItems: 'center' }}>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>
          Los rubros agrupan categorías por proceso productivo: Láser, 3D, Router CNC, Melamina, etc.
        </p>
        <button className="btn btn-primary btn-sm" onClick={() => setEditing({ ...blank })}>
          + Nuevo rubro
        </button>
      </div>

      {loading ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>Cargando...</div>
      ) : rubros.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', border: '1px dashed var(--border)', borderRadius: 8 }}>
          No hay rubros creados. Agregá el primero para organizar tus categorías.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
          {rubros.map((r) => (
            <div key={r.id} style={{
              border: `2px solid ${r.color}33`,
              borderRadius: 10, padding: '14px 16px',
              background: `${r.color}0d`,
              display: 'flex', flexDirection: 'column', gap: 6,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {r.emoji && <span style={{ fontSize: 22 }}>{r.emoji}</span>}
                <div style={{
                  width: 12, height: 12, borderRadius: '50%',
                  background: r.color, flexShrink: 0,
                  ...(r.emoji ? { display: 'none' } : {}),
                }} />
                <strong style={{ fontSize: 15, color: 'var(--text)' }}>{r.nombre}</strong>
              </div>
              {r.descripcion && (
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>{r.descripcion}</p>
              )}
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <button className="btn btn-sm btn-ghost" onClick={() => setEditing(r)} style={{ flex: 1 }}>Editar</button>
                <button className="btn btn-sm btn-ghost" onClick={() => handleDelete(r.id)} style={{ color: 'var(--danger)' }}>Eliminar</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <RubroForm initial={editing} onCancel={() => setEditing(null)} onSave={handleSave} />
      )}
    </div>
  )
}

function RubroForm({ initial, onCancel, onSave }) {
  const [form, setForm] = useState({ ...blank, ...initial })
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onCancel])

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <h3>{form.id ? 'Editar rubro' : 'Nuevo rubro'}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onCancel}>✕</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          <div className="field">
            <label>Nombre del rubro</label>
            <input
              className="input"
              value={form.nombre}
              onChange={(e) => set('nombre', e.target.value)}
              placeholder="Ej: Láser, Impresión 3D, Router CNC, Melamina..."
            />
          </div>

          {/* Color */}
          <div className="field">
            <label>Color identificador</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {COLORES_SUGERIDOS.map((c) => (
                <button
                  key={c}
                  onClick={() => set('color', c)}
                  style={{
                    width: 28, height: 28, borderRadius: '50%', border: 'none', cursor: 'pointer',
                    background: c,
                    outline: form.color === c ? `3px solid ${c}` : '3px solid transparent',
                    outlineOffset: 2,
                  }}
                />
              ))}
              <input
                type="color"
                value={form.color}
                onChange={(e) => set('color', e.target.value)}
                style={{ width: 28, height: 28, border: 'none', padding: 0, cursor: 'pointer', borderRadius: 4 }}
                title="Color personalizado"
              />
            </div>
          </div>

          {/* Emoji / ícono */}
          <div className="field">
            <label>Ícono (emoji, opcional)</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
              {EMOJIS.map((e) => (
                <button
                  key={e}
                  onClick={() => set('emoji', form.emoji === e ? '' : e)}
                  style={{
                    fontSize: 20, padding: '4px 8px', borderRadius: 6, cursor: 'pointer',
                    border: `2px solid ${form.emoji === e ? form.color : 'var(--border)'}`,
                    background: form.emoji === e ? `${form.color}22` : 'white',
                  }}
                >
                  {e}
                </button>
              ))}
            </div>
            <input
              className="input"
              value={form.emoji}
              onChange={(e) => set('emoji', e.target.value)}
              placeholder="O escribí cualquier emoji..."
              style={{ maxWidth: 200 }}
            />
          </div>

          <div className="field">
            <label>Descripción (opcional)</label>
            <textarea
              className="textarea"
              value={form.descripcion || ''}
              onChange={(e) => set('descripcion', e.target.value)}
              placeholder="Ej: Trabajos de corte y grabado láser en madera y acrílico"
            />
          </div>

          {/* Preview */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
            borderRadius: 8, background: `${form.color}0d`, border: `2px solid ${form.color}33`,
          }}>
            {form.emoji && <span style={{ fontSize: 24 }}>{form.emoji}</span>}
            <div style={{ width: 12, height: 12, borderRadius: '50%', background: form.color, ...(form.emoji ? { display: 'none' } : {}) }} />
            <strong style={{ fontSize: 15 }}>{form.nombre || 'Vista previa'}</strong>
          </div>

        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onCancel}>Cancelar</button>
          <button className="btn btn-primary" onClick={() => onSave(form)} disabled={!form.nombre.trim()}>
            Guardar
          </button>
        </div>
      </div>
    </div>
  )
}
