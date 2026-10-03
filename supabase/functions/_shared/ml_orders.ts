// Ventas de Mercado Libre → ventas del programa. Lo usan el webhook (tiempo real)
// y la importación manual de las últimas ventas. Es idempotente: una orden de ML
// entra una sola vez (origen_ref = ML#<orden>) y, si cambia de estado, se actualiza.
import { mlFetch } from './ml.ts'
import { expandirCombos } from './combos.ts'
import { sendPushToOrg } from './webpush.ts'

type Cuenta = { org_id: string, ml_user_id: number, tienda_id: number | null }

// Estado de la orden (+ del envío) de ML → fase del pedido en el programa.
function estadoWebDe(order: any, envio: any): string {
  const s = order.status
  if (s === 'cancelled' || s === 'invalid') return 'cancelado'
  if (s === 'payment_required' || s === 'payment_in_process' || s === 'confirmed') return 'esperando_pago'
  const e = envio?.status
  if (e === 'shipped' || e === 'delivered') return 'completado'
  if (e === 'ready_to_ship') return 'listo'
  return 'en_preparacion'
}

function formaPagoDe(order: any): string {
  const tipo = String(order.payments?.[0]?.payment_type ?? order.payments?.[0]?.payment_type_id ?? '').toLowerCase()
  if (tipo.includes('debit')) return 'debito'
  if (tipo.includes('credit')) return 'credito'
  return 'transferencia' // dinero en cuenta de Mercado Pago, efectivo (ticket), transferencia
}

async function moverStock(admin: any, itemsCrudos: { producto_id: string | null; cantidad: number }[], signo: 1 | -1) {
  const items = await expandirCombos(admin, itemsCrudos)
  const porProducto: Record<string, number> = {}
  for (const it of items) {
    if (!it.producto_id) continue
    porProducto[it.producto_id] = (porProducto[it.producto_id] || 0) + Number(it.cantidad)
  }
  const ids = Object.keys(porProducto)
  if (!ids.length) return
  const { data } = await admin.from('productos').select('id, stock_actual').in('id', ids)
  await Promise.all((data ?? []).map((p: any) =>
    admin.from('productos').update({ stock_actual: (Number(p.stock_actual) || 0) + signo * porProducto[p.id] }).eq('id', p.id)))
}

const fmtMoney = (n: number) => '$ ' + n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Trae la orden de ML y la deja reflejada en Ventas.
 * @returns { ok, accion } accion: 'creada' | 'actualizada' | 'sin_cambios' | 'ignorada'
 */
