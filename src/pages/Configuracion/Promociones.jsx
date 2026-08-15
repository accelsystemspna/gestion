import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fmtMoney } from '../../lib/format'

const TIPOS = {
  descuento_pct:      { label: 'Descuento %',              icon: '％' },
  descuento_monto:    { label: 'Descuento $ fijo',         icon: '💲' },
  nxm:                { label: 'Lleva N, paga M (2x1/3x2)', icon: '🎁' },
  segunda_unidad_pct: { label: '2da unidad a % del precio', icon: '✌️' },
}

const CANALES = {
  local: { label: '🏪 Solo local', color: '#0891b2', bg: '#cffafe' },
  web:   { label: '🌐 Solo web',   color: '#7c3aed', bg: '#f5f3ff' },
  ambos: { label: '🏪🌐 Ambos',    color: '#16a34a', bg: '#dcfce7' },
}

const blank = {
  nombre: '', tipo: 'descuento_pct', valor: '', lleva: 2, paga: 1,
  canal: 'ambos', alcance_tipo: 'todos', alcance_ids: [],
  fecha_desde: '', fecha_hasta: '', activa: true,
}

function describirPromo(p) {
  if (p.tipo === 'descuento_pct')      return `${p.valor}% de descuento`
  if (p.tipo === 'descuento_monto')    return `${fmtMoney(p.valor)} de descuento`
  if (p.tipo === 'nxm')                return `Lleva ${p.lleva}, paga ${p.paga}`
  if (p.tipo === 'segunda_unidad_pct') return `2da unidad al ${p.valor}%`
  return p.tipo
}

export default function Promociones() {
  const [items, setItems] = useState([])
  const [categorias, setCategorias] = useState([])
  const [productos, setProductos] = useState([])
  const [editing, setEditing] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    const [p, c, pr] = await Promise.all([
      supabase.from('promociones').select('*').order('created_at', { ascending: false }),
      supabase.from('categorias').select('id, nombre').order('nombre'),
      supabase.from('productos').select('id, sku, nombre').eq('activo', true).order('nombre'),
    ])
    setItems(p.data || [])
    setCategorias(c.data || [])
    setProductos(pr.data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const handleSave = async (form) => {
    const payload = {
      nombre:       form.nombre,
      tipo:         form.tipo,
      valor:        form.valor !== '' ? Number(form.valor) : null,
      lleva:        form.tipo === 'nxm' ? Number(form.lleva) || 1 : null,
      paga:         form.tipo === 'nxm' ? Number(form.paga) || 1 : null,
      canal:        form.canal,
      alcance_tipo: form.alcance_tipo,
      alcance_ids:  form.alcance_tipo === 'todos' ? [] : form.alcance_ids,
      fecha_desde:  form.fecha_desde || null,
      fecha_hasta:  form.fecha_hasta || null,
      activa:       !!form.activa,
    }
    const res = form.id
      ? await supabase.from('promociones').update(payload).eq('id', form.id)
      : await supabase.from('promociones').insert(payload)
    if (res.error) { alert('Error: ' + res.error.message); return }
    setEditing(null)
    load()
  }

  const handleToggleActiva = async (p) => {
    await supabase.from('promociones').update({ activa: !p.activa }).eq('id', p.id)
    load()
  }

  const handleDelete = async (id) => {
    if (!confirm('¿Eliminar esta promoción?')) return
    const { error } = await supabase.from('promociones').delete().eq('id', id)
    if (error) alert('Error: ' + error.message)
    else load()
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14, alignItems: 'center' }}>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>
          Descuentos, 2x1/3x2 y ofertas por cantidad. Se aplican solos en el POS y, si corresponde, se avisa a la web.
        </p>
        <button className="btn btn-primary btn-sm" onClick={() => setEditing({ ...blank })}>
          + Nueva promoción
        </button>
      </div>

      {loading ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>Cargando...</div>
      ) : items.length === 0 ? (
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)', border: '1px dashed var(--border)', borderRadius: 8 }}>
          No hay promociones cargadas.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((p) => {
            const canal = CANALES[p.canal] || CANALES.ambos
            const vencida = p.fecha_hasta && p.fecha_hasta < new Date().toISOString().slice(0, 10)
            return (
              <div key={p.id} style={{
                border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px',
                background: 'var(--bg-card)', display: 'flex', alignItems: 'center', gap: 16,
                opacity: p.activa && !vencida ? 1 : 0.55,
              }}>
                <div style={{ fontSize: 22, flexShrink: 0 }}>{TIPOS[p.tipo]?.icon || '🏷️'}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 15 }}>{p.nombre}</strong>
                    <span style={{ fontSize: 12, padding: '1px 8px', borderRadius: 999, background: canal.bg, color: canal.color, fontWeight: 700 }}>
                      {canal.label}
                    </span>
                    {vencida && (
                      <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 999, background: '#fff1f2', color: '#dc2626', fontWeight: 600 }}>
                        Vencida
                      </span>
                    )}
                    {!p.activa && (
                      <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 999, background: 'var(--bg-muted)', color: 'var(--text-muted)', fontWeight: 600 }}>
                        Pausada
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                    {describirPromo(p)}
                    {' · '}
                    {p.alcance_tipo === 'todos' ? 'Todos los productos'
                      : p.alcance_tipo === 'categoria' ? `${p.alcance_ids.length} categoría(s)`
                      : `${p.alcance_ids.length} producto(s)`}
                    {(p.fecha_desde || p.fecha_hasta) && (
                      <span> · {p.fecha_desde || '…'} → {p.fecha_hasta || '…'}</span>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button className="btn btn-sm btn-ghost" onClick={() => handleToggleActiva(p)}>
                    {p.activa ? 'Pausar' : 'Activar'}
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={() => setEditing(p)}>Editar</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => handleDelete(p.id)} style={{ color: 'var(--danger)' }}>Eliminar</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {editing && (
        <PromoForm
          initial={editing}
          categorias={categorias}
          productos={productos}
          onCancel={() => setEditing(null)}
          onSave={handleSave}
        />
      )}
    </div>
  )
}

