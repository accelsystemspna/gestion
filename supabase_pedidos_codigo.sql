-- Código de pedido más fácil de recordar: prefijo del negocio + 6 números al azar (CC-482-731, ES-105-664).
-- Los códigos viejos (CC-XXXX-XXXX) siguen funcionando.
alter table public.branding add column if not exists prefijo_pedido text;
update public.branding set prefijo_pedido = 'CC' where user_id = 'b2edb9d6-eeb1-474c-b94b-4958228f5e23' and prefijo_pedido is null;
update public.branding set prefijo_pedido = 'ES' where user_id = '0b79d6ad-573a-45c4-a7a3-7bb4a3b288d7' and prefijo_pedido is null;

-- Por dónde se intentó entrar: los errores con el código no bloquean a quien entra por su link.
alter table public.pedido_intentos add column if not exists via text;

create or replace function public.pedidos_antes() returns trigger
language plpgsql as $$
declare c text; digitos text; prefijo text; n int;
begin
  if tg_op = 'INSERT' and (new.codigo is null or new.codigo = '') then
    -- Prefijo cargado en la marca del negocio; si no hay, las iniciales del nombre; si tampoco, PD.
    select coalesce(nullif(upper(b.prefijo_pedido), ''),
                    upper(left(regexp_replace(regexp_replace(' ' || coalesce(b.nombre, ''), '\s+(\S)\S*', '\1', 'g'), '[^A-Za-z]', '', 'g'), 2)))
      into prefijo from public.branding b where b.user_id = new.org_id;
    if prefijo is null or prefijo !~ '^[A-Z]{2,4}$' then prefijo := 'PD'; end if;
    loop
      n := 100000 + floor(random() * 900000)::int;
      c := prefijo || '-' || left(n::text, 3) || '-' || right(n::text, 3);
      exit when not exists (select 1 from public.pedidos where codigo = c);
    end loop;
    new.codigo := c;
  end if;

  -- PIN = últimos 3 números del celular (si no se puso uno a mano)
  if new.pin is null or new.pin = '' then
    digitos := regexp_replace(coalesce(new.cliente_telefono, ''), '\D', '', 'g');
    if length(digitos) >= 3 then new.pin := right(digitos, 3); end if;
  end if;

  -- Entra la seña por primera vez (al crear o al editar): el pedido queda aceptado y el precio se congela.
  if new.sena_monto > 0 and (tg_op = 'INSERT' or coalesce(old.sena_monto, 0) = 0) then
    if new.sena_fecha is null then new.sena_fecha := now(); end if;
    if new.estado = 'presupuestado' then new.estado := 'aceptado'; end if;
    if not new.precio_congelado then new.precio_congelado := true; new.precio_congelado_en := now(); end if;
  end if;

  if tg_op = 'UPDATE' then
    new.updated_at := now();
    if new.precio_congelado and not old.precio_congelado and new.precio_congelado_en is null then
      new.precio_congelado_en := now();
    end if;
    -- Con el precio congelado, el total no se puede cambiar (hay que "descongelar" primero, a propósito).
    if old.precio_congelado and new.precio_congelado and new.total <> old.total then
      raise exception 'El precio de este pedido está congelado (ya tiene seña). Descongelalo primero si querés cambiarlo.';
    end if;
  end if;
  return new;
end $$;
