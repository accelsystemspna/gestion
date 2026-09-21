// Supabase Edge Function — woo-order-webhook
// Receptor público del webhook nativo de WooCommerce ("Pedido pagado").
// Crea la venta en estado 'pendiente_revision' con canal 'web_minorista'
// para que se revise y facture desde Ventas antes de darla por confirmada.
// Además guarda el estado del pedido (sección Tiendas), lo mantiene al día
// cuando WooCommerce lo cambia y vincula al comprador con Clientes.
//
// Configurar en WooCommerce → Ajustes → Avanzado → Webhooks:
//   Tema:   Pedido actualizado (o "Pedido pagado" si está disponible)
//   URL:    <esta función>?tienda=<id de la tienda en Integraciones>
//   Secret: el mismo "Webhook Secret" configurado en Integraciones para esa tienda
import { serve }        from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendPushToOrg } from '../_shared/webpush.ts'
import { ESTADOS_BORRADOR, filaPedido } from '../_shared/woo.ts'
import { ajustarFasePorProduccion } from '../_shared/produccion.ts'

function fmtMoneyAR(n: number): string {
  return '$ ' + Math.round(n).toLocaleString('es-AR')
}

const cors = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'content-type, x-wc-webhook-signature, x-wc-webhook-topic, x-wc-webhook-source',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

async function verifySignature(secret: string, rawBody: string, signatureB64: string): Promise<boolean> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody))
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sigBuf)))
  return sigB64 === signatureB64
}

// Estado de WooCommerce -> estado que se muestra en la sección Tiendas.
const ESTADO_WEB: Record<string, string> = {
  'on-hold': 'esperando_pago', 'pending': 'esperando_pago',
  'processing': 'en_preparacion', 'completed': 'completado',
  'cancelled': 'cancelado', 'refunded': 'cancelado', 'failed': 'cancelado',
}
// Pedidos NUEVOS que se importan (los demás estados solo actualizan un pedido que ya existe):
// - processing/completed: pago confirmado.
// - on-hold: pago pendiente (ej. esperando que llegue una transferencia).
const ESTADOS_NUEVOS = new Set(['processing', 'completed', 'on-hold'])

function formaPagoDe(order: any): string {
  const t = `${order.payment_method ?? ''} ${order.payment_method_title ?? ''}`.toLowerCase()
  if (/bacs|transfer|cbu|dep[oó]sito/.test(t)) return 'transferencia'
  if (/d[eé]bito|debit/.test(t)) return 'debito'
  if (/tarjeta|cr[eé]dito|credit|card|stripe|mercado|cuotas/.test(t)) return 'credito'
  return 'transferencia'
}

// Datos extra que manda el portal mayorista (y que WooCommerce minorista casi no trae).
// Solo se devuelven los que vienen con valor: un campo vacío nunca pisa lo ya guardado.
const COLS_PORTAL = [
  'origen_numero', 'origen_logistica', 'origen_tracking', 'origen_tracking_url', 'cliente_dni',
  'cliente_empresa', 'cliente_direccion_envio', 'contacto_preferido', 'origen_estado_portal',
]
function camposPortalDe(order: any): Record<string, string> {
  const meta: Record<string, unknown> = {}
  for (const m of order.meta_data ?? []) if (m?.key) meta[m.key] = m.value
  const sh = order.shipping ?? {}
  const envio = [sh.address_1, sh.city, sh.state, sh.postcode].filter(Boolean).join(', ')
  const crudo: Record<string, unknown> = {
    origen_numero:           order.number ?? meta.numero_portal,
    origen_logistica:        order.shipping_lines?.[0]?.method_title || meta.logistica,
    origen_tracking:         meta.tracking,
    origen_tracking_url:     meta.tracking_url,
    cliente_dni:             meta.dni,
    cliente_empresa:         order.billing?.company,
    cliente_direccion_envio: envio,
    contacto_preferido:      meta.contacto_preferido,
    origen_estado_portal:    meta.estado_portal,
  }
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(crudo)) {
    const t = v == null ? '' : String(v).trim()
    if (t) out[k] = t
  }
  return out
}

