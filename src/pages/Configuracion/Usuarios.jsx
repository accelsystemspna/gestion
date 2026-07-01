import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'

export default function Usuarios() {
  const { user } = useAuth()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('profiles').select('*').order('created_at')
    setItems(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const cambiarRol = async (id, rol) => {
    const { error } = await supabase.from('profiles').update({ rol }).eq('id', id)
    if (error) alert('Error: ' + error.message)
    else load()
  }

  return (
    <div>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 14 }}>
        Los nuevos usuarios se crean al registrarse desde la pantalla de Login. Acá podés cambiar sus roles.
      </p>

      {loading ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>Cargando...</div>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Email</th>
                <th>Rol</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((u) => (
                <tr key={u.id}>
                  <td>
                    {u.nombre || '—'}
                    {u.id === user?.id && <span className="badge" style={{ marginLeft: 8 }}>Vos</span>}
                  </td>
                  <td>{u.email}</td>
                  <td>
                    <select
                      className="select"
                      style={{ width: 'auto', display: 'inline-block', padding: '4px 8px' }}
                      value={u.rol}
                      onChange={(e) => cambiarRol(u.id, e.target.value)}
                    >
                      <option value="admin">admin</option>
                      <option value="vendedor">vendedor</option>
                    </select>
                  </td>
                  <td></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
