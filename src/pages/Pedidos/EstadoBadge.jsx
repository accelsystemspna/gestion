import { ESTADOS } from '../../lib/pedidos'

export default function EstadoBadge({ estado }) {
  const e = ESTADOS[estado] || { label: estado, color: '#64748b', bg: 'rgba(100,116,139,0.14)' }
  return <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 999, color: e.color, background: e.bg, whiteSpace: 'nowrap' }}>{e.label}</span>
}