export async function procesarOrdenML(
  admin: any, cuenta: Cuenta, orderId: number | string, opts: { sinPush?: boolean } = {},
): Promise<{ ok: boolean, accion?: string, venta_id?: number, error?: string }> {
  const org = cuenta.org_id
  const r = await mlFetch(admin, org, `/orders/${orderId}`)
  if (!r.ok) return { ok: false, error: r.error }
  const order = r.data
  if (!order?.id) return { ok: false, error: 'Orden inválida' }
  if (Number(order.seller?.id) !== Number(cuenta.ml_user_id)) return { ok: true, accion: 'ignorada' } // es una compra, no una venta

  // Envío: estado y dirección (mejor esfuerzo)
  let envio: any = null
  if (order.shipping?.id) {
    const e = await mlFetch(admin, org, `/shipments/${order.shipping.id}`, { headers: { 'x-format-new': 'true' } })
    if (e.ok) envio = e.data
  }
  const estadoWeb = estadoWebDe(order, envio)
  const origenRef = `ML#${order.id}`
  const dir = envio?.receiver_address ?? order.shipping?.receiver_address ?? null
  const direccion = dir
    ? [dir.address_line || [dir.street_name, dir.street_number].filter(Boolean).join(' '), dir.city?.name ?? dir.city, dir.state?.name ?? dir.state, dir.zip_code].filter(Boolean).join(', ')
    : null
  const tracking = envio?.tracking_number ?? null
  const logistica = envio?.logistic_type ?? envio?.shipping_option?.name ?? null

  const { data: existente } = await admin.from('ventas')
    .select('id, estado, estado_web, factura_emitida, origen_tracking, cliente_nombre, total')
    .eq('org_id', org).eq('origen_ref', origenRef).maybeSingle()

  if (existente) {
    const cambios: Record<string, unknown> = {}
    if (existente.estado_web !== estadoWeb) { cambios.estado_web = estadoWeb; cambios.origen_estado = order.status }
    if (tracking && existente.origen_tracking !== tracking) cambios.origen_tracking = tracking
    const cancelar = estadoWeb === 'cancelado' && existente.estado !== 'anulado' && !existente.factura_emitida
    if (cancelar) cambios.estado = 'anulado'
    if (!Object.keys(cambios).length) return { ok: true, accion: 'sin_cambios', venta_id: existente.id }
    const { error } = await admin.from('ventas').update(cambios).eq('id', existente.id)
    if (error) return { ok: false, error: error.message }
    if (cancelar) {
      const { data: its } = await admin.from('venta_items').select('producto_id, cantidad').eq('venta_id', existente.id)
      await moverStock(admin, its ?? [], 1)
    }
    return { ok: true, accion: 'actualizada', venta_id: existente.id }
  }

  // Solo entran ventas con el pago acreditado (o canceladas que nunca vimos: no tiene sentido importarlas).
  if (order.status !== 'paid') return { ok: true, accion: 'ignorada' }

  const { data: maxData } = await admin.from('ventas').select('numero').order('numero', { ascending: false }).limit(1)
  const numero = (maxData?.[0]?.numero ?? 0) + 1

  const b = order.buyer ?? {}
  const nombre = [b.first_name, b.last_name].filter(Boolean).join(' ').trim() || b.nickname || 'Consumidor Final'
  const telefono = [b.phone?.area_code, b.phone?.number].filter(Boolean).join(' ') || null

  // DNI / CUIT del comprador (para facturar). Mejor esfuerzo.
  let dni: string | null = null
  const bi = await mlFetch(admin, org, `/orders/${order.id}/billing_info`)
  if (bi.ok) dni = bi.data?.billing_info?.doc_number ?? null

  const creado = new Date(order.date_created ?? Date.now())
  const now = isNaN(creado.getTime()) ? new Date() : creado
  const fecha = now.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
  const hora = now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' })
  const total = Number(order.total_amount) || 0
  const comision = (order.order_items ?? []).reduce((s: number, li: any) => s + (Number(li.sale_fee) || 0) * (Number(li.quantity) || 1), 0)

  const { data: tienda } = cuenta.tienda_id
    ? await admin.from('tiendas').select('id, nombre, lista_id').eq('id', cuenta.tienda_id).maybeSingle()
    : { data: null }

  const { data: venta, error: ventaErr } = await admin.from('ventas').insert({
    numero, fecha, hora,
    cliente_id: null,
    cliente_nombre: nombre,
    lista_id: tienda?.lista_id ?? null,
    comprobante: 'ticket',
    subtotal_items: total, descuento_porcentaje: 0, descuento_monto: 0, total,
    forma_pago: formaPagoDe(order),
    estado: 'pendiente_revision',
    canal: 'mercadolibre',
    origen_ref: origenRef,
    created_at: now.toISOString(),
    notas: `Venta Mercado Libre #${order.id}` + (b.nickname ? ` — ${b.nickname}` : '') + (comision ? ` — comisión ML ${fmtMoney(comision)}` : ''),
    org_id: org,
    tienda_id: cuenta.tienda_id,
    estado_web: estadoWeb,
    origen_estado: order.status,
    origen_pago: 'Mercado Pago',
    origen_numero: String(order.id),
    origen_logistica: logistica,
    origen_tracking: tracking,
    cliente_email: b.email || null,
    cliente_telefono: telefono,
    cliente_direccion: direccion,
    cliente_direccion_envio: direccion,
    cliente_dni: dni,
  }).select().single()
  if (ventaErr) return { ok: false, error: ventaErr.message }

  // Ítems: se vinculan al producto por la publicación (item_id) o por SKU; si no, quedan como ítem libre.
  const lineas: any[] = order.order_items ?? []
  const itemIds = lineas.map((li) => li.item?.id).filter(Boolean)
  const skus = lineas.map((li) => li.item?.seller_sku || li.item?.seller_custom_field).filter(Boolean)
  const [{ data: pubs }, { data: prods }] = await Promise.all([
    itemIds.length ? admin.from('ml_publicaciones').select('item_id, producto_id').eq('org_id', org).in('item_id', itemIds) : { data: [] },
    skus.length ? admin.from('productos').select('id, sku').eq('org_id', org).in('sku', skus) : { data: [] },
  ])
  const porItem = Object.fromEntries((pubs ?? []).filter((p: any) => p.producto_id).map((p: any) => [p.item_id, p.producto_id]))
  const porSku = Object.fromEntries((prods ?? []).map((p: any) => [p.sku, p.id]))

  const items = lineas.map((li) => {
    const sku = li.item?.seller_sku || li.item?.seller_custom_field || ''
    const productoId = porItem[li.item?.id] ?? (sku ? porSku[sku] : null) ?? null
    const cantidad = Number(li.quantity) || 1
    const unit = Number(li.unit_price) || 0
    return {
      venta_id: venta.id,
      tipo: productoId ? 'producto' : 'custom',
      producto_id: productoId,
      descripcion: li.item?.title || 'Ítem',
      sku,
      cantidad,
      precio_unitario: unit,
      subtotal: unit * cantidad,
      es_libre: !productoId,
    }
  })
  if (items.length) await admin.from('venta_items').insert(items)
  await moverStock(admin, items, -1)

  // Cliente: se vincula (por nombre) o se crea. Mejor esfuerzo.
  try {
    if (nombre !== 'Consumidor Final') {
      let clienteId: string | null = null
      const { data } = await admin.from('clientes').select('id').eq('org_id', org).eq('etiqueta', 'Mercado Libre').ilike('nombre', nombre).limit(1)
      clienteId = data?.[0]?.id ?? null
      if (!clienteId) {
        const fila: Record<string, unknown> = { nombre, email: b.email || null, telefono, direccion, etiqueta: 'Mercado Libre', org_id: org }
        let c = await admin.from('clientes').insert(fila).select('id').single()
        if (c.error && /user_id/.test(c.error.message)) c = await admin.from('clientes').insert({ ...fila, user_id: org }).select('id').single()
        if (!c.error) clienteId = c.data.id
      }
      if (clienteId) await admin.from('ventas').update({ cliente_id: clienteId }).eq('id', venta.id)
    }
  } catch (err) {
    console.warn('[ml] no se pudo vincular el cliente:', err)
  }

  if (!opts.sinPush) {
    try {
      await sendPushToOrg(admin, org, {
        title: '🛍️ Nueva venta en Mercado Libre',
        body: `${nombre} · ${fmtMoney(total)}`,
        url: '/ventas',
        tag: 'venta-ml-' + venta.id,
      })
    } catch (err) {
      console.warn('[ml] push:', err)
    }
  }
  return { ok: true, accion: 'creada', venta_id: venta.id }
}
