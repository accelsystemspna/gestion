// Panel del cliente: entra con su celular y un PIN que elige, y ve sus pedidos y documentos.
// Se despliega con --no-verify-jwt (lo llama el sitio de pedidos, sin sesión). Contrato en C:\Proyectos\Pedidos\docs\PEDIDO-A-GESTION.md
//
//   { telefono, pin }              → panel
//   { acceso }                     → crear_pin (primer ingreso o PIN olvidado, con el link de WhatsApp)
//   { acceso, pin_nuevo }          → panel + telefono. El link queda usado
//   { telefono, pin, pin_nuevo }   → panel. Cambia el PIN
//
// Seguridad:
//   · Mismo error y tiempo si el celular no existe, no tiene PIN o el PIN está mal.
//   · 5 errores cada 15 minutos y 15 por día por celular (también en celulares que no existen) y límite por IP.
//     El link de WhatsApp no pasa por esos límites: crear el PIN nuevo destraba al cliente.
//   · PIN con hash lento y sal. Del link se guarda solo el hash.
//   · No devuelve email, dirección, notas internas, costos, ids, token, pin ni items.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

const MAX_FALLOS = 5
const MAX_FALLOS_DIA = 15
const MAX_FALLOS_IP = 25
const VENTANA_MIN = 15
const TIEMPO_MINIMO_MS = 700
const ITERACIONES = 150_000
const BUCKET = 'documentos-clientes'
const FIRMA_SEGUNDOS = 600

const ERROR_CREDENCIALES = 'El celular o el PIN no son correctos.'
const ERROR_LINK = 'Este link ya se usó o venció.'
const ETIQUETAS: Record<string, string> = {
  presupuestado: 'Presupuestado', aceptado: 'Aceptado', en_produccion: 'En producción', listo: 'Listo para entregar',
  entregado: 'Entregado', rechazado: 'Rechazado', cancelado: 'Cancelado',
}

const aHex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b))].map((x) => x.toString(16).padStart(2, '0')).join('')
const deHex = (h: string) => new Uint8Array((h.match(/../g) || []).map((x) => parseInt(x, 16)))
const sha256 = async (t: string) => aHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))

async function derivar(pin: string, sal: Uint8Array, iteraciones: number) {
  const clave = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  return aHex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: iteraciones }, clave, 256))
}
async function hashPin(pin: string) {
  const sal = crypto.getRandomValues(new Uint8Array(16))
  return `pbkdf2$${ITERACIONES}$${aHex(sal)}$${await derivar(pin, sal, ITERACIONES)}`
}
/** Sin hash guardado se calcula igual, contra una sal de relleno: tarda lo mismo y da falso. */
async function verificarPin(pin: string, guardado: string | null | undefined) {
  const [, iter, sal, hash] = (guardado || '').split('$')
  if (!hash) { await derivar(pin, new Uint8Array(16), ITERACIONES); return false }
  const calculado = await derivar(pin, deHex(sal), Number(iter))
  let dif = calculado.length ^ hash.length
  for (let i = 0; i < calculado.length; i++) dif |= calculado.charCodeAt(i) ^ hash.charCodeAt(i)
  return dif === 0
}

/** Motivo por el que no sirve el PIN, o null si está bien. */
function problemaDelPin(pin: unknown, celular: string) {
  if (typeof pin !== 'string' || !/^\d{4,6}$/.test(pin)) return 'El PIN tiene que tener entre 4 y 6 números.'
  if (/^(\d)\1+$/.test(pin)) return 'Elegí un PIN que no repita el mismo número.'
  const d = [...pin].map(Number)
  if (d.every((n, i) => i === 0 || n === d[i - 1] + 1) || d.every((n, i) => i === 0 || n === d[i - 1] - 1)) return 'Elegí un PIN que no sea una secuencia.'
  if (celular.endsWith(pin)) return 'El PIN no puede ser el final de tu celular.'
  return null
}

