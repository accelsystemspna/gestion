-- ═══════════════════════════════════════════════════════════════════════════
-- CATÁLOGO PÚBLICO con imágenes LIVIANAS (ahorra ancho de banda de Supabase).
--
-- Qué cambia en catalogo_publico:
--   · imagenes      → ahora devuelve la versión LIVIANA de cada foto (hasta 1200 px, ~30 KB) cuando existe,
--                     y si una foto todavía no tiene liviana, devuelve la original (nunca queda una imagen rota).
--   · imagenes_hd   → columna NUEVA con las ORIGINALES (lo que devolvía `imagenes` antes): para mostrar al abrir
--                     un producto o hacer zoom.
--   · imagen_url    → sin cambios (original).
-- Producto común: [su foto]. Combo: la foto de cada producto que lo forma, en orden (nunca las fotos web del combo).
--
-- Las livianas las genera scripts/generar-livianas.mjs en productos/lite/v1/<SKU>_<archivo-original>.png.
--
-- CÓMO VOLVER ATRÁS (si algo no se ve bien): correr el bloque "ROLLBACK" del final.
-- Se ejecuta pegándolo completo en Supabase → SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════

-- Originales (la lógica que tenía `imagenes` hasta hoy), para el zoom / detalle
create or replace function public.catalogo_imagenes_hd_de(p_id uuid) returns text[]
language sql stable security definer set search_path = public as $$
  with p as (
    select id, sku, imagen_url, coalesce(combo_items, '[]'::jsonb) combo_items
    from productos
   where id = p_id and activo = true and mostrar_en_catalogo = true
     and org_id in (select org_id from profiles where rol = 'principal')
  ),
  cand as (
    select c.imagen_url as u, 2 as grp, ci.o::bigint as o
      from p, jsonb_array_elements(p.combo_items) with ordinality ci(e, o)
      join productos c on c.id = (ci.e->>'producto_id')::uuid
    union all
    select imagen_url, 3, 1 from p
  ),
  ok as (select u, grp, o from cand where u ~ '^https://uoyyiiggfcswvllwchsx\.supabase\.co/storage/v1/object/public/'),
  elegido as (select min(grp) g from ok),
  unicas as (select distinct on (u) u, o from ok where grp = (select g from elegido) order by u, o)
  select coalesce(array_agg(u order by o), '{}'::text[]) from unicas
$$;
revoke all on function public.catalogo_imagenes_hd_de(uuid) from public;
grant execute on function public.catalogo_imagenes_hd_de(uuid) to anon, authenticated;

-- Livianas (con respaldo a la original si todavía no existe la liviana)
create or replace function public.catalogo_imagenes_de(p_id uuid) returns text[]
language sql stable security definer set search_path = public as $$
  with p as (
    select id, sku, imagen_url, coalesce(combo_items, '[]'::jsonb) combo_items
    from productos
   where id = p_id and activo = true and mostrar_en_catalogo = true
     and org_id in (select org_id from profiles where rol = 'principal')
  ),
  cand as (
    select c.sku, c.imagen_url as u, 2 as grp, ci.o::bigint as o
      from p, jsonb_array_elements(p.combo_items) with ordinality ci(e, o)
      join productos c on c.id = (ci.e->>'producto_id')::uuid
    union all
    select sku, imagen_url, 3, 1 from p
  ),
  ok as (select sku, u, grp, o from cand where u ~ '^https://uoyyiiggfcswvllwchsx\.supabase\.co/storage/v1/object/public/'),
  elegido as (select min(grp) g from ok),
  unicas as (select distinct on (u) sku, u, o from ok where grp = (select g from elegido) order by u, o)
  select coalesce(array_agg(coalesce(l.url, un.u) order by un.o), '{}'::text[])
    from unicas un
    left join lateral (
      select 'https://uoyyiiggfcswvllwchsx.supabase.co/storage/v1/object/public/productos/' || o.name as url
        from storage.objects o
       where o.bucket_id = 'productos'
         and o.name = 'lite/v1/' || un.sku || '_' || regexp_replace(un.u, '^.*/([^/]+)\.[A-Za-z0-9]+$', '\1') || '.png'
       limit 1
    ) l on true
$$;
-- (catalogo_imagenes_de ya tenía execute para anon/authenticated; create or replace lo conserva)

create or replace view public.catalogo_publico as
  select p.sku, p.nombre, p.imagen_url, p.alto_producto, p.ancho_producto, p.subcategoria_id, p.created_at,
         public.catalogo_imagenes_de(p.id)    as imagenes,
         public.catalogo_imagenes_hd_de(p.id) as imagenes_hd
    from public.productos p
    left join public.categorias c on c.id = p.categoria_id
   where p.activo = true
     and p.mostrar_en_catalogo = true
     and coalesce(c.mostrar_en_catalogo, true) = true
     and p.org_id in (select org_id from public.profiles where rol = 'principal');

revoke all on public.catalogo_publico from anon, authenticated;
grant select on public.catalogo_publico to anon, authenticated;

-- ═══════════════ ROLLBACK (solo si hace falta volver a como estaba) ═══════════════
-- create or replace function public.catalogo_imagenes_de(p_id uuid) returns text[]
-- language sql stable security definer set search_path = public as $$
--   select public.catalogo_imagenes_hd_de(p_id)
-- $$;
-- (con esto `imagenes` vuelve a devolver las originales; la columna imagenes_hd puede quedar sin problema)
