-- ═══════════════════════════════════════════════════════════════════════════
-- STOCK COMPARTIDO (opcional) en las categorías que el Principal le activa a un negocio.
--   · comparte_stock = true  → el negocio vende del MISMO stock del Principal
--                              (cada venta le descuenta al producto original).
--   · comparte_stock = false → el negocio lleva su propio stock de esos productos
--                              (arranca en 0; el stock del Principal no se toca).
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.categorias_acceso add column if not exists comparte_stock boolean not null default false;

drop policy if exists acceso_update on public.categorias_acceso;
create policy acceso_update on public.categorias_acceso for update
  using (public.es_principal()) with check (public.es_principal());

-- Stock propio de un negocio sobre productos ajenos (los de stock no compartido).
create table if not exists public.stock_negocio (
  producto_id  uuid    not null references public.productos(id) on delete cascade,
  org_id       uuid    not null,
  stock_actual integer not null default 0,
  primary key (producto_id, org_id)
);
alter table public.stock_negocio enable row level security;
drop policy if exists stock_negocio_org on public.stock_negocio;
create policy stock_negocio_org on public.stock_negocio for all
  using (org_id = public.get_org_id()) with check (org_id = public.get_org_id());

-- Dónde cae el stock de un producto para el negocio que llama:
--   'propio'  → es suyo (productos.stock_actual)
--   'owner'   → es del Principal y comparten stock (se descuenta del original)
--   'negocio' → es del Principal pero cada uno lleva el suyo (stock_negocio)
--   null      → no lo ve
create or replace function public._destino_stock(p_producto uuid, p_org uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when p.org_id = p_org then 'propio'
    when a.categoria_id is not null and a.comparte_stock then 'owner'
    when a.categoria_id is not null then 'negocio'
  end
  from public.productos p
  left join public.categorias_acceso a on a.categoria_id = p.categoria_id and a.org_id = p_org
  where p.id = p_producto
$$;

-- Descuenta (o suma, con cantidad negativa) stock. items: [{producto_id, cantidad}]
-- Reemplaza al "leer y escribir" del cliente: es atómico y llega a productos ajenos.
create or replace function public.ajustar_stock(p_items jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  it jsonb; v_prod uuid; v_cant integer; v_org uuid := public.get_org_id(); v_dest text;
begin
  if auth.uid() is null then raise exception 'No autorizado'; end if;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_prod := (it->>'producto_id')::uuid;
    v_cant := round((it->>'cantidad')::numeric)::integer;
    continue when v_prod is null or v_cant is null or v_cant = 0;
    v_dest := public._destino_stock(v_prod, v_org);
    if v_dest in ('propio', 'owner') then
      update public.productos set stock_actual = coalesce(stock_actual, 0) - v_cant where id = v_prod;
    elsif v_dest = 'negocio' then
      insert into public.stock_negocio (producto_id, org_id, stock_actual) values (v_prod, v_org, -v_cant)
      on conflict (producto_id, org_id) do update set stock_actual = public.stock_negocio.stock_actual - v_cant;
    end if;
  end loop;
end $$;

-- Fija el stock propio del negocio sobre un producto ajeno de stock no compartido.
create or replace function public.fijar_stock_propio(p_producto uuid, p_stock integer) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.get_org_id();
begin
  if auth.uid() is null then raise exception 'No autorizado'; end if;
  if public._destino_stock(p_producto, v_org) is distinct from 'negocio' then
    raise exception 'Este producto no lleva stock propio en tu negocio';
  end if;
  insert into public.stock_negocio (producto_id, org_id, stock_actual) values (p_producto, v_org, p_stock)
  on conflict (producto_id, org_id) do update set stock_actual = excluded.stock_actual;
end $$;

revoke all on function public.ajustar_stock(jsonb), public.fijar_stock_propio(uuid, integer), public._destino_stock(uuid, uuid) from public, anon;
grant execute on function public.ajustar_stock(jsonb), public.fijar_stock_propio(uuid, integer) to authenticated;
