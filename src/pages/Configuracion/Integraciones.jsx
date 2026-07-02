import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'

// ─── Helpers de UI ───────────────────────────────────────────────────────────

const TIPOS = {
  woocommerce:  { label: 'WooCommerce', color: '#7c3aed', bg: 'rgba(124,58,237,0.12)', sigla: 'WC' },
  mercadolibre: { label: 'Mercado Libre', color: '#d97706', bg: 'rgba(217,119,6,0.12)', sigla: 'ML' },
}

function TipoBadge({ tipo }) {
  const t = TIPOS[tipo] || { label: tipo, color: '#64748b', bg: '#f1f5f9', sigla: '?' }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
      background: t.bg, color: t.color, border: `1px solid ${t.color}33`,
    }}>
      {t.sigla} · {t.label}
    </span>
  )
}

function Toggle({ value, onChange }) {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{
        width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer',
        background: value ? 'var(--primary)' : '#cbd5e1', position: 'relative',
        transition: 'background 0.2s', flexShrink: 0,
      }}
    >
      <span style={{
        position: 'absolute', top: 3, left: value ? 21 : 3,
        width: 16, height: 16, borderRadius: '50%', background: 'white',
        transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
      }} />
    </button>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────

const blank = {
  nombre: '', tipo: 'woocommerce', url: '',
  consumer_key: '', consumer_secret: '',
  app_id: '', access_token: '',
  lista_id: '', categorias_ids: [], activa: true, notas: '',
}

