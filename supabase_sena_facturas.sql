-- Seña, saldo y facturación en partes (seña y saldo) para ventas del portal mayorista y pedidos.
-- Un registro por comprobante. Las facturas ya emitidas (ventas.cae / nro_factura) no se tocan:
-- una venta con factura_emitida cuenta como facturada por su total.

-- ── Comprobantes ────────────────────────────────────────────────────────────
create table if not exists public.facturas (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null default public.get_org_id(),
  venta_id      bigint references public.ventas(id) on delete restrict,
  pedido_id     uuid references public.pedidos(id) on delete restrict,
  concepto      text not null check (concepto in ('sena', 'saldo', 'total')),
  importe       numeric not null check (importe > 0),
  detalle       text not null,
  modo          text not null check (modo in ('homologacion', 'produccion')),
  estado        text not null default 'pendiente' check (estado in ('pendiente', 'emitida', 'fallida')),
  error         text,
  punto_venta   integer,
  nro_factura   bigint,
  cae           text,
  cae_vto       date,
  fecha         date,
  doc_tipo      integer,
  doc_nro       text,
  cond_iva      text,
  solicitud_id  uuid not null unique,      -- un reintento con el mismo id no emite dos veces
  created_at    timestamptz not null default now(),
  check ((venta_id is null) <> (pedido_id is null))
);
create index if not exists facturas_venta on public.facturas (venta_id) where venta_id is not null;
create index if not exists facturas_pedido on public.facturas (pedido_id) where pedido_id is not null;
alter table public.facturas enable row level security;
-- El navegador solo las lee. Las crea y completa la función emitir-factura.
revoke insert, update, delete on public.facturas from anon, authenticated;
drop policy if exists facturas_org on public.facturas;
create policy facturas_org on public.facturas for select to authenticated using (org_id = public.get_org_id());

-- Reserva el importe antes de pedir el CAE, con la venta o el pedido bloqueados: dos pedidos a la vez
-- no pueden pasarse del total. Cuenta lo pendiente y lo emitido del mismo modo (pruebas aparte de producción).
create or replace function public.reservar_factura(
  p_org uuid, p_venta bigint, p_pedido uuid, p_concepto text, p_importe numeric, p_solicitud uuid,
  p_modo text, p_detalle text, p_doc_tipo integer, p_doc_nro text, p_cond_iva text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_total numeric;
  v_legacy boolean := false;
  v_facturado numeric;
  v_prev public.facturas;
  v_id uuid;
begin
  select * into v_prev from public.facturas where solicitud_id = p_solicitud;
  if found then
    if v_prev.org_id <> p_org then raise exception 'Solicitud inválida.'; end if;
    return jsonb_build_object('id', v_prev.id, 'estado', v_prev.estado, 'nueva', false);
  end if;
  if (p_venta is null) = (p_pedido is null) then raise exception 'Indicá la venta o el pedido.'; end if;
  if p_importe is null or p_importe <= 0 then raise exception 'El importe tiene que ser mayor a cero.'; end if;

  if p_venta is not null then
    select total, coalesce(factura_emitida, false) into v_total, v_legacy
      from public.ventas where id = p_venta and org_id = p_org for update;
  else
    select total into v_total from public.pedidos where id = p_pedido and org_id = p_org for update;
  end if;
  if v_total is null then raise exception 'No se encontró la operación.'; end if;
  if v_legacy then raise exception 'Esta venta ya tiene una factura por el total.'; end if;

  select coalesce(sum(importe), 0) into v_facturado from public.facturas
   where (venta_id = p_venta or pedido_id = p_pedido) and modo = p_modo and estado in ('pendiente', 'emitida');
  if round(v_facturado + p_importe, 2) > round(v_total, 2) then
    raise exception 'Supera el total: ya se facturaron $% de $%. Falta facturar $%.',
      round(v_facturado, 2), round(v_total, 2), round(greatest(v_total - v_facturado, 0), 2);
  end if;

  insert into public.facturas (org_id, venta_id, pedido_id, concepto, importe, detalle, modo, solicitud_id, doc_tipo, doc_nro, cond_iva)
  values (p_org, p_venta, p_pedido, p_concepto, round(p_importe, 2), p_detalle, p_modo, p_solicitud, p_doc_tipo, p_doc_nro, p_cond_iva)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'estado', 'pendiente', 'nueva', true);
end $$;
revoke all on function public.reservar_factura(uuid, bigint, uuid, text, numeric, uuid, text, text, integer, text, text) from public, anon, authenticated;
grant execute on function public.reservar_factura(uuid, bigint, uuid, text, numeric, uuid, text, text, integer, text, text) to service_role;

-- ── Cobro: seña y saldo ─────────────────────────────────────────────────────
-- El saldo no se guarda: es total - seña, o 0 si el saldo ya se cobró.
alter table public.ventas add column if not exists sena_monto numeric;
alter table public.ventas add column if not exists sena_fecha date;
alter table public.ventas add column if not exists sena_forma text;
alter table public.ventas add column if not exists saldo_cobrado boolean not null default false;
alter table public.ventas add column if not exists saldo_fecha date;
alter table public.ventas add column if not exists saldo_forma text;
alter table public.ventas add column if not exists cobro_actualizado timestamptz;      -- gana el último cambio (gestión o portal)
alter table public.ventas add column if not exists cobro_pendiente_portal boolean not null default false;

alter table public.pedidos add column if not exists saldo_cobrado boolean not null default false;
alter table public.pedidos add column if not exists saldo_fecha date;
alter table public.pedidos add column if not exists saldo_forma text;

-- ── Documentos del panel: una factura por comprobante ───────────────────────
alter table public.cliente_documentos add column if not exists factura_id uuid references public.facturas(id) on delete set null;
drop index if exists public.cliente_documentos_venta_tipo;
create unique index if not exists cliente_documentos_venta_tipo on public.cliente_documentos (venta_id, tipo) where venta_id is not null and factura_id is null;
create unique index if not exists cliente_documentos_factura on public.cliente_documentos (factura_id) where factura_id is not null;

-- ── ARCA: pruebas en homologación sin tocar producción ──────────────────────
-- Certificado de homologación aparte, y un acceso (token) guardado por cada modo.
alter table public.arca_config add column if not exists cert_pem_homo text;
alter table public.arca_config add column if not exists key_pem_homo text;
alter table public.arca_token add column if not exists token_homo text;
alter table public.arca_token add column if not exists sign_homo text;
alter table public.arca_token add column if not exists expiracion_homo timestamptz;