// Estado de fabricación de cada renglón (solo lo manda el portal mayorista): meta "produccion" con
// {"0":"a_fabricar","1":"listo"} y, en cada line_item, meta "indice". WooCommerce minorista no trae nada
// de esto → devuelve [] y no se toca nada.
const ESTADOS_PRODUCCION = new Set(['a_fabricar', 'programado', 'listo', 'en_stock'])
type InfoProd = { indice: number | null; produccion: string | null }
function produccionDe(order: any): InfoProd[] {
  let mapa: Record<string, unknown> = {}
  const metaProd = (order.meta_data ?? []).find((m: any) => m?.key === 'produccion')?.value
  if (metaProd) {
    try { mapa = typeof metaProd === 'string' ? JSON.parse(metaProd) : metaProd } catch { mapa = {} }
  }
  const lineas: any[] = order.line_items ?? []
  const info = lineas.map((li, pos) => {
    const raw = (li?.meta_data ?? []).find((m: any) => m?.key === 'indice')?.value
    const indice = raw === undefined || raw === null || raw === '' || isNaN(Number(raw)) ? null : Number(raw)
    const est = String((mapa && (mapa as any)[String(indice ?? pos)]) ?? '')
    return { indice, produccion: ESTADOS_PRODUCCION.has(est) ? est : null }
  })
  return info.some((i) => i.indice !== null || i.produccion) ? info : []
}

// Actualiza el estado de fabricación de los renglones de una venta ya existente.
// Mejor esfuerzo: si todavía no se corrió supabase_mayorista_produccion.sql, no hace nada.
async function aplicarProduccion(admin: any, ventaId: string, lineItems: any[], info: InfoProd[]): Promise<number> {
  if (!info.length) return 0
  try {
    const { data: filas, error } = await admin.from('venta_items').select('id, sku, origen_indice, produccion').eq('venta_id', ventaId)
    if (error || !filas?.length) return 0
    const usadas = new Set<string>()
    let cambiados = 0
    for (let pos = 0; pos < lineItems.length; pos++) {
      const { indice, produccion } = info[pos] ?? { indice: null, produccion: null }
      if (indice === null && !produccion) continue
      let fila = indice !== null ? filas.find((f: any) => f.origen_indice === indice && !usadas.has(f.id)) : null
      // Pedidos viejos sin índice guardado: se empareja por SKU.
      if (!fila && lineItems[pos]?.sku) fila = filas.find((f: any) => f.origen_indice == null && f.sku === lineItems[pos].sku && !usadas.has(f.id))
      if (!fila) continue
      usadas.add(fila.id)
      const cambios: Record<string, unknown> = {}
      if (indice !== null && fila.origen_indice !== indice) cambios.origen_indice = indice
      if (produccion && fila.produccion !== produccion) cambios.produccion = produccion
      if (!Object.keys(cambios).length) continue
      const { error: e } = await admin.from('venta_items').update(cambios).eq('id', fila.id)
      if (!e) cambiados++
    }
    return cambiados
  } catch (err) {
    console.warn('[woo-order-webhook] producción:', err)
    return 0
  }
}

// Suma (signo=1) o resta (signo=-1) unidades al stock de los productos indicados.
async function moverStock(admin: any, items: { producto_id: string | null; cantidad: number }[], signo: 1 | -1) {
  const porProducto: Record<string, number> = {}
  for (const it of items) {
    if (!it.producto_id) continue
    porProducto[it.producto_id] = (porProducto[it.producto_id] || 0) + Number(it.cantidad)
  }
  const ids = Object.keys(porProducto)
  if (!ids.length) return
  const { data } = await admin.from('productos').select('id, stock_actual').in('id', ids)
  await Promise.all((data ?? []).map((p: any) =>
    admin.from('productos')
      .update({ stock_actual: (Number(p.stock_actual) || 0) + signo * porProducto[p.id] })
      .eq('id', p.id)
  ))
}

