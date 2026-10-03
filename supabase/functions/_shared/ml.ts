// Mercado Libre: credenciales de la app, renovación de tokens y llamadas a la API.
// La app de ML es una sola (secrets ML_APP_ID / ML_CLIENT_SECRET); cada negocio
// conecta su propia cuenta y sus tokens quedan en ml_tokens (solo service role).

export const ML_API = 'https://api.mercadolibre.com'
export const ML_AUTH = 'https://auth.mercadolibre.com.ar/authorization'

export function credencialesApp() {
  const id = Deno.env.get('ML_APP_ID')
  const secret = Deno.env.get('ML_CLIENT_SECRET')
  if (!id || !secret) throw new Error('Falta configurar ML_APP_ID / ML_CLIENT_SECRET en la edge function.')
  return { id, secret }
}

/** URL a la que ML devuelve al usuario después de autorizar (la edge function ml-oauth). */
export function redirectUri() {
  return `${Deno.env.get('SUPABASE_URL')}/functions/v1/ml-oauth`
}

/** Dónde vive la app, para volver después de conectar. */
export function appUrl() {
  return Deno.env.get('APP_URL') || 'https://gestion.ccdesign.com.ar'
}

async function pedirToken(params: Record<string, string>) {
  const { id, secret } = credencialesApp()
  const res = await fetch(`${ML_API}/oauth/token`, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: secret, ...params }),
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, data }
}

/** Cambia el `code` del OAuth por tokens. */
export function canjearCodigo(code: string) {
  return pedirToken({ grant_type: 'authorization_code', code, redirect_uri: redirectUri() })
}

/**
 * Devuelve un access_token vigente del negocio, renovándolo si falta poco.
 * El refresh_token de ML es de un solo uso: la renovación se guarda con un "compare and set"
 * para que dos funciones corriendo a la vez no se pisen (la que pierde relee el token nuevo).
 */
export async function tokenVigente(admin: any, orgId: string, forzar = false): Promise<string> {
  const leer = async () => (await admin.from('ml_tokens').select('*').eq('org_id', orgId).maybeSingle()).data
  let t = await leer()
  if (!t) throw new Error('Mercado Libre no está conectado en este negocio.')
  const vence = new Date(t.expires_at).getTime()
  if (!forzar && vence - Date.now() > 5 * 60_000) return t.access_token

  const r = await pedirToken({ grant_type: 'refresh_token', refresh_token: t.refresh_token })
  if (!r.ok || !r.data?.access_token) {
    // Quizás otra ejecución ya renovó (el refresh_token se quemó): se relee antes de rendirse.
    const nuevo = await leer()
    if (nuevo && nuevo.refresh_token !== t.refresh_token) return nuevo.access_token
    throw new Error('La conexión con Mercado Libre venció. Volvé a conectar la cuenta en Configuración → Integraciones.')
  }
  const { data: upd } = await admin.from('ml_tokens').update({
    access_token: r.data.access_token,
    refresh_token: r.data.refresh_token ?? t.refresh_token,
    expires_at: new Date(Date.now() + (Number(r.data.expires_in) || 21600) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('org_id', orgId).eq('refresh_token', t.refresh_token).select('access_token')
  if (upd?.length) return r.data.access_token
  t = await leer()
  return t?.access_token ?? r.data.access_token
}

export type ResultadoML = { ok: boolean, status: number, data: any, error?: string }

/** Llama a la API de ML con el token del negocio. Nunca lanza por errores HTTP: devuelve { ok, status, data, error }. */
export async function mlFetch(
  admin: any, orgId: string, path: string,
  opts: { method?: string, body?: unknown, headers?: Record<string, string> } = {},
): Promise<ResultadoML> {
  const llamar = async (token: string) => {
    const res = await fetch(`${ML_API}${path.startsWith('/') ? path : '/' + path}`, {
      method: opts.method ?? 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.headers ?? {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(25000),
    })
    const texto = await res.text()
    let data: any = null
    try { data = texto ? JSON.parse(texto) : null } catch { data = texto }
    return { res, data }
  }
  try {
    let { res, data } = await llamar(await tokenVigente(admin, orgId))
    if (res.status === 401) ({ res, data } = await llamar(await tokenVigente(admin, orgId, true)))
    if (res.ok) return { ok: true, status: res.status, data }
    return { ok: false, status: res.status, data, error: mensajeError(data, res.status) }
  } catch (err) {
    return { ok: false, status: 0, data: null, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Texto legible de un error de ML (que suele traer `message` y una lista `cause`). */
export function mensajeError(data: any, status: number): string {
  if (!data) return `Mercado Libre respondió ${status}.`
  if (typeof data === 'string') return data.slice(0, 300)
  const causas = Array.isArray(data.cause)
    ? data.cause.map((c: any) => c?.message || c?.code).filter(Boolean).join('; ')
    : ''
  return [data.message || data.error, causas].filter(Boolean).join(' — ') || `Mercado Libre respondió ${status}.`
}
