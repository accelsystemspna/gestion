-- Datos para imprimir bien la factura.

-- Del emisor: van en la factura y se cargan en Configuración → ARCA.
alter table public.arca_config add column if not exists domicilio text;
alter table public.arca_config add column if not exists iibb text;
alter table public.arca_config add column if not exists inicio_actividades date;

-- De cada factura: la fecha con la que se emitió y a quién, para reimprimirla igual y armar bien el QR.
alter table public.ventas add column if not exists factura_fecha date;
alter table public.ventas add column if not exists factura_doc_tipo integer;
alter table public.ventas add column if not exists factura_doc_nro text;
alter table public.ventas add column if not exists factura_cond_iva text;

-- Del cliente: para poder facturarle a su nombre. Opcional.
alter table public.clientes add column if not exists cuit text;
alter table public.clientes add column if not exists cuit_tipo text;
alter table public.clientes add column if not exists condicion_iva text;
