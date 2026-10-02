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

const card = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: 20, marginBottom: 16 }
const lbl = { fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }
const blankNeg = { negocio: '', nombre: '', password: '' }
const blankUser = { nombre: '', password: '', rol: 'vendedor' }

// Pantalla solo para el Principal: crea negocios (cada uno con su master), ve quién trabaja
// en cada uno y decide qué categorías se le activan.
export default function Negocios() {
  const { orgId } = useAuth()
  const [negocios, setNegocios]   = useState([])
  const [perfiles, setPerfiles]   = useState([])
  const [categorias, setCategorias] = useState([])
  const [accesos, setAccesos]     = useState([])
  const [loading, setLoading]     = useState(true)
  const [form, setForm]           = useState(blankNeg)
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState(null)
  const [abierto, setAbierto]     = useState(null)
  const [userForm, setUserForm]   = useState(blankUser)
  const [userError, setUserError] = useState(null)

  const load = async () => {
    const [n, p, c, a] = await Promise.all([
      supabase.from('negocios').select('*').order('created_at'),
      supabase.from('profiles').select('id, nombre, email, rol, org_id').order('created_at'),
      supabase.from('categorias').select('id, nombre, sku_prefijo').eq('org_id', orgId).order('nombre'),
      supabase.from('categorias_acceso').select('categoria_id, org_id, comparte_stock'),
    ])
    setNegocios((n.data || []).filter((x) => x.org_id !== orgId))
    setPerfiles(p.data || [])
    setCategorias(c.data || [])
    setAccesos(a.data || [])
    setLoading(false)
  }
  useEffect(() => { if (orgId) load() }, [orgId])

  const crearNegocio = async (e) => {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      await callEdge('create_negocio', form)
      setForm(blankNeg)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const tieneAcceso = (orgNeg, catId) => accesos.some((a) => a.org_id === orgNeg && a.categoria_id === catId)

  const toggleAcceso = async (orgNeg, catId) => {
    const activo = tieneAcceso(orgNeg, catId)
    const { error: err } = activo
      ? await supabase.from('categorias_acceso').delete().eq('org_id', orgNeg).eq('categoria_id', catId)
      : await supabase.from('categorias_acceso').insert({ org_id: orgNeg, categoria_id: catId })
    if (err) return alert('Error: ' + err.message)
    setAccesos((prev) => activo
      ? prev.filter((a) => !(a.org_id === orgNeg && a.categoria_id === catId))
      : [...prev, { org_id: orgNeg, categoria_id: catId, comparte_stock: false }])
  }

  const toggleStock = async (orgNeg, catId) => {
    const nuevo = !accesos.find((a) => a.org_id === orgNeg && a.categoria_id === catId)?.comparte_stock
    const { error: err } = await supabase.from('categorias_acceso').update({ comparte_stock: nuevo })
      .eq('org_id', orgNeg).eq('categoria_id', catId)
    if (err) return alert('Error: ' + err.message)
    setAccesos((prev) => prev.map((a) => a.org_id === orgNeg && a.categoria_id === catId ? { ...a, comparte_stock: nuevo } : a))
  }

  const agregarUsuario = async (e, orgNeg) => {
    e.preventDefault()
    setUserError(null)
    try {
      await callEdge('create', { ...userForm, org_id: orgNeg })
      setUserForm(blankUser)
      await load()
    } catch (err) {
      setUserError(err.message)
    }
  }

  const eliminarUsuario = async (u) => {
    if (!confirm(`¿Eliminar a ${u.nombre || u.email}? Esta acción no se puede deshacer.`)) return
    try {
      await callEdge('delete', { user_id: u.id })
      setPerfiles((prev) => prev.filter((x) => x.id !== u.id))
    } catch (err) {
      alert('Error: ' + err.message)
    }
  }

  const cambiarRol = async (u, rol) => {
    try {
      await callEdge('update_rol', { user_id: u.id, rol })
      setPerfiles((prev) => prev.map((x) => x.id === u.id ? { ...x, rol } : x))
    } catch (err) {
      alert('Error: ' + err.message)
    }
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <div style={card}>
        <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>Nuevo negocio</h3>
        <p style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--text-muted)' }}>
          Cada negocio tiene su propio master, y sus propias tiendas, clientes, ventas, facturas y dashboard.
          Arranca sin categorías: se las activás vos acá abajo. Puede crear productos propios.
        </p>
        <form onSubmit={crearNegocio} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={{ gridColumn: '1/-1' }}>
            <label style={lbl}>Nombre del negocio</label>
            <input className="input" value={form.negocio} onChange={(e) => setForm({ ...form, negocio: e.target.value })} required placeholder="Ej. Estrella del Sur" />
          </div>
          <div>
            <label style={lbl}>Usuario del master (para entrar)</label>
            <input className="input" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} required placeholder="Ej. Alicia" />
          </div>
          <div>
            <label style={lbl}>Contraseña</label>
            <input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={6} placeholder="Mínimo 6 caracteres" />
          </div>
          {error && (
            <div style={{ gridColumn: '1/-1', color: 'var(--danger)', fontSize: 13, padding: '8px 12px', background: 'rgba(239,68,68,0.08)', borderRadius: 6 }}>{error}</div>
          )}
          <div style={{ gridColumn: '1/-1', display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? 'Creando...' : '+ Crear negocio'}</button>
          </div>
        </form>
      </div>

      {loading ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>Cargando...</div>
      ) : negocios.length === 0 ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>Todavía no hay otros negocios.</div>
      ) : negocios.map((neg) => {
        const equipo = perfiles.filter((p) => p.org_id === neg.org_id)
        const masters = equipo.filter((p) => p.rol === 'master')
        const open = abierto === neg.org_id
        const cantCats = accesos.filter((a) => a.org_id === neg.org_id).length
        return (
          <div key={neg.org_id} style={{ ...card, padding: 0 }}>
            <div onClick={() => { setAbierto(open ? null : neg.org_id); setUserError(null) }}
              style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 15 }}>
                  {neg.nombre}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Master: {masters.map((m) => m.nombre).join(', ') || '—'} · {equipo.length} {equipo.length === 1 ? 'usuario' : 'usuarios'} · {cantCats} {cantCats === 1 ? 'categoría activada' : 'categorías activadas'}
                </div>
              </div>
              <span style={{ color: 'var(--text-muted)' }}>{open ? '▲' : '▼'}</span>
            </div>

            {open && (
              <div style={{ padding: '4px 20px 20px', borderTop: '1px solid var(--border)' }}>
                <h4 style={{ margin: '14px 0 8px', fontSize: 13 }}>Categorías activadas</h4>
                <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--text-muted)' }}>
                  Las que marques las ve y las puede vender (sin editarlas). Con "Comparte stock" vende del mismo stock tuyo; sin eso lleva su propio stock de esos productos (arranca en 0). Lo que cree por su cuenta es solo de este negocio.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {categorias.map((c) => {
                    const activa = tieneAcceso(neg.org_id, c.id)
                    const comparte = accesos.find((a) => a.org_id === neg.org_id && a.categoria_id === c.id)?.comparte_stock
                    return (
                      <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 13, padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6 }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', flex: 1 }}>
                          <input type="checkbox" checked={activa} onChange={() => toggleAcceso(neg.org_id, c.id)} />
                          {c.nombre}
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: activa ? 'pointer' : 'not-allowed', opacity: activa ? 1 : 0.4 }}
                          title="Tildado: vende del mismo stock. Sin tildar: el negocio lleva su propio stock de estos productos.">
                          <input type="checkbox" disabled={!activa} checked={!!activa && !!comparte} onChange={() => toggleStock(neg.org_id, c.id)} />
                          Comparte stock
                        </label>
                      </div>
                    )
                  })}
                  {categorias.length === 0 && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No tenés categorías para compartir.</span>}
                </div>

                <h4 style={{ margin: '18px 0 8px', fontSize: 13 }}>Usuarios</h4>
                <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', marginBottom: 12 }}>
                  <table className="table">
                    <tbody>
                      {equipo.map((u) => (
                        <tr key={u.id}>
                          <td>{u.nombre || '—'}</td>
                          <td style={{ color: 'var(--text-muted)', fontSize: 13 }}>{u.email}</td>
                          <td>
                            {u.rol === 'master'
                              ? <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>master</span>
                              : (
                                <select className="select" style={{ width: 'auto', padding: '4px 8px', fontSize: 13 }} value={u.rol} onChange={(e) => cambiarRol(u, e.target.value)}>
                                  <option value="admin">Admin</option>
                                  <option value="vendedor">Vendedor</option>
                                </select>
                              )}
                          </td>
                          <td style={{ width: 40 }}>
                            <button onClick={() => eliminarUsuario(u)} title="Eliminar usuario"
                              style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 16, padding: '4px 8px' }}>🗑</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <form onSubmit={(e) => agregarUsuario(e, neg.org_id)} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 8, alignItems: 'end' }}>
                  <div>
                    <label style={lbl}>Usuario</label>
                    <input className="input" value={userForm.nombre} onChange={(e) => setUserForm({ ...userForm, nombre: e.target.value })} required />
                  </div>
                  <div>
                    <label style={lbl}>Contraseña</label>
                    <input className="input" type="password" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} required minLength={6} />
                  </div>
                  <div>
                    <label style={lbl}>Rol</label>
                    <select className="select" value={userForm.rol} onChange={(e) => setUserForm({ ...userForm, rol: e.target.value })}>
                      <option value="master">Master</option>
                      <option value="admin">Admin</option>
                      <option value="vendedor">Vendedor</option>
                    </select>
                  </div>
                  <button className="btn btn-primary" type="submit">+ Agregar</button>
                </form>
                {userError && <div style={{ color: 'var(--danger)', fontSize: 13, marginTop: 8 }}>{userError}</div>}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
