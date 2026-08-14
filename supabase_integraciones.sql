-- ══════════════════════════════════════════════════════════════════
-- INTEGRACIONES (tiendas / canales de venta)
-- Ejecutar en Supabase → SQL Editor
-- ══════════════════════════════════════════════════════════════════

-- 1. Tabla tiendas
create table if not exists public.tiendas (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  nombre          text not null,
  tipo            text not null default 'woocommerce'
                    check (tipo in ('woocommerce', 'mercadolibre')),
  url             text,
  -- WooCommerce
  consumer_key    text,
  consumer_secret text,
  webhook_secret  text,          -- secret del plugin Accel Systems → Sync
  -- Mercado Libre
  app_id          text,
  access_token    text,
  -- Configuración
  lista_id        bigint,        -- lista de precios asignada
  categorias_ids  integer[],     -- categorías a sincronizar (vacío = todas)
  activa          boolean not null default true,
  notas           text,
  created_at      timestamptz not null default now()
);

create index if not exists tiendas_user_id_idx on public.tiendas (user_id);

-- 2. Row Level Security
-- OJO: usa get_org_id(), NO auth.uid() = user_id directo. Con auth.uid()
-- los usuarios admin/vendedor (creados desde la app, con su propio uid)
-- no verían las tiendas configuradas por el master — mismo bug que ya
-- se corrigió antes para branding y arca_config. get_org_id() devuelve
-- el id del master tanto si el que consulta es el master como si es un
-- admin/vendedor de su organización.
alter table public.tiendas enable row level security;

drop policy if exists "tiendas_all" on public.tiendas;
create policy "tiendas_all" on public.tiendas
  for all
  using  (user_id = public.get_org_id())
  with check (user_id = public.get_org_id());

-- 3. Agregar webhook_secret si la tabla ya existía sin esa columna
alter table public.tiendas add column if not exists webhook_secret text;
