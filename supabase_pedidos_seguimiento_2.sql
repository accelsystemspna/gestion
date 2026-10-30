-- Cada negocio tiene su propio sitio de seguimiento de pedidos (su dominio, su marca, su WhatsApp/Instagram).
-- La dirección se guarda en la marca del negocio y se arma con ella el link que se le manda al cliente.
alter table branding add column if not exists url_seguimiento text;

update branding set url_seguimiento = 'https://seguimiento.ccdesign.com.ar'
 where user_id = 'b2edb9d6-eeb1-474c-b94b-4958228f5e23' and url_seguimiento is null;
