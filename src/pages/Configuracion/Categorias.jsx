import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

const blankCat = { nombre: '', sku_prefijo: '', tipo_fabricacion: 'Melamina', rubro_id: '' }
const blankSub = { nombre: '' }

export default function Categorias() {
  const [categorias, setCategorias] = useState([])
  const [rubros, setRubros]         = useState([])
  const [loading, setLoading]       = useState(true)
  const [editingCat, setEditingCat] = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  const [subcats, setSubcats]       = useState({})
  const [editingSub, setEditingSub] = useState(null)
  const [filtroRubro, setFiltroRubro] = useState('')

  const load = async () => {
    setLoading(true)
    const [{ data: cats }, { data: rubs }] = await Promise.all([
      supabase.from('categorias').select('*').order('nombre'),
      supabase.from('rubros').select('*').order('created_at'),
    ])
    setCategorias(cats || [])
    setRubros(rubs || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const loadSubcats = async (catId) => {
    const { data } = await supabase.from('subcategorias').select('*').eq('categoria_id', catId).order('nombre')
    setSubcats((prev) => ({ ...prev, [catId]: data || [] }))
  }

  const toggleExpand = (id) => {
    if (expandedId === id) { setExpandedId(null) }
    else { setExpandedId(id); loadSubcats(id) }
  }

  const handleSaveCat = async (form) => {
    const prefijo = form.sku_prefijo.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3)
    if (prefijo.length !== 3) return alert('El prefijo SKU debe tener exactamente 3 letras')
    if (!form.nombre.trim()) return alert('El nombre es requerido')
    const payload = {
      nombre:           form.nombre.trim(),
      sku_prefijo:      prefijo,
      tipo_fabricacion: form.tipo_fabricacion,
      rubro_id:         form.rubro_id ? Number(form.rubro_id) : null,
    }
    const res = form.id
      ? await supabase.from('categorias').update(payload).eq('id', form.id)
      : await supabase.from('categorias').insert(payload)
    if (res.error) return alert('Error: ' + res.error.message)
    setEditingCat(null)
    load()
  }

  const handleDeleteCat = async (id) => {
    if (!confirm('¿Eliminar esta categoría y todas sus subcategorías?')) return
    const { error } = await supabase.from('categorias').delete().eq('id', id)
    if (error) alert('Error: ' + error.message)
    else { if (expandedId === id) setExpandedId(null); load() }
  }

  const handleSaveSub = async (form, catId) => {
    if (!form.nombre.trim()) return alert('El nombre es requerido')
    const payload = { nombre: form.nombre.trim(), categoria_id: catId }
    const res = form.id
      ? await supabase.from('subcategorias').update({ nombre: form.nombre.trim() }).eq('id', form.id)
      : await supabase.from('subcategorias').insert(payload)
    if (res.error) return alert('Error: ' + res.error.message)
    setEditingSub(null)
    loadSubcats(catId)
  }

  const handleDeleteSub = async (id, catId) => {
    if (!confirm('¿Eliminar esta subcategoría?')) return
    const { error } = await supabase.from('subcategorias').delete().eq('id', id)
    if (error) alert('Error: ' + error.message)
    else loadSubcats(catId)
  }

  const catsFiltradas = filtroRubro
    ? categorias.filter((c) => String(c.rubro_id) === String(filtroRubro))
    : categorias

  // Agrupar por rubro para visualización
  const grupos = (() => {
    if (filtroRubro) return [{ rubro: rubros.find(r => String(r.id) === String(filtroRubro)), cats: catsFiltradas }]
    const sinRubro = catsFiltradas.filter(c => !c.rubro_id)
    const conRubro = rubros.map(r => ({
      rubro: r,
      cats: catsFiltradas.filter(c => String(c.rubro_id) === String(r.id)),
    })).filter(g => g.cats.length > 0)
    return [
      ...conRubro,
      ...(sinRubro.length ? [{ rubro: null, cats: sinRubro }] : []),
    ]
  })()

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14, alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>
            Cada categoría define el prefijo SKU y el tipo de fabricación.
          </p>
          {rubros.length > 0 && (
            <select
              className="select"
              value={filtroRubro}
              onChange={(e) => setFiltroRubro(e.target.value)}
              style={{ width: 'auto', fontSize: 12 }}
            >
              <option value="">Todos los rubros</option>
              {rubros.map((r) => (
                <option key={r.id} value={r.id}>{r.emoji ? `${r.emoji} ` : ''}{r.nombre}</option>
              ))}
            </select>
          )}
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setEditingCat({ ...blankCat })}>
          + Nueva categoría
        </button>
      </div>

      {loading ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>Cargando...</div>
      ) : categorias.length === 0 ? (
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)', border: '1px dashed var(--border)', borderRadius: 8 }}>
          No hay categorías creadas.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {grupos.map(({ rubro, cats }, gi) => (
            <div key={gi}>
              {/* Encabezado de rubro */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                {rubro ? (
                  <>
                    {rubro.emoji && <span style={{ fontSize: 16 }}>{rubro.emoji}</span>}
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: rubro.color || 'var(--primary)', ...(rubro.emoji ? { display: 'none' } : {}) }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: rubro.color || 'var(--primary)' }}>
                      {rubro.nombre}
                    </span>
                  </>
                ) : (
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>Sin rubro asignado</span>
                )}
                <div style={{ flex: 1, height: 1, background: rubro?.color ? `${rubro.color}33` : 'var(--border)', marginLeft: 4 }} />
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{cats.length} {cats.length === 1 ? 'categoría' : 'categorías'}</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {cats.map((cat) => (
                  <div key={cat.id} style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', background: 'var(--bg-card)' }}>
                      <button
                        onClick={() => toggleExpand(cat.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', marginRight: 10, fontSize: 12, color: 'var(--text-muted)', padding: 0 }}
                      >
                        {expandedId === cat.id ? '▾' : '▸'}
                      </button>
                      <div style={{ flex: 1 }}>
                        <strong>{cat.nombre}</strong>
                        <span style={{ marginLeft: 8, fontSize: 12, background: 'var(--primary)', color: '#fff', padding: '2px 8px', borderRadius: 4, fontFamily: 'monospace' }}>
                          {cat.sku_prefijo}
                        </span>
                        <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--text-muted)' }}>{cat.tipo_fabricacion}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-sm btn-ghost" onClick={() => setEditingCat({ ...cat, rubro_id: cat.rubro_id || '' })}>Editar</button>
                        <button className="btn btn-sm btn-ghost" onClick={() => handleDeleteCat(cat.id)} style={{ color: 'var(--danger)' }}>Eliminar</button>
                      </div>
                    </div>

                    {expandedId === cat.id && (
                      <div style={{ padding: '12px 16px 16px 40px', borderTop: '1px solid var(--border)', background: 'var(--bg-muted)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Subcategorías</span>
                          <button className="btn btn-sm btn-ghost" onClick={() => setEditingSub({ ...blankSub, _catId: cat.id })}>
                            + Agregar
                          </button>
                        </div>
                        {(subcats[cat.id] || []).length === 0 ? (
                          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>Sin subcategorías.</p>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {(subcats[cat.id] || []).map((sub) => (
                              <div key={sub.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <span style={{ flex: 1, fontSize: 14 }}>· {sub.nombre}</span>
                                <button className="btn btn-sm btn-ghost" onClick={() => setEditingSub({ ...sub, _catId: cat.id })}>Editar</button>
                                <button className="btn btn-sm btn-ghost" onClick={() => handleDeleteSub(sub.id, cat.id)} style={{ color: 'var(--danger)' }}>Eliminar</button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {editingCat && (
        <CategoriaForm
          initial={editingCat}
          rubros={rubros}
          onCancel={() => setEditingCat(null)}
          onSave={handleSaveCat}
        />
      )}
      {editingSub && (
        <SubcategoriaForm
          initial={editingSub}
          onCancel={() => setEditingSub(null)}
          onSave={(form) => handleSaveSub(form, editingSub._catId)}
        />
      )}
    </div>
  )
}

function CategoriaForm({ initial, rubros, onCancel, onSave }) {
  const [form, setForm] = useState({ ...blankCat, ...initial })
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onCancel])

  const handlePrefijo = (v) => set('sku_prefijo', v.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3))

  const rubroSel = rubros.find(r => String(r.id) === String(form.rubro_id))

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h3>{form.id ? 'Editar categoría' : 'Nueva categoría'}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onCancel}>✕</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 14 }}>
            <div className="field">
              <label>Nombre</label>
              <input className="input" value={form.nombre} onChange={(e) => set('nombre', e.target.value)} />
            </div>
            <div className="field">
              <label>Prefijo SKU (3 letras)</label>
              <input
                className="input"
                value={form.sku_prefijo}
                onChange={(e) => handlePrefijo(e.target.value)}
                placeholder="EJM"
                maxLength={3}
                style={{ fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.1em' }}
              />
            </div>
            <div className="field">
              <label>Tipo de fabricación</label>
              <select className="select" value={form.tipo_fabricacion} onChange={(e) => set('tipo_fabricacion', e.target.value)}>
                <option value="Melamina">Melamina</option>
                <option value="Impresión 3D">Impresión 3D</option>
              </select>
            </div>
          </div>

          {/* Rubro */}
          <div className="field">
            <label>Rubro</label>
            {rubros.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
                No hay rubros creados. Creá rubros en la pestaña "Rubros" primero.
              </p>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <label style={{
                  display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                  padding: '6px 12px', borderRadius: 6, fontSize: 13, userSelect: 'none',
                  border: `1px solid ${!form.rubro_id ? 'var(--primary)' : 'var(--border)'}`,
                  background: !form.rubro_id ? 'var(--primary-faint)' : 'var(--bg-cell)',
                  color: !form.rubro_id ? 'var(--primary)' : 'var(--text-muted)',
                }}>
                  <input type="radio" name="rubro" style={{ display: 'none' }} checked={!form.rubro_id} onChange={() => set('rubro_id', '')} />
                  Sin rubro
                </label>
                {rubros.map((r) => {
                  const sel = String(form.rubro_id) === String(r.id)
                  return (
                    <label key={r.id} style={{
                      display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                      padding: '6px 12px', borderRadius: 6, fontSize: 13, userSelect: 'none',
                      border: `1px solid ${sel ? r.color : 'var(--border)'}`,
                      background: sel ? `${r.color}22` : 'var(--bg-cell)',
                      color: sel ? r.color : 'var(--text)',
                      fontWeight: sel ? 600 : 400,
                    }}>
                      <input type="radio" name="rubro" style={{ display: 'none' }} checked={sel} onChange={() => set('rubro_id', r.id)} />
                      {r.emoji && <span>{r.emoji}</span>}
                      {r.nombre}
                    </label>
                  )
                })}
              </div>
            )}
          </div>

          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
            SKUs: <strong>{form.sku_prefijo || 'XXX'}000001</strong>, <strong>{form.sku_prefijo || 'XXX'}000002</strong>...
            {rubroSel && <span> · Rubro: <span style={{ color: rubroSel.color, fontWeight: 600 }}>{rubroSel.nombre}</span></span>}
          </p>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onCancel}>Cancelar</button>
          <button className="btn btn-primary" onClick={() => onSave(form)} disabled={!form.nombre || form.sku_prefijo.length !== 3}>
            Guardar
          </button>
        </div>
      </div>
    </div>
  )
}

function SubcategoriaForm({ initial, onCancel, onSave }) {
  const [form, setForm] = useState(initial)

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onCancel])

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h3>{form.id ? 'Editar subcategoría' : 'Nueva subcategoría'}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onCancel}>✕</button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label>Nombre</label>
            <input className="input" value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} />
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
