-- ═══════════════════════════════════════════════════════════════════════════
-- NEGOCIOS: Principal → Negocio → Master (→ admin / vendedor)
--   · principal : dueño del sistema. Ve todos los negocios, crea negocios y les
--                 activa categorías. (Hoy: sergio / CC Design)
--   · master    : dueño de UN negocio. Solo ve y toca lo de su negocio.
--   · admin / vendedor: como siempre, dentro de su negocio.
-- Cada negocio = un org_id (el id de su master). Ventas, clientes, tiendas,
-- ARCA y branding ya estaban separados por org_id; esto separa también
-- productos, categorías, listas de precios y el resto, y cierra la lista de
-- usuarios (antes cualquier usuario veía y editaba a todos).
-- Idempotente: se puede correr más de una vez.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Rol principal + funciones auxiliares ────────────────────────────────
alter table public.profiles drop constraint if exists profiles_rol_check;
alter table public.profiles add constraint profiles_rol_check
  check (rol = any (array['principal','master','admin','vendedor']));

update public.profiles set rol = 'principal' where id = 'b2edb9d6-eeb1-474c-b94b-4958228f5e23';

create or replace function public.es_principal() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and rol = 'principal')
$$;

-- ── 2. Tabla de negocios ───────────────────────────────────────────────────
create table if not exists public.negocios (
  org_id     uuid primary key,
  nombre     text not null,
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.negocios enable row level security;
drop policy if exists negocios_select on public.negocios;
drop policy if exists negocios_update on public.negocios;
create policy negocios_select on public.negocios for select
  using (org_id = public.get_org_id() or public.es_principal());
create policy negocios_update on public.negocios for update
  using (public.es_principal()) with check (public.es_principal());

insert into public.negocios (org_id, nombre) values
  ('b2edb9d6-eeb1-474c-b94b-4958228f5e23', 'CC Design'),
  ('0b79d6ad-573a-45c4-a7a3-7bb4a3b288d7', 'Estrella del Sur')
on conflict (org_id) do nothing;

-- ── 3. profiles: cada uno ve solo su negocio; nadie se cambia el rol ───────
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or org_id = public.get_org_id() or public.es_principal());

-- Nadie crea su propio perfil: se crean desde la edge function manage-users.
drop policy if exists profiles_insert_self on public.profiles;

-- profiles_update_self deja editar la propia fila (modo oscuro, etc.), pero
-- hasta hoy también permitía ponerse rol 'master' o cambiarse de negocio.
create or replace function public.profiles_protect() returns trigger
language plpgsql as $$
begin
  if auth.uid() is not null and (
       new.rol    is distinct from old.rol
    or new.org_id is distinct from old.org_id
    or new.email  is distinct from old.email) then
    raise exception 'No se puede cambiar el rol, el negocio ni el email desde acá';
  end if;
  return new;
end $$;
drop trigger if exists profiles_protect on public.profiles;
create trigger profiles_protect before update on public.profiles
  for each row execute function public.profiles_protect();

-- ── 4. org_id en lo que faltaba (todo lo existente es de CC Design) ────────
do $$
declare t text;
begin
  foreach t in array array['categorias','subcategorias','productos','listas_precios',
                           'promociones','materiales','rubros','tarifas','imagenes_compartidas']
  loop
    execute format('alter table public.%I add column if not exists org_id uuid', t);
    execute format('update public.%I set org_id = %L where org_id is null', t, 'b2edb9d6-eeb1-474c-b94b-4958228f5e23');
    execute format('alter table public.%I alter column org_id set default public.get_org_id()', t);
    execute format('alter table public.%I alter column org_id set not null', t);
    execute format('create index if not exists %I on public.%I (org_id)', t || '_org_idx', t);
  end loop;
end $$;

-- ── 5. Categorías que el Principal le activa a cada negocio ────────────────
create table if not exists public.categorias_acceso (
  categoria_id integer not null references public.categorias(id) on delete cascade,
  org_id       uuid    not null,
  created_at   timestamptz not null default now(),
  primary key (categoria_id, org_id)
);
alter table public.categorias_acceso enable row level security;
drop policy if exists acceso_select on public.categorias_acceso;
drop policy if exists acceso_insert on public.categorias_acceso;
drop policy if exists acceso_delete on public.categorias_acceso;
create policy acceso_select on public.categorias_acceso for select
  using (org_id = public.get_org_id() or public.es_principal());
create policy acceso_insert on public.categorias_acceso for insert
  with check (public.es_principal()
    and exists (select 1 from public.categorias c where c.id = categoria_id and c.org_id = public.get_org_id()));
create policy acceso_delete on public.categorias_acceso for delete
  using (public.es_principal());

-- ── 6. RLS por negocio ─────────────────────────────────────────────────────
-- Lo propio se lee y escribe; lo "activado" por el Principal solo se lee.
-- (Las lecturas públicas — catálogo web — siguen para el rol anon.)

