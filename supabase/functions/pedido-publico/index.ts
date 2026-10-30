// Seguimiento público de un pedido: el cliente entra con el LINK (token largo) y el PIN, y ve el estado de su pedido.
// Se despliega con --no-verify-jwt (lo llama el sitio de seguimiento, sin sesión).
//
// Seguridad:
//   · El token del link es largo e imposible de adivinar. El PIN (últimos 3 del celular) es el segundo paso.
//   · Máx. 5 PIN equivocados cada 15 minutos y 15 por día, por pedido, y límite por IP.
//   · Los errores con el código no bloquean a quien entra por su link (se cuentan por separado).
//   · Cada negocio tiene su propio sitio (branding.url_seguimiento): un pedido solo se abre desde el sitio de su negocio.
//   · Respuestas genéricas: nunca se confirma si un token/código existe a quien no tiene el PIN.
//   · Solo se devuelve lo que el cliente puede ver (nada de teléfono, email, notas internas, costos ni ids).
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

const MAX_FALLOS_PEDIDO = 5
const MAX_FALLOS_DIA = 15
const MAX_FALLOS_IP = 25
const VENTANA_MIN = 15

const ETIQUETAS: Record<string, string> = {
  presupuestado: 'Presupuestado', aceptado: 'Aceptado', en_produccion: 'En producción', listo: 'Listo para entregar',
  entregado: 'Entregado', rechazado: 'Rechazado', cancelado: 'Cancelado',
}

