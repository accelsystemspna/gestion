-- Acceso rápido al panel desde Clientes y desde el pedido.

-- Si cada cliente del negocio ya creó su PIN y si tiene un link vigente. Nunca devuelve el PIN ni el link.
create or replace function public.estado_acceso_clientes()
returns table (cliente_id uuid, tiene_pin boolean, link_vigente boolean)
language sql stable security definer set search_path = public as $$
  select c.cliente_id, c.pin_hash is not null, c.token_hash is not null and c.token_vence > now()
    from cliente_credenciales c
   where c.org_id = get_org_id()
$$;
revoke all on function public.estado_acceso_clientes() from public, anon;
grant execute on function public.estado_acceso_clientes() to authenticated;

-- Para un pedido sin cliente vinculado: los clientes del negocio con ese celular.
create or replace function public.buscar_clientes_por_celular(p_telefono text)
returns table (id uuid, nombre text, telefono text)
language sql stable set search_path = public as $$
  select c.id, c.nombre, c.telefono from clientes c
   where c.org_id = get_org_id()
     and length(celular_normalizado(p_telefono)) >= 10
     and celular_normalizado(c.telefono) = celular_normalizado(p_telefono)
$$;
revoke all on function public.buscar_clientes_por_celular(text) from public, anon;
grant execute on function public.buscar_clientes_por_celular(text) to authenticated;
