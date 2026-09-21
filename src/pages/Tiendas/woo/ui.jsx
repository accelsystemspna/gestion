// Piezas de interfaz compartidas por el panel de WooCommerce (sección Tiendas).
import { estadoWooInfo } from '../../../lib/wooPanel'

export function Badge({ children, color, bg, title }) {
  return (
    <span title={title} style={{
      display: 'inline-block', fontSize: 11, fontWeight: 700, padding: '2px 8px',
      borderRadius: 999, background: bg, color, whiteSpace: 'nowrap',
    }}>{children}</span>
  )
}

export function EstadoWoo({ estado }) {
  const i = estadoWooInfo(estado)
  return <Badge color={i.color} bg={i.bg}>{i.label}</Badge>
}

export function Kpi({ label, value, sub, color }) {
  return (
    <div style={{ flex: '1 1 150px', padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: color || 'var(--text)', marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{sub}</div>}
    </div>
  )
}

export function Aviso({ tipo = 'aviso', children, onClose }) {
  const colores = {
    error: { bg: '#fee2e2', fg: '#7f1d1d' }, aviso: { bg: '#fef3c7', fg: '#78350f' },
    ok: { bg: '#dcfce7', fg: '#14532d' }, info: { bg: '#e0f2fe', fg: '#0c4a6e' },
  }[tipo]
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '10px 14px', marginBottom: 12, borderRadius: 8, fontSize: 13, background: colores.bg, color: colores.fg }}>
      <span>{children}</span>
      {onClose && <span style={{ cursor: 'pointer', fontWeight: 700 }} onClick={onClose}>✕</span>}
    </div>
  )
}

export function Vacio({ children }) {
  return <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)', border: '1px dashed var(--border)', borderRadius: 8 }}>{children}</div>
}

export function Paginador({ pagina, total, porPagina, onCambio }) {
  const paginas = Math.max(1, Math.ceil(total / porPagina))
  if (paginas <= 1) return null
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'center', marginTop: 14, fontSize: 13 }}>
      <button className="btn btn-sm" disabled={pagina <= 1} onClick={() => onCambio(pagina - 1)}>‹ Anterior</button>
      <span style={{ color: 'var(--text-muted)' }}>Página {pagina} de {paginas} · {total} en total</span>
      <button className="btn btn-sm" disabled={pagina >= paginas} onClick={() => onCambio(pagina + 1)}>Siguiente ›</button>
    </div>
  )
}

/** Panel lateral que se abre sobre la pantalla (detalle de un pedido). */
export function Cajon({ titulo, subtitulo, onClose, children, ancho = 820 }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 9000, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label={titulo}
        style={{ width: `min(${ancho}px, 100vw)`, height: '100%', overflowY: 'auto', background: 'var(--bg)', boxShadow: '-8px 0 30px rgba(0,0,0,0.25)' }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '14px 20px', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{titulo}</div>
            {subtitulo && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{subtitulo}</div>}
          </div>
          <button className="btn btn-sm" onClick={onClose} aria-label="Cerrar">✕ Cerrar</button>
        </div>
        <div style={{ padding: 20 }}>{children}</div>
      </div>
    </div>
  )
}

export const Tarjeta = ({ titulo, children, style }) => (
  <section style={{ border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)', padding: '14px 16px', ...style }}>
    {titulo && <h3 style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>{titulo}</h3>}
    {children}
  </section>
)
