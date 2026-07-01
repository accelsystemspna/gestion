-- ══════════════════════════════════════════════════════════════════
-- VENTAS — ejecutar en Supabase → SQL Editor
-- ══════════════════════════════════════════════════════════════════

-- 1. Tabla ventas (cabecera)
create table if not exists public.ventas (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  numero        serial,                      -- número correlativo de venta
  cliente_id    uuid references public.clientes(id) on delete set null,
  cliente_nombre text,                       -- nombre libre (sin cliente en sistema)
  lista_id      uuid references public.listas_precios(id) on delete set null,
  fecha         date not null default current_date,
  total         numeric(12,2) default 0,
  estado        text default 'pendiente',    -- 'pendiente' | 'pagado' | 'cancelado' | 'anulado'
  notas         text,
  created_at    timestamptz not null default now()
);

create index if not exists ventas_user_id_idx  on public.ventas (user_id);
create index if not exists ventas_fecha_idx    on public.ventas (fecha desc);
create index if not exists ventas_estado_idx   on public.ventas (estado);

-- 2. Tabla venta_items (renglones)
create table if not exists public.venta_items (
  id              uuid primary key default gen_random_uuid(),
  venta_id        uuid not null references public.ventas(id) on delete cascade,
  tipo            text default 'producto',   -- 'producto' | 'custom'
  producto_id     uuid references public.productos(id) on delete set null,
  descripcion     text not null,
  sku             text,
  cantidad        numeric(10,3) default 1,
  precio_unitario numeric(12,2) default 0,
  subtotal        numeric(12,2) default 0
);

create index if not exists venta_items_venta_id_idx on public.venta_items (venta_id);

-- 3. Row Level Security
alter table public.ventas      enable row level security;
alter table public.venta_items enable row level security;

-- ventas
create policy "ver ventas propias"      on public.ventas for select using (auth.uid() = user_id);
create policy "insertar ventas propias" on public.ventas for insert with check (true);
create policy "actualizar ventas propias" on public.ventas for update using (auth.uid() = user_id);
create policy "eliminar ventas propias" on public.ventas for delete using (auth.uid() = user_id);

-- venta_items
create policy "ver items propios"      on public.venta_items for select using (
  exists (select 1 from public.ventas v where v.id = venta_id and v.user_id = auth.uid())
);
create policy "insertar items propios" on public.venta_items for insert with check (true);
create policy "eliminar items propios" on public.venta_items for delete using (
  exists (select 1 from public.ventas v where v.id = venta_id and v.user_id = auth.uid())
);

-- 4. Trigger: auto-completar user_id en ventas
create or replace function public.set_venta_user_id()
returns trigger language plpgsql security definer as $$
begin
  new.user_id := auth.uid();
  return new;
end;
$$;

create trigger ventas_set_user_id
  before insert on public.ventas
  for each row execute procedure public.set_venta_user_id();
