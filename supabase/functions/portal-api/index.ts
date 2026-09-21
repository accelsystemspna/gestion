// Supabase Edge Function — portal-api
// Proxy entre el programa de gestión y el portal mayorista (WordPress), para hacer desde
// Tiendas todo lo que se hace en el panel del portal SIN exponer el webhook secret en el navegador.
//
//   Usuario (autenticado) → esta función → POST <portal>/wp-json/mayorista/v1/<ruta>
//
// Body: { accion, venta_id?, tienda_id?, ...datos }   (lista blanca de acciones abajo)
//   Pedido (necesitan venta_id):  order, order-notify, order-tracking, order-item-status, order-label, order-delete
//   Clientes (usan tienda_id):    leads, lead-status, lead-delete
//
// Los cambios que gestión pide por estas rutas NO vuelven por webhook: acá mismo se refleja
// en la venta lo que el portal aceptó. Si el portal falla, se devuelve su mensaje y no se cambia nada.
import { serve }        from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ESTADOS_PRODUCCION, ajustarFasePorProduccion } from '../_shared/produccion.ts'

const cors = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

const ACCIONES_PEDIDO = new Set(['order', 'order-notify', 'order-tracking', 'order-item-status', 'order-label', 'order-delete'])
const ACCIONES_LEADS  = new Set(['leads', 'lead-status', 'lead-delete'])
const ESTADOS_LEAD    = new Set(['pendiente', 'aprobado', 'rechazado'])

const ESTADO_WEB: Record<string, string> = {
  'on-hold': 'esperando_pago', 'processing': 'en_preparacion', 'completed': 'completado', 'cancelled': 'cancelado',
}
// Estado del pedido en el portal → estado equivalente de WooCommerce
const PORTAL_A_WOO: Record<string, string> = {
  pendiente: 'on-hold', confirmado: 'processing', en_produccion: 'processing', despachado: 'completed', cancelado: 'cancelled',
}

function baseUrl(url: string): string {
  let base = String(url || '').trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(base)) {
    const host = base.split('/')[0].split(':')[0].toLowerCase()
    const local = host === 'localhost' || host === '127.0.0.1' || /\.(local|test|localhost)$/.test(host)
    base = (local ? 'http://' : 'https://') + base
  }
  return base
}

type Respuesta = { ok: true; data: any } | { ok: false; status: number; error: string }

