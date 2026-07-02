import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'

const ESTADOS = ['pagado', 'pendiente', 'cancelado']

// ── campo reutilizable ────────────────────────────────────────────────────────
function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 5 }}>
        {label}
      </label>
      {children}
    </div>
  )
}

const inputStyle = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid var(--border)',
  borderRadius: 6,
  fontSize: 14,
  background: 'var(--surface)',
  color: 'inherit',
  boxSizing: 'border-box',
}

// ── modal ─────────────────────────────────────────────────────────────────────
export default function ClienteForm({ cliente, onClose, onSaved, etiquetas = [] }) {
  const { orgId } = useAuth()
  const [form, setForm] = useState({
    nombre: '',
    email: '',
    telefono: '',
    direccion: '',
    etiqueta: '',
    notas: '',
    lista_id: '',
  })
  const [listas, setListas] = useState([])
  const [compras, setCompras] = useState([])
  const [loadingCompras, setLoadingCompras] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [tabLocal, setTabLocal] = useState('datos') // 'datos' | 'compras'
  const [newCompra, setNewCompra] = useState({ descripcion: '', monto: '', fecha: today(), estado: 'pendiente', notas: '' })
  const [addingCompra, setAddingCompra] = useState(false)
  const [etiquetaCustom, setEtiquetaCustom] = useState(false)

  function today() {
    return new Date().toISOString().slice(0, 10)
  }

  useEffect(() => {
    supabase.from('listas_precios').select('id, nombre').order('nombre')
      .then(({ data }) => setListas(data || []))
  }, [])

  useEffect(() => {
    if (cliente) {
      setForm({
        nombre: cliente.nombre ?? '',
        email: cliente.email ?? '',
        telefono: cliente.telefono ?? '',
        direccion: cliente.direccion ?? '',
        etiqueta: cliente.etiqueta ?? '',
        notas: cliente.notas ?? '',
        lista_id: cliente.lista_id ? String(cliente.lista_id) : '',
      })
      // cargar compras existentes
      setLoadingCompras(true)
      supabase
        .from('compras')
        .select('*')
        .eq('cliente_id', cliente.id)
        .order('fecha', { ascending: false })
        .then(({ data }) => {
          setCompras(data ?? [])
          setLoadingCompras(false)
        })
    }
  }, [cliente])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function handleSave() {
    if (!form.nombre.trim()) { setError('El nombre es obligatorio.'); return }
    setSaving(true)
    setError('')
    const payload = {
      nombre: form.nombre.trim(),
      email: form.email.trim() || null,
      telefono: form.telefono.trim() || null,
      direccion: form.direccion.trim() || null,
      etiqueta: form.etiqueta.trim() || null,
      notas: form.notas.trim() || null,
      lista_id: form.lista_id || null,
    }
    let err
    if (cliente) {
      ;({ error: err } = await supabase.from('clientes').update(payload).eq('id', cliente.id))
    } else {
      ;({ error: err } = await supabase.from('clientes').insert([{ ...payload, org_id: orgId }]))
    }
    setSaving(false)
    if (err) { setError(err.message); return }
    onSaved()
  }

  async function handleAddCompra() {
    if (!newCompra.descripcion.trim() && !newCompra.monto) return
    setAddingCompra(true)
    const payload = {
      cliente_id: cliente.id,
      descripcion: newCompra.descripcion.trim() || null,
      monto: parseFloat(newCompra.monto) || 0,
      fecha: newCompra.fecha || today(),
      estado: newCompra.estado || 'pendiente',
      notas: newCompra.notas.trim() || null,
    }
    await supabase.from('compras').insert([payload])
    const { data } = await supabase
      .from('compras')
      .select('*')
      .eq('cliente_id', cliente.id)
      .order('fecha', { ascending: false })
    setCompras(data ?? [])
    setNewCompra({ descripcion: '', monto: '', fecha: today(), estado: 'pendiente', notas: '' })
    setAddingCompra(false)
  }

  async function handleDeleteCompra(id) {
    await supabase.from('compras').delete().eq('id', id)
    setCompras((prev) => prev.filter((c) => c.id !== id))
  }

  function fmt(n) {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n ?? 0)
  }
  function fmtDate(d) {
    if (!d) return '—'
    return new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  }

  const tabStyle = (active) => ({
    padding: '8px 16px',
    background: 'transparent',
    border: 'none',
    borderBottom: active ? '2px solid var(--primary)' : '2px solid transparent',
    color: active ? 'var(--primary)' : 'var(--text-muted)',
    fontWeight: 600,
    fontSize: 13,
    cursor: 'pointer',
  })

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 300,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        style={{
          background: 'var(--bg)',
          borderRadius: 10,
          width: '100%',
          maxWidth: 500,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
        }}
      >
        {/* cabecera */}
        <div
          style={{
            padding: '18px 20px 14px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 16 }}>
            {cliente ? 'Editar cliente' : 'Nuevo cliente'}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--text-muted)' }}>×</button>
        </div>

        {/* tabs (solo si editar) */}
        {cliente && (
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', paddingLeft: 8 }}>
            <button style={tabStyle(tabLocal === 'datos')} onClick={() => setTabLocal('datos')}>Datos</button>
            <button style={tabStyle(tabLocal === 'compras')} onClick={() => setTabLocal('compras')}>
              Compras {compras.length > 0 && `(${compras.length})`}
            </button>
          </div>
        )}

        {/* cuerpo */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px' }}>
          {tabLocal === 'datos' ? (
            <>
              <Field label="Nombre *">
                <input style={inputStyle} value={form.nombre} onChange={set('nombre')} placeholder="Nombre del cliente" />
              </Field>
              <Field label="Email">
                <input style={inputStyle} value={form.email} onChange={set('email')} type="email" placeholder="email@ejemplo.com" />
              </Field>
              <Field label="Teléfono / WhatsApp">
                <input style={inputStyle} value={form.telefono} onChange={set('telefono')} placeholder="+54 9 11 1234-5678" />
              </Field>
              <Field label="Dirección">
                <input style={inputStyle} value={form.direccion} onChange={set('direccion')} placeholder="Calle, ciudad…" />
              </Field>
              <Field label="Categoría / Etiqueta">
                {etiquetaCustom ? (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      style={{ ...inputStyle, flex: 1 }}
                      value={form.etiqueta}
                      onChange={set('etiqueta')}
                      placeholder="Nueva categoría"
                      autoFocus
                    />
                    <button
                      onClick={() => setEtiquetaCustom(false)}
                      style={{ padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', background: 'var(--surface)', fontSize: 13 }}
                    >
                      ←
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select
                      style={{ ...inputStyle, flex: 1 }}
                      value={form.etiqueta}
                      onChange={set('etiqueta')}
                    >
                      <option value="">Sin categoría</option>
                      {etiquetas.map((e) => (
                        <option key={e} value={e}>{e}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => { setEtiquetaCustom(true); setForm((f) => ({ ...f, etiqueta: '' })) }}
                      style={{ padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', background: 'var(--surface)', fontSize: 13 }}
                      title="Nueva categoría"
                    >
                      +
                    </button>
                  </div>
                )}
              </Field>
              <Field label="Lista de precios">
                <select
                  style={inputStyle}
                  value={form.lista_id}
                  onChange={set('lista_id')}
                >
                  <option value="">— Sin lista asignada —</option>
                  {listas.map(l => (
                    <option key={l.id} value={l.id}>{l.nombre}</option>
                  ))}
                </select>
              </Field>

              <Field label="Notas internas">
                <textarea
                  style={{ ...inputStyle, height: 72, resize: 'vertical' }}
                  value={form.notas}
                  onChange={set('notas')}
                  placeholder="Preferencias, comentarios…"
                />
              </Field>
              {error && <div style={{ color: '#ef4444', fontSize: 13, marginBottom: 8 }}>{error}</div>}
            </>
          ) : (
            /* tab compras */
            <div>
              {/* nueva compra */}
              <div
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: 14,
                  marginBottom: 16,
                  background: 'var(--surface)',
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10, color: 'var(--text-muted)' }}>
                  REGISTRAR COMPRA
                </div>
                <Field label="Descripción">
                  <input
                    style={inputStyle}
                    value={newCompra.descripcion}
                    onChange={(e) => setNewCompra((p) => ({ ...p, descripcion: e.target.value }))}
                    placeholder="Producto o servicio"
                  />
                </Field>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <Field label="Monto ($)">
                    <input
                      style={inputStyle}
                      type="number"
                      value={newCompra.monto}
                      onChange={(e) => setNewCompra((p) => ({ ...p, monto: e.target.value }))}
                      placeholder="0"
                    />
                  </Field>
                  <Field label="Fecha">
                    <input
                      style={inputStyle}
                      type="date"
                      value={newCompra.fecha}
                      onChange={(e) => setNewCompra((p) => ({ ...p, fecha: e.target.value }))}
                    />
                  </Field>
                </div>
                <Field label="Estado">
                  <select
                    style={inputStyle}
                    value={newCompra.estado}
                    onChange={(e) => setNewCompra((p) => ({ ...p, estado: e.target.value }))}
                  >
                    {ESTADOS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
                <Field label="Notas">
                  <input
                    style={inputStyle}
                    value={newCompra.notas}
                    onChange={(e) => setNewCompra((p) => ({ ...p, notas: e.target.value }))}
                    placeholder="Opcional"
                  />
                </Field>
                <button
                  onClick={handleAddCompra}
                  disabled={addingCompra}
                  style={{
                    padding: '8px 14px',
                    background: 'var(--primary)',
                    border: 'none',
                    borderRadius: 6,
                    color: 'white',
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: 600,
                    width: '100%',
                  }}
                >
                  {addingCompra ? 'Guardando…' : '+ Registrar compra'}
                </button>
              </div>

              {/* historial */}
              {loadingCompras ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 16 }}>Cargando…</div>
              ) : compras.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 16, fontSize: 14 }}>Sin compras aún</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {compras.map((c) => (
                    <div
                      key={c.id}
                      style={{
                        border: '1px solid var(--border)',
                        borderRadius: 8,
                        padding: '10px 12px',
                        display: 'flex',
                        gap: 10,
                        alignItems: 'flex-start',
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{c.descripcion || '—'}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                          {fmtDate(c.fecha)} · {c.estado}
                          {c.notas && ` · ${c.notas}`}
                        </div>
                      </div>
                      <div style={{ fontWeight: 700, color: 'var(--primary)', whiteSpace: 'nowrap' }}>{fmt(c.monto)}</div>
                      <button
                        onClick={() => handleDeleteCompra(c.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 16, padding: '0 2px' }}
                        title="Eliminar"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* pie */}
        {tabLocal === 'datos' && (
          <div
            style={{
              padding: '14px 20px',
              borderTop: '1px solid var(--border)',
              display: 'flex',
              gap: 10,
              justifyContent: 'flex-end',
            }}
          >
            <button
              onClick={onClose}
              style={{
                padding: '8px 16px',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                padding: '8px 20px',
                background: 'var(--primary)',
                border: 'none',
                borderRadius: 6,
                color: 'white',
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              {saving ? 'Guardando…' : cliente ? 'Guardar cambios' : 'Crear cliente'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
