-- Pagos a cuenta en la cuenta corriente de un cliente.
-- Un pago se reparte entre sus ventas pendientes en cuenta corriente (de la más vieja a la más nueva,
-- o a una venta elegida). Queda una fila por cada venta que toca, todas con el mismo `grupo`.
-- Cada fila se puede facturar aparte (factura C por ese importe, contra esa venta).

alter table public.ventas add column if not exists cobrado_cc numeric not null default 0;

create table if not exists public.cc_pagos (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null default public.get_org_id(),
  grupo       uuid not null,
  cliente_id  uuid not null references public.clientes(id) on delete cascade,
  venta_id    bigint not null references public.ventas(id) on delete cascade,
  fecha       date not null default current_date,
  importe     numeric not null check (importe > 0),
  forma       text,
  factura_id  uuid references public.facturas(id) on delete set null,
  creado_por  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists cc_pagos_cliente on public.cc_pagos (cliente_id, fecha);
create index if not exists cc_pagos_venta on public.cc_pagos (venta_id);
alter table public.cc_pagos enable row level security;
revoke all on public.cc_pagos from anon;
-- Se cargan y se anulan con las funciones de abajo; desde el navegador solo se lee y se anota la factura.
revoke insert, delete on public.cc_pagos from authenticated;
drop policy if exists cc_pagos_ver on public.cc_pagos;
create policy cc_pagos_ver on public.cc_pagos for select to authenticated using (org_id = public.get_org_id());
drop policy if exists cc_pagos_factura on public.cc_pagos;
create policy cc_pagos_factura on public.cc_pagos for update to authenticated
  using (org_id = public.get_org_id()) with check (org_id = public.get_org_id());

-- Registra un pago a cuenta. p_venta null = se aplica a las ventas más viejas primero.
create or replace function public.registrar_pago_cc(
  p_cliente uuid, p_importe numeric, p_fecha date, p_forma text, p_venta bigint default null
) returns setof public.cc_pagos language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.get_org_id();
  v_grupo uuid := gen_random_uuid();
  v_resto numeric := round(coalesce(p_importe, 0), 2);
  v_deuda numeric;
  v_parte numeric;
  r record;
begin
  if v_org is null then raise exception 'Sin negocio.'; end if;
  if v_resto <= 0 then raise exception 'El importe tiene que ser mayor a cero.'; end if;
  if not exists (select 1 from public.clientes where id = p_cliente and org_id = v_org) then
    raise exception 'No se encontró el cliente.';
  end if;

  select coalesce(sum(greatest(total - cobrado_cc, 0)), 0) into v_deuda from public.ventas
   where org_id = v_org and cliente_id = p_cliente and forma_pago = 'cuenta_corriente'
     and estado in ('pendiente', 'parcial') and (p_venta is null or id = p_venta);
  if v_resto > round(v_deuda, 2) then
    raise exception 'El pago ($%) supera lo que debe ($%). Lo que sobra cargalo como saldo a favor.', v_resto, round(v_deuda, 2);
  end if;

  for r in
    select id, total, cobrado_cc from public.ventas
     where org_id = v_org and cliente_id = p_cliente and forma_pago = 'cuenta_corriente'
       and estado in ('pendiente', 'parcial') and (p_venta is null or id = p_venta)
     order by fecha, numero
     for update
  loop
    exit when v_resto <= 0;
    v_parte := least(v_resto, round(greatest(r.total - r.cobrado_cc, 0), 2));
    continue when v_parte <= 0;
    update public.ventas
       set cobrado_cc = round(cobrado_cc + v_parte, 2),
           estado = case when round(cobrado_cc + v_parte, 2) >= round(total, 2) then 'pagado' else 'parcial' end
     where id = r.id;
    insert into public.cc_pagos (org_id, grupo, cliente_id, venta_id, fecha, importe, forma)
    values (v_org, v_grupo, p_cliente, r.id, coalesce(p_fecha, current_date), v_parte, nullif(trim(p_forma), ''));
    v_resto := round(v_resto - v_parte, 2);
  end loop;

  update public.clientes set saldo = coalesce(saldo, 0) + round(p_importe, 2) where id = p_cliente;
  return query select * from public.cc_pagos where grupo = v_grupo order by created_at;
end $$;
revoke all on function public.registrar_pago_cc(uuid, numeric, date, text, bigint) from public, anon;
grant execute on function public.registrar_pago_cc(uuid, numeric, date, text, bigint) to authenticated;

-- Anula un pago cargado por error (todas sus filas). No se puede si alguna parte ya se facturó.
create or replace function public.anular_pago_cc(p_grupo uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.get_org_id();
  v_total numeric := 0;
  v_cliente uuid;
  r record;
begin
  if exists (select 1 from public.cc_pagos where grupo = p_grupo and org_id = v_org and factura_id is not null) then
    raise exception 'Ese pago ya tiene factura: no se puede anular.';
  end if;
  for r in select * from public.cc_pagos where grupo = p_grupo and org_id = v_org for update loop
    update public.ventas
       set cobrado_cc = greatest(round(cobrado_cc - r.importe, 2), 0),
           estado = case when estado = 'anulado' then estado
                         when greatest(round(cobrado_cc - r.importe, 2), 0) > 0 then 'parcial' else 'pendiente' end
     where id = r.venta_id;
    v_total := v_total + r.importe;
    v_cliente := r.cliente_id;
  end loop;
  if v_cliente is null then raise exception 'No se encontró el pago.'; end if;
  update public.clientes set saldo = coalesce(saldo, 0) - round(v_total, 2) where id = v_cliente;
  delete from public.cc_pagos where grupo = p_grupo and org_id = v_org;
end $$;
revoke all on function public.anular_pago_cc(uuid) from public, anon;
grant execute on function public.anular_pago_cc(uuid) to authenticated;

-- Desde el navegador solo se puede anotar qué factura corresponde a cada parte.
revoke update on public.cc_pagos from authenticated;
grant update (factura_id) on public.cc_pagos to authenticated;
