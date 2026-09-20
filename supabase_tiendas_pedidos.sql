-- Ejecutar en Supabase Dashboard -> SQL Editor
-- Sección "Tiendas": estado de los pedidos web y datos de contacto del comprador.

alter table public.ventas add column if not exists tienda_id          bigint references public.tiendas(id) on delete set null;
alter table public.ventas add column if not exists estado_web         text;   -- esperando_pago | procesado | completado | cancelado
alter table public.ventas add column if not exists origen_estado      text;   -- estado tal cual lo tiene WooCommerce (on-hold, processing...)
alter table public.ventas add column if not exists origen_pago        text;   -- medio de pago que eligió el cliente en la web
alter table public.ventas add column if not exists cliente_email      text;
alter table public.ventas add column if not exists cliente_telefono   text;
alter table public.ventas add column if not exists cliente_direccion  text;

alter table public.ventas drop constraint if exists ventas_estado_web_check;
alter table public.ventas add constraint ventas_estado_web_check
  check (estado_web is null or estado_web in ('esperando_pago', 'procesado', 'completado', 'cancelado'));

create index if not exists ventas_tienda_idx on public.ventas (tienda_id) where tienda_id is not null;

-- Pedidos web que ya existían: completar el estado y la tienda a partir de las notas
update public.ventas
   set estado_web = case when notas ilike '%pendiente de pago%' then 'esperando_pago' else 'procesado' end
 where origen_ref like 'WC#%' and estado_web is null;

update public.ventas v
   set tienda_id = t.id
  from public.tiendas t
 where v.tienda_id is null
   and v.origen_ref like 'WC#%'
   and position(t.nombre in coalesce(v.notas, '')) > 0;
