import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { fmtMoney } from '../../lib/format'
import { ESTADOS, ESTADOS_ABIERTOS, pinDeTelefono, recalcularPedidosAbiertos, subirImagenPedido } from '../../lib/pedidos'
import { optimizarFoto } from '../../lib/imagenes'
import PedidoDetalle from './PedidoDetalle'
import EstadoBadge from './EstadoBadge'

const FILTROS = [['abiertos', 'Abiertos'], ...Object.entries(ESTADOS).map(([k, v]) => [k, v.label]), ['todos', 'Todos']]

export default function Pedidos() {
  const [params, setParams] = useSearchParams()
  const [idAAbrir] = useState(() => params.get('abrir'))   // se lee una sola vez, al entrar
  const [pedidos, setPedidos] = useState([])
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro]   = useState('abiertos')
  const [q, setQ]             = useState('')
  const [abierto, setAbierto] = useState(null)   // pedido abierto en el detalle
  const [nuevo, setNuevo]     = useState(false)
  const [aviso, setAviso]     = useState('')
  const [falta, setFalta]     = useState(false)

  const cargar = async () => {
    const { data, error } = await supabase.from('pedidos').select('*').order('created_at', { ascending: false }).limit(500)
    if (error) { setFalta(/relation|does not exist|schema cache/i.test(error.message)); setLoading(false); return [] }
    setPedidos(data || [])
    setLoading(false)
    return data || []
  }

  useEffect(() => {
    (async () => {
      let lista = await cargar()
      // Los pedidos sin seña siguen los costos de hoy: se actualizan al entrar.
      const cambiados = await recalcularPedidosAbiertos()
      if (cambiados) { lista = await cargar(); setAviso(`Se actualizó el precio de ${cambiados} pedido${cambiados !== 1 ? 's' : ''} sin seña porque cambiaron los costos.`) }
      // Si venimos de un presupuesto: se abre el pedido recién creado.
      if (idAAbrir) { const p = lista.find((x) => x.id === idAAbrir); if (p) setAbierto(p); setParams({}, { replace: true }) }
    })()
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  const conteos = useMemo(() => {
    const c = { abiertos: pedidos.filter((p) => ESTADOS_ABIERTOS.includes(p.estado)).length, todos: pedidos.length }
    for (const k of Object.keys(ESTADOS)) c[k] = pedidos.filter((p) => p.estado === k).length
    return c
  }, [pedidos])

  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase()
    return pedidos.filter((p) => {
      if (filtro === 'abiertos' ? !ESTADOS_ABIERTOS.includes(p.estado) : filtro !== 'todos' && p.estado !== filtro) return false
      return !t || [p.codigo, p.cliente_nombre, p.titulo, p.cliente_telefono].some((x) => String(x || '').toLowerCase().includes(t))
    })
  }, [pedidos, filtro, q])

  const alCambiar = (p) => {
    setPedidos((prev) => prev.some((x) => x.id === p.id) ? prev.map((x) => x.id === p.id ? p : x) : [p, ...prev])
    setAbierto(p)
  }

  if (falta) {
    return (
      <div style={{ padding: 20, borderRadius: 8, background: '#fef3c7', border: '1px solid #fcd34d', color: '#78350f', fontSize: 14 }}>
        Falta crear las tablas de Pedidos en Supabase: pegá el contenido de <strong>supabase_pedidos.sql</strong> en el SQL Editor y tocá Run.
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 24, marginBottom: 4 }}>Pedidos</h1>
          <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: 13 }}>
            Trabajos a pedido: del presupuesto a la entrega, con código de seguimiento, seña y saldo.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setNuevo(true)}>+ Nuevo pedido</button>
      </div>

      {aviso && <div style={{ padding: '8px 12px', marginBottom: 12, borderRadius: 6, background: 'rgba(14,116,144,0.1)', color: '#0e7490', fontSize: 13 }}>{aviso}</div>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        {FILTROS.map(([k, label]) => (
          <button key={k} onClick={() => setFiltro(k)} className="btn btn-sm" style={{
            background: filtro === k ? 'var(--primary)' : undefined, color: filtro === k ? '#fff' : undefined, borderColor: filtro === k ? 'var(--primary)' : undefined,
          }}>{label} ({conteos[k] ?? 0})</button>
        ))}
        <input className="input" style={{ flex: '1 1 220px', maxWidth: 340, padding: '6px 10px', fontSize: 13 }}
          placeholder="Buscar por cliente, código, celular o título…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {loading ? (
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>Cargando...</div>
      ) : visibles.length === 0 ? (
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)', border: '1px dashed var(--border)', borderRadius: 8 }}>
          {pedidos.length === 0 ? 'Todavía no hay pedidos. Creá uno con “+ Nuevo pedido” o pasá un presupuesto a pedido desde Presupuestos.' : 'No hay pedidos con ese filtro.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {visibles.map((p) => (
            <div key={p.id} onClick={() => setAbierto(p)} style={{
              display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr) auto', gap: 12, alignItems: 'center', cursor: 'pointer',
              padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface, var(--bg-card))',
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 14 }}>{p.cliente_nombre}</strong>
                  <EstadoBadge estado={p.estado} />
                  {p.precio_congelado && <span title="Precio congelado (ya tiene seña)" style={{ fontSize: 12 }}>🔒</span>}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.titulo}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  <code>{p.codigo}</code> · PIN {p.pin || '—'} · {new Date(p.created_at).toLocaleDateString('es-AR')}
                </div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                <div>Total: <strong style={{ color: 'var(--text)' }}>{fmtMoney(p.total)}</strong></div>
                <div>Seña: {fmtMoney(p.sena_monto)} · <span style={{ color: Number(p.saldo) > 0 && p.sena_monto > 0 ? '#b45309' : undefined, fontWeight: 600 }}>Saldo: {fmtMoney(p.saldo)}</span></div>
              </div>
              <span style={{ color: 'var(--text-muted)' }}>›</span>
            </div>
          ))}
        </div>
      )}

      {abierto && <PedidoDetalle pedido={abierto} onCambio={alCambiar} onCerrar={() => setAbierto(null)} onEliminado={(id) => { setPedidos((prev) => prev.filter((x) => x.id !== id)); setAbierto(null) }} />}
      {nuevo && <NuevoPedido onCancelar={() => setNuevo(false)} onCreado={(p) => { setNuevo(false); alCambiar(p) }} />}
    </div>
  )
}

