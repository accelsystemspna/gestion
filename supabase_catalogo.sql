-- ═══════════════════════════════════════════════════════════════════════════
-- CATÁLOGO PÚBLICO: control "Mostrar en catálogo" + todas las imágenes de cada producto.
--
-- · productos.mostrar_en_catalogo y categorias.mostrar_en_catalogo (default true: nada desaparece).
--   Un producto sale en el catálogo si está activo, su casilla está tildada y la de su categoría también.
-- · catalogo_publico.imagenes (text[]): URLs públicas del bucket, en orden.
--     producto común → [imagen_url]
--     combo → la imagen principal (imagen_url) de cada producto que lo forma, en orden; nunca las fotos web del combo.
-- · Solo productos del negocio Principal (el catálogo público es el de CC Design; la vista corre con
--   permisos del dueño y se saltea la separación por negocio, así que se filtra acá).
-- · Solo lectura para anon/authenticated (antes tenía permisos de escritura y llegaba a la tabla productos).
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.productos  add column if not exists mostrar_en_catalogo boolean not null default true;
alter table public.categorias add column if not exists mostrar_en_catalogo boolean not null default true;

-- Imágenes públicas de un producto. La ejecuta quien consulta la vista (anon), por eso lleva execute para anon y
-- es security definer; y para que llamarla suelta (RPC) no exponga nada de más, solo responde por productos
-- que SÍ están visibles en el catálogo.
create or replace function public.catalogo_imagenes_de(p_id uuid) returns text[]
language sql stable security definer set search_path = public as $$
  with p as (
    select id, imagen_url, imagen_web_url, coalesce(imagenes_web, '{}') imagenes_web, coalesce(combo_items, '[]'::jsonb) combo_items
    from productos
   where id = p_id and activo = true and mostrar_en_catalogo = true
     and org_id in (select org_id from profiles where rol = 'principal')
  ),
  cand as (
    -- 1) imagen principal de cada producto que forma el combo (las fotos web del combo NO se usan)
    select c.imagen_url as u, 2 as grp, ci.o::bigint as o
      from p, jsonb_array_elements(p.combo_items) with ordinality ci(e, o)
      join productos c on c.id = (ci.e->>'producto_id')::uuid
    union all
    -- 2) la foto del producto (producto común; o combo cuyos componentes no tienen foto)
    select imagen_url, 3, 1 from p
  ),
  ok as (
    select u, grp, o from cand
     where u ~ '^https://uoyyiiggfcswvllwchsx\.supabase\.co/storage/v1/object/public/'
  ),
  elegido as (select min(grp) g from ok),
  unicas as (
    select distinct on (u) u, o from ok where grp = (select g from elegido) order by u, o
  )
  select coalesce(array_agg(u order by o), '{}'::text[]) from unicas
$$;
revoke all on function public.catalogo_imagenes_de(uuid) from public;
grant execute on function public.catalogo_imagenes_de(uuid) to anon, authenticated;

create or replace view public.catalogo_publico as
  select p.sku, p.nombre, p.imagen_url, p.alto_producto, p.ancho_producto, p.subcategoria_id, p.created_at,
         public.catalogo_imagenes_de(p.id) as imagenes
    from public.productos p
    left join public.categorias c on c.id = p.categoria_id
   where p.activo = true
     and p.mostrar_en_catalogo = true
     and coalesce(c.mostrar_en_catalogo, true) = true
     and p.org_id in (select org_id from public.profiles where rol = 'principal');

revoke all on public.catalogo_publico from anon, authenticated;
grant select on public.catalogo_publico to anon, authenticated;

-- Defensa en profundidad: el rol anónimo nunca escribe en tablas del programa (RLS ya lo frenaba, salvo vistas).
do $$ declare r record; begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') loop
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from anon', r.relname);
  end loop;
end $$;
alter default privileges in schema public revoke insert, update, delete, truncate, references, trigger on tables from anon;
