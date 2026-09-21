// Lista de pedidos de WooCommerce, como la pantalla "Pedidos" del panel de WooCommerce.
import { useCallback, useEffect, useRef, useState } from 'react'
import { fmtMoney } from '../../../lib/format'
import {
  ESTADOS_ELEGIBLES, estadoWooInfo, listarPedidosWoo, contarPorEstado, sincronizarPedidos, esLocalUrl, fmtFechaHora,
} from '../../../lib/wooPanel'
import { Aviso, EstadoWoo, Paginador, Vacio } from './ui'
import DetallePedidoWoo from './DetallePedidoWoo'

const POR_PAGINA = 25

export default function PedidosWoo({ tienda, ventasPorRef, onCambio }) {
  const local = esLocalUrl(tienda.url)
  const [estado, setEstado] = useState('todos')
  const [q, setQ] = useState('')
  const [qAplicada, setQAplicada] = useState('')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [pagina, setPagina] = useState(1)
  const [datos, setDatos] = useState({ filas: [], total: 0 })
  const [conteos, setConteos] = useState({ todos: 0 })
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [abierto, setAbierto] = useState(null)
  const [sync, setSync] = useState(null)        // { corriendo, texto, tipo }
  const pedido = useRef(0)                       // evita que una respuesta lenta pise a una más nueva

  const cargar = useCallback(async () => {
    const n = ++pedido.current
    setCargando(true)
    const [lista, c] = await Promise.all([
      listarPedidosWoo(tienda.id, { estado, q: qAplicada, desde, hasta, pagina, porPagina: POR_PAGINA }),
      contarPorEstado(tienda.id),
    ])
    if (n !== pedido.current) return
    setError(lista.error || '')
    setDatos({ filas: lista.filas, total: lista.total })
    setConteos(c.conteos)
    setCargando(false)
  }, [tienda.id, estado, qAplicada, desde, hasta, pagina])

  useEffect(() => { cargar() }, [cargar])
  useEffect(() => { setPagina(1) }, [tienda.id, estado, qAplicada, desde, hasta])
  // Espera un instante después de escribir para no consultar en cada tecla
  useEffect(() => { const t = setTimeout(() => setQAplicada(q), 350); return () => clearTimeout(t) }, [q])

  const sincronizar = async () => {
    setSync({ corriendo: true, texto: 'Buscando pedidos en WooCommerce…', tipo: 'info' })
    const r = await sincronizarPedidos(tienda.id, {
      onProgreso: ({ pagina: p, paginas, acumulado }) => setSync({ corriendo: true, tipo: 'info', texto: `Importando… página ${p} de ${paginas} (${acumulado.procesados} pedidos)` }),
    })
    if (!r.ok) { setSync({ corriendo: false, tipo: 'error', texto: r.error }); return }
    setSync({
      corriendo: false, tipo: r.errores ? 'aviso' : 'ok',
      texto: `Listo: ${r.procesados} pedidos revisados · ${r.nuevas_ventas} ventas nuevas · ${r.actualizados} actualizados · ${r.sin_cambios} sin cambios${r.errores ? ` · ${r.errores} con error` : ''}.`,
    })
    cargar(); onCambio?.()
  }

  const filtros = ['todos', ...ESTADOS_ELEGIBLES]

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input className="input" style={{ width: 260, padding: '6px 10px', fontSize: 13 }} placeholder="Buscar por cliente, email o N° de pedido…" value={q} onChange={e => setQ(e.target.value)} />
          <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', gap: 4, alignItems: 'center' }}>Desde
            <input className="input" type="date" style={{ padding: '5px 8px', fontSize: 12, width: 'auto' }} value={desde} onChange={e => setDesde(e.target.value)} />
          </label>
          <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', gap: 4, alignItems: 'center' }}>Hasta
            <input className="input" type="date" style={{ padding: '5px 8px', fontSize: 12, width: 'auto' }} value={hasta} onChange={e => setHasta(e.target.value)} />
          </label>
          {(desde || hasta || q) && <button className="btn btn-sm btn-ghost" onClick={() => { setQ(''); setDesde(''); setHasta('') }}>Limpiar</button>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sm" onClick={cargar} disabled={cargando}>Actualizar</button>
          <button className="btn btn-sm btn-primary" onClick={sincronizar} disabled={local || sync?.corriendo}
            title={local ? 'La tienda es local: el servidor no puede llegar a ella.' : 'Trae de WooCommerce los pedidos que todavía no están en el programa'}>
            {sync?.corriendo ? 'Sincronizando…' : 'Sincronizar pedidos'}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {filtros.map(k => {
          const activo = estado === k
          const n = conteos[k] ?? 0
          if (k !== 'todos' && k !== estado && n === 0) return null
          return (
            <button key={k} onClick={() => setEstado(k)} className="btn btn-sm" style={{
              background: activo ? 'var(--primary)' : undefined, color: activo ? '#fff' : undefined, borderColor: activo ? 'var(--primary)' : undefined,
            }}>{k === 'todos' ? 'Todos' : estadoWooInfo(k).label} ({n})</button>
          )
        })}
        {(conteos.trash || 0) > 0 && (
          <button onClick={() => setEstado('trash')} className="btn btn-sm btn-ghost" style={{ marginLeft: 'auto' }}>Papelera ({conteos.trash})</button>
        )}
      </div>

      {sync && <Aviso tipo={sync.tipo} onClose={sync.corriendo ? undefined : () => setSync(null)}>{sync.texto}</Aviso>}
      {error && <Aviso tipo="aviso">{/pedidos_web/.test(error) ? <>Falta correr <strong>supabase_woo_panel.sql</strong> en Supabase (SQL Editor). Detalle: {error}</> : error}</Aviso>}

      {cargando && datos.filas.length === 0 ? (
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>Cargando pedidos…</div>
      ) : datos.filas.length === 0 ? (
        <Vacio>
          {conteos.todos === 0
            ? <>Todavía no hay pedidos de esta tienda en el programa.<br />{local ? 'Los pedidos llegan solos cuando WooCommerce avisa (webhook).' : 'Apretá "Sincronizar pedidos" para traer los que ya tiene WooCommerce.'}</>
            : 'No hay pedidos con ese filtro.'}
        </Vacio>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 780 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {['Pedido', 'Fecha', 'Estado', 'Productos', 'Pago', 'Total', 'En el programa'].map((h, i) => (
                  <th key={h} style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: i === 5 ? 'right' : 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {datos.filas.map(p => {
                const items = p.items || []
                const venta = ventasPorRef?.get(`${tienda.id}:WC#${p.woo_id}`)
                return (
                  <tr key={p.id} onClick={() => setAbierto(p.woo_id)} style={{ cursor: 'pointer', borderBottom: '1px solid var(--border)', opacity: p.estado === 'cancelled' || p.estado === 'trash' ? 0.6 : 1 }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-muted)' }} onMouseLeave={e => { e.currentTarget.style.background = '' }}>
                    <td style={{ padding: '10px 12px' }}>
                      <div><strong>#{p.numero}</strong> <span style={{ fontWeight: 600 }}>{p.cliente_nombre || 'Sin nombre'}</span></div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.cliente_email}</div>
                    </td>
                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>{fmtFechaHora(p.fecha_creado)}</td>
                    <td style={{ padding: '10px 12px' }}><EstadoWoo estado={p.estado} /></td>
                    <td style={{ padding: '10px 12px', maxWidth: 240 }}>
                      {items.length === 0 ? '—' : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {items.slice(0, 3).map(it => it.image?.src
                            ? <img key={it.id} src={it.image.src} alt="" title={`${it.quantity} × ${it.name}`} style={{ width: 34, height: 34, borderRadius: 6, objectFit: 'cover', border: '1px solid var(--border)' }} />
                            : <span key={it.id} style={{ width: 34, height: 34, borderRadius: 6, background: 'var(--bg-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>{it.quantity}×</span>)}
                          <span style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {items.length === 1 ? `${items[0].quantity} × ${items[0].name}` : `${items.length} productos`}
                          </span>
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '10px 12px', color: 'var(--text-muted)' }}>{p.metodo_pago_titulo || p.metodo_pago || '—'}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 800, whiteSpace: 'nowrap' }}>{fmtMoney(p.total)}</td>
                    <td style={{ padding: '10px 12px', fontSize: 12 }}>
                      {venta ? <span style={{ color: '#15803d', fontWeight: 700 }}>Venta N° {venta.numero}</span> : <span style={{ color: 'var(--text-muted)' }}>Sin venta</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <Paginador pagina={pagina} total={datos.total} porPagina={POR_PAGINA} onCambio={setPagina} />

      {abierto && <DetallePedidoWoo tienda={tienda} wooId={abierto} onClose={() => setAbierto(null)} onCambio={() => { cargar(); onCambio?.() }} />}
    </div>
  )
}
