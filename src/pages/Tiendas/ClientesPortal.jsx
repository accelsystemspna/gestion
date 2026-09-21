import { useEffect, useState } from 'react'
import { portalApi } from '../../lib/portalApi'

// Clientes que se registraron en el portal mayorista: aprobar, rechazar o eliminar.
// Todo pasa por la función portal-api (el secret del portal nunca llega al navegador).

const ESTADOS = {
  pendiente: { label: 'Pendiente', color: '#b45309', bg: '#fef3c7' },
  aprobado:  { label: 'Aprobado',  color: '#15803d', bg: '#dcfce7' },
  rechazado: { label: 'Rechazado', color: '#b91c1c', bg: '#fee2e2' },
}

const fmtFecha = (f) => {
  if (!f) return '—'
  const d = new Date(String(f).replace(' ', 'T'))
  return isNaN(d.getTime()) ? String(f).slice(0, 10) : d.toLocaleDateString('es-AR')
}

export default function ClientesPortal({ tienda, onPendientes }) {
  const [filtro, setFiltro]   = useState('pendiente')   // pendiente | aprobado | rechazado | todos
  const [leads, setLeads]     = useState([])
  const [conteos, setConteos] = useState({})
  const [cargando, setCargando] = useState(true)
  const [trabajando, setTrabajando] = useState(null)
  const [msg, setMsg]         = useState(null)
  const [q, setQ]             = useState('')

  const [recarga, setRecarga] = useState(0)

  // Vuelve a pedir la lista (silencioso: no muestra "Cargando…" ni pisa el cartel)
  const cargar = () => setRecarga(n => n + 1)
  const cambiarFiltro = (k) => { setCargando(true); setFiltro(k) }

  useEffect(() => {
    let vivo = true
    portalApi('leads', { tienda_id: tienda.id, ...(filtro !== 'todos' ? { status: filtro } : {}) }).then(r => {
      if (!vivo) return
      if (!r.ok) { setMsg({ tipo: 'error', texto: r.error }); setLeads([]); setCargando(false); return }
      setLeads(r.leads || [])
      setConteos(r.conteos || {})
      if (onPendientes) onPendientes(Number(r.conteos?.pendiente ?? 0))
      setCargando(false)
    })
    return () => { vivo = false }
  }, [tienda.id, filtro, recarga])   // eslint-disable-line react-hooks/exhaustive-deps

  const cambiarEstado = async (lead, status) => {
    setTrabajando(lead.id); setMsg(null)
    const r = await portalApi('lead-status', { tienda_id: tienda.id, lead_id: lead.id, status })
    setTrabajando(null)
    if (!r.ok) { setMsg({ tipo: 'error', texto: r.error }); return }
    setMsg({ tipo: 'ok', texto: `${lead.nombre || 'El cliente'} quedó ${ESTADOS[status].label.toLowerCase()}.` })
    cargar()
  }

  const eliminar = async (lead) => {
    if (!window.confirm(`¿Eliminar a ${lead.nombre || 'este cliente'} del portal? Esto no se puede deshacer.`)) return
    setTrabajando(lead.id); setMsg(null)
    const r = await portalApi('lead-delete', { tienda_id: tienda.id, lead_id: lead.id })
    setTrabajando(null)
    if (!r.ok) { setMsg({ tipo: 'error', texto: r.error }); return }
    setMsg({ tipo: 'ok', texto: 'Cliente eliminado del portal.' })
    cargar()
  }

  const txt = q.trim().toLowerCase()
  const visibles = txt
    ? leads.filter(l => [l.nombre, l.empresa, l.email, l.telefono].some(x => (x || '').toLowerCase().includes(txt)))
    : leads

  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 12px' }}>
        Personas que se registraron en <strong>{tienda.nombre}</strong>. Los pendientes esperan que los apruebes para poder comprar.
      </p>

      {msg && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', gap: 10, padding: '10px 14px', marginBottom: 12, borderRadius: 8, fontSize: 13,
          background: msg.tipo === 'error' ? '#fee2e2' : '#dcfce7', color: msg.tipo === 'error' ? '#7f1d1d' : '#14532d',
        }}>
          <span>{msg.texto}</span>
          <span style={{ cursor: 'pointer', fontWeight: 700 }} onClick={() => setMsg(null)}>✕</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        {[['pendiente', 'Pendientes'], ['aprobado', 'Aprobados'], ['rechazado', 'Rechazados'], ['todos', 'Todos']].map(([k, label]) => {
          const n = k === 'todos' ? conteos.total : conteos[k]
          return (
            <button key={k} onClick={() => cambiarFiltro(k)} className="btn btn-sm" style={{
              background: filtro === k ? 'var(--primary)' : undefined, color: filtro === k ? '#fff' : undefined,
              borderColor: filtro === k ? 'var(--primary)' : undefined,
            }}>{label}{n != null ? ` (${n})` : ''}</button>
          )
        })}
        <input className="input" style={{ flex: '1 1 200px', maxWidth: 320, padding: '6px 10px', fontSize: 13 }}
          placeholder="Buscar cliente…" value={q} onChange={e => setQ(e.target.value)} />
        <button className="btn btn-sm" onClick={() => { setCargando(true); cargar() }} disabled={cargando}>Actualizar</button>
      </div>

      {cargando ? (
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>Cargando…</div>
      ) : visibles.length === 0 ? (
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)', border: '1px dashed var(--border)', borderRadius: 8 }}>
          {leads.length === 0 ? 'No hay clientes con ese filtro.' : 'Ningún cliente coincide con la búsqueda.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {visibles.map(l => {
            const est = ESTADOS[l.status] || { label: l.status || '—', color: 'var(--text-muted)', bg: 'var(--bg-muted)' }
            const ocupado = trabajando === l.id
            return (
              <div key={l.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                padding: '10px 14px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)',
              }}>
                <div style={{ minWidth: 0, flex: '1 1 260px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 14 }}>{l.nombre || 'Sin nombre'}</strong>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: est.bg, color: est.color }}>{est.label}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6, marginTop: 2 }}>
                    {l.empresa && <div>{l.empresa}</div>}
                    <div>{[l.email, l.telefono].filter(Boolean).join(' · ') || 'Sin datos de contacto'}</div>
                    <div>Registrado: {fmtFecha(l.fecha)} · Último acceso: {fmtFecha(l.ultimo_acceso)}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {l.status !== 'aprobado' && (
                    <button className="btn btn-sm btn-primary" disabled={ocupado} onClick={() => cambiarEstado(l, 'aprobado')}>Aprobar</button>
                  )}
                  {l.status !== 'rechazado' && (
                    <button className="btn btn-sm" disabled={ocupado} onClick={() => cambiarEstado(l, 'rechazado')}>Rechazar</button>
                  )}
                  {l.status !== 'pendiente' && (
                    <button className="btn btn-sm btn-ghost" disabled={ocupado} onClick={() => cambiarEstado(l, 'pendiente')}>Volver a pendiente</button>
                  )}
                  <button className="btn btn-sm btn-ghost" disabled={ocupado} style={{ color: 'var(--danger)' }} onClick={() => eliminar(l)}>Eliminar</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
