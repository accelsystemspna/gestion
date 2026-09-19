-- Ejecutar en Supabase Dashboard -> SQL Editor

-- 1) Link de YouTube (Short) por producto
alter table public.productos add column if not exists video_url text;

-- 2) Biblioteca de imágenes compartidas (se suben una vez, se usan en muchos productos)
create table if not exists public.imagenes_compartidas (
  id          bigint generated always as identity primary key,
  nombre      text,
  url         text not null,
  orden       integer not null default 0,
  activa      boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table public.imagenes_compartidas enable row level security;

drop policy if exists "imagenes_compartidas_all" on public.imagenes_compartidas;
create policy "imagenes_compartidas_all" on public.imagenes_compartidas
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- 3) Cada producto puede optar por no mostrar las imágenes compartidas
alter table public.productos
  add column if not exists usar_imagenes_compartidas boolean not null default true;
