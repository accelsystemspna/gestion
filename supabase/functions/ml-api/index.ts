// API de Mercado Libre para la app (autenticada con el usuario logueado).
// Acciones: connect_url, status, disconnect, import_orders (+ publicaciones y preguntas).
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ML_AUTH, credencialesApp, redirectUri, mlFetch } from '../_shared/ml.ts'
import { procesarOrdenML } from '../_shared/ml_orders.ts'
import { publicarItem, htmlATexto } from '../_shared/ml_publicar.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'No autorizado' }, 401)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )
    const { data: { user }, error: authErr } = await admin.auth.getUser(authHeader.replace('Bearer ', ''))
    if (authErr || !user) return json({ error: 'Token inválido' }, 401)

    const { data: perfil } = await admin.from('profiles').select('rol, org_id').eq('id', user.id).maybeSingle()
    if (!perfil || !['principal', 'master', 'admin'].includes(perfil.rol)) return json({ error: 'No tenés permiso' }, 403)
    const org: string = perfil.org_id ?? user.id
    const esMaster = perfil.rol === 'principal' || perfil.rol === 'master'

    const body = await req.json().catch(() => ({}))
    const { action } = body

    const cuentaDe = async () =>
      (await admin.from('ml_cuentas').select('org_id, ml_user_id, nickname, tienda_id').eq('org_id', org).maybeSingle()).data

    // ── Conectar: devuelve la URL de autorización de ML ─────────────────
    if (action === 'connect_url') {
      if (!esMaster) return json({ error: 'Solo el master puede conectar Mercado Libre' }, 403)
      const { id } = credencialesApp()
      const state = crypto.randomUUID()
      await admin.from('ml_estados_oauth').delete().lt('created_at', new Date(Date.now() - 3600_000).toISOString())
      await admin.from('ml_estados_oauth').insert({ state, org_id: org })
      const u = new URL(ML_AUTH)
      u.searchParams.set('response_type', 'code')
      u.searchParams.set('client_id', id)
      u.searchParams.set('redirect_uri', redirectUri())
      u.searchParams.set('state', state)
      return json({ url: u.toString() })
    }

    // ── Estado de la conexión ───────────────────────────────────────────
    if (action === 'status') {
      const c = await cuentaDe()
      if (!c) return json({ conectada: false })
      const me = await mlFetch(admin, org, '/users/me')
      return json({
        conectada: me.ok, nickname: c.nickname, ml_user_id: c.ml_user_id,
        error: me.ok ? null : me.error,
      })
    }

    // ── Desconectar ─────────────────────────────────────────────────────
    if (action === 'disconnect') {
      if (!esMaster) return json({ error: 'Solo el master puede desconectar Mercado Libre' }, 403)
      const c = await cuentaDe()
      if (!c) return json({ ok: true })
      await admin.from('ml_tokens').delete().eq('org_id', org)
      await admin.from('ml_cuentas').delete().eq('org_id', org)
      if (c.tienda_id) await admin.from('tiendas').update({ activa: false }).eq('id', c.tienda_id)
      return json({ ok: true })
    }

    // ── Importar las ventas de los últimos N días ───────────────────────
    if (action === 'import_orders') {
      const c = await cuentaDe()
      if (!c) return json({ error: 'Mercado Libre no está conectado' }, 400)
      const dias = Math.min(Math.max(Number(body.dias) || 30, 1), 90)
      const desde = new Date(Date.now() - dias * 86400_000).toISOString()
      const resumen = { creadas: 0, actualizadas: 0, sin_cambios: 0, ignoradas: 0, errores: [] as string[] }
      for (let offset = 0; offset < 500; offset += 50) {
        const r = await mlFetch(admin, org,
          `/orders/search?seller=${c.ml_user_id}&order.date_created.from=${encodeURIComponent(desde)}&sort=date_asc&limit=50&offset=${offset}`)
        if (!r.ok) return json({ error: r.error, ...resumen }, 502)
        const ordenes: any[] = r.data?.results ?? []
        for (const o of ordenes) {
          const p = await procesarOrdenML(admin, c, o.id, { sinPush: true })
          if (!p.ok) resumen.errores.push(`#${o.id}: ${p.error}`)
          else if (p.accion === 'creada') resumen.creadas++
          else if (p.accion === 'actualizada') resumen.actualizadas++
          else if (p.accion === 'sin_cambios') resumen.sin_cambios++
          else resumen.ignoradas++
        }
        if (ordenes.length < 50) break
      }
      return json({ ok: true, ...resumen })
    }

    // ── Traer todas las publicaciones de ML y vincularlas a productos por SKU ──
    if (action === 'sync_items') {
      const c = await cuentaDe()
      if (!c) return json({ error: 'Mercado Libre no está conectado' }, 400)

      // 1) ids de todas las publicaciones (activas, pausadas, cerradas)
      const ids: string[] = []
      for (const status of ['active', 'paused', 'closed']) {
        for (let offset = 0; offset < 1000; offset += 100) {
          const r = await mlFetch(admin, org, `/users/${c.ml_user_id}/items/search?status=${status}&limit=100&offset=${offset}`)
          if (!r.ok) return json({ error: r.error }, 502)
          const res: string[] = r.data?.results ?? []
          ids.push(...res)
          if (res.length < 100) break
        }
      }

      // 2) detalle de a 20 (límite de ML)
      const items: any[] = []
      for (let i = 0; i < ids.length; i += 20) {
        const r = await mlFetch(admin, org, `/items?ids=${ids.slice(i, i + 20).join(',')}`)
        if (!r.ok) return json({ error: r.error }, 502)
        for (const e of r.data ?? []) if (e?.code === 200 && e.body) items.push(e.body)
      }

      // 3) vincular por SKU contra los productos del negocio
      const skuDe = (it: any) =>
        it.seller_custom_field || it.attributes?.find((a: any) => a.id === 'SELLER_SKU')?.value_name || null
      const skus = [...new Set(items.map(skuDe).filter(Boolean))]
      const { data: prods } = skus.length
        ? await admin.from('productos').select('id, sku').eq('org_id', org).in('sku', skus)
        : { data: [] as any[] }
      const porSku = Object.fromEntries((prods ?? []).map((p: any) => [p.sku, p.id]))

      const ahora = new Date().toISOString()
      const filas = items.map((it) => {
        const sku = skuDe(it)
        return {
          org_id: org, item_id: it.id, producto_id: sku ? porSku[sku] ?? null : null,
          ml_categoria_id: it.category_id, titulo: it.title, precio: it.price, estado: it.status,
          permalink: it.permalink, thumbnail: it.secure_thumbnail || it.thumbnail || null,
          stock: it.available_quantity, vendidos: it.sold_quantity, sku, error: null, actualizada_en: ahora,
        }
      })
      for (let i = 0; i < filas.length; i += 200) {
        const { error } = await admin.from('ml_publicaciones').upsert(filas.slice(i, i + 200), { onConflict: 'item_id' })
        if (error) return json({ error: error.message }, 500)
      }
      return json({ ok: true, total: filas.length, vinculadas: filas.filter((f) => f.producto_id).length })
    }

    // ── Sugerir categoría de ML a partir de un título ───────────────────
    if (action === 'predict_category') {
      const r = await mlFetch(admin, org, `/sites/MLA/domain_discovery/search?limit=5&q=${encodeURIComponent(String(body.titulo ?? ''))}`)
      if (!r.ok) return json({ error: r.error }, 502)
      return json({ categorias: (r.data ?? []).map((d: any) => ({ id: d.category_id, nombre: d.category_name, dominio: d.domain_name })) })
    }

    // ── Atributos que pide una categoría (para saber qué completar) ─────
    if (action === 'category_attributes') {
      const r = await mlFetch(admin, org, `/categories/${encodeURIComponent(String(body.categoria_ml))}/attributes`)
      if (!r.ok) return json({ error: r.error }, 502)
      return json({
        atributos: (r.data ?? []).filter((a: any) => !a.tags?.hidden && !a.tags?.read_only).map((a: any) => ({
          id: a.id, nombre: a.name, tipo: a.value_type, hint: a.hint ?? null,
          obligatorio: !!a.tags?.required, condicional: !!a.tags?.conditional_required,
          valores: (a.values ?? []).slice(0, 40).map((v: any) => v.name),
        })),
      })
    }

    // ── Publicar un producto (o solo validarlo, sin publicar) ───────────
    if (action === 'publish') {
      const c = await cuentaDe()
      if (!c) return json({ error: 'Mercado Libre no está conectado' }, 400)
      let q = admin.from('productos').select('*').eq('org_id', org)
      q = body.producto_id ? q.eq('id', body.producto_id) : q.eq('sku', String(body.sku ?? ''))
      const { data: producto } = await q.maybeSingle()
      if (!producto) return json({ error: 'Producto no encontrado en este negocio' }, 404)
      const r = await publicarItem(admin, org, producto, body.pedido ?? body, { soloValidar: !!body.validar })
      return json(r, r.ok ? 200 : 422)
    }

    // ── Cambiar precio / stock / estado / descripción de una publicación ─
    if (action === 'update_item') {
      const { item_id, precio, stock, estado, descripcion } = body
      const { data: pub } = await admin.from('ml_publicaciones').select('id').eq('org_id', org).eq('item_id', item_id).maybeSingle()
      if (!pub) return json({ error: 'Esa publicación no es de este negocio' }, 404)
      const cambios: Record<string, unknown> = {}
      if (precio !== undefined) cambios.price = Number(precio)
      if (stock !== undefined) cambios.available_quantity = Math.max(0, Math.round(Number(stock)))
      if (estado !== undefined) {
        if (!['active', 'paused', 'closed'].includes(estado)) return json({ error: 'Estado inválido' }, 400)
        cambios.status = estado
      }
      const errores: string[] = []
      if (Object.keys(cambios).length) {
        const r = await mlFetch(admin, org, `/items/${item_id}`, { method: 'PUT', body: cambios })
        if (!r.ok) errores.push(r.error ?? 'No se pudo actualizar')
        else await admin.from('ml_publicaciones').update({
          precio: r.data.price, stock: r.data.available_quantity, estado: r.data.status, actualizada_en: new Date().toISOString(),
        }).eq('id', pub.id)
      }
      if (descripcion !== undefined) {
        const texto = htmlATexto(descripcion)
        let d = await mlFetch(admin, org, `/items/${item_id}/description?api_version=2`, { method: 'PUT', body: { plain_text: texto } })
        // Si la publicación todavía no tenía descripción, hay que crearla en vez de reemplazarla.
        if (!d.ok && d.status === 404) d = await mlFetch(admin, org, `/items/${item_id}/description`, { method: 'POST', body: { plain_text: texto } })
        if (!d.ok) errores.push('Descripción: ' + (d.error ?? 'no se pudo'))
      }
      return json({ ok: !errores.length, errores }, errores.length ? 422 : 200)
    }

    return json({ error: 'Acción desconocida' }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
