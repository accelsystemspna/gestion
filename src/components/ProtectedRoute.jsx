import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'

export default function ProtectedRoute({ children, soloAdmin = false }) {
  const { session, profile, loading, profileLoading } = useAuth()
  if (loading || (session && profileLoading)) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>
        Cargando...
      </div>
    )
  }
  if (!session) return <Navigate to="/login" replace />
  if (soloAdmin && profile !== null && profile?.rol !== 'admin') return <Navigate to="/ventas" replace />
  return children
}
