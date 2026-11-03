-- Materiales compartidos entre negocios y materiales ocultos.
--   · El Principal elige qué materiales suyos ve cada negocio (como las categorías). El otro negocio
--     los usa pero no los edita: el precio lo mantiene el dueño.
--   · Cada negocio puede ocultar un material que le compartieron y no usa: deja de aparecer para elegir,
--     pero los productos que ya lo usan lo siguen encontrando para calcular el costo.
-- Idempotente: se puede correr más de una vez.

create table if not exists public.materiales_acceso (
  material_id integer not null references public.materiales(id) on delete cascade,
  org_id      uuid    not null,
  created_at  timestamptz not null default now(),
  primary key (material_id, org_id)
);
alter table public.materiales_acceso enable row level security;
drop policy if exists mat_acceso_select on public.materiales_acceso;
drop policy if exists mat_acceso_insert on public.materiales_acceso;
drop policy if exists mat_acceso_delete on public.materiales_acceso;
create policy mat_acceso_select on public.materiales_acceso for select to authenticated
  using (org_id = public.get_org_id() or public.es_principal());
create policy mat_acceso_insert on public.materiales_acceso for insert to authenticated
  with check (public.es_principal()
    and exists (select 1 from public.materiales m where m.id = material_id and m.org_id = public.get_org_id()));
create policy mat_acceso_delete on public.materiales_acceso for delete to authenticated
  using (public.es_principal());

create table if not exists public.materiales_ocultos (
  material_id integer not null references public.materiales(id) on delete cascade,
  org_id      uuid    not null default public.get_org_id(),
  created_at  timestamptz not null default now(),
  primary key (material_id, org_id)
);
alter table public.materiales_ocultos enable row level security;
drop policy if exists mat_ocultos_org on public.materiales_ocultos;
create policy mat_ocultos_org on public.materiales_ocultos for all to authenticated
  using (org_id = public.get_org_id()) with check (org_id = public.get_org_id());

-- materiales: lo propio se lee y escribe; lo compartido solo se lee
drop policy if exists materiales_org on public.materiales;
drop policy if exists materiales_select on public.materiales;
drop policy if exists materiales_insert on public.materiales;
drop policy if exists materiales_update on public.materiales;
drop policy if exists materiales_delete on public.materiales;
create policy materiales_select on public.materiales for select to authenticated
  using (org_id = public.get_org_id()
      or id in (select material_id from public.materiales_acceso where org_id = public.get_org_id()));
create policy materiales_insert on public.materiales for insert to authenticated with check (org_id = public.get_org_id());
create policy materiales_update on public.materiales for update to authenticated using (org_id = public.get_org_id()) with check (org_id = public.get_org_id());
create policy materiales_delete on public.materiales for delete to authenticated using (org_id = public.get_org_id());

-- Cuándo cambió cada material, para que los negocios que lo usan recalculen sus productos solos.
alter table public.materiales add column if not exists updated_at timestamptz not null default now();
create or replace function public.materiales_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists materiales_touch on public.materiales;
create trigger materiales_touch before update on public.materiales
  for each row execute function public.materiales_touch();

-- Hasta cuándo recalculó cada negocio sus costos con los materiales compartidos.
create table if not exists public.costos_recalculados (
  org_id   uuid primary key default public.get_org_id(),
  hecho_en timestamptz not null default now()
);
alter table public.costos_recalculados enable row level security;
drop policy if exists costos_recalculados_org on public.costos_recalculados;
create policy costos_recalculados_org on public.costos_recalculados for all to authenticated
  using (org_id = public.get_org_id()) with check (org_id = public.get_org_id());
