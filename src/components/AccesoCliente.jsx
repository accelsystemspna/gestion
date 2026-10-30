import { useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { mandarAccesoCliente } from '../lib/accesoCliente'

/**
 * Botón "Mandar acceso por WhatsApp" del panel del cliente, con el estado de su PIN.
 * `estado`: { tiene_pin, link_vigente } o undefined si todavía no tiene credenciales.
 * Los clics no se propagan: en Clientes va dentro de una tarjeta que se abre al tocarla.
 */
export default function AccesoCliente({ cliente, estado, onEnviado }) {
  const { orgId } = useAuth()
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  const tienePin = !!estado?.tiene_pin

  const mandar = async (e) => {
    e.stopPropagation()
    setError('')
    const aviso = tienePin
      ? `Se va a generar un link para que ${cliente.nombre} cambie su PIN. El PIN actual sigue valiendo hasta que lo cambie.`
      : `Se va a generar un link para que ${cliente.nombre} cree su PIN.`
    if (!window.confirm(`${aviso}\n\nCada link nuevo invalida el anterior: si ya le mandaste otro, deja de funcionar.\n\n¿Seguir?`)) return
    setEnviando(true)
    try {
      await mandarAccesoCliente(cliente, orgId, tienePin)
      onEnviado?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div onClick={(e) => e.stopPropagation()} style={{ cursor: 'default' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 12, whiteSpace: 'nowrap', background: tienePin ? 'rgba(22,163,74,0.12)' : 'rgba(100,116,139,0.14)', color: tienePin ? '#15803d' : '#64748b' }}>
          {tienePin ? 'Ya tiene PIN' : 'Sin PIN'}
        </span>
        {cliente.telefono
          ? <button type="button" className="btn btn-sm" onClick={mandar} disabled={enviando}>
              {enviando ? 'Generando…' : tienePin ? '💬 Mandar link para cambiar PIN' : '💬 Mandar acceso por WhatsApp'}
            </button>
          : <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Falta cargar el celular para mandarle el acceso.</span>}
      </div>
      {estado?.link_vigente && !error && <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>Tiene un link vigente sin usar.</p>}
      {error && <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--danger)' }}>{error}</p>}
    </div>
  )
}
