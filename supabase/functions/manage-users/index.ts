import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Jerarquía: principal (dueño del sistema) → master (dueño de un negocio) → admin / vendedor.
// El principal puede actuar sobre cualquier negocio; el master solo sobre el suyo y
// únicamente crea/gestiona admin y vendedor (los masters los crea el principal).
const ROLES_EQUIPO = ['admin', 'vendedor']
const ROLES_TODOS = ['master', 'admin', 'vendedor']

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'No autorizado' }, 401)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authErr } = await admin.auth.getUser(token)
    if (authErr || !user) return json({ error: 'Token inválido' }, 401)

    const { data: caller } = await admin.from('profiles').select('rol, org_id').eq('id', user.id).maybeSingle()
    if (!caller || !['principal', 'master'].includes(caller.rol)) {
      return json({ error: 'Solo el master puede gestionar usuarios' }, 403)
    }
    const esPrincipal = caller.rol === 'principal'
    const callerOrgId: string = caller.org_id ?? user.id

    const body = await req.json()
    const { action } = body

    // Negocio sobre el que se actúa: el del caller, salvo que sea el principal y pida otro.
    const orgObjetivo: string = esPrincipal && body.org_id ? body.org_id : callerOrgId

    // Usuario sobre el que se actúa (editar/borrar): tiene que ser del negocio objetivo
    // y nunca un principal. El master además solo toca admin/vendedor.
    const cargarObjetivo = async (id: string) => {
      const { data: t } = await admin.from('profiles').select('id, rol, org_id').eq('id', id).maybeSingle()
      if (!t) return { error: json({ error: 'Usuario no encontrado' }, 404) }
      if (t.rol === 'principal') return { error: json({ error: 'No se puede modificar al usuario principal' }, 403) }
      if (!esPrincipal && (t.org_id !== callerOrgId || !ROLES_EQUIPO.includes(t.rol))) {
        return { error: json({ error: 'No tenés permiso sobre ese usuario' }, 403) }
      }
      return { target: t }
    }

    // ── Crear usuario (dentro de un negocio) ─────────────────────────
    if (action === 'create') {
      const { password, nombre } = body
      const rol = body.rol || 'vendedor'
      if (!password || !nombre) return json({ error: 'Faltan campos' }, 400)
      if (!ROLES_TODOS.includes(rol)) return json({ error: 'Rol inválido' }, 400)
      if (rol === 'master' && !esPrincipal) return json({ error: 'Solo el principal puede crear masters' }, 403)

      if (esPrincipal && body.org_id) {
        const { data: neg } = await admin.from('negocios').select('org_id').eq('org_id', orgObjetivo).maybeSingle()
        if (!neg) return json({ error: 'Negocio inexistente' }, 400)
      }
      return await crearUsuario(admin, { nombre, password, rol, orgId: orgObjetivo })
    }

    // ── Crear negocio nuevo con su master (solo principal) ───────────
    if (action === 'create_negocio') {
      if (!esPrincipal) return json({ error: 'Solo el principal puede crear negocios' }, 403)
      const { negocio, nombre, password } = body
      if (!negocio?.trim() || !nombre || !password) return json({ error: 'Faltan campos' }, 400)

      const res = await crearUsuario(admin, { nombre, password, rol: 'master', orgId: null })
      if (res.status !== 200) return res
      const { user_id } = await res.json()

      const { error: negErr } = await admin.from('negocios').insert({ org_id: user_id, nombre: negocio.trim() })
      if (negErr) {
        await admin.auth.admin.deleteUser(user_id)
        return json({ error: negErr.message }, 400)
      }

      // Listas de precios de arranque: copia de las del principal (las edita después).
      // Categorías: ninguna — el principal se las activa desde la pantalla Negocios.
      const { data: listas } = await admin.from('listas_precios').select('*').eq('org_id', callerOrgId)
      if (listas?.length) {
        await admin.from('listas_precios').insert(
          listas.map(({ id: _id, created_at: _c, org_id: _o, ...l }) => ({ ...l, org_id: user_id }))
        )
      }
      return json({ ok: true, org_id: user_id, user_id })
    }

    // ── Cambiar rol ──────────────────────────────────────────────────
    if (action === 'update_rol') {
      const { user_id, rol } = body
      if (user_id === user.id) return json({ error: 'No podés cambiar tu propio rol' }, 400)
      if (!ROLES_TODOS.includes(rol)) return json({ error: 'Rol inválido' }, 400)
      if (rol === 'master' && !esPrincipal) return json({ error: 'Solo el principal puede crear masters' }, 403)
      const { target, error } = await cargarObjetivo(user_id)
      if (error) return error
      // Un master no se puede crear por promoción: su org_id sería el de otro negocio.
      if (rol === 'master' && target!.org_id !== user_id) {
        return json({ error: 'Para sumar un master nuevo, creá el usuario como master' }, 400)
      }
      const { error: upErr } = await admin.from('profiles').update({ rol }).eq('id', user_id)
      if (upErr) return json({ error: upErr.message }, 400)
      return json({ ok: true })
    }

    // ── Eliminar usuario ─────────────────────────────────────────────
    if (action === 'delete') {
      const { user_id } = body
      if (user_id === user.id) return json({ error: 'No podés eliminarte a vos mismo' }, 400)
      const { error } = await cargarObjetivo(user_id)
      if (error) return error
      const { error: delErr } = await admin.auth.admin.deleteUser(user_id)
      if (delErr) return json({ error: delErr.message }, 400)
      return json({ ok: true })
    }

    return json({ error: 'Acción desconocida' }, 400)
  } catch (e) {
    return json({ error: e.message }, 500)
  }
})

// orgId null = negocio nuevo (el org_id es el id del propio master).
async function crearUsuario(
  admin: ReturnType<typeof createClient>,
  { nombre, password, rol, orgId }: { nombre: string; password: string; rol: string; orgId: string | null },
) {
  const email = toEmail(nombre)
  if (email.startsWith('@')) return json({ error: 'Nombre inválido' }, 400)

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (createErr) {
    const yaExiste = /already|registered|exists/i.test(createErr.message)
    return json({ error: yaExiste ? 'Ya existe un usuario con ese nombre, probá con otro' : createErr.message }, 400)
  }

  const { error: profileErr } = await admin.from('profiles').insert({
    id: created.user.id,
    email,
    nombre,
    rol,
    org_id: orgId ?? created.user.id,
  })
  if (profileErr) {
    await admin.auth.admin.deleteUser(created.user.id)
    return json({ error: profileErr.message }, 400)
  }
  return json({ ok: true, user_id: created.user.id })
}

function toEmail(nombre: string): string {
  return nombre.toLowerCase().trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '.')
    .replace(/[^a-z0-9.]/g, '')
    + '@gestion.internal'
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}
