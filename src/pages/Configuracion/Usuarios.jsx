import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'

const EDGE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-users`

async function callEdge(action, body = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(EDGE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
      'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ action, ...body }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Error desconocido')
  return data
}

const blank = { nombre: '', email: '', password: '', rol: 'vendedor' }

export default function Usuarios() {
  const { user } = useAuth()
  const [items, setItems]   = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm]     = useState(blank)
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('profiles').select('*').order('created_at')
    setItems(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const crearUsuario = async (e) => {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      await callEdge('create', form)
      setForm(blank)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const cambiarRol = async (user_id, rol) => {
    try {
      await callEdge('update_rol', { user_id, rol })
      setItems(prev => prev.map(u => u.id === user_id ? { ...u, rol } : u))
    } catch (err) {
      alert('Error: ' + err.message)
    }
  }

  const eliminar = async (user_id, nombre) => {
    if (!confirm(`¿Eliminar a ${nombre}? Esta acción no se puede deshacer.`)) return
    try {
      await callEdge('delete', { user_id })
      setItems(prev => prev.filter(u => u.id !== user_id))
    } catch (err) {
      alert('Error: ' + err.message)
    }
  }

  return (
    <div style={{ maxWidth: 680 }}>

      {/* ── Formulario nuevo usuario ── */}
      <div style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: 20,
        marginBottom: 24,
      }}>
        <h3 style={{ margin: '0 0 16px', fontSize: 15, color: 'var(--text)' }}>Nuevo usuario</h3>
        <form onSubmit={crearUsuario} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Nombre</label>
            <input className="input" value={form.nombre} onChange={e => set('nombre', e.target.value)} required placeholder="Ej. María" />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Email</label>
            <input className="input" type="email" value={form.email} onChange={e => set('email', e.target.value)} required placeholder="maria@empresa.com" />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Contraseña</label>
            <input className="input" type="password" value={form.password} onChange={e => set('password', e.target.value)} required minLength={6} placeholder="Mínimo 6 caracteres" />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Rol</label>
            <select className="select" value={form.rol} onChange={e => set('rol', e.target.value)}>
              <option value="admin">Admin — acceso total</option>
              <option value="vendedor">Vendedor — solo ventas</option>
            </select>
          </div>

          {error && (
            <div style={{ gridColumn: '1/-1', color: 'var(--danger)', fontSize: 13, padding: '8px 12px', background: 'rgba(239,68,68,0.08)', borderRadius: 6 }}>
              {error}
            </div>
          )}

          <div style={{ gridColumn: '1/-1', display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" type="submit" disabled={saving}>
              {saving ? 'Creando...' : '+ Crear usuario'}
            </button>
          </div>
        </form>
      </div>

      {/* ── Lista de usuarios ── */}
      {loading ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>Cargando...</div>
      ) : (
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Email</th>
                <th>Rol</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((u) => (
                <tr key={u.id}>
                  <td>
                    {u.nombre || '—'}
                    {u.id === user?.id && (
                      <span className="badge" style={{ marginLeft: 8, fontSize: 10 }}>Vos</span>
                    )}
                  </td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 13 }}>{u.email}</td>
                  <td>
                    {u.id === user?.id ? (
                      <span style={{ fontSize: 13, color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                        {u.rol}
                      </span>
                    ) : (
                      <select
                        className="select"
                        style={{ width: 'auto', padding: '4px 8px', fontSize: 13 }}
                        value={u.rol}
                        onChange={(e) => cambiarRol(u.id, e.target.value)}
                      >
                        <option value="admin">Admin</option>
                        <option value="vendedor">Vendedor</option>
                      </select>
                    )}
                  </td>
                  <td>
                    {u.id !== user?.id && (
                      <button
                        onClick={() => eliminar(u.id, u.nombre || u.email)}
                        style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 16, padding: '4px 8px' }}
                        title="Eliminar usuario"
                      >
                        🗑
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
