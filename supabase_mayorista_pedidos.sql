-- Ejecutar en Supabase Dashboard -> SQL Editor
-- Pedidos del portal mayorista: datos del pedido, entrega y seguimiento.

alter table public.ventas add column if not exists origen_numero            text;  -- N° de pedido del portal (ej. 2026-0014)
alter table public.ventas add column if not exists origen_logistica         text;  -- logística elegida (ej. Andreani)
alter table public.ventas add column if not exists origen_tracking          text;  -- N° de seguimiento
alter table public.ventas add column if not exists origen_tracking_url      text;
alter table public.ventas add column if not exists origen_estado_portal     text;  -- pendiente | confirmado | en_produccion | despachado | cancelado
alter table public.ventas add column if not exists cliente_dni              text;
alter table public.ventas add column if not exists cliente_empresa          text;  -- razón social
alter table public.ventas add column if not exists cliente_direccion_envio  text;  -- dirección de entrega completa
alter table public.ventas add column if not exists contacto_preferido       text;  -- whatsapp / email / ...
