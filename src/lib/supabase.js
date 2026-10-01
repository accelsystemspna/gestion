import { createClient } from '@supabase/supabase-js'

// En el navegador (Vite) las variables vienen de import.meta.env; en un script de
// Node (carpeta scripts/, sin bundler) no existe import.meta.env, así que se usan
// las mismas variables leídas de process.env. No cambia nada del comportamiento
// en el navegador: ahí import.meta.env siempre existe y gana primero.
const env = (typeof import.meta !== 'undefined' && import.meta.env) || globalThis.process?.env || {}

const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY

// En Node no hay que guardar la sesión en localStorage (no existe) ni refrescarla sola.
const esNode = typeof window === 'undefined'

// La app instalada (PWA — "display: standalone" en el manifest) mantiene la sesión
// siempre, como hasta ahora: se usa todos los días para vender y no tiene sentido
// pedir usuario/contraseña a cada rato. En un navegador común la sesión se guarda en
// sessionStorage (dura solo mientras esa pestaña siga abierta): al cerrar el
// navegador hay que volver a iniciar sesión. AuthContext además fuerza un reingreso
// si pasó más de un día, aunque la pestaña nunca se haya cerrado.
export const esAppInstalada = !esNode && (
  window.matchMedia?.('(display-mode: standalone)')?.matches === true ||
  window.navigator?.standalone === true
)

const opciones = esNode
  ? { auth: { persistSession: false } }
  : { auth: { storage: esAppInstalada ? window.localStorage : window.sessionStorage, persistSession: true, autoRefreshToken: true } }

export const supabase = createClient(supabaseUrl, supabaseAnonKey, opciones)
