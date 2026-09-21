// Panel de WooCommerce dentro de "Tiendas": pedidos, productos, clientes, cupones, resumen y conexión.
import { useMemo, useState } from 'react'
import { esLocalUrl, hace } from '../../../lib/wooPanel'
import { Vacio } from './ui'
import PedidosWoo from './PedidosWoo'
import { ProductosWoo, ClientesWoo, CuponesWoo } from './CatalogoWoo'
import ResumenWoo from './ResumenWoo'
import ConexionWoo from './ConexionWoo'

const SECCIONES = [
  ['pedidos', 'Pedidos'], ['productos', 'Productos'], ['clientes', 'Clientes'], ['cupones', 'Cupones'],
  ['resumen', 'Resumen'], ['conexion', 'Conexión'],
]

export default function WooPanel({ tiendas, tiendaSelId, ventas, onCambio }) {
  const woos = tiendas.filter(t => t.tipo === 'woocommerce')
  const inicial = woos.find(t => String(t.id) === String(tiendaSelId)) || woos[0] || null
  const [id, setId] = useState(inicial ? String(inicial.id) : '')
  const [seccion, setSeccion] = useState('pedidos')
  const tienda = woos.find(t => String(t.id) === String(id)) || inicial

  // Para saber qué pedidos ya son una venta en el programa
  const ventasPorRef = useMemo(() => {
    const m = new Map()
    for (const v of ventas || []) if (v.tienda_id != null && v.origen_ref) m.set(`${v.tienda_id}:${v.origen_ref}`, v)
    return m
  }, [ventas])

  if (!tienda) {
    return <Vacio>Todavía no hay ninguna tienda WooCommerce. Se agrega en Configuración → Integraciones.</Vacio>
  }

  const local = esLocalUrl(tienda.url)
  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        {woos.length > 1 ? (
          <select className="input" value={tienda.id} onChange={e => setId(e.target.value)} style={{ width: 'auto', padding: '6px 10px', fontSize: 13, fontWeight: 700 }} aria-label="Tienda">
            {woos.map(t => <option key={t.id} value={t.id}>{t.nombre} — {t.url}</option>)}
          </select>
        ) : <strong style={{ fontSize: 14 }}>{tienda.nombre} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>— {tienda.url}</span></strong>}
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Último aviso de la tienda: <strong>{hace(tienda.ultimo_webhook_en)}</strong>{local ? ' · sitio local' : ''}
        </span>
      </div>

      <div role="tablist" style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 14 }}>
        {SECCIONES.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={seccion === k} onClick={() => setSeccion(k)} className="btn btn-sm" style={{
            background: seccion === k ? 'var(--text)' : undefined, color: seccion === k ? 'var(--bg)' : undefined, borderColor: seccion === k ? 'var(--text)' : undefined,
          }}>{label}</button>
        ))}
      </div>

      {seccion === 'pedidos'   && <PedidosWoo key={tienda.id} tienda={tienda} ventasPorRef={ventasPorRef} onCambio={onCambio} />}
      {seccion === 'productos' && <ProductosWoo key={tienda.id} tienda={tienda} />}
      {seccion === 'clientes'  && <ClientesWoo key={tienda.id} tienda={tienda} />}
      {seccion === 'cupones'   && <CuponesWoo key={tienda.id} tienda={tienda} />}
      {seccion === 'resumen'   && <ResumenWoo key={tienda.id} tienda={tienda} />}
      {seccion === 'conexion'  && <ConexionWoo key={tienda.id} tienda={tienda} onCambio={onCambio} />}
    </div>
  )
}
