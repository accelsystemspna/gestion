import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [profileLoading, setProfileLoading] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  // Ojo: depende de session?.user?.id (no de `session` entero). Supabase
  // renueva el token solo al volver a la pestaña, y eso dispara
  // onAuthStateChange con un objeto `session` nuevo aunque sea el mismo
  // usuario — si este efecto dependiera de `session`, se volvería a pedir
  // el perfil y ProtectedRoute mostraría "Cargando..." tapando la pantalla
  // cada vez que se cambia de pestaña del navegador.
  const userId = session?.user?.id
  useEffect(() => {
    if (!userId) {
      setProfile(null)
      return
    }
    setProfileLoading(true)
    supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        setProfile(data)
        setProfileLoading(false)
      })
  }, [userId])

  const toEmail = (usuario) => {
    if (usuario.includes('@')) return usuario
    return usuario.toLowerCase().trim()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, '.')
      .replace(/[^a-z0-9.]/g, '')
      + '@gestion.internal'
  }

  const signIn = (usuario, password) =>
    supabase.auth.signInWithPassword({ email: toEmail(usuario), password })

  const signOut = () => supabase.auth.signOut()

  const isMaster = !profile || profile?.rol === 'master'
  const isAdmin  = isMaster || profile?.rol === 'admin'
  const orgId    = profile?.org_id ?? session?.user?.id ?? null

  return (
    <AuthContext.Provider
      value={{ session, user: session?.user ?? null, profile, loading, profileLoading, isMaster, isAdmin, orgId, signIn, signOut }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
