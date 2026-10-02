import { createContext, useContext, useEffect, useState } from 'react'
import { supabase, esAppInstalada } from './supabase'

const AuthContext = createContext(null)

// En el navegador (no en la app instalada) la sesión se cierra sola al pasar un día
// completo, aunque la pestaña nunca se haya cerrado. Se guarda junto a la sesión
// (misma sessionStorage), así que sobrevive a un F5 pero no a cerrar el navegador.
const LOGIN_AT = 'gestion_login_at'
const UN_DIA_MS = 24 * 60 * 60 * 1000

function marcarInicioSesion() {
  if (esAppInstalada) return
  try { sessionStorage.setItem(LOGIN_AT, String(Date.now())) } catch { /* storage bloqueado */ }
}
function borrarInicioSesion() {
  try { sessionStorage.removeItem(LOGIN_AT) } catch { /* storage bloqueado */ }
}
// true si ya pasó más de un día desde que se inició sesión en este navegador.
function sesionVencida() {
  if (esAppInstalada) return false
  let desde
  try { desde = sessionStorage.getItem(LOGIN_AT) } catch { return false }
  // Sesión restaurada sin esta marca (por ejemplo, recién agregada esta función):
  // se toma "ahora" como inicio en vez de cerrarla de sorpresa.
  if (!desde) { marcarInicioSesion(); return false }
  return Date.now() - Number(desde) > UN_DIA_MS
}

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
        // Modo oscuro guardado en el perfil (no en este dispositivo) tiene
        // prioridad — así la preferencia viaja con el usuario a cualquier
        // dispositivo donde inicie sesión.
        if (data && data.dark_mode !== null && data.dark_mode !== undefined) {
          localStorage.setItem('darkMode', String(data.dark_mode))
          document.documentElement.classList.toggle('dark', data.dark_mode)
        }
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

  const signIn = async (usuario, password) => {
    const r = await supabase.auth.signInWithPassword({ email: toEmail(usuario), password })
    if (!r.error) marcarInicioSesion()
    return r
  }

  const signOut = () => {
    borrarInicioSesion()
    return supabase.auth.signOut()
  }

  // Navegador (no la app instalada): si pasó más de un día desde que se inició sesión,
  // se cierra sola — aunque la pestaña haya quedado abierta todo ese tiempo. Se revisa
  // apenas hay sesión, cada tanto mientras la pestaña sigue abierta, y al volver a ella.
  useEffect(() => {
    if (!userId || esAppInstalada) return
    const revisar = () => { if (sesionVencida()) signOut() }
    revisar()
    const id = setInterval(revisar, 10 * 60 * 1000)
    document.addEventListener('visibilitychange', revisar)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', revisar)
    }
  }, [userId])

  // principal = dueño del sistema (ve todos los negocios); master = dueño de un negocio.
  // El principal también cuenta como master dentro de su propio negocio.
  const isPrincipal = profile?.rol === 'principal'
  const isMaster = !profile || profile?.rol === 'master' || isPrincipal
  const isAdmin  = isMaster || profile?.rol === 'admin'
  const orgId    = profile?.org_id ?? session?.user?.id ?? null

  // Nombre del negocio al que pertenece el usuario (se muestra en el menú lateral).
  const [negocioNombre, setNegocioNombre] = useState('')
  useEffect(() => {
    if (!orgId || !userId) return
    supabase.from('negocios').select('nombre').eq('org_id', orgId).maybeSingle()
      .then(({ data }) => setNegocioNombre(data?.nombre || ''))
  }, [orgId, userId])

  return (
    <AuthContext.Provider
      value={{ session, user: session?.user ?? null, profile, loading, profileLoading, isMaster, isAdmin, isPrincipal, orgId, negocioNombre, signIn, signOut }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
