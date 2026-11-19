-- Mercado Libre: factura automática al despachar, subida de la factura a la venta de ML
-- y notas de crédito (devoluciones).

-- Interruptor por cuenta: facturar sola cada venta cuando ML la marca como despachada.
alter table public.ml_cuentas add column if not exists facturar_al_despachar boolean not null default false;

-- Seguimiento de la factura de una venta de ML.
alter table public.ventas add column if not exists ml_facturando timestamptz;      -- toma de la venta mientras se emite (evita facturar dos veces)
alter table public.ventas add column if not exists ml_factura_error text;         -- por qué no se facturó sola (ej: comprador con CUIT)
alter table public.ventas add column if not exists ml_factura_subida timestamptz; -- cuándo se subió el PDF a la venta de ML
alter table public.ventas add column if not exists ml_subida_error text;          -- último error al subirla

-- ── Notas de crédito ─────────────────────────────────────────────────────────
-- Anulan (total o parcialmente) una factura ya emitida. Se asocian a la factura de la venta
-- (ventas.nro_factura) o a una factura por partes (facturas.id).
create table if not exists public.notas_credito (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null default public.get_org_id(),
  venta_id      bigint not null references public.ventas(id) on delete restrict,
  factura_id    uuid references public.facturas(id) on delete restrict,   -- null = la factura de la venta
  importe       numeric not null check (importe > 0),
  motivo        text not null,
  modo          text not null check (modo in ('homologacion', 'produccion')),
  estado        text not null default 'pendiente' check (estado in ('pendiente', 'emitida', 'fallida')),
  error         text,
  punto_venta   integer,
  nro           bigint,
  cae           text,
  cae_vto       date,
  fecha         date,
  doc_tipo      integer,
  doc_nro       text,
  cond_iva      text,
  asoc_pto_vta  integer,
  asoc_nro      bigint,
  asoc_fecha    date,
  solicitud_id  uuid not null unique,
  ml_subida     timestamptz,
  ml_subida_error text,
  created_at    timestamptz not null default now()
);
create index if not exists notas_credito_venta on public.notas_credito (venta_id);
alter table public.notas_credito enable row level security;
revoke all on public.notas_credito from anon;
revoke insert, delete on public.notas_credito from authenticated;
revoke update on public.notas_credito from authenticated;
grant update (ml_subida, ml_subida_error) on public.notas_credito to authenticated;
drop policy if exists notas_credito_ver on public.notas_credito;
create policy notas_credito_ver on public.notas_credito for select to authenticated using (org_id = public.get_org_id());
drop policy if exists notas_credito_ml on public.notas_credito;
create policy notas_credito_ml on public.notas_credito for update to authenticated
  using (org_id = public.get_org_id()) with check (org_id = public.get_org_id());

-- Reserva una nota de crédito antes de pedir el CAE: nunca se acredita más de lo facturado.
create or replace function public.reservar_nota_credito(
  p_org uuid, p_venta bigint, p_factura uuid, p_importe numeric, p_motivo text, p_solicitud uuid, p_modo text,
  p_doc_tipo integer, p_doc_nro text, p_cond_iva text, p_asoc_pto integer, p_asoc_nro bigint, p_asoc_fecha date, p_tope numeric
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_prev public.notas_credito;
  v_ya numeric;
  v_id uuid;
begin
  select * into v_prev from public.notas_credito where solicitud_id = p_solicitud;
  if found then
    if v_prev.org_id <> p_org then raise exception 'Solicitud inválida.'; end if;
    return jsonb_build_object('id', v_prev.id, 'estado', v_prev.estado, 'nueva', false);
  end if;
  perform 1 from public.ventas where id = p_venta and org_id = p_org for update;
  if not found then raise exception 'No se encontró la venta.'; end if;
  select coalesce(sum(importe), 0) into v_ya from public.notas_credito
   where venta_id = p_venta and modo = p_modo and estado in ('pendiente', 'emitida')
     and coalesce(factura_id::text, '') = coalesce(p_factura::text, '');
  if round(v_ya + p_importe, 2) > round(p_tope, 2) then
    raise exception 'Supera lo facturado: ya se acreditaron $% de $%. Queda $%.',
      round(v_ya, 2), round(p_tope, 2), round(greatest(p_tope - v_ya, 0), 2);
  end if;
  insert into public.notas_credito (org_id, venta_id, factura_id, importe, motivo, modo, solicitud_id, doc_tipo, doc_nro, cond_iva, asoc_pto_vta, asoc_nro, asoc_fecha)
  values (p_org, p_venta, p_factura, round(p_importe, 2), p_motivo, p_modo, p_solicitud, p_doc_tipo, p_doc_nro, p_cond_iva, p_asoc_pto, p_asoc_nro, p_asoc_fecha)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'estado', 'pendiente', 'nueva', true);
end $$;
revoke all on function public.reservar_nota_credito(uuid, bigint, uuid, numeric, text, uuid, text, integer, text, text, integer, bigint, date, numeric) from public, anon, authenticated;
grant execute on function public.reservar_nota_credito(uuid, bigint, uuid, numeric, text, uuid, text, integer, text, text, integer, bigint, date, numeric) to service_role;