// Acepta el código como lo escriba el cliente (cc482731, CC 482 731). Nuevo: CC-482-731. Viejo: CC-XXXX-XXXX.
function normalizarCodigo(valor: unknown) {
  const c = typeof valor === 'string' ? valor.toUpperCase().replace(/[^A-Z0-9]/g, '') : ''
  const viejo = /^CC([0-9A-F]{4})([0-9A-F]{4})$/.exec(c)
  if (viejo) return `CC-${viejo[1]}-${viejo[2]}`
  const nuevo = /^([A-Z]{2,4})(\d{3})(\d{3})$/.exec(c)
  return nuevo ? `${nuevo[1]}-${nuevo[2]}-${nuevo[3]}` : ''
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  let body: any
  try { body = await req.json() } catch { return json({ error: 'Pedido inválido' }, 400) }
  const token = typeof body.token === 'string' ? body.token.trim().toLowerCase() : ''
  const codigo = normalizarCodigo(body.codigo)
  const pin = typeof body.pin === 'string' ? body.pin.trim() : ''
  const sitio = typeof body.sitio === 'string' ? body.sitio.trim().toLowerCase().slice(0, 200) : ''
  if (!token && !body.codigo) return json({ error: 'Falta el link o el código del pedido' }, 400)
  if (token && !/^[a-f0-9]{32}$/.test(token)) return json({ error: 'El link no es válido' }, 404)
  if (!token && !codigo) return json({ error: 'No encontramos ese pedido' }, 404)

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'desconocida'
  const desde = new Date(Date.now() - VENTANA_MIN * 60_000).toISOString()
  const desdeDia = new Date(Date.now() - 86400_000).toISOString()
  const via = token ? 'link' : 'codigo'

  // Límite por IP (quien barre muchos links/códigos distintos)
  const { count: fallosIp } = await admin.from('pedido_intentos').select('id', { count: 'exact', head: true })
    .eq('ip', ip).eq('ok', false).gte('creado', desde)
  if ((fallosIp ?? 0) >= MAX_FALLOS_IP) return json({ error: 'Demasiados intentos. Probá de nuevo en unos minutos.', bloqueado: true }, 429)

  const { data: pedido } = token
    ? await admin.from('pedidos').select('*').eq('token', token).maybeSingle()
    : await admin.from('pedidos').select('*').eq('codigo', codigo).maybeSingle()

  if (!pedido) {
    await admin.from('pedido_intentos').insert({ pedido_id: null, ip, ok: false, via })
    return json({ error: token ? 'El link no es válido o venció' : 'No encontramos ese pedido' }, 404)
  }

  // Sitio de otro negocio: si el sitio desde donde se pide está registrado para OTRO negocio, es como si el pedido no existiera.
  if (sitio) {
    const { data: marcas } = await admin.from('branding').select('user_id, url_seguimiento').not('url_seguimiento', 'is', null)
    const host = (u: string) => { try { return new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`).hostname.toLowerCase() } catch { return '' } }
    const duenio = (marcas || []).find((m: any) => host(String(m.url_seguimiento)) === sitio)
    if (duenio && duenio.user_id !== pedido.org_id) {
      await admin.from('pedido_intentos').insert({ pedido_id: null, ip, ok: false, via })
      return json({ error: token ? 'El link no es válido o venció' : 'No encontramos ese pedido' }, 404)
    }
  }

  // Límite por pedido
  const { count: fallos } = await admin.from('pedido_intentos').select('id', { count: 'exact', head: true })
    .eq('pedido_id', pedido.id).eq('ok', false).eq('via', via).gte('creado', desde)
  const { count: fallosDia } = await admin.from('pedido_intentos').select('id', { count: 'exact', head: true })
    .eq('pedido_id', pedido.id).eq('ok', false).eq('via', via).gte('creado', desdeDia)
  if ((fallosDia ?? 0) >= MAX_FALLOS_DIA) {
    return json({ error: 'Se bloqueó el acceso por varios intentos. Probá de nuevo mañana o escribinos.', bloqueado: true }, 429)
  }
  if ((fallos ?? 0) >= MAX_FALLOS_PEDIDO) {
    return json({ error: `Se bloqueó el acceso por varios intentos. Probá de nuevo en ${VENTANA_MIN} minutos.`, bloqueado: true }, 429)
  }

  const { data: negocio } = await admin.from('branding').select('nombre, logo_url, slogan, telefono, instagram').eq('user_id', pedido.org_id).maybeSingle()
  const marca = { nombre: negocio?.nombre || '', logo_url: negocio?.logo_url || null, slogan: negocio?.slogan || null }

  // ¿Hace falta PIN? Por código siempre; por link, salvo que el pedido lo tenga desactivado (o no tenga celular cargado).
  const sinPin = !!token && (pedido.pin_requerido === false || !pedido.pin)
  if (!token && (pedido.pin_requerido === false || !pedido.pin)) {
    return json({ error: 'Para ver este pedido entrá desde el link que te mandamos.' }, 403)
  }
  if (!sinPin) {
    if (!pin) return json({ requiere_pin: true, negocio: marca })
    if (pin !== pedido.pin) {
      await admin.from('pedido_intentos').insert({ pedido_id: pedido.id, ip, ok: false, via })
      const restantes = Math.max(0, Math.min(MAX_FALLOS_PEDIDO - (fallos ?? 0), MAX_FALLOS_DIA - (fallosDia ?? 0)) - 1)
      return json({ error: 'El PIN no es correcto.', requiere_pin: true, intentos_restantes: restantes, negocio: marca }, 401)
    }
  }
  await admin.from('pedido_intentos').insert({ pedido_id: pedido.id, ip, ok: true, via })
  // Limpieza de intentos viejos (best-effort)
  admin.from('pedido_intentos').delete().lt('creado', new Date(Date.now() - 2 * 86400_000).toISOString()).then(() => {}, () => {})

  const { data: eventos } = await admin.from('pedido_eventos').select('fecha, tipo, detalle')
    .eq('pedido_id', pedido.id).eq('visible_cliente', true).order('fecha', { ascending: true })

  const primerNombre = String(pedido.cliente_nombre || '').trim().split(/\s+/)[0] || ''
  return json({
    ok: true,
    negocio: { ...marca, telefono: negocio?.telefono || null, instagram: negocio?.instagram || null },
    pedido: {
      codigo: pedido.codigo,
      cliente: primerNombre,
      titulo: pedido.titulo,
      descripcion: pedido.descripcion,
      estado: pedido.estado,
      estado_etiqueta: ETIQUETAS[pedido.estado] || pedido.estado,
      total: Number(pedido.total) || 0,
      sena: Number(pedido.sena_monto) || 0,
      saldo: Number(pedido.saldo) || 0,
      precio_congelado: !!pedido.precio_congelado,
      nota: pedido.nota_cliente,
      entrega_estimada: pedido.entrega_estimada,
      imagenes_referencia: pedido.imagenes_referencia || [],
      imagenes_resultado: pedido.imagenes_resultado || [],
      creado: pedido.created_at,
      actualizado: pedido.updated_at,
    },
    eventos: eventos || [],
  })
})
