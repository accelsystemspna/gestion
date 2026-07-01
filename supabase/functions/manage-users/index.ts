import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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

    // Verificar que el caller es admin
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authErr } = await admin.auth.getUser(token)
    if (authErr || !user) return json({ error: 'Token inválido' }, 401)

    const { data: caller } = await admin.from('profiles').select('rol').eq('id', user.id).single()
    if (caller?.rol !== 'admin') return json({ error: 'Solo admins pueden gestionar usuarios' }, 403)

    const body = await req.json()
    const { action } = body

    // ── Crear usuario ────────────────────────────────────────────────
    if (action === 'create') {
      const { email, password, nombre, rol } = body
      if (!email || !password || !nombre) return json({ error: 'Faltan campos' }, 400)

      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      })
      if (createErr) return json({ error: createErr.message }, 400)

      const { error: profileErr } = await admin.from('profiles').insert({
        id: created.user.id,
        email,
        nombre,
        rol: rol || 'vendedor',
      })
      if (profileErr) {
        await admin.auth.admin.deleteUser(created.user.id)
        return json({ error: profileErr.message }, 400)
      }

      return json({ ok: true, user_id: created.user.id })
    }

    // ── Cambiar rol ──────────────────────────────────────────────────
    if (action === 'update_rol') {
      const { user_id, rol } = body
      if (user_id === user.id) return json({ error: 'No podés cambiar tu propio rol' }, 400)
      const { error } = await admin.from('profiles').update({ rol }).eq('id', user_id)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    // ── Eliminar usuario ─────────────────────────────────────────────
    if (action === 'delete') {
      const { user_id } = body
      if (user_id === user.id) return json({ error: 'No podés eliminarte a vos mismo' }, 400)
      const { error } = await admin.auth.admin.deleteUser(user_id)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    return json({ error: 'Acción desconocida' }, 400)
  } catch (e) {
    return json({ error: e.message }, 500)
  }
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}
