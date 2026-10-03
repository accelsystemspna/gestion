import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { precioVenta } from '../../lib/pricing'
import { fmtMoney } from '../../lib/format'
import { mlApi } from '../../lib/mlApi'

const soloTexto = (html) => String(html || '').replace(/<\s*br\s*\/?>|<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()

// Publicar un producto en Mercado Libre: primero se valida (ML lo revisa sin publicarlo) y recién
// con "Publicar" sale a la venta. La estructura (envío, garantía, marca...) se copia de una publicación tuya.
export default function PublicarMLModal({ producto, listas, onClose }) {
  const lista = (listas || []).find((l) => /mercado\s*libre/i.test(l.nombre))
  const sugerido = lista ? Math.round(precioVenta(Number(producto.costo_base) || 0, lista)) : ''
  const [titulo, setTitulo] = useState((producto.ml_titulo || String(producto.seo_titulo || '').split('|')[0] || producto.nombre || '').trim().slice(0, 60))
  const [precio, setPrecio] = useState(producto.ml_precio || sugerido)
  const [stock, setStock]   = useState(Math.max(Number(producto.stock_actual) || 0, 0) || 10)
  const [existentes, setExistentes] = useState([])
  const [estado, setEstado] = useState(null)   // { tipo: 'ok'|'error', texto, avisos?, vista? }
  const [ocupado, setOcupado] = useState('')
  const [publicado, setPublicado] = useState(null)

  useEffect(() => {
    supabase.from('ml_publicaciones').select('item_id, titulo, estado, permalink').eq('producto_id', producto.id)
      .then(({ data }) => setExistentes(data || []))
  }, [producto.id])

  const pedido = () => ({ titulo, precio: Number(precio), stock: Number(stock) })

  const validar = async () => {
    setOcupado('validar'); setEstado(null)
    try {
      const r = await mlApi('publish', { producto_id: producto.id, validar: true, pedido: pedido() })
      setEstado({ tipo: 'ok', texto: 'Mercado Libre aprobó el producto. Todavía no está publicado.', avisos: r.avisos, vista: r.vista })
    } catch (err) { setEstado({ tipo: 'error', texto: err.message }) }
    setOcupado('')
  }

  const publicar = async () => {
    if (!confirm(`¿Publicar "${titulo}" en Mercado Libre a ${fmtMoney(Number(precio))}?`)) return
    setOcupado('publicar'); setEstado(null)
    try {
      const r = await mlApi('publish', { producto_id: producto.id, pedido: pedido() })
      setPublicado(r)
    } catch (err) { setEstado({ tipo: 'error', texto: err.message }) }
    setOcupado('')
  }

  const campo = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-muted)' }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ margin: 0 }}>🛒 Publicar en Mercado Libre</h3>
          <button className="btn btn-sm btn-ghost" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 13 }}>
            <strong>{producto.nombre}</strong> <code style={{ color: 'var(--text-muted)' }}>{producto.sku}</code>
          </div>

          {publicado ? (
            <div style={{ padding: 12, borderRadius: 8, background: 'rgba(22,163,74,0.1)', color: '#15803d', fontSize: 13 }}>
              ✅ Publicado ({publicado.estado}). <a href={publicado.permalink} target="_blank" rel="noreferrer">Ver en Mercado Libre</a>
              {publicado.error_descripcion && <div style={{ color: '#b45309', marginTop: 6 }}>⚠ La descripción no se pudo cargar: {publicado.error_descripcion}</div>}
            </div>
          ) : (<>
            {existentes.length > 0 && (
              <div style={{ padding: 10, borderRadius: 8, background: 'rgba(217,119,6,0.1)', color: '#92400e', fontSize: 12 }}>
                Este producto ya tiene {existentes.length === 1 ? 'una publicación' : `${existentes.length} publicaciones`} en ML:{' '}
                {existentes.map((e) => <a key={e.item_id} href={e.permalink} target="_blank" rel="noreferrer" style={{ marginRight: 8 }}>{e.item_id}</a>)}
                Si publicás de nuevo se crea otra.
              </div>
            )}
            <label style={campo}>Título (máx. 60 caracteres)
              <input className="input" value={titulo} maxLength={60} onChange={(e) => setTitulo(e.target.value)} />
              <span style={{ textAlign: 'right' }}>{titulo.length}/60</span>
            </label>
            <div style={{ display: 'flex', gap: 12 }}>
              <label style={{ ...campo, flex: 1 }}>Precio en ML ($)
                <input className="input" type="number" value={precio} onChange={(e) => setPrecio(e.target.value)} />
                <span>{lista ? `Sugerido con la lista "${lista.nombre}"` : 'No hay una lista "Mercado Libre": poné el precio a mano'}</span>
              </label>
              <label style={{ ...campo, flex: 1 }}>Stock
                <input className="input" type="number" min="1" value={stock} onChange={(e) => setStock(e.target.value)} />
                <span>Mercado Libre pide al menos 1</span>
              </label>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Fotos y descripción salen de la pestaña Mercado Libre del producto (si está vacía, de las generales: {(producto.ml_imagenes?.length ? producto.ml_imagenes : [producto.imagen_web_url, ...(producto.imagenes_web || []), producto.imagen_url].filter(Boolean)).length} foto(s)
              {(producto.ml_descripcion || soloTexto(producto.descripcion)) ? '' : ', sin descripción'}). Envío, garantía y marca se copian de una publicación tuya.
            </div>
            {(producto.ml_descripcion || soloTexto(producto.descripcion)) && (
              <div style={{ fontSize: 12, maxHeight: 90, overflow: 'auto', padding: 8, border: '1px solid var(--border)', borderRadius: 6, whiteSpace: 'pre-wrap' }}>
                {producto.ml_descripcion || soloTexto(producto.descripcion)}
              </div>
            )}
            {estado && (
              <div style={{
                padding: '8px 12px', borderRadius: 6, fontSize: 13,
                color: estado.tipo === 'ok' ? '#15803d' : 'var(--danger)',
                background: estado.tipo === 'ok' ? 'rgba(22,163,74,0.1)' : 'rgba(239,68,68,0.08)',
              }}>
                {estado.texto}
                {estado.avisos?.length > 0 && <div style={{ color: '#92400e', marginTop: 4 }}>Avisos: {estado.avisos.join(' · ')}</div>}
              </div>
            )}
          </>)}
        </div>
        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn" onClick={onClose}>{publicado ? 'Cerrar' : 'Cancelar'}</button>
          {!publicado && <>
            <button className="btn" onClick={validar} disabled={!!ocupado || !(Number(precio) > 0) || !titulo.trim()}>
              {ocupado === 'validar' ? 'Validando...' : 'Validar'}
            </button>
            <button className="btn btn-primary" onClick={publicar} disabled={!!ocupado || !(Number(precio) > 0) || !titulo.trim()}>
              {ocupado === 'publicar' ? 'Publicando...' : 'Publicar'}
            </button>
          </>}
        </div>
      </div>
    </div>
  )
}
