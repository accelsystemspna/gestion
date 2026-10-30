-- Las fotos de los pedidos se borran a los 90 días de cargadas (solo las de pedidos, nunca las de productos).
-- Una vez por día, a las 4 de la mañana de Argentina, se llama a la función pedidos-fotos-vencidas.
-- El secreto se guarda aparte en el Vault con el nombre 'pedidos_limpieza_secret' (no va en este archivo)
-- y en los secretos de las funciones como PEDIDOS_LIMPIEZA_SECRET.
alter table public.pedidos add column if not exists imagenes_vencidas_en timestamptz;

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule('pedidos-fotos-vencidas', '0 7 * * *', $cron$
  select net.http_post(
    url := 'https://uoyyiiggfcswvllwchsx.supabase.co/functions/v1/pedidos-fotos-vencidas',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-limpieza-secreto', (select decrypted_secret from vault.decrypted_secrets where name = 'pedidos_limpieza_secret')
    ),
    body := '{"simular": false}'::jsonb,
    timeout_milliseconds := 60000
  );
$cron$);
