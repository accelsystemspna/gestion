-- Estado de fabricación por producto (portal mayorista).
-- Correr una vez en Supabase → SQL Editor.
alter table public.venta_items add column if not exists origen_indice integer;
alter table public.venta_items add column if not exists produccion text;
