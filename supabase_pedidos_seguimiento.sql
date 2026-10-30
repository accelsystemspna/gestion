-- ═══════════════════════════════════════════════════════════════════════════
-- SEGUIMIENTO PÚBLICO de pedidos: registro de intentos (anti-adivinanza de PIN).
-- La consulta pública pasa por la edge function `pedido-publico` (con permisos de servidor);
-- esta tabla solo la usa esa función: RLS activado y sin políticas = nadie más la ve ni la toca.
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.pedido_intentos (
  id         bigint generated always as identity primary key,
  pedido_id  uuid,                          -- null si el token/código no existía
  ip         text,
  ok         boolean not null,
  creado     timestamptz not null default now()
);
create index if not exists pedido_intentos_pedido_idx on public.pedido_intentos (pedido_id, creado desc);
create index if not exists pedido_intentos_ip_idx on public.pedido_intentos (ip, creado desc);
alter table public.pedido_intentos enable row level security;
revoke all on public.pedido_intentos from anon, authenticated;
