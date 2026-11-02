-- Cantidad de bultos de la etiqueta de un pedido del portal mayorista (la guarda también el portal).
alter table public.ventas add column if not exists etiqueta_bultos integer;
