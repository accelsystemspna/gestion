-- Pedido con el saldo cobrado: queda aceptado, con el precio congelado, y su saldo pasa a 0 en todos lados
-- (lista de pedidos, ficha, seguimiento y panel del cliente). Idempotente.

-- El saldo se calcula solo: 0 si ya se cobró
alter table public.pedidos drop column if exists saldo;
alter table public.pedidos add column saldo numeric
  generated always as (case when saldo_cobrado then 0 else greatest(total - sena_monto, 0) end) stored;

-- Al marcar el saldo cobrado, un pedido que seguía presupuestado pasa a aceptado
create or replace function public.pedidos_saldo_cobrado() returns trigger language plpgsql as $$
begin
  if new.saldo_cobrado and not coalesce(old.saldo_cobrado, false) then
    if new.saldo_fecha is null then new.saldo_fecha := current_date; end if;
    if new.estado = 'presupuestado' then new.estado := 'aceptado'; end if;
    if not new.precio_congelado then new.precio_congelado := true; new.precio_congelado_en := now(); end if;
  end if;
  return new;
end $$;
drop trigger if exists pedidos_saldo_cobrado on public.pedidos;
create trigger pedidos_saldo_cobrado before update on public.pedidos
  for each row execute function public.pedidos_saldo_cobrado();

-- Los que ya se cobraron y quedaron presupuestados
update public.pedidos
   set estado = 'aceptado', precio_congelado = true, precio_congelado_en = coalesce(precio_congelado_en, now())
 where saldo_cobrado and estado = 'presupuestado';
