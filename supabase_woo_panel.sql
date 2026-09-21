-- Ejecutar en Supabase Dashboard -> SQL Editor
-- Panel WooCommerce dentro de "Tiendas": guarda cada pedido tal cual lo manda WooCommerce
-- (todos los estados: pendiente, en espera, procesando, completado, cancelado, reembolsado, fallido),
-- para ver en el programa lo mismo que se ve en el panel de WooCommerce.

create table if not exists public.pedidos_web (
  id               bigint generated always as identity primary key,
  org_id           uuid   not null,
  tienda_id        bigint not null references public.tiendas(id) on delete cascade,
  woo_id           bigint not null,                 -- ID del pedido en WooCommerce
  numero           text,                            -- número visible (puede diferir del ID)
  estado           text   not null,                 -- estado nativo: pending, on-hold, processing, completed, cancelled, refunded, failed, trash
  fecha_creado     timestamptz,
  fecha_modificado timestamptz,
  total            numeric(14,2) not null default 0,
  moneda           text,
  cliente_nombre   text,
  cliente_email    text,
  cliente_telefono text,
  metodo_pago      text,                            -- id de la pasarela (bacs, woo-mercado-pago-basic...)
  metodo_pago_titulo text,
  datos            jsonb  not null,                 -- pedido completo tal como lo manda WooCommerce
  notas            jsonb,                           -- notas del pedido (se traen al abrirlo)
  sincronizado_en  timestamptz not null default now(),
  unique (tienda_id, woo_id)
);

create index if not exists pedidos_web_org_fecha_idx   on public.pedidos_web (org_id, tienda_id, fecha_creado desc);
create index if not exists pedidos_web_tienda_estado   on public.pedidos_web (tienda_id, estado);

alter table public.pedidos_web enable row level security;

drop policy if exists "pedidos_web_org" on public.pedidos_web;
create policy "pedidos_web_org" on public.pedidos_web
  for all
  using  (org_id = public.get_org_id())
  with check (org_id = public.get_org_id());

-- Estado de la conexión de cada tienda (lo completan las funciones)
alter table public.tiendas add column if not exists ultimo_webhook_en timestamptz;  -- último aviso recibido de WooCommerce
alter table public.tiendas add column if not exists ultima_sync_en    timestamptz;  -- última sincronización manual de pedidos