export default function Integraciones() {
  const { orgId } = useAuth()
  const [tiendas, setTiendas]     = useState([])
  const [listas, setListas]       = useState([])
  const [categorias, setCategorias] = useState([])
  const [editing, setEditing]     = useState(null)
  const [loading, setLoading]     = useState(true)

  const load = async () => {
    setLoading(true)
    const [t, l, c] = await Promise.all([
      supabase.from('tiendas').select('*').eq('user_id', orgId).order('created_at'),
      supabase.from('listas_precios').select('id, nombre').order('created_at'),
      supabase.from('categorias').select('id, nombre').order('nombre'),
    ])
    setTiendas(t.data || [])
    setListas(l.data || [])
    setCategorias(c.data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const handleSave = async (form) => {
    const payload = {
      nombre:          form.nombre,
      tipo:            form.tipo,
      url:             form.url || null,
      consumer_key:    form.consumer_key || null,
      consumer_secret: form.consumer_secret || null,
      app_id:          form.app_id || null,
      access_token:    form.access_token || null,
      lista_id:        form.lista_id ? Number(form.lista_id) : null,
      categorias_ids:  form.categorias_ids || [],
      activa:          !!form.activa,
      notas:           form.notas || null,
    }
    const res = form.id
      ? await supabase.from('tiendas').update(payload).eq('id', form.id)
      : await supabase.from('tiendas').insert({ ...payload, user_id: orgId })
    if (res.error) { alert('Error: ' + res.error.message); return }
    setEditing(null)
    load()
  }

  const toggleActiva = async (tienda) => {
    await supabase.from('tiendas').update({ activa: !tienda.activa }).eq('id', tienda.id)
    load()
  }

  const handleDelete = async (id) => {
    if (!confirm('¿Eliminar esta integración?')) return
    const { error } = await supabase.from('tiendas').delete().eq('id', id)
    if (error) alert('Error: ' + error.message)
    else load()
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14, alignItems: 'center' }}>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>
          Configurá tus tiendas y canales de venta. Los productos se pueden asignar a una o varias tiendas.
        </p>
        <button className="btn btn-primary btn-sm" onClick={() => setEditing({ ...blank, categorias_ids: [] })}>
          + Nueva tienda
        </button>
      </div>

      {loading ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>Cargando...</div>
      ) : tiendas.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', border: '1px dashed var(--border)', borderRadius: 8 }}>
          No hay tiendas configuradas. Agregá la primera.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {tiendas.map((t) => {
            const lista = listas.find((l) => l.id === t.lista_id)
            const cats  = (t.categorias_ids || []).map((id) => categorias.find((c) => String(c.id) === String(id))?.nombre).filter(Boolean)
            return (
              <div key={t.id} style={{
                border: '1px solid var(--border)', borderRadius: 8, padding: '14px 16px',
                background: 'var(--bg-card)', display: 'flex', alignItems: 'center', gap: 16,
                opacity: t.activa ? 1 : 0.55,
              }}>
                {/* Ícono tipo */}
                <div style={{
                  width: 44, height: 44, borderRadius: 10, flexShrink: 0,
                  background: TIPOS[t.tipo]?.bg || '#f1f5f9',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 800, color: TIPOS[t.tipo]?.color || '#64748b',
                  border: `1px solid ${TIPOS[t.tipo]?.color || '#64748b'}33`,
                }}>
                  {TIPOS[t.tipo]?.sigla || '?'}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 15 }}>{t.nombre}</strong>
                    <TipoBadge tipo={t.tipo} />
                    {!t.activa && (
                      <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 999, background: 'var(--bg-muted)', color: 'var(--text-muted)', fontWeight: 600 }}>
                        Inactiva
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                    {t.url && (
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>🔗 {t.url}</span>
                    )}
                    {lista && (
                      <span style={{ fontSize: 12, padding: '1px 7px', borderRadius: 4, background: 'var(--primary-faint)', color: 'var(--primary)' }}>
                        Lista: {lista.nombre}
                      </span>
                    )}
                    {cats.length > 0 ? (
                      cats.map((c) => (
                        <span key={c} style={{ fontSize: 12, padding: '1px 7px', borderRadius: 4, background: 'rgba(16,185,129,0.12)', color: 'var(--success)' }}>
                          {c}
                        </span>
                      ))
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Todas las categorías</span>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                  <Toggle value={!!t.activa} onChange={() => toggleActiva(t)} />
                  <button className="btn btn-sm btn-ghost" onClick={() => setEditing(t)}>Editar</button>
                  <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => handleDelete(t.id)}>Eliminar</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Info de próximas funciones */}
      <div style={{ marginTop: 24, padding: '14px 16px', borderRadius: 8, background: 'var(--bg-muted)', border: '1px solid var(--border)' }}>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
          <strong style={{ color: 'var(--text)' }}>Próximamente:</strong> sincronización automática de productos, actualización masiva de precios y stock, y OAuth para Mercado Libre.
          Por ahora usá el <strong>Exportar CSV</strong> en Productos para importar manualmente en cada plataforma.
        </p>
      </div>

      {editing && (
        <TiendaForm
          initial={editing}
          listas={listas}
          categorias={categorias}
          onCancel={() => setEditing(null)}
          onSave={handleSave}
        />
      )}
    </div>
  )
}

// ─── Formulario ───────────────────────────────────────────────────────────────

function TiendaForm({ initial, listas, categorias, onCancel, onSave }) {
  const [form, setForm] = useState(() => ({
    ...blank,
    ...initial,
    categorias_ids: initial.categorias_ids ? [...initial.categorias_ids] : [],
  }))
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onCancel])

  const toggleCategoria = (id) => {
    setForm((f) => {
      const ids = f.categorias_ids.map(String)
      const sid = String(id)
      return {
        ...f,
        categorias_ids: ids.includes(sid) ? ids.filter((i) => i !== sid) : [...ids, sid],
      }
    })
  }

  const [showSecret, setShowSecret] = useState(false)

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <h3>{form.id ? 'Editar tienda' : 'Nueva tienda'}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onCancel}>✕</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Nombre + tipo */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px', gap: 12 }}>
            <div className="field">
              <label>Nombre de la tienda</label>
              <input
                className="input"
                value={form.nombre}
                onChange={(e) => set('nombre', e.target.value)}
                placeholder="Ej: Mi Tienda Minorista"
              />
            </div>
            <div className="field">
              <label>Plataforma</label>
              <select className="select" value={form.tipo} onChange={(e) => set('tipo', e.target.value)}>
                <option value="woocommerce">WooCommerce</option>
                <option value="mercadolibre">Mercado Libre</option>
              </select>
            </div>
          </div>

          {/* Credenciales WooCommerce */}
          {form.tipo === 'woocommerce' && (
            <div style={{ border: '1px solid #7c3aed44', borderRadius: 8, padding: '12px 14px', background: 'rgba(124,58,237,0.07)' }}>
              <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 600, color: '#7c3aed' }}>Credenciales WooCommerce</p>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>URL de la tienda</label>
                <input
                  className="input"
                  value={form.url}
                  onChange={(e) => set('url', e.target.value)}
                  placeholder="https://mitienda.com"
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="field">
                  <label>Consumer Key</label>
                  <input
                    className="input"
                    type={showSecret ? 'text' : 'password'}
                    value={form.consumer_key}
                    onChange={(e) => set('consumer_key', e.target.value)}
                    placeholder="ck_••••••••"
                  />
                </div>
                <div className="field">
                  <label>Consumer Secret</label>
                  <input
                    className="input"
                    type={showSecret ? 'text' : 'password'}
                    value={form.consumer_secret}
                    onChange={(e) => set('consumer_secret', e.target.value)}
                    placeholder="cs_••••••••"
                  />
                </div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginTop: 8, cursor: 'pointer', color: 'var(--text-muted)', userSelect: 'none' }}>
                <input type="checkbox" checked={showSecret} onChange={(e) => setShowSecret(e.target.checked)} />
                Mostrar claves
              </label>
              <p style={{ fontSize: 11, color: '#7c3aed', margin: '8px 0 0' }}>
                Generá las claves en WordPress → WooCommerce → Ajustes → API → Añadir clave (permisos: Lectura/Escritura)
              </p>
            </div>
          )}

          {/* Credenciales Mercado Libre */}
          {form.tipo === 'mercadolibre' && (
            <div style={{ border: '1px solid #d9770644', borderRadius: 8, padding: '12px 14px', background: 'rgba(217,119,6,0.07)' }}>
              <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 600, color: '#d97706' }}>Credenciales Mercado Libre</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="field">
                  <label>App ID</label>
                  <input
                    className="input"
                    value={form.app_id}
                    onChange={(e) => set('app_id', e.target.value)}
                    placeholder="123456789"
                  />
                </div>
                <div className="field">
                  <label>Access Token</label>
                  <input
                    className="input"
                    type={showSecret ? 'text' : 'password'}
                    value={form.access_token}
                    onChange={(e) => set('access_token', e.target.value)}
                    placeholder="APP_USR-••••••••"
                  />
                </div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginTop: 8, cursor: 'pointer', color: 'var(--text-muted)', userSelect: 'none' }}>
                <input type="checkbox" checked={showSecret} onChange={(e) => setShowSecret(e.target.checked)} />
                Mostrar claves
              </label>
              <p style={{ fontSize: 11, color: '#d97706', margin: '8px 0 0' }}>
                Obtenés el Access Token desde developers.mercadolibre.com → Tu aplicación → Credenciales
              </p>
            </div>
          )}

          {/* Lista de precios */}
          <div className="field">
            <label>Lista de precios para esta tienda</label>
            <select className="select" value={form.lista_id} onChange={(e) => set('lista_id', e.target.value)}>
              <option value="">— Sin lista asignada —</option>
              {listas.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
            </select>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              Los precios exportados a esta tienda usarán esta lista.
            </span>
          </div>

          {/* Categorías */}
          <div>
            <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
              Categorías a sincronizar
            </label>
            {categorias.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>No hay categorías creadas.</p>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {categorias.map((c) => {
                  const sel = form.categorias_ids.map(String).includes(String(c.id))
                  return (
                    <label
                      key={c.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                        padding: '5px 10px', borderRadius: 6, fontSize: 13,
                        border: `1px solid ${sel ? 'var(--primary)' : 'var(--border)'}`,
                        background: sel ? 'var(--primary-faint)' : 'var(--bg-cell)',
                        color: sel ? 'var(--primary)' : 'var(--text)',
                        userSelect: 'none', transition: 'all 0.15s',
                      }}
                    >
                      <input
                        type="checkbox"
                        style={{ display: 'none' }}
                        checked={sel}
                        onChange={() => toggleCategoria(c.id)}
                      />
                      {sel ? '✓ ' : ''}{c.nombre}
                    </label>
                  )
                })}
              </div>
            )}
            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '6px 0 0' }}>
              Sin selección = se sincronizan todas las categorías.
            </p>
          </div>

          {/* Activa */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none' }}>
            <Toggle value={!!form.activa} onChange={(v) => set('activa', v)} />
            <span style={{ fontSize: 13, fontWeight: 500 }}>Tienda activa</span>
          </label>

          {/* Notas */}
          <div className="field">
            <label>Notas internas</label>
            <textarea
              className="textarea"
              value={form.notas || ''}
              onChange={(e) => set('notas', e.target.value)}
              placeholder="Ej: Esta tienda es para ventas al por mayor en zona norte"
            />
          </div>

        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onCancel}>Cancelar</button>
          <button
            className="btn btn-primary"
            onClick={() => onSave(form)}
            disabled={!form.nombre}
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  )
}