async function llamarPortal(tienda: any, ruta: string, payload: Record<string, unknown>): Promise<Respuesta> {
  let res: Response
  try {
    res = await fetch(`${baseUrl(tienda.url)}/wp-json/mayorista/v1/${ruta}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-webhook-secret': tienda.webhook_secret },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(25000),
    })
  } catch {
    return { ok: false, status: 0, error: 'No se pudo conectar con el portal. Revisá la URL de la tienda en Integraciones.' }
  }
  const data = await res.json().catch(() => ({} as any))
  if (!res.ok || data?.ok === false) {
    const detalle = data?.message || data?.error || ''
    const texto =
      res.status === 404 ? 'No existe en el portal (puede que ya se haya eliminado).' :
      res.status === 400 ? 'El portal rechazó el dato enviado.' :
      res.status === 401 ? 'El secret no coincide con el del portal.' :
      res.status === 403 ? 'El portal todavía no tiene un secret configurado.' :
      `El portal respondió HTTP ${res.status}.`
    return { ok: false, status: res.status, error: detalle && res.status !== 401 && res.status !== 403 ? `${texto} ${detalle}` : texto }
  }
  return { ok: true, data }
}

async function devolverStock(admin: any, ventaId: string | number) {
  const { data: items } = await admin.from('venta_items').select('producto_id, cantidad').eq('venta_id', ventaId)
  const porProducto: Record<string, number> = {}
  for (const it of items ?? []) {
    if (it.producto_id) porProducto[it.producto_id] = (porProducto[it.producto_id] || 0) + Number(it.cantidad)
  }
  const ids = Object.keys(porProducto)
  if (!ids.length) return
  const { data: prods } = await admin.from('productos').select('id, stock_actual').in('id', ids)
  await Promise.all((prods ?? []).map((p: any) =>
    admin.from('productos').update({ stock_actual: (Number(p.stock_actual) || 0) + porProducto[p.id] }).eq('id', p.id)
  ))
}

// Guarda en la venta la fabricación de cada producto. `items` viene del portal:
// [{ indice, sku, produccion }]. Se cruza por índice y, en pedidos viejos sin índice, por SKU.
async function guardarProduccion(admin: any, ventaId: string | number, items: any[]) {
  if (!items.length) return
  try {
    const { data: filas, error } = await admin.from('venta_items').select('id, sku, origen_indice, produccion').eq('venta_id', ventaId)
    if (error || !filas?.length) return
    const usadas = new Set<string>()
    for (const it of items) {
      const indice = it?.indice === undefined || it?.indice === null || it?.indice === '' || isNaN(Number(it.indice)) ? null : Number(it.indice)
      const prod = ESTADOS_PRODUCCION.has(String(it?.produccion)) ? String(it.produccion) : null
      let fila = indice !== null ? filas.find((f: any) => f.origen_indice === indice && !usadas.has(f.id)) : null
      if (!fila && it?.sku) fila = filas.find((f: any) => f.origen_indice == null && f.sku === it.sku && !usadas.has(f.id))
      if (!fila) continue
      usadas.add(fila.id)
      const cambios: Record<string, unknown> = {}
      if (indice !== null && fila.origen_indice !== indice) cambios.origen_indice = indice
      if (prod && fila.produccion !== prod) cambios.produccion = prod
      if (Object.keys(cambios).length) await admin.from('venta_items').update(cambios).eq('id', fila.id)
    }
  } catch (err) {
    console.warn('[portal-api] guardar producción:', err)
  }
}

// Sincroniza la venta con el pedido tal cual está hoy en el portal (estado, tracking, fabricación).
async function sincronizarDesdePortal(admin: any, venta: any, pedido: any): Promise<string> {
  const actual = venta.estado_web === 'procesado' ? 'en_preparacion' : venta.estado_web
  const cambios: Record<string, unknown> = {}

  const estadoPortal = String(pedido?.estado_portal ?? '')
  if (estadoPortal) cambios.origen_estado_portal = estadoPortal
  if (typeof pedido?.tracking === 'string') { cambios.origen_tracking = pedido.tracking || null; cambios.origen_tracking_url = pedido.tracking ? (pedido.tracking_url || null) : null }
  if (pedido?.logistica) cambios.origen_logistica = String(pedido.logistica)

  let nuevo = actual
  const woo = PORTAL_A_WOO[estadoPortal]
  if (woo) {
    const objetivo = ESTADO_WEB[woo]
    // "En preparación" y "Listo" son lo mismo para el portal (processing): un pedido listo no retrocede.
    const mismo = objetivo === actual || (actual === 'listo' && objetivo === 'en_preparacion')
    if (!mismo) { nuevo = objetivo; cambios.estado_web = objetivo; cambios.origen_estado = woo }
  }
  const cancelar = nuevo === 'cancelado' && actual !== 'cancelado' && venta.estado !== 'anulado' && !venta.factura_emitida
  if (cancelar) cambios.estado = 'anulado'

  if (Object.keys(cambios).length) {
    let { error } = await admin.from('ventas').update(cambios).eq('id', venta.id)
    if (error && /column|schema cache/i.test(error.message)) {
      for (const k of ['origen_estado_portal', 'origen_tracking', 'origen_tracking_url', 'origen_logistica']) delete cambios[k]
      if (Object.keys(cambios).length) ({ error } = await admin.from('ventas').update(cambios).eq('id', venta.id))
    }
  }
  if (cancelar) await devolverStock(admin, venta.id)

  await guardarProduccion(admin, venta.id, Array.isArray(pedido?.items) ? pedido.items : [])
  const fase = await ajustarFasePorProduccion(admin, venta.id)
  return fase ?? nuevo
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'No autorizado' }, 401)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const { data: { user }, error: authErr } = await admin.auth.getUser(authHeader.replace(/^Bearer /i, ''))
    if (authErr || !user) return json({ error: 'Token inválido' }, 401)
    const { data: perfil } = await admin.from('profiles').select('org_id').eq('id', user.id).maybeSingle()
    const orgId = perfil?.org_id ?? user.id

    const body = await req.json().catch(() => ({}))
    const accion = String(body.accion ?? '')
    const esPedido = ACCIONES_PEDIDO.has(accion)
    const esLead = ACCIONES_LEADS.has(accion)
    if (!esPedido && !esLead) return json({ ok: false, error: 'Acción no permitida.' }, 400)

    const cols = 'id, user_id, nombre, tipo, url, webhook_secret'
    let tienda: any = null
    let venta: any = null
    let orderId = 0

    if (esPedido) {
      // ── La venta y su tienda ──────────────────────────────────────────────
      if (!body.venta_id) return json({ ok: false, error: 'Falta la venta.' }, 400)
      ;({ data: venta } = await admin.from('ventas')
        .select('id, origen_ref, tienda_id, estado, estado_web, factura_emitida, notas')
        .eq('id', body.venta_id).maybeSingle())
      if (!venta) return json({ ok: false, error: 'La venta no existe.' }, 404)
      const m = /^WC#(\d+)$/.exec(venta.origen_ref ?? '')
      if (!m) return json({ ok: false, error: 'Esta venta no viene del portal mayorista.' }, 400)
      orderId = Number(m[1])

      if (venta.tienda_id) {
        ;({ data: tienda } = await admin.from('tiendas').select(cols).eq('id', venta.tienda_id).maybeSingle())
      } else {
        // Pedidos viejos sin tienda_id: se reconocen por el nombre COMPLETO al final de las notas.
        const { data: propias } = await admin.from('tiendas').select(cols).eq('user_id', orgId)
        const notas = venta.notas ?? ''
        tienda = (propias ?? [])
          .filter((t: any) => t.nombre && (notas.endsWith(`— ${t.nombre}`) || notas.includes(`— ${t.nombre} (`)))
          .sort((a: any, b: any) => b.nombre.length - a.nombre.length)[0] ?? null
      }
    } else {
      // ── Clientes del portal: se indica la tienda ──────────────────────────
      if (!body.tienda_id) return json({ ok: false, error: 'Falta la tienda.' }, 400)
      ;({ data: tienda } = await admin.from('tiendas').select(cols).eq('id', body.tienda_id).maybeSingle())
    }

    if (!tienda || tienda.user_id !== orgId) return json({ error: 'No tenés acceso a esta tienda.' }, 403)
    if (tienda.tipo !== 'mayorista') return json({ ok: false, error: 'Esta tienda no es un portal mayorista.' }, 400)
    if (!tienda.url || !tienda.webhook_secret) {
      return json({ ok: false, error: 'La tienda no tiene URL o webhook secret cargados en Integraciones.' })
    }
    if (venta && !venta.tienda_id) {
      await admin.from('ventas').update({ tienda_id: tienda.id }).eq('id', venta.id).then(() => {}, () => {})
    }

    const falla = (r: { error: string }) => json({ ok: false, error: r.error })

    // ── Acciones sobre un pedido ────────────────────────────────────────────
    if (accion === 'order') {
      const r = await llamarPortal(tienda, 'order', { order_id: orderId })
      if (!r.ok) return falla(r)
      const estado_web = await sincronizarDesdePortal(admin, venta, r.data.order ?? {})
      return json({ ok: true, order: r.data.order ?? null, estado_web })
    }

    if (accion === 'order-notify') {
      const r = await llamarPortal(tienda, 'order-notify', { order_id: orderId })
      if (!r.ok) return falla(r)
      return json({ ok: true, email_sent: r.data.email_sent ?? null, wa_sent: r.data.wa_sent ?? null, wa_link: r.data.wa_link ?? null })
    }

    if (accion === 'order-tracking') {
      const tracking = typeof body.tracking === 'string' ? body.tracking.trim() : ''
      const r = await llamarPortal(tienda, 'order-tracking', { order_id: orderId, tracking, notificar: body.notificar === true })
      if (!r.ok) return falla(r)
      const url = tracking ? (r.data.tracking_url ?? null) : null
      const { error } = await admin.from('ventas').update({ origen_tracking: tracking || null, origen_tracking_url: url }).eq('id', venta.id)
      if (error) return json({ ok: false, error: `El portal aceptó el cambio pero no se pudo guardar acá: ${error.message}` })
      return json({ ok: true, tracking, tracking_url: url, email_sent: r.data.email_sent ?? null })
    }

    if (accion === 'order-item-status') {
      const item = String(body.item ?? '')
      const status = String(body.status ?? '')
      if (!(item === 'all' || /^\d+$/.test(item)) || !ESTADOS_PRODUCCION.has(status)) {
        return json({ ok: false, error: 'Producto o estado de fabricación no válido.' }, 400)
      }
      const r = await llamarPortal(tienda, 'order-item-status', { order_id: orderId, item, status })
      if (!r.ok) return falla(r)
      // Se vuelve a leer el pedido para cruzar los productos por índice/SKU; si eso falla,
      // se usa el mapa {"0":"listo",...} que ya devolvió el portal.
      const detalle = await llamarPortal(tienda, 'order', { order_id: orderId })
      let estado_web: string
      if (detalle.ok) {
        estado_web = await sincronizarDesdePortal(admin, venta, detalle.data.order ?? {})
      } else {
        const mapa = r.data.produccion && typeof r.data.produccion === 'object' ? r.data.produccion : {}
        await guardarProduccion(admin, venta.id, Object.entries(mapa).map(([indice, produccion]) => ({ indice, produccion })))
        estado_web = (await ajustarFasePorProduccion(admin, venta.id)) ?? venta.estado_web
      }
      return json({ ok: true, produccion: r.data.produccion ?? null, estado_web })
    }

    if (accion === 'order-label') {
      const r = await llamarPortal(tienda, 'order-label', { order_id: orderId })
      if (!r.ok) return falla(r)
      return json({ ok: true, label: r.data.label ?? null })
    }

    if (accion === 'order-delete') {
      const r = await llamarPortal(tienda, 'order-delete', { order_id: orderId })
      // Si ya no existía en el portal, se considera borrado: el objetivo es que no quede ahí.
      if (!r.ok && r.status !== 404) return falla(r)
      return json({ ok: true, ya_no_existia: !r.ok })
    }

    // ── Clientes (registros) del portal ─────────────────────────────────────
    if (accion === 'leads') {
      const payload: Record<string, unknown> = {}
      if (body.status) {
        if (!ESTADOS_LEAD.has(String(body.status))) return json({ ok: false, error: 'Estado no válido.' }, 400)
        payload.status = String(body.status)
      }
      const r = await llamarPortal(tienda, 'leads', payload)
      if (!r.ok) return falla(r)
      return json({ ok: true, leads: r.data.leads ?? [], conteos: r.data.conteos ?? {} })
    }

    const leadId = /^\d+$/.test(String(body.lead_id ?? '')) ? Number(body.lead_id) : 0
    if (!leadId) return json({ ok: false, error: 'Falta el cliente.' }, 400)

    if (accion === 'lead-status') {
      if (!ESTADOS_LEAD.has(String(body.status))) return json({ ok: false, error: 'Estado no válido.' }, 400)
      const r = await llamarPortal(tienda, 'lead-status', { lead_id: leadId, status: String(body.status) })
      if (!r.ok) return falla(r)
      return json({ ok: true, lead: r.data.lead ?? null })
    }

    // lead-delete
    const r = await llamarPortal(tienda, 'lead-delete', { lead_id: leadId })
    if (!r.ok) return falla(r)
    return json({ ok: true })
  } catch (err) {
    console.error('[portal-api]', err)
    return json({ ok: false, error: (err as Error).message }, 500)
  }
})
