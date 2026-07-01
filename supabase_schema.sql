-- =====================================================================
-- ESQUEMA SUPABASE - Sistema de Gestión Carpintería / Impresión 3D
-- Ejecutar en el SQL Editor de Supabase (https://app.supabase.com)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. PERFILES DE USUARIO (extiende auth.users)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text,
  email text,
  rol text not null default 'vendedor' check (rol in ('admin','vendedor')),
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select using (auth.uid() is not null);

drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles
  for update using (auth.uid() = id);

-- Trigger para crear perfil automáticamente al registrar usuario
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.profiles (id, email, nombre, rol)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'nombre', new.email), 'vendedor')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- 2. BRANDING (una sola fila por organización - usamos id=1)
-- ---------------------------------------------------------------------
create table if not exists public.branding (
  id int primary key default 1,
  logo_url text,
  nombre text,
  slogan text,
  direccion text,
  telefono text,
  email text,
  web_mayorista text,
  web_minorista text,
  instagram text,
  facebook text,
  tiktok text,
  youtube text,
  pinterest text,
  updated_at timestamptz default now(),
  constraint single_branding check (id = 1)
);

alter table public.branding enable row level security;

drop policy if exists "branding_all" on public.branding;
create policy "branding_all" on public.branding
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

insert into public.branding (id) values (1) on conflict do nothing;

-- ---------------------------------------------------------------------
-- 3. LISTAS DE PRECIOS
-- ---------------------------------------------------------------------
create table if not exists public.listas_precios (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  tipo text not null check (tipo in ('Minorista','Mayorista','Mercado Libre','Lista de cuadros','Personalizada')),
  margen_melamina numeric not null default 0,
  margen_3d numeric not null default 0,
  adicional numeric not null default 0,
  nota_interna text,
  created_at timestamptz default now()
);

alter table public.listas_precios enable row level security;

drop policy if exists "listas_all" on public.listas_precios;
create policy "listas_all" on public.listas_precios
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- ---------------------------------------------------------------------
-- 4. CATEGORÍAS Y SUBCATEGORÍAS
-- ---------------------------------------------------------------------
create table if not exists public.categorias (
  id serial primary key,
  nombre text not null,
  sku_prefijo char(3) not null unique,
  created_at timestamptz default now()
);

alter table public.categorias enable row level security;

drop policy if exists "categorias_all" on public.categorias;
create policy "categorias_all" on public.categorias
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

create table if not exists public.subcategorias (
  id serial primary key,
  categoria_id int not null references public.categorias(id) on delete cascade,
  nombre text not null,
  created_at timestamptz default now()
);

alter table public.subcategorias enable row level security;

drop policy if exists "subcategorias_all" on public.subcategorias;
create policy "subcategorias_all" on public.subcategorias
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- ---------------------------------------------------------------------
-- 5. MATERIALES (placas / chapas) - ID numérico autoincrement
-- ---------------------------------------------------------------------
create table if not exists public.materiales (
  id serial primary key,
  nombre text not null,
  tipo text not null check (tipo in ('Melamina','MDF','Acrílico','Otro')),
  precio_placa numeric not null default 0,
  ancho_cm numeric not null default 0,
  alto_cm numeric not null default 0,
  espesor numeric,
  desperdicio numeric not null default 0,
  notas text,
  created_at timestamptz default now()
);

alter table public.materiales enable row level security;

drop policy if exists "materiales_all" on public.materiales;
create policy "materiales_all" on public.materiales
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- ---------------------------------------------------------------------
-- 5. TARIFAS DE FABRICACIÓN - ID numérico autoincrement
-- ---------------------------------------------------------------------
create table if not exists public.tarifas (
  id serial primary key,
  nombre text not null,
  tipo text not null check (tipo in ('Corte','Impresión 3D','Otro')),
  costo_hora numeric not null default 0,
  notas text,
  created_at timestamptz default now()
);

alter table public.tarifas enable row level security;

drop policy if exists "tarifas_all" on public.tarifas;
create policy "tarifas_all" on public.tarifas
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- ---------------------------------------------------------------------
-- 6. PRODUCTOS
-- ---------------------------------------------------------------------
create table if not exists public.productos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  sku text not null unique check (sku ~ '^[A-Z]{3}[0-9]{6}$'),
  descripcion text,
  categoria text not null check (categoria in ('Melamina','Impresión 3D')),

  -- relaciones
  material_id int references public.materiales(id) on delete set null,
  tarifa_id int references public.tarifas(id) on delete set null,

  -- melamina
  ancho_pieza numeric,
  alto_pieza numeric,
  cantidad_piezas int,
  fab_minutos int,
  fab_segundos int,

  -- 3D
  gramos_filamento numeric,
  imp_horas int,
  imp_minutos int,

  costo_base numeric not null default 0,
  created_at timestamptz default now()
);

alter table public.productos enable row level security;

drop policy if exists "productos_all" on public.productos;
create policy "productos_all" on public.productos
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- ---------------------------------------------------------------------
-- 7. PRESUPUESTOS
-- ---------------------------------------------------------------------
create table if not exists public.presupuestos (
  id uuid primary key default gen_random_uuid(),
  numero serial,
  cliente text,
  lista_id uuid references public.listas_precios(id) on delete set null,
  total numeric not null default 0,
  items jsonb not null default '[]'::jsonb,
  notas text,
  created_at timestamptz default now()
);

alter table public.presupuestos enable row level security;

drop policy if exists "presupuestos_all" on public.presupuestos;
create policy "presupuestos_all" on public.presupuestos
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- ---------------------------------------------------------------------
-- 8. STORAGE BUCKET PARA LOGOS
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('branding', 'branding', true)
on conflict (id) do nothing;

drop policy if exists "branding_storage_select" on storage.objects;
create policy "branding_storage_select" on storage.objects
  for select using (bucket_id = 'branding');

drop policy if exists "branding_storage_write" on storage.objects;
create policy "branding_storage_write" on storage.objects
  for insert with check (bucket_id = 'branding' and auth.uid() is not null);

drop policy if exists "branding_storage_update" on storage.objects;
create policy "branding_storage_update" on storage.objects
  for update using (bucket_id = 'branding' and auth.uid() is not null);

drop policy if exists "branding_storage_delete" on storage.objects;
create policy "branding_storage_delete" on storage.objects
  for delete using (bucket_id = 'branding' and auth.uid() is not null);
