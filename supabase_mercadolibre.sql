-- ═══════════════════════════════════════════════════════════════════════════
-- MERCADO LIBRE: una cuenta por negocio (org_id), conectada por OAuth.
-- Los tokens viven en ml_tokens SIN ninguna política: solo las edge functions
-- (service role) los leen; el navegador nunca los ve.
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- Cuenta conectada (datos que sí puede ver el negocio)
create table if not exists public.ml_cuentas (
  org_id       uuid primary key,
  ml_user_id   bigint not null unique,
  nickname     text,
  site_id      text not null default 'MLA',
  tienda_id    bigint,                       -- fila de `tiendas` (tipo mercadolibre) de este negocio
  conectada_en timestamptz not null default now()
);
alter table public.ml_cuentas enable row level security;
drop policy if exists ml_cuentas_select on public.ml_cuentas;
create policy ml_cuentas_select on public.ml_cuentas for select using (org_id = public.get_org_id());

-- Tokens (secretos): RLS activado y sin políticas = solo service role
create table if not exists public.ml_tokens (
  org_id        uuid primary key references public.ml_cuentas(org_id) on delete cascade,
  access_token  text not null,
  refresh_token text not null,
  expires_at    timestamptz not null,
  updated_at    timestamptz not null default now()
);
alter table public.ml_tokens enable row level security;

-- Estado temporal del flujo OAuth (anti-CSRF). Solo service role.
create table if not exists public.ml_estados_oauth (
  state      text primary key,
  org_id     uuid not null,
  created_at timestamptz not null default now()
);
alter table public.ml_estados_oauth enable row level security;

-- Publicaciones de ML vinculadas a productos del programa
create table if not exists public.ml_publicaciones (
  id              bigint generated always as identity primary key,
  org_id          uuid not null,
  producto_id     uuid references public.productos(id) on delete set null,
  item_id         text unique,               -- MLA123456789
  ml_categoria_id text,
  titulo          text,
  precio          numeric,
  estado          text,                      -- active | paused | closed | under_review ...
  permalink       text,
  error           text,
  creada_en       timestamptz not null default now(),
  actualizada_en  timestamptz not null default now()
);
create index if not exists ml_publicaciones_org_idx on public.ml_publicaciones (org_id);
create index if not exists ml_publicaciones_prod_idx on public.ml_publicaciones (producto_id);
alter table public.ml_publicaciones enable row level security;
drop policy if exists ml_publicaciones_select on public.ml_publicaciones;
create policy ml_publicaciones_select on public.ml_publicaciones for select using (org_id = public.get_org_id());

-- Las ventas de ML entran como ventas normales con canal 'mercadolibre' y origen_ref 'ML#<orden>'.
create unique index if not exists ventas_origen_ref_ml_uniq on public.ventas (org_id, origen_ref) where canal = 'mercadolibre';
alter table public.ml_publicaciones add column if not exists thumbnail text;
alter table public.ml_publicaciones add column if not exists stock integer;
alter table public.ml_publicaciones add column if not exists vendidos integer;
alter table public.ml_publicaciones add column if not exists sku text;
-- Configuración propia de Mercado Libre por producto (separada de la de la web)
alter table public.productos add column if not exists ml_titulo text;
alter table public.productos add column if not exists ml_descripcion text;      -- texto plano
alter table public.productos add column if not exists ml_imagenes text[] not null default '{}';  -- la primera es la portada
alter table public.productos add column if not exists ml_atributos jsonb not null default '{}'::jsonb;  -- { ATRIBUTO_ID: "valor" }
alter table public.productos add column if not exists ml_categoria_id text;
alter table public.productos add column if not exists ml_precio numeric;        -- si se completa, pisa el de la lista Mercado Libre
