-- Panel del cliente: entra con su celular y un PIN que elige, y ve sus pedidos y documentos.
-- Las credenciales y los intentos no se pueden leer ni escribir desde el navegador: solo las funciones del servidor.

-- Una sola forma para el celular: sin espacios, +54, 9, 0 ni 15. Ej: "+54 9 343 15 610-8660" → 3436108660
create or replace function public.celular_normalizado(t text) returns text
language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(t, ''), '\D', '', 'g');
begin
  d := regexp_replace(d, '^00', '');
  if d like '54%' and length(d) >= 12 then d := substr(d, 3); end if;
  if d like '9%' and length(d) in (11, 13) then d := substr(d, 2); end if;
  if d like '0%' then d := substr(d, 2); end if;
  if length(d) = 12 then
    if d like '11%' and substr(d, 3, 2) = '15' then d := left(d, 2) || substr(d, 5);
    elsif substr(d, 4, 2) = '15' then d := left(d, 3) || substr(d, 6);
    elsif substr(d, 5, 2) = '15' then d := left(d, 4) || substr(d, 7);
    end if;
  end if;
  return d;
end $$;

create index if not exists clientes_org_celular on public.clientes (org_id, public.celular_normalizado(telefono));

create table if not exists public.cliente_credenciales (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null,
  cliente_id   uuid not null unique references public.clientes(id) on delete cascade,
  pin_hash     text,
  token_hash   text unique,
  token_vence  timestamptz,
  creado       timestamptz not null default now(),
  actualizado  timestamptz not null default now()
);
alter table public.cliente_credenciales enable row level security;
revoke all on public.cliente_credenciales from anon, authenticated;

create table if not exists public.cliente_intentos (
  id       bigint generated always as identity primary key,
  org_id   uuid,
  celular  text,
  ip       text,
  ok       boolean not null,
  creado   timestamptz not null default now()
);
create index if not exists cliente_intentos_celular on public.cliente_intentos (celular, creado);
create index if not exists cliente_intentos_ip on public.cliente_intentos (ip, creado);
alter table public.cliente_intentos enable row level security;
revoke all on public.cliente_intentos from anon, authenticated;

-- Documentos del cliente (presupuesto, factura, recibo). El PDF va en un bucket privado: se abre solo con link firmado.
-- El link firmado muestra la ruta del archivo, así que la ruta no lleva ids: <sha256 del org_id>/<uuid al azar>.pdf
create table if not exists public.cliente_documentos (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null default get_org_id(),
  cliente_id  uuid not null references public.clientes(id) on delete cascade,
  pedido_id   uuid references public.pedidos(id) on delete set null,
  tipo        text not null check (tipo in ('presupuesto', 'factura', 'recibo')),
  titulo      text not null,
  fecha       timestamptz not null default now(),
  total       numeric not null default 0,
  ruta        text not null unique,
  created_at  timestamptz not null default now()
);
create index if not exists cliente_documentos_cliente on public.cliente_documentos (cliente_id);
alter table public.cliente_documentos enable row level security;
revoke all on public.cliente_documentos from anon;
drop policy if exists cliente_documentos_org on public.cliente_documentos;
create policy cliente_documentos_org on public.cliente_documentos for all to authenticated
  using (org_id = get_org_id()) with check (org_id = get_org_id());

insert into storage.buckets (id, name, public) values ('documentos-clientes', 'documentos-clientes', false)
  on conflict (id) do update set public = false;
drop policy if exists documentos_clientes_org on storage.objects;
create policy documentos_clientes_org on storage.objects for all to authenticated
  using (bucket_id = 'documentos-clientes' and (storage.foldername(name))[1] = encode(sha256(convert_to(get_org_id()::text, 'UTF8')), 'hex'))
  with check (bucket_id = 'documentos-clientes' and (storage.foldername(name))[1] = encode(sha256(convert_to(get_org_id()::text, 'UTF8')), 'hex'));

-- Presupuestos vinculados al cliente (hasta ahora guardaban solo el nombre como texto).
alter table public.presupuestos add column if not exists cliente_id uuid references public.clientes(id) on delete set null;

-- Para la función del servidor: clientes de ese celular en ese negocio (si son dos, no se le da acceso a ninguno).
create or replace function public.clientes_por_celular(p_org uuid, p_celular text)
returns table (id uuid, nombre text, telefono text) language sql stable as $$
  select c.id, c.nombre, c.telefono from public.clientes c
   where c.org_id = p_org and length(p_celular) >= 10 and public.celular_normalizado(c.telefono) = p_celular
$$;

-- Para la función del servidor: pedidos del cliente, por cliente_id y, si el pedido no tiene, por celular.
create or replace function public.pedidos_de_cliente(p_org uuid, p_cliente uuid, p_celular text)
returns setof public.pedidos language sql stable as $$
  select p.* from public.pedidos p
   where p.org_id = p_org
     and (p.cliente_id = p_cliente
          or (p.cliente_id is null and length(p_celular) >= 10 and public.celular_normalizado(p.cliente_telefono) = p_celular))
   order by p.created_at desc limit 50
$$;
revoke all on function public.clientes_por_celular(uuid, text) from public, anon, authenticated;
revoke all on function public.pedidos_de_cliente(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.clientes_por_celular(uuid, text) to service_role;
grant execute on function public.pedidos_de_cliente(uuid, uuid, text) to service_role;

-- Botón "Mandar acceso por WhatsApp": link largo, vence a los 7 días, sirve una vez; generar otro invalida el anterior.
-- Se guarda solo el hash. No toca el PIN actual: se reemplaza recién cuando el cliente crea el nuevo.
create or replace function public.generar_acceso_cliente(p_cliente uuid) returns text
language plpgsql security definer set search_path = public as $$
declare c record; tok text; cuantos int; celu text;
begin
  select id, org_id, telefono into c from clientes where id = p_cliente and org_id = get_org_id();
  if c.id is null then raise exception 'No encontramos ese cliente.'; end if;
  celu := celular_normalizado(c.telefono);
  if length(celu) < 10 then raise exception 'El cliente no tiene un celular válido (hacen falta 10 números con la característica).'; end if;
  select count(*) into cuantos from clientes where org_id = c.org_id and celular_normalizado(telefono) = celu;
  if cuantos > 1 then raise exception 'Hay % clientes con este celular. Unificalos antes de mandar el acceso.', cuantos; end if;
  tok := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into cliente_credenciales (org_id, cliente_id, token_hash, token_vence)
    values (c.org_id, c.id, encode(sha256(convert_to(tok, 'UTF8')), 'hex'), now() + interval '7 days')
    on conflict (cliente_id) do update set token_hash = excluded.token_hash, token_vence = excluded.token_vence, actualizado = now();
  return tok;
end $$;
revoke all on function public.generar_acceso_cliente(uuid) from public, anon;
grant execute on function public.generar_acceso_cliente(uuid) to authenticated;

-- Si cambia el celular del cliente, el acceso anterior deja de valer (ese celular puede ser de otra persona).
create or replace function public.clientes_celular_cambia() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if celular_normalizado(new.telefono) is distinct from celular_normalizado(old.telefono) then
    delete from cliente_credenciales where cliente_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists clientes_celular_cambia on public.clientes;
create trigger clientes_celular_cambia after update of telefono on public.clientes
  for each row execute function public.clientes_celular_cambia();
