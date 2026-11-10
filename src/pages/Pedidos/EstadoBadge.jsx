import { ESTADOS } from '../../lib/pedidos'

// Estado del pedido: un punto de color y la palabra, sin fondo.
export default function EstadoBadge({ estado }) {
  const e = ESTADOS[estado] || { label: estado, color: '#64748b' }
  return (
    <span style={{ fontSize: 12, fontWeight: 500, color: e.color, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', background: e.color, flexShrink: 0 }} />
      {e.label}
    </span>
  )
}
