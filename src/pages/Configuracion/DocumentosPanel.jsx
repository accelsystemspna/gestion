import { useState } from 'react'
import { useAuth } from '../../lib/AuthContext'
import { buscarDocumentosFaltantes, generarDocumentosFaltantes } from '../../lib/documentosCliente'

// Los presupuestos y tickets anteriores llegan al panel del cliente recién cuando alguien lo decide acá:
// primero se ve qué se va a publicar y a quién.
export default function DocumentosPanel() {
  const { orgId } = useAuth()
  const [faltan, setFaltan] = useState(null)
  const [trabajando, setTrabajando] = useState(false)
  const [avance, setAvance] = useState(null)
  const [resultado, setResultado] = useState(null)
  const [error, setError] = useState('')

  const buscar = async () => {
    setTrabajando(true); setError(''); setResultado(null)
    try { setFaltan(await buscarDocumentosFaltantes()) } catch (e) { setError(e.message) }
    setTrabajando(false)
  }

  const generar = async () => {
    const cuantos = faltan.presupuestos.length + faltan.ventas.length
    if (!window.confirm(`Tus clientes van a poder ver y bajar estos ${cuantos} documentos desde su panel. ¿Seguir?`)) return
    setTrabajando(true); setError('')
    try {
      setResultado(await generarDocumentosFaltantes(faltan, orgId, (n, total) => setAvance({ n, total })))
      setFaltan(null)
    } catch (e) { setError(e.message) }
    setAvance(null)
    setTrabajando(false)
  }

  const fila = { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '4px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }

  return (
    <div className="card" style={{ marginTop: 24, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <h3 style={{ margin: 0, fontSize: 16 }}>Documentos anteriores en el panel del cliente</h3>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
          Los presupuestos y tickets nuevos ya se guardan solos. Esto arma los anteriores con los datos guardados. No emite nada en ARCA.
        </p>
      </div>

      {error && <div style={{ fontSize: 13, color: '#dc2626' }}>{error}</div>}
      {resultado && (
        <div style={{ fontSize: 13, color: resultado.fallaron ? '#b45309' : '#15803d' }}>
          Listo: {resultado.presupuestos} presupuestos y {resultado.tickets} tickets.
          {resultado.fallaron > 0 && ` ${resultado.fallaron} no se pudieron guardar: volvé a buscar para reintentar.`}
        </div>
      )}

      {faltan && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <strong style={{ fontSize: 13 }}>Presupuestos ({faltan.presupuestos.length})</strong>
            {faltan.presupuestos.map((p) => (
              <div key={p.id} style={fila}><span>N° {p.numero} · {p.cliente}</span><span>${Number(p.total || 0).toLocaleString('es-AR')}</span></div>
            ))}
          </div>
          <div>
            <strong style={{ fontSize: 13 }}>Tickets ({faltan.ventas.length})</strong>
            {faltan.ventas.map((v) => (
              <div key={v.id} style={fila}><span>V-{v.numero} · {v.clienteNombre || v.cliente_nombre}</span><span>${Number(v.total || 0).toLocaleString('es-AR')}</span></div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn" onClick={buscar} disabled={trabajando}>{trabajando && !avance ? 'Buscando…' : 'Ver qué falta'}</button>
        {faltan && faltan.presupuestos.length + faltan.ventas.length > 0 && (
          <button className="btn btn-primary" onClick={generar} disabled={trabajando}>
            {avance ? `Generando ${avance.n} de ${avance.total}…` : 'Generar y mostrar a los clientes'}
          </button>
        )}
      </div>
    </div>
  )
}
