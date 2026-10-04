import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { mlApi } from '../../lib/mlApi'
import { fmtMoney } from '../../lib/format'

const ESTADOS = {
  active:       { label: 'Activa',    color: '#15803d', bg: 'rgba(22,163,74,0.12)' },
  paused:       { label: 'Pausada',   color: '#b45309', bg: 'rgba(217,119,6,0.14)' },
  closed:       { label: 'Cerrada',   color: '#64748b', bg: 'rgba(100,116,139,0.14)' },
  under_review: { label: 'En revisión', color: '#6d28d9', bg: 'rgba(109,40,217,0.12)' },
}

// Publicaciones del negocio en Mercado Libre, vinculadas a los productos del programa por SKU.
export default function MercadoLibrePanel() {
  const { orgId } = useAuth()
  const [pubs, setPubs]       = useState([])
  const [prods, setProds]     = useState({})
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [msg, setMsg]         = useState(null)
  const [filtro, setFiltro]   = useState('todas')
  const [q, setQ]             = useState('')
  const [orden, setOrden]     = useState({ col: 'recientes', dir: 'desc' })

  const cargar = async () => {
    const { data } = await supabase.from('ml_publicaciones').select('*').order('actualizada_en', { ascending: false })
    setPubs(data || [])
    const ids = [...new Set((data || []).map((p) => p.producto_id).filter(Boolean))]
    if (ids.length) {
      const { data: ps } = await supabase.from('productos').select('id, sku, nombre').in('id', ids)
      setProds(Object.fromEntries((ps || []).map((p) => [p.id, p])))
    }
    setLoading(false)
  }
  useEffect(() => { if (orgId) cargar() }, [orgId])

  const sincronizar = async () => {
    setSyncing(true); setMsg(null)
    try {
      const r = await mlApi('sync_items')
      setMsg({ tipo: 'ok', texto: `${r.total} publicaciones traídas de Mercado Libre (${r.vinculadas} vinculadas a un producto por SKU).` })
      await cargar()
    } catch (err) { setMsg({ tipo: 'error', texto: err.message }) }
    setSyncing(false)
  }

  const conteos = useMemo(() => {
    const c = { todas: pubs.length, sin_vincular: pubs.filter((p) => !p.producto_id).length }
    for (const p of pubs) c[p.estado] = (c[p.estado] || 0) + 1
    return c
  }, [pubs])

  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase()
    const lista = pubs.filter((p) => {
      if (filtro === 'sin_vincular' ? !!p.producto_id : filtro !== 'todas' && p.estado !== filtro) return false
      return !t || (p.titulo || '').toLowerCase().includes(t) || (p.sku || '').toLowerCase().includes(t) || (p.item_id || '').toLowerCase().includes(t)
    })
    const num = (v) => Number(v) || 0
    const clave = {
      precio: (p) => num(p.precio), stock: (p) => num(p.stock), vendidos: (p) => num(p.vendidos),
      titulo: (p) => (p.titulo || '').toLowerCase(), sku: (p) => (p.sku || '').toLowerCase(), estado: (p) => p.estado || '',
      recientes: (p) => new Date(p.actualizada_en || 0).getTime(),
    }[orden.col]
    const signo = orden.dir === 'asc' ? 1 : -1
    // Desempate por título para que el orden no "salte" entre publicaciones con el mismo valor.
    return [...lista].sort((a, b) => {
      const x = clave(a), y = clave(b)
      return (x < y ? -1 : x > y ? 1 : (a.titulo || '').localeCompare(b.titulo || '')) * signo
    })
  }, [pubs, filtro, q, orden])

  // Tocar un encabezado ordena por esa columna; tocarlo de nuevo invierte el sentido.
  const ordenarPor = (col) => setOrden((o) => o.col === col ? { col, dir: o.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: ['precio', 'stock', 'vendidos'].includes(col) ? 'desc' : 'asc' })
  const flecha = (col) => orden.col === col ? (orden.dir === 'asc' ? ' ▲' : ' ▼') : ''
  const PRESETS = [['recientes|desc', 'Más recientes'], ['vendidos|desc', 'Más vendidos'], ['precio|desc', 'Precio: mayor a menor'], ['precio|asc', 'Precio: menor a mayor'], ['stock|asc', 'Stock: menor a mayor'], ['stock|desc', 'Stock: mayor a menor'], ['titulo|asc', 'Título A-Z']]

  const filtros = [['todas', 'Todas'], ['active', 'Activas'], ['paused', 'Pausadas'], ['closed', 'Cerradas'], ['sin_vincular', 'Sin vincular']]

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <p style={{ margin: 0, flex: 1, minWidth: 220, fontSize: 13, color: 'var(--text-muted)' }}>
          Tus publicaciones en Mercado Libre. Se vinculan a un producto cuando el <strong>SKU de la publicación</strong> coincide con el del programa.
        </p>
        <button className="btn btn-primary btn-sm" onClick={sincronizar} disabled={syncing}>
          {syncing ? 'Trayendo...' : 'Traer publicaciones de ML'}
        </button>
      </div>

      {msg && (
        <div style={{
          marginBottom: 12, fontSize: 13, padding: '8px 12px', borderRadius: 6,
          color: msg.tipo === 'ok' ? '#15803d' : 'var(--danger)',
          background: msg.tipo === 'ok' ? 'rgba(22,163,74,0.1)' : 'rgba(239,68,68,0.08)',
        }}>{msg.texto}</div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        {filtros.map(([k, label]) => (
          <button key={k} onClick={() => setFiltro(k)} className="btn btn-sm" style={{
            background: filtro === k ? 'var(--primary)' : undefined, color: filtro === k ? '#fff' : undefined,
            borderColor: filtro === k ? 'var(--primary)' : undefined,
          }}>{label} ({conteos[k] ?? 0})</button>
        ))}
        <input className="input" style={{ flex: '1 1 200px', maxWidth: 320, padding: '6px 10px', fontSize: 13 }}
          placeholder="Buscar por título, SKU o código MLA…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" style={{ width: 'auto', fontSize: 13, padding: '6px 10px' }} value={PRESETS.some(([k]) => k === orden.col + '|' + orden.dir) ? orden.col + '|' + orden.dir : ''}
          onChange={(e) => { const [col, dir] = e.target.value.split('|'); if (col) setOrden({ col, dir }) }} title="Ordenar publicaciones">
          <option value="" disabled>Ordenar por…</option>
          {PRESETS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
      </div>

      {loading ? (
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>Cargando...</div>
      ) : pubs.length === 0 ? (
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)', border: '1px dashed var(--border)', borderRadius: 8 }}>
          Todavía no trajiste tus publicaciones. Tocá <strong>Traer publicaciones de ML</strong> (la cuenta tiene que estar conectada en Configuración → Integraciones).
        </div>
      ) : (
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 56 }}></th>
                <th style={{ cursor: 'pointer' }} onClick={() => ordenarPor('titulo')}>Publicación{flecha('titulo')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => ordenarPor('sku')}>Producto del programa{flecha('sku')}</th>
                <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => ordenarPor('precio')}>Precio{flecha('precio')}</th>
                <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => ordenarPor('stock')}>Stock{flecha('stock')}</th>
                <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => ordenarPor('vendidos')}>Vendidos{flecha('vendidos')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => ordenarPor('estado')}>Estado{flecha('estado')}</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((p) => {
                const est = ESTADOS[p.estado] || { label: p.estado || '—', color: '#64748b', bg: 'rgba(100,116,139,0.14)' }
                const prod = p.producto_id ? prods[p.producto_id] : null
                return (
                  <tr key={p.id}>
                    <td>{p.thumbnail && <img src={p.thumbnail} alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6 }} />}</td>
                    <td>
                      <a href={p.permalink} target="_blank" rel="noreferrer" style={{ fontWeight: 600, color: 'var(--text)' }}>{p.titulo}</a>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.item_id}{p.sku ? ` · SKU ${p.sku}` : ' · sin SKU'}</div>
                    </td>
                    <td style={{ fontSize: 13 }}>
                      {prod ? <>{prod.nombre} <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{prod.sku}</span></>
                        : <span style={{ color: '#b45309', fontSize: 12 }}>Sin vincular</span>}
                    </td>
                    <td style={{ textAlign: 'right' }}>{fmtMoney(p.precio)}</td>
                    <td style={{ textAlign: 'right' }}>{p.stock ?? '—'}</td>
                    <td style={{ textAlign: 'right' }}>{p.vendidos ?? 0}</td>
                    <td><span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, color: est.color, background: est.bg }}>{est.label}</span></td>
                  </tr>
                )
              })}
              {visibles.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 16 }}>Sin resultados.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