function PromoForm({ initial, categorias, productos, onCancel, onSave }) {
  const [form, setForm] = useState(() => ({
    ...blank,
    ...initial,
    alcance_ids: initial.alcance_ids ? [...initial.alcance_ids] : [],
    fecha_desde: initial.fecha_desde || '',
    fecha_hasta: initial.fecha_hasta || '',
  }))
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const [buscarProducto, setBuscarProducto] = useState('')

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onCancel])

  const toggleAlcanceId = (id) => {
    setForm((f) => {
      const ids = f.alcance_ids.map(String)
      const sid = String(id)
      return { ...f, alcance_ids: ids.includes(sid) ? ids.filter((i) => i !== sid) : [...ids, sid] }
    })
  }

  const productosFiltrados = buscarProducto.trim()
    ? productos.filter((p) =>
        p.nombre.toLowerCase().includes(buscarProducto.toLowerCase()) ||
        (p.sku || '').toLowerCase().includes(buscarProducto.toLowerCase()))
    : productos.filter((p) => form.alcance_ids.map(String).includes(String(p.id)))

  const valido = form.nombre.trim() &&
    (form.tipo !== 'nxm' ? form.valor !== '' : true) &&
    (form.alcance_tipo === 'todos' || form.alcance_ids.length > 0)

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <h3>{form.id ? 'Editar promoción' : 'Nueva promoción'}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onCancel}>✕</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          <div className="field">
            <label>Nombre</label>
            <input className="input" value={form.nombre} onChange={(e) => set('nombre', e.target.value)}
              placeholder="Ej: 2x1 en cuadros chicos" />
          </div>

          {/* Tipo */}
          <div className="field">
            <label>Tipo de promoción</label>
            <select className="select" value={form.tipo} onChange={(e) => set('tipo', e.target.value)}>
              {Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
            </select>
          </div>

          {/* Valor según tipo */}
          {form.tipo === 'nxm' ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="field">
                <label>Lleva</label>
                <input className="input" type="number" min="1" value={form.lleva} onChange={(e) => set('lleva', e.target.value)} />
              </div>
              <div className="field">
                <label>Paga</label>
                <input className="input" type="number" min="1" value={form.paga} onChange={(e) => set('paga', e.target.value)} />
              </div>
              <span style={{ gridColumn: 'span 2', fontSize: 11, color: 'var(--text-muted)' }}>
                Ej: 2x1 → lleva 2, paga 1. 3x2 → lleva 3, paga 2.
              </span>
            </div>
          ) : (
            <div className="field" style={{ maxWidth: 220 }}>
              <label>{form.tipo === 'descuento_monto' ? 'Monto de descuento ($)' : form.tipo === 'segunda_unidad_pct' ? '2da unidad al… (%)' : 'Porcentaje de descuento (%)'}</label>
              <input className="input" type="number" step="0.01" value={form.valor} onChange={(e) => set('valor', e.target.value)}
                placeholder={form.tipo === 'segunda_unidad_pct' ? 'Ej: 50 = mitad de precio' : '0'} />
            </div>
          )}

          {/* Canal */}
          <div className="field">
            <label>¿Dónde aplica?</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {Object.entries(CANALES).map(([k, v]) => (
                <button key={k} type="button" onClick={() => set('canal', k)}
                  style={{
                    flex: 1, padding: '8px 10px', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    border: `1px solid ${form.canal === k ? v.color : 'var(--border)'}`,
                    background: form.canal === k ? v.bg : 'var(--surface)',
                    color: form.canal === k ? v.color : 'var(--text)',
                  }}>
                  {v.label}
                </button>
              ))}
            </div>
            {form.canal !== 'local' && (
              <span style={{ fontSize: 11, color: 'var(--warning)', marginTop: 4 }}>
                ⚠️ Para 2x1/3x2 y 2da unidad, el lado web todavía necesita que el sitio sepa aplicarlo — por ahora estos tipos se ven reflejados solo en el POS.
              </span>
            )}
          </div>

          {/* Alcance */}
          <div className="field">
            <label>¿A qué productos aplica?</label>
            <select className="select" value={form.alcance_tipo} onChange={(e) => set('alcance_tipo', e.target.value)}>
              <option value="todos">Todos los productos</option>
              <option value="categoria">Categorías específicas</option>
              <option value="producto">Productos específicos</option>
            </select>
          </div>

          {form.alcance_tipo === 'categoria' && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxHeight: 140, overflowY: 'auto', padding: 4 }}>
              {categorias.map((c) => {
                const sel = form.alcance_ids.map(String).includes(String(c.id))
                return (
                  <label key={c.id} style={{
                    display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '5px 10px',
                    borderRadius: 6, fontSize: 13, border: `1px solid ${sel ? 'var(--primary)' : 'var(--border)'}`,
                    background: sel ? 'var(--primary-faint)' : 'var(--bg-cell)', color: sel ? 'var(--primary)' : 'var(--text)',
                  }}>
                    <input type="checkbox" style={{ display: 'none' }} checked={sel} onChange={() => toggleAlcanceId(c.id)} />
                    {sel ? '✓ ' : ''}{c.nombre}
                  </label>
                )
              })}
            </div>
          )}

          {form.alcance_tipo === 'producto' && (
            <div>
              <input className="input" placeholder="🔍 Buscar producto por nombre o SKU..."
                value={buscarProducto} onChange={(e) => setBuscarProducto(e.target.value)} style={{ marginBottom: 8 }} />
              <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
                {productosFiltrados.length === 0 ? (
                  <div style={{ padding: 12, fontSize: 12, color: 'var(--text-muted)' }}>
                    {buscarProducto ? 'Sin resultados.' : 'Sin productos seleccionados todavía — buscá arriba.'}
                  </div>
                ) : productosFiltrados.map((p) => {
                  const sel = form.alcance_ids.map(String).includes(String(p.id))
                  return (
                    <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderBottom: '1px solid var(--border)', cursor: 'pointer', fontSize: 13 }}>
                      <input type="checkbox" checked={sel} onChange={() => toggleAlcanceId(p.id)} />
                      <code style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.sku}</code>
                      {p.nombre}
                    </label>
                  )
                })}
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{form.alcance_ids.length} producto(s) seleccionados</span>
            </div>
          )}

          {/* Vigencia */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="field">
              <label>Desde (opcional)</label>
              <input className="input" type="date" value={form.fecha_desde} onChange={(e) => set('fecha_desde', e.target.value)} />
            </div>
            <div className="field">
              <label>Hasta (opcional)</label>
              <input className="input" type="date" value={form.fecha_hasta} onChange={(e) => set('fecha_hasta', e.target.value)} />
            </div>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
            <input type="checkbox" checked={form.activa} onChange={(e) => set('activa', e.target.checked)} />
            <span style={{ fontSize: 13, fontWeight: 600 }}>Promoción activa</span>
          </label>

        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onCancel}>Cancelar</button>
          <button className="btn btn-primary" onClick={() => onSave(form)} disabled={!valido}>Guardar</button>
        </div>
      </div>
    </div>
  )
}
