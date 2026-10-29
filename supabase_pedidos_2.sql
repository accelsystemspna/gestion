-- ═══════════════════════════════════════════════════════════════════════════
-- PEDIDOS, parte 2: LINK de seguimiento (con token largo) y PIN opcional.
--
-- El cliente entra con un link único (…/?p=<token>) y el sitio le pide solo el PIN
-- (por defecto, los últimos 3 números de su celular). El token es largo e imposible de adivinar;
-- el PIN corto alcanza porque solo lo usa quien ya tiene el link.
--   · token          → parte final del link. Se genera solo (también para los pedidos que ya existen).
--   · pin_requerido  → si se destilda, el link entra directo (sin PIN).
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.pedidos add column if not exists token text not null default replace(gen_random_uuid()::text, '-', '');
create unique index if not exists pedidos_token_uniq on public.pedidos (token);
alter table public.pedidos add column if not exists pin_requerido boolean not null default true;
