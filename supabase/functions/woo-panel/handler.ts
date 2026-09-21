// Lógica de la función woo-panel (el panel de WooCommerce dentro de "Tiendas").
// Está separada de index.ts para poder probarla con Node: recibe sus dependencias (Supabase, fetch).
//
// El navegador NO habla directo con WooCommerce: pasa por acá, así las claves de API no viajan por
// internet ni chocan con CORS / contenido mixto (HTTPS → HTTP), y todo queda registrado en el programa.
import {
  ESTADOS_WOO, ESTADOS_BORRADOR, wooFetch, filaPedido, resumenProducto, evaluarWebhooks, firmar, esLocal, baseUrl,
} from '../_shared/woo.ts'

export type Deps = {
  admin: any
  fetchFn: typeof fetch
  env: { SUPABASE_URL: string, SERVICE_ROLE_KEY: string }
}

const cors = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}
const fallo = (error: string, extra: Record<string, unknown> = {}) => json({ ok: false, error, ...extra })

/** Referencia del proyecto Supabase (https://REF.supabase.co → REF). */
function refDe(url: string): string {
  return (/^https?:\/\/([^.]+)\.supabase\.co/i.exec(url) ?? [])[1] ?? ''
}
function urlWebhook(env: Deps['env'], tiendaId: number): string {
  return `https://${refDe(env.SUPABASE_URL)}.functions.supabase.co/woo-order-webhook?tienda=${tiendaId}`
}

