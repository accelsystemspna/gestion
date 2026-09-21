// Productos, clientes y cupones de la tienda (lo que muestra el panel de WooCommerce), leídos en vivo.
import { useCallback, useEffect, useState } from 'react'
import ImageThumb from '../../../components/ImageThumb'
import { fmtMoney } from '../../../lib/format'
import { invocarWoo, esLocalUrl, fmtSoloFecha } from '../../../lib/wooPanel'
import { Aviso, Badge, Paginador, Vacio } from './ui'

const POR_PAGINA = 20

function useListado(tienda, accion, filtros) {
  const [pagina, setPagina] = useState(1)
  const [estado, setEstado] = useState({ items: [], total: 0, cargando: true, error: '' })
  const clave = JSON.stringify(filtros)
  useEffect(() => { setPagina(1) }, [tienda.id, clave])
  const cargar = useCallback(async () => {
    setEstado(e => ({ ...e, cargando: true }))
    const r = await invocarWoo(accion, tienda.id, { pagina, por_pagina: POR_PAGINA, ...filtros })
    setEstado(r.ok ? { items: r.items, total: r.total ?? r.items.length, cargando: false, error: '' } : { items: [], total: 0, cargando: false, error: r.error })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tienda.id, accion, pagina, clave])
  useEffect(() => { cargar() }, [cargar])
  return { ...estado, pagina, setPagina, cargar }
}

const Tabla = ({ columnas, children, minWidth = 700 }) => (
  <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)' }}>
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth }}>
      <thead>
        <tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {columnas.map(c => <th key={c} style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>{c}</th>)}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  </div>
)
const td = { padding: '9px 12px', borderBottom: '1px solid var(--border)' }

function SoloConAcceso({ tienda, children }) {
  if (esLocalUrl(tienda.url)) {
    return <Aviso tipo="info">Esta tienda es local ({tienda.url}): el servidor del programa no puede llegar a ella desde internet. Esta sección funciona con la tienda real (HTTPS).</Aviso>
  }
  return children
}

// ── Productos ───────────────────────────────────────────────────────────────
export function ProductosWoo({ tienda }) {
  const [buscar, setBuscar] = useState('')
  const [buscarAplicado, setBuscarAplicado] = useState('')
  const [estadoP, setEstadoP] = useState('')
  const [stock, setStock] = useState('')
  useEffect(() => { const t = setTimeout(() => setBuscarAplicado(buscar), 400); return () => clearTimeout(t) }, [buscar])
  const l = useListado(tienda, 'productos', { buscar: buscarAplicado, estado: estadoP, stock })

  return (
    <SoloConAcceso tienda={tienda}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <input className="input" style={{ width: 260, padding: '6px 10px', fontSize: 13 }} placeholder="Buscar producto o SKU…" value={buscar} onChange={e => setBuscar(e.target.value)} />
        <select className="input" style={{ width: 'auto', padding: '6px 10px', fontSize: 13 }} value={estadoP} onChange={e => setEstadoP(e.target.value)}>
          <option value="">Todos los estados</option><option value="publish">Publicados</option><option value="draft">Borradores</option><option value="private">Privados</option>
        </select>
        <select className="input" style={{ width: 'auto', padding: '6px 10px', fontSize: 13 }} value={stock} onChange={e => setStock(e.target.value)}>
          <option value="">Todo el stock</option><option value="instock">En stock</option><option value="outofstock">Sin stock</option><option value="onbackorder">Bajo pedido</option>
        </select>
        <button className="btn btn-sm" onClick={l.cargar} disabled={l.cargando}>Actualizar</button>
      </div>
      {l.error && <Aviso tipo="error">{l.error}</Aviso>}
      {!l.error && !l.cargando && l.items.length === 0 ? <Vacio>No hay productos con ese filtro.</Vacio> : (
        <Tabla columnas={['Producto', 'SKU', 'Precio', 'Stock', 'Estado', 'Categorías', 'En el programa']} minWidth={860}>
          {l.items.map(p => (
            <tr key={p.id}>
              <td style={td}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {p.imagen ? <ImageThumb src={p.imagen} size={40} radius={6} alt={p.nombre} /> : <div style={{ width: 40, height: 40, borderRadius: 6, background: 'var(--bg-muted)' }} />}
                  {p.enlace ? <a href={p.enlace} target="_blank" rel="noreferrer" style={{ fontWeight: 700 }}>{p.nombre}</a> : <strong>{p.nombre}</strong>}
                </div>
              </td>
              <td style={{ ...td, fontFamily: 'monospace' }}>{p.sku || '—'}</td>
              <td style={td}>
                {p.en_oferta && p.oferta != null
                  ? <><span style={{ textDecoration: 'line-through', color: 'var(--text-muted)', marginRight: 6 }}>{fmtMoney(p.regular)}</span><strong style={{ color: '#b91c1c' }}>{fmtMoney(p.oferta)}</strong></>
                  : p.precio != null ? fmtMoney(p.precio) : '—'}
              </td>
              <td style={td}>{p.stock === 'instock' ? <Badge color="#15803d" bg="#dcfce7">En stock</Badge> : p.stock === 'outofstock' ? <Badge color="#b91c1c" bg="#fee2e2">Sin stock</Badge> : <Badge color="#b45309" bg="#ffedd5">Bajo pedido</Badge>}</td>
              <td style={td}>{p.estado === 'publish' ? 'Publicado' : p.estado === 'draft' ? 'Borrador' : p.estado}</td>
              <td style={{ ...td, fontSize: 12, color: 'var(--text-muted)' }}>{p.categorias.join(', ') || '—'}</td>
              <td style={td}>{!p.sku ? <span style={{ color: 'var(--text-muted)' }}>Sin SKU</span> : p.en_programa ? <Badge color="#15803d" bg="#dcfce7">Sincronizado</Badge> : <Badge color="#b45309" bg="#fef3c7">Solo en la web</Badge>}</td>
            </tr>
          ))}
        </Tabla>
      )}
      <Paginador pagina={l.pagina} total={l.total} porPagina={POR_PAGINA} onCambio={l.setPagina} />
    </SoloConAcceso>
  )
}

