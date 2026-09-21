// Supabase Edge Function — woo-panel
// Panel de WooCommerce dentro de "Tiendas": pedidos completos con notas, cambio de estado,
// productos, cupones, clientes, importación de pedidos históricos y diagnóstico de la conexión.
//
//   Usuario (autenticado) → esta función → API REST de WooCommerce (con las claves de la tienda)
//
// Body: { accion, tienda_id, ... }  — ver handler.ts para las acciones.
// Las claves de API nunca salen del servidor.
import { serve }        from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handler }      from './handler.ts'

serve((req) => {
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  return handler(req, { admin, fetchFn: fetch, env: { SUPABASE_URL, SERVICE_ROLE_KEY } })
})
