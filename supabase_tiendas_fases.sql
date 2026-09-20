-- Ejecutar en Supabase Dashboard -> SQL Editor
-- Fases del pedido web: esperando pago -> en preparación -> listo para despachar -> despachado

alter table public.ventas drop constraint if exists ventas_estado_web_check;
alter table public.ventas add constraint ventas_estado_web_check
  check (estado_web is null or estado_web in
    ('esperando_pago', 'procesado', 'en_preparacion', 'listo', 'completado', 'cancelado'));

-- Los pedidos que estaban "procesados" pasan a "en preparación"
update public.ventas set estado_web = 'en_preparacion' where estado_web = 'procesado';
