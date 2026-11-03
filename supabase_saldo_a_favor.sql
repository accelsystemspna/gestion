-- Saldo a favor del cliente (plata que le queda para usar: pagó de más, una devolución, una seña de un pedido
-- que no se hizo…). Va aparte de clientes.saldo, que es el de la cuenta corriente.
-- Son movimientos: + queda a favor, − se usó o se le devolvió. El saldo es la suma. No se borran ni se editan:
-- un error se corrige con un movimiento en sentido contrario, así queda el historial completo.
create table if not exists public.cliente_saldos (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null default public.get_org_id(),
  cliente_id  uuid not null references public.clientes(id) on delete cascade,
  fecha       date not null default current_date,
  importe     numeric not null check (importe <> 0),
  motivo      text not null check (length(trim(motivo)) > 0),
  creado_por  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists cliente_saldos_cliente on public.cliente_saldos (cliente_id, fecha);
alter table public.cliente_saldos enable row level security;
revoke all on public.cliente_saldos from anon;
revoke update, delete on public.cliente_saldos from authenticated;
drop policy if exists cliente_saldos_ver on public.cliente_saldos;
create policy cliente_saldos_ver on public.cliente_saldos for select to authenticated using (org_id = public.get_org_id());
drop policy if exists cliente_saldos_cargar on public.cliente_saldos;
create policy cliente_saldos_cargar on public.cliente_saldos for insert to authenticated with check (org_id = public.get_org_id());