// ── Clientes ────────────────────────────────────────────────────────────────
export function ClientesWoo({ tienda }) {
  const [buscar, setBuscar] = useState('')
  const [aplicado, setAplicado] = useState('')
  useEffect(() => { const t = setTimeout(() => setAplicado(buscar), 400); return () => clearTimeout(t) }, [buscar])
  const l = useListado(tienda, 'clientes', { buscar: aplicado })
  return (
    <SoloConAcceso tienda={tienda}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input className="input" style={{ width: 260, padding: '6px 10px', fontSize: 13 }} placeholder="Buscar cliente…" value={buscar} onChange={e => setBuscar(e.target.value)} />
        <span style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>Clientes con cuenta en la tienda. Los que compran sin registrarse figuran en la pestaña Clientes de arriba.</span>
      </div>
      {l.error && <Aviso tipo="error">{l.error}</Aviso>}
      {!l.error && !l.cargando && l.items.length === 0 ? <Vacio>No hay clientes registrados.</Vacio> : (
        <Tabla columnas={['Cliente', 'Email', 'Teléfono', 'Pedidos', 'Gastado', 'Registrado']} minWidth={700}>
          {l.items.map(c => (
            <tr key={c.id}>
              <td style={{ ...td, fontWeight: 700 }}>{c.nombre}</td>
              <td style={td}><a href={`mailto:${c.email}`}>{c.email}</a></td>
              <td style={td}>{c.telefono || '—'}</td>
              <td style={td}>{c.pedidos ?? '—'}</td>
              <td style={td}>{c.gastado != null ? fmtMoney(c.gastado) : '—'}</td>
              <td style={{ ...td, color: 'var(--text-muted)' }}>{fmtSoloFecha(c.registrado)}</td>
            </tr>
          ))}
        </Tabla>
      )}
      <Paginador pagina={l.pagina} total={l.total} porPagina={POR_PAGINA} onCambio={l.setPagina} />
    </SoloConAcceso>
  )
}

// ── Cupones ─────────────────────────────────────────────────────────────────
const TIPO_CUPON = { percent: 'Porcentaje', fixed_cart: 'Monto fijo en el carrito', fixed_product: 'Monto fijo por producto' }
export function CuponesWoo({ tienda }) {
  const l = useListado(tienda, 'cupones', {})
  return (
    <SoloConAcceso tienda={tienda}>
      {l.error && <Aviso tipo="error">{l.error}</Aviso>}
      {!l.error && !l.cargando && l.items.length === 0 ? <Vacio>No hay cupones creados.</Vacio> : (
        <Tabla columnas={['Código', 'Descuento', 'Usos', 'Vence', 'Descripción']} minWidth={640}>
          {l.items.map(c => (
            <tr key={c.id}>
              <td style={{ ...td, fontFamily: 'monospace', fontWeight: 800 }}>{c.codigo}</td>
              <td style={td}>{c.tipo === 'percent' ? `${c.monto}%` : fmtMoney(c.monto)} <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{TIPO_CUPON[c.tipo] || c.tipo}</span></td>
              <td style={td}>{c.usos}{c.limite ? ` / ${c.limite}` : ''}</td>
              <td style={td}>{c.vence ? fmtSoloFecha(c.vence) : 'Sin vencimiento'}</td>
              <td style={{ ...td, color: 'var(--text-muted)' }}>{c.descripcion || '—'}</td>
            </tr>
          ))}
        </Tabla>
      )}
      <Paginador pagina={l.pagina} total={l.total} porPagina={POR_PAGINA} onCambio={l.setPagina} />
    </SoloConAcceso>
  )
}
