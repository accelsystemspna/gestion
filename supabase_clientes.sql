-- ══════════════════════════════════════════════════════════════════
-- CLIENTES Y COMPRAS — ejecutar en Supabase → SQL Editor
-- ══════════════════════════════════════════════════════════════════

-- 1. Tabla clientes
create table if not exists public.clientes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  nombre      text not null,
  email       text,
  telefono    text,
  direccion   text,
  etiqueta    text,           -- actúa como "pestaña" / categoría
  notas       text,
  created_at  timestamptz not null default now()
);

-- índices útiles
create index if not exists clientes_user_id_idx  on public.clientes (user_id);
create index if not exists clientes_etiqueta_idx on public.clientes (etiqueta);

-- 2. Tabla compras
create table if not exists public.compras (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  cliente_id  uuid not null references public.clientes(id) on delete cascade,
  descripcion text,
  monto       numeric(12,2) default 0,
  fecha       date not null default current_date,
  estado      text default 'pendiente',   -- 'pagado' | 'pendiente' | 'cancelado'
  notas       text,
  created_at  timestamptz not null default now()
);

create index if not exists compras_cliente_id_idx on public.compras (cliente_id);
create index if not exists compras_user_id_idx    on public.compras (user_id);

-- 3. Row Level Security
alter table public.clientes enable row level security;
alter table public.compras   enable row level security;

-- políticas clientes
create policy "Usuarios ven sus clientes"
  on public.clientes for select
  using (auth.uid() = user_id);

create policy "Usuarios insertan sus clientes"
  on public.clientes for insert
  with check (true);   -- user_id lo setea el trigger antes del check

create policy "Usuarios actualizan sus clientes"
  on public.clientes for update
  using (auth.uid() = user_id);

create policy "Usuarios eliminan sus clientes"
  on public.clientes for delete
  using (auth.uid() = user_id);

-- políticas compras
create policy "Usuarios ven sus compras"
  on public.compras for select
  using (auth.uid() = user_id);

create policy "Usuarios insertan sus compras"
  on public.compras for insert
  with check (auth.uid() = user_id);

create policy "Usuarios actualizan sus compras"
  on public.compras for update
  using (auth.uid() = user_id);

create policy "Usuarios eliminan sus compras"
  on public.compras for delete
  using (auth.uid() = user_id);

-- 4. Triggers: auto-completar user_id desde auth.uid()

-- Para clientes: toma el uid del usuario autenticado
create or replace function public.set_cliente_user_id()
returns trigger language plpgsql security definer as $$
begin
  new.user_id := auth.uid();
  return new;
end;
$$;

create trigger clientes_set_user_id
  before insert on public.clientes
  for each row execute procedure public.set_cliente_user_id();

-- Para compras: hereda user_id del cliente padre
create or replace function public.set_compra_user_id()
returns trigger language plpgsql security definer as $$
begin
  if new.user_id is null then
    select user_id into new.user_id
    from public.clientes
    where id = new.cliente_id;
  end if;
  return new;
end;
$$;

create trigger compras_set_user_id
  before insert on public.compras
  for each row execute procedure public.set_compra_user_id();