const host = (u: string) => { try { return new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`).hostname.toLowerCase() } catch { return '' } }

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  let body: any
  try { body = await req.json() } catch { return json({ error: 'Pedido inválido' }, 400) }
  const inicio = Date.now()
  const conTiempoParejo = async (r: Response) => {
    const falta = TIEMPO_MINIMO_MS - (Date.now() - inicio)
    if (falta > 0) await new Promise((ok) => setTimeout(ok, falta))
    return r
  }

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )
    const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'desconocida'
    const desde = new Date(Date.now() - VENTANA_MIN * 60_000).toISOString()
    const desdeDia = new Date(Date.now() - 86400_000).toISOString()
    const sitio = typeof body.sitio === 'string' ? body.sitio.trim().toLowerCase().slice(0, 200) : ''
    const acceso = typeof body.acceso === 'string' ? body.acceso.trim().toLowerCase() : ''

    const fallar = (org: string | null, celular: string | null) => admin.from('cliente_intentos').insert({ org_id: org, celular, ip, ok: false })
    const normalizar = async (t: string) => {
      const { data, error } = await admin.rpc('celular_normalizado', { t })
      if (error) throw error
      return String(data || '')
    }
    const clientesDe = async (org: string, celular: string) => {
      const { data, error } = await admin.rpc('clientes_por_celular', { p_org: org, p_celular: celular })
      if (error) throw error
      return data || []
    }

    const { count: fallosIp } = await admin.from('cliente_intentos').select('id', { count: 'exact', head: true })
      .eq('ip', ip).eq('ok', false).gte('creado', desde)
    if ((fallosIp ?? 0) >= MAX_FALLOS_IP) return await conTiempoParejo(json({ error: 'Demasiados intentos. Probá de nuevo en unos minutos.', bloqueado: true }, 429))

    // El negocio del sitio desde donde se entra (cada negocio tiene el suyo)
    const { data: marcas } = await admin.from('branding').select('user_id, url_seguimiento').not('url_seguimiento', 'is', null)
    const orgSitio: string | null = (marcas || []).find((m: any) => sitio && host(String(m.url_seguimiento)) === sitio)?.user_id ?? null

    const marcaDe = async (org: string) => {
      const { data: n } = await admin.from('branding').select('nombre, logo_url, slogan, telefono, instagram').eq('user_id', org).maybeSingle()
      return { nombre: n?.nombre || '', logo_url: n?.logo_url || null, slogan: n?.slogan || null, telefono: n?.telefono || null, instagram: n?.instagram || null }
    }
    const primerNombre = (t: unknown) => String(t || '').trim().split(/\s+/)[0] || ''

    const panel = async (org: string, cliente: any, celular: string) => {
      const { data: pedidos, error } = await admin.rpc('pedidos_de_cliente', { p_org: org, p_cliente: cliente.id, p_celular: celular })
      if (error) throw error
      const ids = (pedidos || []).map((p: any) => p.id)
      const [{ data: eventos }, { data: docs }] = await Promise.all([
        ids.length
          ? admin.from('pedido_eventos').select('pedido_id, fecha, tipo, detalle').in('pedido_id', ids).eq('visible_cliente', true).order('fecha', { ascending: true })
          : Promise.resolve({ data: [] as any[] }),
        admin.from('cliente_documentos').select('pedido_id, tipo, titulo, fecha, total, ruta').eq('org_id', org).eq('cliente_id', cliente.id).order('fecha', { ascending: false }),
      ])
      const firmas = new Map<string, string>()
      const rutas = (docs || []).map((d: any) => d.ruta)
      if (rutas.length) {
        const { data: firmadas, error: e } = await admin.storage.from(BUCKET).createSignedUrls(rutas, FIRMA_SEGUNDOS)
        if (e) throw e
        for (const f of firmadas || []) if (f.path && f.signedUrl) firmas.set(f.path, f.signedUrl)
      }
      const documento = (d: any) => ({ tipo: d.tipo, titulo: d.titulo, fecha: d.fecha, total: Number(d.total) || 0, url: firmas.get(d.ruta) })
      const conUrl = (docs || []).filter((d: any) => firmas.has(d.ruta))
      return {
        ok: true,
        negocio: await marcaDe(org),
        cliente: { nombre: primerNombre(cliente.nombre) },
        pedidos: (pedidos || []).map((p: any) => ({
          codigo: p.codigo,
          cliente: primerNombre(p.cliente_nombre),
          titulo: p.titulo,
          descripcion: p.descripcion,
          estado: p.estado,
          estado_etiqueta: ETIQUETAS[p.estado] || p.estado,
          total: Number(p.total) || 0,
          sena: Number(p.sena_monto) || 0,
          saldo: Number(p.saldo) || 0,
          precio_congelado: !!p.precio_congelado,
          nota: p.nota_cliente,
          entrega_estimada: p.entrega_estimada,
          imagenes_referencia: p.imagenes_referencia || [],
          imagenes_resultado: p.imagenes_resultado || [],
          imagenes_vencidas: !!p.imagenes_vencidas_en && !p.imagenes_referencia?.length && !p.imagenes_resultado?.length,
          creado: p.created_at,
          actualizado: p.updated_at,
          eventos: (eventos || []).filter((e: any) => e.pedido_id === p.id).map((e: any) => ({ fecha: e.fecha, tipo: e.tipo, detalle: e.detalle })),
          documentos: conUrl.filter((d: any) => d.pedido_id === p.id).map(documento),
        })),
        // Documentos que no están atados a un pedido (ej. una factura emitida desde Ventas)
        documentos: conUrl.filter((d: any) => !d.pedido_id || !ids.includes(d.pedido_id)).map(documento),
      }
    }

    // ── Con el link de WhatsApp: primer ingreso o PIN olvidado ──────────────────────────────────
    if (acceso) {
      const linkInvalido = async () => { await fallar(orgSitio, null); return await conTiempoParejo(json({ error: ERROR_LINK }, 404)) }
      if (!/^[a-f0-9]{64}$/.test(acceso)) return await linkInvalido()
      const tokenHash = await sha256(acceso)
      const { data: cred } = await admin.from('cliente_credenciales').select('id, org_id, cliente_id, token_vence').eq('token_hash', tokenHash).maybeSingle()
      if (!cred || !cred.token_vence || new Date(cred.token_vence).getTime() < Date.now()) return await linkInvalido()
      if (orgSitio && orgSitio !== cred.org_id) return await linkInvalido()
      const { data: cliente } = await admin.from('clientes').select('id, nombre, telefono').eq('id', cred.cliente_id).maybeSingle()
      const celular = await normalizar(cliente?.telefono || '')
      const mismos = cliente ? await clientesDe(cred.org_id, celular) : []
      if (mismos.length !== 1) return await linkInvalido()

      if (body.pin_nuevo === undefined) {
        return json({ crear_pin: true, negocio: await marcaDe(cred.org_id), cliente: { nombre: primerNombre(cliente!.nombre) } })
      }
      const problema = problemaDelPin(body.pin_nuevo, celular)
      if (problema) return json({ error: problema }, 400)
      // Con el token en el filtro: si dos pedidos llegan juntos, solo uno usa el link.
      const { data: usado } = await admin.from('cliente_credenciales')
        .update({ pin_hash: await hashPin(body.pin_nuevo), token_hash: null, token_vence: null, actualizado: new Date().toISOString() })
        .eq('id', cred.id).eq('token_hash', tokenHash).select('id')
      if (!usado?.length) return await linkInvalido()
      await admin.from('cliente_intentos').delete().eq('org_id', cred.org_id).eq('celular', celular)
      return json({ ...(await panel(cred.org_id, cliente, celular)), telefono: celular })
    }

    // ── Con celular y PIN ───────────────────────────────────────────────────────────────────────
    const pin = typeof body.pin === 'string' ? body.pin.trim().slice(0, 12) : ''
    const telefono = typeof body.telefono === 'string' ? body.telefono.slice(0, 40) : ''
    if (!telefono || !pin) return await conTiempoParejo(json({ error: ERROR_CREDENCIALES }, 401))

    const celular = await normalizar(telefono)
    const cuenta = async (d: string) => {
      let q = admin.from('cliente_intentos').select('id', { count: 'exact', head: true }).eq('celular', celular).eq('ok', false).gte('creado', d)
      q = orgSitio ? q.eq('org_id', orgSitio) : q.is('org_id', null)
      return (await q).count ?? 0
    }
    const [fallos, fallosDia] = await Promise.all([cuenta(desde), cuenta(desdeDia)])
    if (fallosDia >= MAX_FALLOS_DIA) return await conTiempoParejo(json({ error: 'Se bloqueó el acceso por varios intentos. Probá de nuevo mañana o escribinos.', bloqueado: true }, 429))
    if (fallos >= MAX_FALLOS) return await conTiempoParejo(json({ error: `Se bloqueó el acceso por varios intentos. Probá de nuevo en ${VENTANA_MIN} minutos.`, bloqueado: true }, 429))

    const candidatos = orgSitio ? await clientesDe(orgSitio, celular) : []
    const cliente = candidatos.length === 1 ? candidatos[0] : null
    const { data: cred } = cliente
      ? await admin.from('cliente_credenciales').select('id, pin_hash').eq('cliente_id', cliente.id).maybeSingle()
      : { data: null as any }

    if (!(await verificarPin(pin, cred?.pin_hash)) || !cliente) {
      await fallar(orgSitio, celular)
      const restantes = Math.max(0, Math.min(MAX_FALLOS - fallos, MAX_FALLOS_DIA - fallosDia) - 1)
      return await conTiempoParejo(json({ error: ERROR_CREDENCIALES, intentos_restantes: restantes }, 401))
    }

    if (body.pin_nuevo !== undefined) {
      const problema = problemaDelPin(body.pin_nuevo, celular)
      if (problema) return json({ error: problema }, 400)
      const { error } = await admin.from('cliente_credenciales').update({ pin_hash: await hashPin(body.pin_nuevo), actualizado: new Date().toISOString() }).eq('id', cred.id)
      if (error) throw error
    }
    await admin.from('cliente_intentos').insert({ org_id: orgSitio, celular, ip, ok: true })
    // Limpieza de intentos viejos (best-effort)
    admin.from('cliente_intentos').delete().lt('creado', new Date(Date.now() - 2 * 86400_000).toISOString()).then(() => {}, () => {})
    return json(await panel(orgSitio!, cliente, celular))
  } catch (err) {
    console.error('[cliente-publico]', err)
    return await conTiempoParejo(json({ error: 'Hubo un problema de nuestro lado. Probá de nuevo en un rato.' }, 500))
  }
})