// Guarda el pedido tal cual lo manda WooCommerce (todos los estados) para verlo en el panel de Tiendas.
// Es "mejor esfuerzo": si la tabla todavía no existe (supabase_woo_panel.sql) o falla algo, no afecta a las ventas.
async function guardarSnapshot(admin: any, tienda: any, order: any, topic: string) {
  try {
    if (ESTADOS_BORRADOR.has(order.status)) return
    if (topic === 'order.deleted') {
      // Al borrar un pedido WooCommerce solo manda su id.
      await admin.from('pedidos_web').update({ estado: 'trash', sincronizado_en: new Date().toISOString() })
        .eq('tienda_id', tienda.id).eq('woo_id', order.id)
      return
    }
    const { error } = await admin.from('pedidos_web').upsert(filaPedido(order, { id: tienda.id, user_id: tienda.user_id }), { onConflict: 'tienda_id,woo_id' })
    if (error && !/relation|does not exist|schema cache/i.test(error.message)) console.warn('[woo-order-webhook] snapshot:', error.message)
  } catch (err) {
    console.warn('[woo-order-webhook] snapshot:', err)
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  const url = new URL(req.url)
  const tiendaId = url.searchParams.get('tienda')
  if (!tiendaId) return json({ error: 'Falta parámetro ?tienda=' }, 400)

  const rawBody   = await req.text()
  const signature = req.headers.get('x-wc-webhook-signature') || ''

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  const { data: tienda } = await admin
    .from('tiendas')
    .select('id, user_id, nombre, activa, webhook_secret, lista_id, tipo')
    .eq('id', tiendaId)
    .maybeSingle()

  if (!tienda || !tienda.activa || !tienda.webhook_secret) {
    return json({ error: 'Tienda no encontrada, inactiva o sin webhook secret' }, 404)
  }

  if (!signature || !(await verifySignature(tienda.webhook_secret, rawBody, signature))) {
    return json({ error: 'Firma inválida' }, 401)
  }

  // WooCommerce manda un ping vacío al crear el webhook — responder OK sin procesar.
  let order: any
  try { order = JSON.parse(rawBody) } catch { return json({ ok: true, skipped: 'ping' }) }
  if (!order?.id) return json({ ok: true, skipped: 'sin order id' })

  const topic       = (req.headers.get('x-wc-webhook-topic') || '').toLowerCase()
  // Las importaciones históricas desde el panel (x-gestion-backfill) no mandan notificaciones push.
  const esBackfill  = req.headers.get('x-gestion-backfill') === '1'
  await guardarSnapshot(admin, tienda, order, topic)
  if (!esBackfill) {
    // Sirve para mostrar en el panel si la tienda está mandando avisos (best-effort).
    try { await admin.from('tiendas').update({ ultimo_webhook_en: new Date().toISOString() }).eq('id', tienda.id) } catch { /* columna aún no creada */ }
  }
  // Pedido eliminado en WooCommerce (papelera): para las ventas equivale a cancelarlo.
  if (topic === 'order.deleted') order = { ...order, status: 'cancelled' }

  const estadoWeb = ESTADO_WEB[order.status]
  if (!estadoWeb) {
    return json({ ok: true, skipped: `estado "${order.status}" ignorado` })
  }
  const esPendiente = estadoWeb === 'esperando_pago'
  const esMayorista = tienda.tipo === 'mayorista'
  const camposPortal = camposPortalDe(order)

  // Idempotencia: si este pedido ya se importó (reintentos de WooCommerce) no se duplica;
  // en cambio, si cambió de estado (ej. llegó la transferencia) se actualiza.
  const origenRef = `WC#${order.id}`
  const colsBase = 'id, estado, estado_web, factura_emitida, cliente_nombre, total'
  let { data: existente, error: errExistente } = await admin
    .from('ventas').select(colsBase + ', ' + COLS_PORTAL.join(', '))
    .eq('origen_ref', origenRef).maybeSingle()
  // Si todavía no se corrió supabase_mayorista_pedidos.sql, se busca sin esas columnas.
  if (errExistente && /column|schema cache/i.test(errExistente.message)) {
    ;({ data: existente } = await admin.from('ventas').select(colsBase).eq('origen_ref', origenRef).maybeSingle())
  }

  if (existente) {
    // "procesado" es el nombre viejo de "en preparación". En WooCommerce "en preparación" y
    // "listo para despachar" son el mismo estado (processing): no se retrocede un pedido ya listo.
    const actual = existente.estado_web === 'procesado' ? 'en_preparacion' : existente.estado_web
    const mismoEstado = actual === estadoWeb || (actual === 'listo' && estadoWeb === 'en_preparacion')

    const cambios: Record<string, unknown> = {}
    if (!mismoEstado) {
      cambios.estado_web = estadoWeb
      cambios.origen_estado = order.status
      if (order.payment_method_title) cambios.origen_pago = order.payment_method_title
    }
    // Mismo estado pero cambió algún dato (tracking, dirección...): también se actualiza.
    for (const [k, v] of Object.entries(camposPortal)) {
      if ((existente as any)[k] !== v) cambios[k] = v
    }
    const cancelar = !mismoEstado && estadoWeb === 'cancelado' && existente.estado !== 'anulado' && !existente.factura_emitida
    if (cancelar) cambios.estado = 'anulado'

    // Estado de fabricación por renglón (solo portal mayorista).
    const infoProd = produccionDe(order)
    const prodCambiados = await aplicarProduccion(admin, existente.id, order.line_items ?? [], infoProd)

    if (!Object.keys(cambios).length) {
      if (!prodCambiados) return json({ ok: true, ya_existia: true, venta_id: existente.id })
      // Solo cambió la fabricación: se "toca" la venta (mismo valor) para que Tiendas se entere en tiempo real.
      await admin.from('ventas').update({ estado_web: existente.estado_web }).eq('id', existente.id)
      // Si con esto quedaron todos los productos listos, el pedido pasa a "Listo para despachar" (y al revés).
      const fase = await ajustarFasePorProduccion(admin, existente.id)
      return json({ ok: true, actualizado: true, venta_id: existente.id, estado_web: fase ?? actual })
    }

    let { error: errUpd } = await admin.from('ventas').update(cambios).eq('id', existente.id)
    if (errUpd && /column|schema cache/i.test(errUpd.message)) {
      // Faltan las columnas del portal: se guardan solo los cambios de estado.
      for (const k of COLS_PORTAL) delete cambios[k]
      if (!Object.keys(cambios).length) return json({ ok: true, ya_existia: true, venta_id: existente.id })
      ;({ error: errUpd } = await admin.from('ventas').update(cambios).eq('id', existente.id))
    }
    if (errUpd) return json({ error: errUpd.message }, 500)

    if (cancelar) {
      const { data: its } = await admin.from('venta_items').select('producto_id, cantidad').eq('venta_id', existente.id)
      await moverStock(admin, its ?? [], 1)
    }

    if (!esBackfill && !mismoEstado && actual === 'esperando_pago' && (estadoWeb === 'en_preparacion' || estadoWeb === 'completado')) {
      try {
        await sendPushToOrg(admin, tienda.user_id, {
          title: '✅ Pago acreditado',
          body:  `${existente.cliente_nombre ?? 'Pedido'} · ${fmtMoneyAR(Number(existente.total) || 0)}`,
          url:   '/tiendas',
          tag:   'venta-web-' + existente.id,
        })
      } catch (err) {
        console.warn('[woo-order-webhook] error al enviar push:', err)
      }
    }
    const fase = infoProd.length && estadoWeb !== 'cancelado' ? await ajustarFasePorProduccion(admin, existente.id) : null
    return json({ ok: true, actualizado: true, venta_id: existente.id, estado_web: fase ?? (mismoEstado ? actual : estadoWeb) })
  }

  if (!ESTADOS_NUEVOS.has(order.status)) {
    return json({ ok: true, skipped: `estado "${order.status}" ignorado (pedido no importado)` })
  }

  // Número correlativo — mismo criterio que usa el POS.
  const { data: maxData } = await admin.from('ventas').select('numero').order('numero', { ascending: false }).limit(1)
  const numero = (maxData?.[0]?.numero ?? 0) + 1

  const nombreCliente = [order.billing?.first_name, order.billing?.last_name]
    .filter(Boolean).join(' ').trim() || 'Consumidor Final'

  // Fecha y hora reales del pedido (así una importación histórica no queda con la fecha de hoy),
  // en hora argentina. WooCommerce da date_created_gmt sin zona horaria.
  const gmt   = typeof order.date_created_gmt === 'string' && order.date_created_gmt ? order.date_created_gmt : null
  const creado = gmt ? new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(gmt) ? gmt : gmt + 'Z') : new Date()
  const now   = isNaN(creado.getTime()) ? new Date() : creado
  const fecha = now.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
  const hora  = now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' })
  const total = Number(order.total) || 0

  const ventaPayload = {
    numero, fecha, hora,
    cliente_id:           null,
    cliente_nombre:       nombreCliente,
    lista_id:             tienda.lista_id ?? null,
    lista_nombre:         null,
    comprobante:          'ticket',
    subtotal_items:       total,
    descuento_porcentaje: 0,
    descuento_monto:      0,
    total,
    forma_pago:           formaPagoDe(order),
    estado:               'pendiente_revision',
    canal:                esMayorista ? 'web_mayorista' : 'web_minorista',
    origen_ref:           origenRef,
    created_at:           now.toISOString(),
    notas:                (esMayorista ? `Pedido mayorista ${order.number ?? order.id}` : `Pedido WooCommerce #${order.id}`) + ` — ${tienda.nombre}` + (esPendiente ? ' (pendiente de pago)' : ''),
    org_id:               tienda.user_id,
  }

  const b = order.billing ?? {}
  const camposWeb = {
    tienda_id:          tienda.id,
    estado_web:         estadoWeb,
    origen_estado:      order.status,
    origen_pago:        order.payment_method_title || order.payment_method || null,
    cliente_email:      b.email || null,
    cliente_telefono:   b.phone || null,
    cliente_direccion:  [b.address_1, b.city, b.state, b.postcode].filter(Boolean).join(', ') || null,
  }

  let { data: venta, error: ventaErr } = await admin.from('ventas').insert({ ...ventaPayload, ...camposWeb, ...camposPortal }).select().single()
  // Si todavía no se corrieron los SQL de Tiendas / Mayorista, se guarda igual sin los campos que faltan.
  if (ventaErr && /column|schema cache/i.test(ventaErr.message)) {
    ;({ data: venta, error: ventaErr } = await admin.from('ventas').insert({ ...ventaPayload, ...camposWeb }).select().single())
  }
  if (ventaErr && /column|schema cache/i.test(ventaErr.message)) {
    ;({ data: venta, error: ventaErr } = await admin.from('ventas').insert(ventaPayload).select().single())
  }
  if (ventaErr) return json({ error: ventaErr.message }, 500)

  // Ítems — intentar matchear por SKU contra el catálogo; si no hay match, se
  // guarda como ítem libre (igual que un ítem libre cargado a mano en el POS).
  const lineItems: any[] = order.line_items ?? []
  const skus = lineItems.map((li) => li.sku).filter(Boolean)
  const { data: productos } = skus.length
    ? await admin.from('productos').select('id, sku').in('sku', skus)
    : { data: [] as any[] }
  const prodBySku = Object.fromEntries((productos ?? []).map((p: any) => [p.sku, p.id]))

  const infoProd = produccionDe(order)
  const itemsPayload = lineItems.map((li) => {
    const productoId = li.sku ? prodBySku[li.sku] ?? null : null
    const cantidad   = Number(li.quantity) || 1
    const subtotal   = Number(li.total) || 0
    return {
      venta_id:        venta.id,
      tipo:             productoId ? 'producto' : 'custom',
      producto_id:      productoId,
      descripcion:      li.name || 'Ítem',
      sku:              li.sku || '',
      cantidad,
      precio_unitario:  cantidad ? subtotal / cantidad : subtotal,
      subtotal,
      es_libre:         !productoId,
    }
  })

  if (itemsPayload.length) {
    await Promise.all(itemsPayload.map(async (ip, pos) => {
      // Portal mayorista: se guarda el índice del renglón y su estado de fabricación.
      // Si esas columnas todavía no existen se inserta igual, sin ellas.
      const prod = infoProd[pos]
      if (prod) {
        const extra: Record<string, unknown> = {}
        if (prod.indice !== null) extra.origen_indice = prod.indice
        if (prod.produccion) extra.produccion = prod.produccion
        if (Object.keys(extra).length) {
          const { error } = await admin.from('venta_items').insert({ ...ip, ...extra })
          if (!error) return
          if (!/column|schema cache/i.test(error.message)) console.warn('[woo-order-webhook] item:', error.message)
        }
      }
      await admin.from('venta_items').insert(ip)
    }))
  }

  // Descontar stock de los productos matcheados (informativo, no bloquea nada)
  await moverStock(admin, itemsPayload, -1)

  // Base de clientes: vincular al comprador con Clientes (por email) o crearlo.
  // Es "mejor esfuerzo": si algo falla, la venta ya quedó guardada igual.
  try {
    const email = (b.email ?? '').trim()
    let clienteId: string | null = null
    if (email) {
      const { data } = await admin.from('clientes').select('id').eq('org_id', tienda.user_id).ilike('email', email).limit(1)
      clienteId = data?.[0]?.id ?? null
    }
    if (!clienteId && nombreCliente !== 'Consumidor Final') {
      const fila: Record<string, unknown> = {
        nombre: nombreCliente, email: email || null, telefono: b.phone || null,
        direccion: camposWeb.cliente_direccion, etiqueta: 'Web', org_id: tienda.user_id,
      }
      let r = await admin.from('clientes').insert(fila).select('id').single()
      if (r.error && /user_id/.test(r.error.message)) {
        r = await admin.from('clientes').insert({ ...fila, user_id: tienda.user_id }).select('id').single()
      }
      if (r.error) console.warn('[woo-order-webhook] no se pudo crear el cliente:', r.error.message)
      else clienteId = r.data.id
    }
    if (clienteId) await admin.from('ventas').update({ cliente_id: clienteId }).eq('id', venta.id)
  } catch (err) {
    console.warn('[woo-order-webhook] error al vincular cliente:', err)
  }

  try {
    if (!esBackfill) await sendPushToOrg(admin, tienda.user_id, {
      title: esPendiente
        ? '⏳ Pedido pendiente de pago'
        : esMayorista ? '🏭 Nuevo pedido mayorista' : '💰 Nueva venta desde la web',
      body:  `${nombreCliente} · ${fmtMoneyAR(total)}`,
      url:   '/tiendas',
      tag:   'venta-web-' + venta.id,
    })
  } catch (err) {
    console.warn('[woo-order-webhook] error al enviar push:', err)
  }

  return json({ ok: true, venta_id: venta.id, numero })
})
