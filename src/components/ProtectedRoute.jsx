import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'

export default function ProtectedRoute({ children, nivel = null }) {
  const { session, profile, loading, profileLoading, isMaster, isAdmin } = useAuth()
  if (loading || (session && profileLoading)) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>
        Cargando...
      </div>
    )
  }
  if (!session) return <Navigate to="/login" replace />
  if (profile !== null) {
    if (nivel === 'master' && !isMaster) return <Navigate to="/ventas" replace />
    if (nivel === 'admin'  && !isAdmin)  return <Navigate to="/ventas" replace />
  }
  return children
}
