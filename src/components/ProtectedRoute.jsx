import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'

export default function ProtectedRoute({ children }) {
  const { session, loading } = useAuth()
  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>
        Cargando...
      </div>
    )
  }
  if (!session) return <Navigate to="/login" replace />
  return children
}