// Alta manual de un pedido (lo normal es crearlo desde un presupuesto).
function NuevoPedido({ onCancelar, onCreado }) {
  const [clientes, setClientes] = useState([])
  const [f, setF] = useState({ cliente_id: '', cliente_nombre: '', cliente_telefono: '', titulo: '', descripcion: '', total: '' })
  const [guardando, setGuardando] = useState(false)
  const [fotos, setFotos] = useState({ imagenes_referencia: [], imagenes_resultado: [] })   // [{ file, url }] hasta que se crea el pedido
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const sucio = Object.values(f).some(Boolean) || fotos.imagenes_referencia.length > 0 || fotos.imagenes_resultado.length > 0
  const cancelar = () => { if (sucio && !confirm('Tenés datos cargados sin guardar. ¿Cerrar igual y perderlos?')) return; onCancelar() }
  const agregarFotos = (campo, e) => {
    const nuevas = [...(e.target.files || [])].map((file) => ({ file, url: URL.createObjectURL(file) }))
    e.target.value = ''
    setFotos((x) => ({ ...x, [campo]: [...x[campo], ...nuevas] }))
  }
  const quitarFoto = (campo, url) => setFotos((x) => ({ ...x, [campo]: x[campo].filter((y) => y.url !== url) }))

  useEffect(() => { supabase.from('clientes').select('id, nombre, telefono, email').order('nombre').then(({ data }) => setClientes(data || [])) }, [])

  const elegirCliente = (id) => {
    const c = clientes.find((x) => x.id === id)
    setF((x) => ({ ...x, cliente_id: id, cliente_nombre: c?.nombre || x.cliente_nombre, cliente_telefono: c?.telefono || x.cliente_telefono }))
  }

  const crear = async (e) => {
    e.preventDefault()
    setGuardando(true)
    const { data, error } = await supabase.from('pedidos').insert({
      cliente_id: f.cliente_id || null, cliente_nombre: f.cliente_nombre.trim(), cliente_telefono: f.cliente_telefono.trim() || null,
      titulo: f.titulo.trim(), descripcion: f.descripcion.trim() || null, total: Number(f.total) || 0,
    }).select('*').single()
    if (error) { setGuardando(false); return alert('Error: ' + error.message) }
    // Las fotos se suben recién ahora, porque la carpeta lleva el código del pedido (que se genera al crearlo).
    let final = data
    const cambios = {}
    for (const campo of ['imagenes_referencia', 'imagenes_resultado']) {
      const urls = []
      for (const { file } of fotos[campo]) {
        try { urls.push(await subirImagenPedido(data.codigo, campo, file, optimizarFoto)) } catch (err) { alert('No se pudo subir una imagen: ' + err.message) }
      }
      if (urls.length) cambios[campo] = urls
    }
    if (Object.keys(cambios).length) {
      const r = await supabase.from('pedidos').update(cambios).eq('id', data.id).select('*').single()
      if (r.data) final = r.data
    }
    setGuardando(false)
    onCreado(final)
  }

  const lbl = { fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }
  return (
    <div className="modal-overlay">
      <form className="modal" style={{ maxWidth: 560, maxHeight: '94vh', display: 'flex', flexDirection: 'column' }} onSubmit={crear}>
        <div className="modal-header"><h3 style={{ margin: 0 }}>Nuevo pedido</h3><button type="button" className="btn btn-ghost btn-sm" onClick={cancelar} title="Cerrar">✕</button></div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
          <div>
            <label style={lbl}>Cliente existente (opcional)</label>
            <select className="select" value={f.cliente_id} onChange={(e) => elegirCliente(e.target.value)}>
              <option value="">— Cliente nuevo —</option>
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}{c.telefono ? ` · ${c.telefono}` : ''}</option>)}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div><label style={lbl}>Nombre *</label><input className="input" value={f.cliente_nombre} onChange={(e) => set('cliente_nombre', e.target.value)} required /></div>
            <div>
              <label style={lbl}>Celular (WhatsApp)</label>
              <input className="input" value={f.cliente_telefono} onChange={(e) => set('cliente_telefono', e.target.value)} placeholder="Ej. 343 612 3456" />
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>PIN del cliente: {pinDeTelefono(f.cliente_telefono) || 'últimos 3 números del celular'}</span>
            </div>
          </div>
          <div><label style={lbl}>¿De qué se trata? *</label><input className="input" value={f.titulo} onChange={(e) => set('titulo', e.target.value)} required placeholder="Ej. Cuadro de Messi en MDF 45x60" /></div>
          <div><label style={lbl}>Detalle</label><textarea className="input" rows={3} value={f.descripcion} onChange={(e) => set('descripcion', e.target.value)} style={{ resize: 'vertical' }} /></div>
          <div><label style={lbl}>Precio ($)</label><input className="input" type="number" value={f.total} onChange={(e) => set('total', e.target.value)} placeholder="Podés dejarlo vacío y cargarlo después" /></div>
          {[['imagenes_referencia', '📷 Imágenes de referencia (las que mandó el cliente)'], ['imagenes_resultado', '🎨 Cómo quedaría (imágenes nuestras)']].map(([campo, titulo]) => (
            <div key={campo}>
              <label style={lbl}>{titulo}</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {fotos[campo].map(({ url }) => (
                  <div key={url} style={{ position: 'relative' }}>
                    <img src={url} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)', display: 'block' }} />
                    <button type="button" onClick={() => quitarFoto(campo, url)} style={{ position: 'absolute', top: -6, right: -6, background: 'var(--danger)', color: '#fff', border: 'none', borderRadius: '50%', width: 18, height: 18, fontSize: 11, cursor: 'pointer' }}>✕</button>
                  </div>
                ))}
                <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
                  + Agregar fotos
                  <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => agregarFotos(campo, e)} />
                </label>
              </div>
            </div>
          ))}
        </div>
        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn" onClick={cancelar}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={guardando}>{guardando ? 'Creando y subiendo fotos...' : 'Crear pedido'}</button>
        </div>
      </form>
    </div>
  )
}
