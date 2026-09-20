-- ══════════════════════════════════════════════════════════════════
-- TIENDA "MAYORISTA" (portal mayorista en WordPress, modelo push)
-- Ejecutar en Supabase → SQL Editor
-- ══════════════════════════════════════════════════════════════════

-- 1. Permitir el nuevo tipo de tienda
alter table public.tiendas drop constraint if exists tiendas_tipo_check;
alter table public.tiendas
  add constraint tiendas_tipo_check
  check (tipo in ('woocommerce', 'mercadolibre', 'mayorista'));

-- 2. Subcategorías que se envían al portal mayorista (vacío = todas)
alter table public.tiendas add column if not exists subcategorias_ids integer[];

-- 3. Múltiplo de compra por producto en el portal mayorista (2, 3 o vacío = automático según el alto)
alter table public.productos add column if not exists multiplo_mayorista smallint;
alter table public.productos drop constraint if exists productos_multiplo_mayorista_check;
alter table public.productos
  add constraint productos_multiplo_mayorista_check
  check (multiplo_mayorista is null or multiplo_mayorista in (2, 3));

-- ══════════════════════════════════════════════════════════════════
-- CIERRE DE LECTURA PÚBLICA (hacer DESPUÉS de probar que el envío funciona)
-- El plugin ya no lee Supabase: quedaron de más las políticas "leer_publico"
-- que se habían creado para que WordPress pudiera consultar las tablas con la
-- clave anon. Sacarlas cierra el acceso público a costo_base y a las listas
-- de precios.
-- ══════════════════════════════════════════════════════════════════
-- drop policy if exists "leer_publico" on public.productos;
-- drop policy if exists "leer_publico" on public.listas_precios;
-- drop policy if exists "leer_publico" on public.categorias;
-- drop policy if exists "leer_publico" on public.subcategorias;
