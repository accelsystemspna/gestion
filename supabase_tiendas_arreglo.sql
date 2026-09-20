-- Ejecutar en Supabase Dashboard -> SQL Editor
-- Corrige la tienda de los pedidos web que quedaron asignados a otra tienda cuyo nombre
-- está contenido en el suyo (ej. un pedido de "Mayorista CC Design" tomado como de "CC Design").

update public.ventas v
   set tienda_id = t.id
  from public.tiendas t
 where v.origen_ref like 'WC#%'
   and (v.notas like '% — ' || t.nombre or v.notas like '% — ' || t.nombre || ' (pendiente de pago)')
   and v.tienda_id is distinct from t.id;

-- Los pedidos de tiendas mayoristas quedan con el canal "web mayorista"
update public.ventas
   set canal = 'web_mayorista'
 where tienda_id in (select id from public.tiendas where tipo = 'mayorista')
   and canal is distinct from 'web_mayorista';