export async function handler(req: Request, deps: Deps): Promise<Response> {
  const { admin, fetchFn, env } = deps
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  // ── Quién llama ─────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'No autorizado' }, 401)
  const { data: { user }, error: authErr } = await admin.auth.getUser(authHeader.replace(/^Bearer /i, ''))
  if (authErr || !user) return json({ error: 'Token inválido' }, 401)
  const { data: perfil } = await admin.from('profiles').select('org_id').eq('id', user.id).maybeSingle()
  const orgId = perfil?.org_id ?? user.id

  const body = await req.json().catch(() => ({}))
  const { accion, tienda_id } = body
  if (!accion || !tienda_id) return fallo('Faltan datos (accion, tienda_id).')

  // ── La tienda (tiene que ser de esta organización y de tipo WooCommerce) ────
  const { data: tienda } = await admin.from('tiendas').select('*').eq('id', tienda_id).maybeSingle()
  if (!tienda || tienda.user_id !== orgId) return fallo('La tienda no existe.')
  if (tienda.tipo !== 'woocommerce') return fallo('Este panel es solo para tiendas WooCommerce.')

  const woo = (path: string, opts: any = {}) => wooFetch(tienda, path, { ...opts, fetchFn })
  const wooId = () => Number(body.woo_id)

  /** Pasa un pedido de WooCommerce por la misma lógica que el webhook (ventas, stock, clientes, panel). */
  const reproducirEnWebhook = async (order: any, topic = 'order.updated', backfill = false) => {
    const cuerpo = JSON.stringify(order)
    const firma = await firmar(tienda.webhook_secret, cuerpo)
    const res = await fetchFn(`${env.SUPABASE_URL}/functions/v1/woo-order-webhook?tienda=${tienda.id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-wc-webhook-signature': firma,
        'x-wc-webhook-topic': topic,
        ...(backfill ? { 'x-gestion-backfill': '1' } : {}),
      },
      body: cuerpo,
    })
    let data: any = null
    try { data = await res.json() } catch { /* sin cuerpo */ }
    return { http: res.status, data }
  }

  switch (accion) {
    // ── Diagnóstico de la conexión ───────────────────────────────────────────
    case 'probar': {
      const checks: { id: string, titulo: string, ok: boolean | null, detalle: string }[] = []

      if (esLocal(tienda.url)) {
        checks.push({ id: 'acceso', titulo: 'Acceso a la tienda', ok: false,
          detalle: `${tienda.url} es un sitio local: el servidor no puede llegar. Usá una tienda con dirección pública (HTTPS).` })
        return json({ ok: false, checks, local: true })
      }

      const sys = await woo('system_status')
      checks.push({
        id: 'claves', titulo: 'Claves de API', ok: sys.ok,
        detalle: sys.ok
          ? `Conectado a WooCommerce ${sys.data?.environment?.version ?? ''} (WordPress ${sys.data?.environment?.wp_version ?? ''}).`
          : (sys.error ?? 'No se pudo conectar.'),
      })
      if (!sys.ok) return json({ ok: false, checks })

      const wh = await woo('webhooks', { query: { per_page: 100 } })
      let evaluacion: any = null
      if (wh.ok) {
        evaluacion = evaluarWebhooks(wh.data, tienda.id, refDe(env.SUPABASE_URL))
        checks.push({
          id: 'webhook', titulo: 'Aviso de pedidos (webhook)', ok: evaluacion.ok,
          detalle: evaluacion.ok
            ? `Activo: cada cambio de un pedido llega al programa.`
            : evaluacion.problemas.join(' '),
        })
        checks.push({
          id: 'webhook_eliminados', titulo: 'Aviso de pedidos eliminados', ok: evaluacion.tiene_deleted ? true : null,
          detalle: evaluacion.tiene_deleted ? 'Activo.' : 'Opcional: sin este aviso, un pedido que se manda a la papelera en WooCommerce no se anula en el programa.',
        })
      } else {
        checks.push({ id: 'webhook', titulo: 'Aviso de pedidos (webhook)', ok: false, detalle: wh.error ?? 'No se pudieron leer los webhooks (las claves necesitan permiso de lectura).' })
      }

      const ped = await woo('orders', { query: { per_page: 1, status: 'any' } })
      let enPrograma: number | null = null
      try {
        const { count } = await admin.from('pedidos_web').select('id', { count: 'exact', head: true }).eq('tienda_id', tienda.id)
        enPrograma = count ?? 0
      } catch { /* tabla aún no creada */ }
      const faltan = ped.ok && enPrograma !== null ? Math.max(0, (ped.total ?? 0) - enPrograma) : null
      checks.push({
        id: 'pedidos', titulo: 'Pedidos en el programa', ok: faltan === null ? null : faltan === 0,
        detalle: !ped.ok ? (ped.error ?? 'No se pudieron leer los pedidos.')
          : enPrograma === null ? 'Falta correr supabase_woo_panel.sql en Supabase (SQL Editor).'
          : faltan === 0 ? `Los ${ped.total} pedidos de WooCommerce ya están en el programa.`
          : `WooCommerce tiene ${ped.total} pedidos y el programa ${enPrograma}: faltan ${faltan}. Usá "Sincronizar pedidos".`,
      })

      return json({
        ok: checks.every((c) => c.ok !== false),
        checks,
        webhook: evaluacion,
        pedidos_woo: ped.ok ? ped.total : null,
        pedidos_programa: enPrograma,
        ultimo_webhook_en: tienda.ultimo_webhook_en ?? null,
        ultima_sync_en: tienda.ultima_sync_en ?? null,
        url_webhook: urlWebhook(env, tienda.id),
      })
    }

    // ── Deja el webhook de WooCommerce bien configurado ──────────────────────
    case 'arreglar_webhook': {
      if (!tienda.webhook_secret) return fallo('La tienda no tiene "Webhook Secret" cargado en Integraciones.')
      const lista = await woo('webhooks', { query: { per_page: 100 } })
      if (!lista.ok) return fallo(lista.error ?? 'No se pudieron leer los webhooks.')
      const url = urlWebhook(env, tienda.id)
      const acciones: string[] = []

      const asegurar = async (tema: string, nombre: string) => {
        const existentes = (lista.data as any[]).filter((w) => /woo-order-webhook/.test(w.delivery_url ?? '') && w.topic === tema)
        const cuerpo = { name: nombre, topic: tema, delivery_url: url, secret: tienda.webhook_secret, status: 'active' }
        if (existentes.length) {
          const w = existentes[0]
          const r = await woo(`webhooks/${w.id}`, { method: 'PUT', body: cuerpo })
          acciones.push(r.ok ? `Webhook #${w.id} (${tema}): activado y apuntando a esta tienda.` : `Webhook #${w.id}: ${r.error}`)
          return r.ok
        }
        const r = await woo('webhooks', { method: 'POST', body: cuerpo })
        acciones.push(r.ok ? `Webhook creado (${tema}).` : `No se pudo crear el webhook ${tema}: ${r.error}`)
        return r.ok
      }
      const a = await asegurar('order.updated', 'Gestión — Pedido actualizado')
      const b = await asegurar('order.deleted', 'Gestión — Pedido eliminado')
      return json({ ok: a && b, acciones })
    }

    // ── Importar pedidos desde WooCommerce (los que nunca llegaron por webhook) ─
    case 'sincronizar': {
      if (!tienda.webhook_secret) return fallo('La tienda no tiene "Webhook Secret" cargado en Integraciones.')
      const pagina = Math.max(1, Number(body.pagina) || 1)
      const porPagina = Math.min(50, Math.max(1, Number(body.por_pagina) || 25))
      const r = await woo('orders', { query: { page: pagina, per_page: porPagina, orderby: 'date', order: 'desc', status: 'any', after: body.desde || undefined } })
      if (!r.ok) return fallo(r.error ?? 'No se pudieron leer los pedidos.')

      const resumen = { procesados: 0, nuevas_ventas: 0, actualizados: 0, sin_cambios: 0, ignorados: 0, errores: 0 }
      const detalle: { woo_id: number, estado: string, resultado: string }[] = []
      for (const order of r.data as any[]) {
        if (ESTADOS_BORRADOR.has(order.status)) continue
        resumen.procesados++
        const res = await reproducirEnWebhook(order, 'order.updated', true)
        const d = res.data ?? {}
        let resultado = 'error'
        if (res.http >= 400) { resumen.errores++ }
        else if (d.skipped) { resultado = 'guardado (sin venta)'; resumen.ignorados++ }
        else if (d.ya_existia) { resultado = 'sin cambios'; resumen.sin_cambios++ }
        else if (d.actualizado) { resultado = 'actualizado'; resumen.actualizados++ }
        else if (d.venta_id) { resultado = 'venta nueva'; resumen.nuevas_ventas++ }
        else { resultado = 'guardado'; resumen.ignorados++ }
        detalle.push({ woo_id: order.id, estado: order.status, resultado: res.http >= 400 ? `error: ${d.error ?? res.http}` : resultado })
      }
      const paginas = r.paginas ?? 1
      const fin = pagina >= paginas
      if (fin) { try { await admin.from('tiendas').update({ ultima_sync_en: new Date().toISOString() }).eq('id', tienda.id) } catch { /* columna aún no creada */ } }
      return json({ ok: true, ...resumen, detalle, pagina, paginas, total: r.total, siguiente: fin ? null : pagina + 1 })
    }

    // ── Un pedido completo, con sus notas ────────────────────────────────────
    case 'pedido': {
      const id = wooId()
      if (!id) return fallo('Falta woo_id.')
      const [p, n] = await Promise.all([woo(`orders/${id}`), woo(`orders/${id}/notes`, { query: { per_page: 100 } })])
      if (!p.ok) return fallo(p.error ?? 'No se pudo leer el pedido.')
      const notas = n.ok ? n.data : []
      try {
        await admin.from('pedidos_web').upsert({ ...filaPedido(p.data, { id: tienda.id, user_id: tienda.user_id }), notas }, { onConflict: 'tienda_id,woo_id' })
      } catch { /* tabla aún no creada */ }
      return json({ ok: true, pedido: p.data, notas })
    }

    // ── Cambiar el estado en WooCommerce (y reflejarlo en el programa) ───────
    case 'estado': {
      const id = wooId()
      const status = String(body.status || '')
      if (!id) return fallo('Falta woo_id.')
      if (!(ESTADOS_WOO as readonly string[]).includes(status)) return fallo('Estado no válido.')
      const r = await woo(`orders/${id}`, { method: 'PUT', body: { status } })
      if (!r.ok) return fallo(r.error ?? 'WooCommerce no aceptó el cambio.', { status: r.status })
      const sync = await reproducirEnWebhook(r.data)
      return json({ ok: true, pedido: r.data, sincronizado: sync.http < 400 })
    }

    // ── Nota del pedido ──────────────────────────────────────────────────────
    case 'nota': {
      const id = wooId()
      const texto = String(body.texto || '').trim()
      if (!id || !texto) return fallo('Falta el pedido o el texto de la nota.')
      const r = await woo(`orders/${id}/notes`, { method: 'POST', body: { note: texto, customer_note: !!body.para_cliente } })
      if (!r.ok) return fallo(r.error ?? 'No se pudo guardar la nota.')
      return json({ ok: true, nota: r.data })
    }

    // ── Productos (catálogo de WooCommerce) ──────────────────────────────────
    case 'productos': {
      const r = await woo('products', {
        query: {
          page: Number(body.pagina) || 1, per_page: Math.min(50, Number(body.por_pagina) || 20),
          search: body.buscar || undefined, status: body.estado || undefined, stock_status: body.stock || undefined,
          orderby: 'date', order: 'desc',
        },
      })
      if (!r.ok) return fallo(r.error ?? 'No se pudieron leer los productos.')
      const items = (r.data as any[]).map(resumenProducto)
      const skus = items.map((p) => p.sku).filter(Boolean)
      let enApp = new Set<string>()
      if (skus.length) {
        try {
          const { data } = await admin.from('productos').select('sku').in('sku', skus)
          enApp = new Set((data ?? []).map((x: any) => x.sku))
        } catch { /* sin datos del catálogo */ }
      }
      return json({ ok: true, items: items.map((p) => ({ ...p, en_programa: p.sku ? enApp.has(p.sku) : false })), total: r.total, paginas: r.paginas })
    }

    // ── Cupones ──────────────────────────────────────────────────────────────
    case 'cupones': {
      const r = await woo('coupons', { query: { page: Number(body.pagina) || 1, per_page: Math.min(50, Number(body.por_pagina) || 20), search: body.buscar || undefined } })
      if (!r.ok) return fallo(r.error ?? 'No se pudieron leer los cupones.')
      const items = (r.data as any[]).map((c) => ({
        id: c.id, codigo: c.code, tipo: c.discount_type, monto: Number(c.amount) || 0, usos: c.usage_count ?? 0,
        limite: c.usage_limit ?? null, vence: c.date_expires ?? null, descripcion: c.description || '', estado: c.status,
      }))
      return json({ ok: true, items, total: r.total, paginas: r.paginas })
    }

    // ── Clientes registrados en WooCommerce ──────────────────────────────────
    case 'clientes': {
      const r = await woo('customers', { query: { page: Number(body.pagina) || 1, per_page: Math.min(50, Number(body.por_pagina) || 20), search: body.buscar || undefined, orderby: 'registered_date', order: 'desc' } })
      if (!r.ok) return fallo(r.error ?? 'No se pudieron leer los clientes.')
      const items = (r.data as any[]).map((c) => ({
        id: c.id, nombre: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || '(sin nombre)', email: c.email,
        telefono: c.billing?.phone || '', pedidos: c.orders_count ?? null, gastado: c.total_spent != null ? Number(c.total_spent) : null, registrado: c.date_created ?? null,
      }))
      return json({ ok: true, items, total: r.total, paginas: r.paginas })
    }

    default:
      return fallo(`Acción desconocida: ${accion}`)
  }
}

export { baseUrl }
