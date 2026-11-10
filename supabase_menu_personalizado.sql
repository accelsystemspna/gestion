-- Menú lateral personalizado por usuario (grupos, orden y opciones ocultas).
-- Vacío = usa el orden de fábrica.
alter table profiles add column if not exists menu_config jsonb;
