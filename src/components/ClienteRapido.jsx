import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { buscarClientesPorCelular, celularValido } from '../lib/accesoCliente'

const CAMPOS = 'id, nombre, telefono, email, lista_id'
const lbl = { fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }

/**
 * Alta de un cliente sin salir de la pantalla, o carga del celular que le falta a uno existente (`cliente`).
 * El celular es obligatorio: de ahí salen el PIN del pedido y el acceso al panel, y no puede repetirse en el negocio.
 */
export default function ClienteRapido({ cliente = null, inicial = '', onListo, onCancelar }) {
  const { orgId } = useAuth()
  const textoEsCelular = /^[\d\s()+-]+$/.test(inicial)
  const [f, setF] = useState({
    nombre: cliente?.nombre ?? (textoEsCelular ? '' : inicial),
    telefono: cliente?.telefono ?? (textoEsCelular ? inicial : ''),
    email: '',
    direccion: '',
  })
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [repetido, setRepetido] = useState(null)   // cliente que ya tiene ese celular
  const set = (k) => (e) => { setF((x) => ({ ...x, [k]: e.target.value })); setError(''); setRepetido(null) }

  const guardar = async (e) => {
    e.preventDefault()
    if (!f.nombre.trim()) return setError('Escribí el nombre del cliente.')
    if (!celularValido(f.telefono)) return setError('Escribí el celular completo, con característica. Ej: 343 610 8660')
    setGuardando(true)
    setError('')
    try {
      const encontrados = await buscarClientesPorCelular(f.telefono)
      const otro = encontrados.find((c) => c.id !== cliente?.id)
      if (otro) { setRepetido(otro); return }
      const telefono = f.telefono.trim()
      const { data, error: err } = cliente
        ? await supabase.from('clientes').update({ telefono }).eq('id', cliente.id).select(CAMPOS).single()
        : await supabase.from('clientes').insert({ org_id: orgId, nombre: f.nombre.trim(), telefono, email: f.email.trim() || null, direccion: f.direccion.trim() || null }).select(CAMPOS).single()
      if (err) throw new Error(err.message)
      onListo(data)
    } catch (err) {
      setError('No se pudo guardar: ' + err.message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="modal-overlay">
      <form className="modal" style={{ maxWidth: 440 }} onSubmit={guardar}>
        <div className="modal-header">
          <h3 style={{ margin: 0 }}>{cliente ? `Celular de ${cliente.nombre}` : 'Nuevo cliente'}</h3>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancelar} title="Cerrar">✕</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {!cliente && <div><label style={lbl}>Nombre *</label><input className="input" value={f.nombre} onChange={set('nombre')} autoFocus={!f.nombre} /></div>}
          <div>
            <label style={lbl}>Celular (WhatsApp) *</label>
            <input className="input" type="tel" value={f.telefono} onChange={set('telefono')} placeholder="Ej: 343 610 8660" autoFocus={!!f.nombre} />
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Con este número el cliente ve sus pedidos y documentos.</span>
          </div>
          {!cliente && <>
            <div><label style={lbl}>Email</label><input className="input" type="email" value={f.email} onChange={set('email')} /></div>
            <div><label style={lbl}>Dirección</label><input className="input" value={f.direccion} onChange={set('direccion')} /></div>
          </>}
          {error && <div style={{ fontSize: 13, color: '#dc2626', fontWeight: 500 }}>{error}</div>}
          {repetido && (
            <div style={{ padding: 10, borderRadius: 6, background: '#fffbeb', border: '1px solid #fcd34d', fontSize: 13, color: '#92400e' }}>
              Ese celular ya es de <strong>{repetido.nombre}</strong>.
              {!cliente && <button type="button" className="btn btn-sm" style={{ marginLeft: 8 }} onClick={() => onListo(repetido, true)}>Usar este cliente</button>}
            </div>
          )}
        </div>
        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn" onClick={onCancelar}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={guardando}>{guardando ? 'Guardando...' : cliente ? 'Guardar celular' : 'Crear cliente'}</button>
        </div>
      </form>
    </div>
  )
}
