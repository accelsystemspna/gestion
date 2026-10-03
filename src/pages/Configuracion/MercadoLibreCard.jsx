import { useEffect, useState } from 'react'
import { useAuth } from '../../lib/AuthContext'
import { mlApi } from '../../lib/mlApi'

// Conexión de la cuenta de Mercado Libre del negocio (OAuth) + importar ventas recientes.
export default function MercadoLibreCard() {
  const { isMaster } = useAuth()
  const [estado, setEstado]   = useState(null)   // null = cargando | { conectada, nickname, error }
  const [msg, setMsg]         = useState(null)   // { tipo: 'ok' | 'error', texto }
  const [ocupado, setOcupado] = useState('')

  const cargar = async () => {
    try { setEstado(await mlApi('status')) }
    catch (err) { setEstado({ conectada: false, error: err.message }) }
  }

  useEffect(() => {
    // Al volver de Mercado Libre la URL trae ?ml=ok|error.
    const p = new URLSearchParams(window.location.search)
    if (p.get('ml')) {
      setMsg(p.get('ml') === 'ok'
        ? { tipo: 'ok', texto: '¡Cuenta de Mercado Libre conectada!' }
        : { tipo: 'error', texto: p.get('msg') || 'No se pudo conectar la cuenta.' })
      window.history.replaceState({}, '', window.location.pathname)
    }
    cargar()
  }, [])

  const conectar = async () => {
    setOcupado('conectar'); setMsg(null)
    try {
      const { url } = await mlApi('connect_url')
      window.location.href = url
    } catch (err) {
      setMsg({ tipo: 'error', texto: err.message }); setOcupado('')
    }
  }

  const desconectar = async () => {
    if (!confirm('¿Desconectar la cuenta de Mercado Libre? Dejan de entrar ventas y de sincronizarse publicaciones.')) return
    setOcupado('desconectar'); setMsg(null)
    try { await mlApi('disconnect'); setMsg({ tipo: 'ok', texto: 'Cuenta desconectada.' }); await cargar() }
    catch (err) { setMsg({ tipo: 'error', texto: err.message }) }
    setOcupado('')
  }

  const importar = async () => {
    setOcupado('importar'); setMsg(null)
    try {
      const r = await mlApi('import_orders', { dias: 30 })
      setMsg({
        tipo: r.errores?.length ? 'error' : 'ok',
        texto: `Últimos 30 días: ${r.creadas} venta${r.creadas !== 1 ? 's' : ''} nueva${r.creadas !== 1 ? 's' : ''}, ${r.actualizadas} actualizada${r.actualizadas !== 1 ? 's' : ''}.` +
               (r.errores?.length ? ` Con errores: ${r.errores.slice(0, 3).join(' | ')}` : ''),
      })
    } catch (err) { setMsg({ tipo: 'error', texto: err.message }) }
    setOcupado('')
  }

  const color = '#d97706'
  return (
    <div style={{ marginTop: 24, padding: 18, borderRadius: 10, border: `1px solid ${color}55`, background: 'rgba(217,119,6,0.06)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h2 style={{ fontSize: 16, margin: 0, color }}>Mercado Libre</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
            {estado === null ? 'Consultando...'
              : estado.conectada ? <>Conectada: <strong style={{ color: 'var(--text)' }}>{estado.nickname}</strong>. Las ventas entran solas a Ventas.</>
              : 'Conectá la cuenta de Mercado Libre de este negocio para traer ventas, publicar productos y responder preguntas.'}
          </p>
          {estado && !estado.conectada && estado.error && (
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--danger)' }}>{estado.error}</p>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {estado?.conectada && (
            <button className="btn btn-sm" onClick={importar} disabled={!!ocupado}>
              {ocupado === 'importar' ? 'Importando...' : 'Importar últimos 30 días'}
            </button>
          )}
          {isMaster && (estado?.conectada
            ? <button className="btn btn-sm" onClick={desconectar} disabled={!!ocupado} style={{ color: 'var(--danger)' }}>Desconectar</button>
            : estado && <button className="btn btn-primary btn-sm" onClick={conectar} disabled={!!ocupado}>{ocupado === 'conectar' ? 'Abriendo...' : 'Conectar con Mercado Libre'}</button>)}
        </div>
      </div>
      {msg && (
        <div style={{
          marginTop: 10, fontSize: 13, padding: '8px 12px', borderRadius: 6,
          color: msg.tipo === 'ok' ? '#15803d' : 'var(--danger)',
          background: msg.tipo === 'ok' ? 'rgba(22,163,74,0.1)' : 'rgba(239,68,68,0.08)',
        }}>{msg.texto}</div>
      )}
    </div>
  )
}
