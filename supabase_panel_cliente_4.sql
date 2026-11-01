-- Panel del cliente: el comprobante de las ventas sin factura también se guarda como documento.
alter table public.cliente_documentos drop constraint if exists cliente_documentos_tipo_check;
alter table public.cliente_documentos add constraint cliente_documentos_tipo_check check (tipo in ('presupuesto', 'factura', 'recibo', 'ticket'));
