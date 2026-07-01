import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/AuthContext'

export default function Login() {
  const { signIn, signUp } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [nombre, setNombre] = useState('')
  const [error, setError] = useState(null)
  const [info, setInfo] = useState(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setLoading(true)
    try {
      if (mode === 'login') {
        const { error } = await signIn(email, password)
        if (error) throw error
        navigate('/home', { replace: true })
      } else {
        const { error } = await signUp(email, password, nombre)
        if (error) throw error
        setInfo('Cuenta creada. Revisá tu email para confirmarla, luego iniciá sesión.')
        setMode('login')
      }
    } catch (err) {
      setError(err.message || 'Error de autenticación')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0ea5e9 0%, #1e293b 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: 400,
          padding: 32,
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <h1 style={{ fontSize: 24, marginBottom: 4 }}>Gestión</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
            Carpintería · Melamina · Impresión 3D
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {mode === 'signup' && (
            <div className="field">
              <label>Nombre</label>
              <input
                className="input"
                type="text"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                required
              />
            </div>
          )}
          <div className="field">
            <label>Email</label>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <div className="field">
            <label>Contraseña</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </div>

          {error && (
            <div
              style={{
                padding: 10,
                background: '#fef2f2',
                color: '#991b1b',
                borderRadius: 6,
                fontSize: 13,
                border: '1px solid #fecaca',
              }}
            >
              {error}
            </div>
          )}
          {info && (
            <div
              style={{
                padding: 10,
                background: '#ecfdf5',
                color: '#065f46',
                borderRadius: 6,
                fontSize: 13,
                border: '1px solid #a7f3d0',
              }}
            >
              {info}
            </div>
          )}

          <button type="submit" className="btn btn-primary" disabled={loading} style={{ marginTop: 6 }}>
            {loading ? 'Procesando...' : mode === 'login' ? 'Ingresar' : 'Crear cuenta'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 20, fontSize: 13 }}>
          {mode === 'login' ? (
            <>
              ¿No tenés cuenta?{' '}
              <button
                type="button"
                onClick={() => { setMode('signup'); setError(null); setInfo(null) }}
                style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontWeight: 500 }}
              >
                Crear una
              </button>
            </>
          ) : (
            <>
              ¿Ya tenés cuenta?{' '}
              <button
                type="button"
                onClick={() => { setMode('login'); setError(null); setInfo(null) }}
                style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontWeight: 500 }}
              >
                Ingresar
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