-- productos
drop policy if exists productos_all on public.productos;
drop policy if exists productos_select on public.productos;
drop policy if exists productos_insert on public.productos;
drop policy if exists productos_update on public.productos;
drop policy if exists productos_delete on public.productos;
create policy productos_select on public.productos for select to authenticated
  using (org_id = public.get_org_id()
      or categoria_id in (select categoria_id from public.categorias_acceso where org_id = public.get_org_id()));
-- Un negocio solo crea productos en sus propias categorías (así los SKU nunca chocan).
create policy productos_insert on public.productos for insert to authenticated
  with check (org_id = public.get_org_id()
    and (categoria_id is null or exists (select 1 from public.categorias c where c.id = categoria_id and c.org_id = public.get_org_id())));
create policy productos_update on public.productos for update to authenticated
  using (org_id = public.get_org_id())
  with check (org_id = public.get_org_id()
    and (categoria_id is null or exists (select 1 from public.categorias c where c.id = categoria_id and c.org_id = public.get_org_id())));
create policy productos_delete on public.productos for delete to authenticated
  using (org_id = public.get_org_id());

-- categorias
drop policy if exists categorias_all on public.categorias;
drop policy if exists leer_publico on public.categorias;
drop policy if exists "public read" on public.categorias;
create policy categorias_publico on public.categorias for select to anon using (true);
create policy categorias_select on public.categorias for select to authenticated
  using (org_id = public.get_org_id()
      or id in (select categoria_id from public.categorias_acceso where org_id = public.get_org_id()));
create policy categorias_insert on public.categorias for insert to authenticated with check (org_id = public.get_org_id());
create policy categorias_update on public.categorias for update to authenticated using (org_id = public.get_org_id()) with check (org_id = public.get_org_id());
create policy categorias_delete on public.categorias for delete to authenticated using (org_id = public.get_org_id());

-- subcategorias
drop policy if exists subcategorias_all on public.subcategorias;
drop policy if exists leer_publico on public.subcategorias;
drop policy if exists "public read" on public.subcategorias;
create policy subcategorias_publico on public.subcategorias for select to anon using (true);
create policy subcategorias_select on public.subcategorias for select to authenticated
  using (org_id = public.get_org_id()
      or categoria_id in (select categoria_id from public.categorias_acceso where org_id = public.get_org_id()));
create policy subcategorias_insert on public.subcategorias for insert to authenticated with check (org_id = public.get_org_id());
create policy subcategorias_update on public.subcategorias for update to authenticated using (org_id = public.get_org_id()) with check (org_id = public.get_org_id());
create policy subcategorias_delete on public.subcategorias for delete to authenticated using (org_id = public.get_org_id());

-- listas_precios
drop policy if exists listas_all on public.listas_precios;
drop policy if exists leer_publico on public.listas_precios;
create policy listas_publico on public.listas_precios for select to anon using (true);
create policy listas_org on public.listas_precios for all to authenticated
  using (org_id = public.get_org_id()) with check (org_id = public.get_org_id());

-- el resto: solo lo del propio negocio
drop policy if exists promociones_all on public.promociones;
drop policy if exists materiales_all on public.materiales;
drop policy if exists rubros_all on public.rubros;
drop policy if exists tarifas_all on public.tarifas;
drop policy if exists imagenes_compartidas_all on public.imagenes_compartidas;
create policy promociones_org on public.promociones for all using (org_id = public.get_org_id()) with check (org_id = public.get_org_id());
create policy materiales_org  on public.materiales  for all using (org_id = public.get_org_id()) with check (org_id = public.get_org_id());
create policy rubros_org      on public.rubros      for all using (org_id = public.get_org_id()) with check (org_id = public.get_org_id());
create policy tarifas_org     on public.tarifas     for all using (org_id = public.get_org_id()) with check (org_id = public.get_org_id());
create policy imgcomp_org     on public.imagenes_compartidas for all using (org_id = public.get_org_id()) with check (org_id = public.get_org_id());

-- ── 7. Estrella del Sur arranca con las mismas listas de precios que CC Design
-- (después las edita a su gusto). Categorías: ninguna, el Principal se las activa.
insert into public.listas_precios (nombre, tipo, margen_melamina, margen_3d, adicional, nota_interna,
  ml_activo, ml_comision, ml_embalaje, envio_activo, envio_monto, campos_extra, redondeo_valor, redondeo_tipo, org_id)
select nombre, tipo, margen_melamina, margen_3d, adicional, nota_interna,
  ml_activo, ml_comision, ml_embalaje, envio_activo, envio_monto, campos_extra, redondeo_valor, redondeo_tipo,
  '0b79d6ad-573a-45c4-a7a3-7bb4a3b288d7'
from public.listas_precios
where org_id = 'b2edb9d6-eeb1-474c-b94b-4958228f5e23'
  and not exists (select 1 from public.listas_precios where org_id = '0b79d6ad-573a-45c4-a7a3-7bb4a3b288d7');
