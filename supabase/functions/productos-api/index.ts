// Supabase Edge Function — productos-api
// Endpoint público (protegido por API key) que expone el catálogo de
// productos activos en JSON, para integraciones externas.
import { serve }        from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'x-api-key, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'GET') return json({ error: 'Método no permitido' }, 405)

  const apiKey = req.headers.get('x-api-key')
  if (!apiKey || apiKey !== Deno.env.get('PRODUCTOS_API_KEY')) {
    return json({ error: 'No autorizado' }, 401)
  }

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const { data, error } = await admin
      .from('productos')
      .select('nombre, sku, descripcion, imagen_url, alto_producto, ancho_producto, categorias(nombre)')
      .eq('activo', true)
      .order('nombre')

    if (error) return json({ error: error.message }, 500)

    const productos = (data ?? []).map((p: any) => ({
      nombre:      p.nombre,
      sku:         p.sku,
      descripcion: p.descripcion,
      foto:        p.imagen_url,
      categoria:   p.categorias?.nombre ?? null,
      alto:        p.alto_producto,
      ancho:       p.ancho_producto,
    }))

    return json({ productos })
  } catch (e) {
    return json({ error: e.message }, 500)
  }
})
