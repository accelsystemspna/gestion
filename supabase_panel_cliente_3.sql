-- Compras del cliente en su panel (ventas de local, tienda web, Mercado Libre y mayorista).

-- Cada factura queda atada a su venta, para mostrarla en la compra correcta. Una sola por venta.
alter table public.cliente_documentos add column if not exists venta_id bigint references public.ventas(id) on delete set null;
create unique index if not exists cliente_documentos_venta_tipo on public.cliente_documentos (venta_id, tipo) where venta_id is not null;

-- Para la función del servidor: ventas del cliente, por cliente_id y, si la venta no tiene, por celular.
-- Nunca por nombre: puede repetirse y mostraría compras ajenas.
create or replace function public.ventas_de_cliente(p_org uuid, p_cliente uuid, p_celular text)
returns setof public.ventas language sql stable as $$
  select v.* from public.ventas v
   where v.org_id = p_org
     and (v.cliente_id = p_cliente
          or (v.cliente_id is null and length(p_celular) >= 10 and public.celular_normalizado(v.cliente_telefono) = p_celular))
   order by v.fecha desc, v.numero desc nulls last limit 100
$$;
revoke all on function public.ventas_de_cliente(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.ventas_de_cliente(uuid, uuid, text) to service_role;
