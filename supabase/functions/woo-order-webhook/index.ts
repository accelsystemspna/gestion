// Supabase Edge Function — woo-order-webhook
// Receptor público del webhook nativo de WooCommerce ("Pedido pagado").
// Crea la venta en estado 'pendiente_revision' con canal 'web_minorista'
// para que se revise y facture desde Ventas antes de darla por confirmada.
//
// Configurar en WooCommerce → Ajustes → Avanzado → Webhooks:
//   Tema:   Pedido actualizado (o "Pedido pagado" si está disponible)
//   URL:    <esta función>?tienda=<id de la tienda en Integraciones>
//   Secret: el mismo "Webhook Secret" configurado en Integraciones para esa tienda
import { serve }        from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendPushToOrg } from '../_shared/webpush.ts'

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

// Estados de WooCommerce que consideramos "venta concretada" (pagada)
const ESTADOS_PAGADOS = new Set(['processing', 'completed'])

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
    .select('id, user_id, nombre, activa, webhook_secret, lista_id')
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

  if (!ESTADOS_PAGADOS.has(order.status)) {
    return json({ ok: true, skipped: `estado "${order.status}" ignorado` })
  }

  // Idempotencia: si este pedido ya se importó (reintentos de WooCommerce), no duplicar.
  const origenRef = `WC#${order.id}`
  const { data: existente } = await admin.from('ventas').select('id').eq('origen_ref', origenRef).maybeSingle()
  if (existente) return json({ ok: true, ya_existia: true, venta_id: existente.id })

  // Número correlativo — mismo criterio que usa el POS.
  const { data: maxData } = await admin.from('ventas').select('numero').order('numero', { ascending: false }).limit(1)
  const numero = (maxData?.[0]?.numero ?? 0) + 1

  const nombreCliente = [order.billing?.first_name, order.billing?.last_name]
    .filter(Boolean).join(' ').trim() || 'Consumidor Final'

  const now   = new Date()
  const fecha = now.toISOString().slice(0, 10)
  const hora  = now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
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
    forma_pago:           'transferencia',
    estado:               'pendiente_revision',
    canal:                'web_minorista',
    origen_ref:           origenRef,
    notas:                `Pedido WooCommerce #${order.id} — ${tienda.nombre}`,
    org_id:               tienda.user_id,
  }

  const { data: venta, error: ventaErr } = await admin.from('ventas').insert(ventaPayload).select().single()
  if (ventaErr) return json({ error: ventaErr.message }, 500)

  // Ítems — intentar matchear por SKU contra el catálogo; si no hay match, se
  // guarda como ítem libre (igual que un ítem libre cargado a mano en el POS).
  const lineItems: any[] = order.line_items ?? []
  const skus = lineItems.map((li) => li.sku).filter(Boolean)
  const { data: productos } = skus.length
    ? await admin.from('productos').select('id, sku').in('sku', skus)
    : { data: [] as any[] }
  const prodBySku = Object.fromEntries((productos ?? []).map((p: any) => [p.sku, p.id]))

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
    await Promise.all(itemsPayload.map((ip) => admin.from('venta_items').insert(ip)))
  }

  // Descontar stock de los productos matcheados (informativo, no bloquea nada)
  const porProducto: Record<string, number> = {}
  for (const ip of itemsPayload) {
    if (!ip.producto_id) continue
    porProducto[ip.producto_id] = (porProducto[ip.producto_id] || 0) + ip.cantidad
  }
  const prodIdsConStock = Object.keys(porProducto)
  if (prodIdsConStock.length) {
    const { data: prodsStock } = await admin.from('productos').select('id, stock_actual').in('id', prodIdsConStock)
    await Promise.all((prodsStock ?? []).map((p: any) =>
      admin.from('productos')
        .update({ stock_actual: (Number(p.stock_actual) || 0) - porProducto[p.id] })
        .eq('id', p.id)
    ))
  }

  try {
    await sendPushToOrg(admin, tienda.user_id, {
      title: '💰 Nueva venta desde la web',
      body:  `${nombreCliente} · ${fmtMoneyAR(total)}`,
      url:   '/ventas?web=1',
      tag:   'venta-web-' + venta.id,
    })
  } catch (err) {
    console.warn('[woo-order-webhook] error al enviar push:', err)
  }

  return json({ ok: true, venta_id: venta.id, numero })
})
