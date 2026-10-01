# Cómo conectar Orquestador con Gestión (cargar productos en la web)

Pegar esto en la sesión de Claude Code que trabaja en Orquestador.

---

Cuando termines un creativo para un producto (fotos + descripción/copy) y yo te
pida "cargalo en Gestión" (o "activalo en tal tienda"), usá el script que ya
existe en el otro proyecto — no reimplementes nada de esto ni llames a
Supabase directo.

## Cómo llamarlo

```bash
node "C:/Proyectos/gestion-app/scripts/completar-producto-web.mjs" ruta/al/pedido.json
```

Es un script de Node normal, se corre desde donde sea (no hace falta estar
parado en esa carpeta). Si al ejecutarlo o leer archivos de esa carpeta te
encontrás con un error de permisos/acceso, pedime acceso a la carpeta
`C:\Proyectos\gestion-app` y seguimos.

**Antes de armar el JSON**, leé el comentario al principio de
`C:/Proyectos/gestion-app/scripts/completar-producto-web.mjs` — ahí está la
forma exacta y actualizada de los campos (por si cambió desde que se escribió
esto). Resumen:

- El producto **tiene que existir ya** en Gestión (con SKU y precio cargados).
  Este script no crea productos nuevos ni calcula costos — solo completa uno
  existente para que se vea bien en la web.
- Campos típicos que vas a usar: `sku` (obligatorio), `descripcion`,
  `seo_titulo`, `seo_descripcion`, `imagen_principal` (ruta local a una foto),
  `imagen_portada_web` (ruta local), `galeria_web` (array de rutas locales),
  `categorias_web` (array de nombres de categoría, tal cual están en Gestión),
  `tiendas` (array de nombres de tienda, tal cual están en Gestión),
  `usar_imagenes_compartidas` (true/false), `activo` (true/false).
- Las rutas de imágenes son **archivos locales de esta compu** (el script las
  lee del disco y las sube él mismo a Supabase) — no hace falta subirlas antes
  a ningún lado.
- Los nombres de categoría/tienda no necesitan ser exactos: alcanza con que se
  parezcan al nombre real en Gestión. Si es ambiguo o no existe, el script
  corta y te dice cuáles son las opciones válidas — mostráselo al usuario en
  vez de adivinar.

## Ejemplo de JSON (armalo con el Write tool en un archivo temporal, no por la
## terminal, para no pelearte con comillas)

```json
{
  "sku": "MEL000012",
  "descripcion": "Cuadro decorativo de Homero Simpson, corte láser en MDF...",
  "imagen_portada_web": "C:/Users/Alicia Beatriz/Desktop/creativos/homero-portada.jpg",
  "galeria_web": ["C:/Users/Alicia Beatriz/Desktop/creativos/homero-2.jpg"],
  "categorias_web": ["Homero", "Cuadros Decorativos"],
  "tiendas": ["Mayorista Local"],
  "usar_imagenes_compartidas": true,
  "activo": true
}
```

Después corré el comando de arriba con la ruta a ese JSON y leé la salida: el
script imprime qué campos cambió y si pudo avisar a cada tienda (WooCommerce
y/o el portal mayorista). Contale al usuario el resultado tal cual, sin
inventar que salió bien si el script marcó un ✕.

## Credenciales

Ya están configuradas en `C:/Proyectos/gestion-app/.env.local` (no lo toques,
no lo leas ni lo repitas — el script las usa solo). Si algún día decís
"no puedo entrar" o el script falla con un error de login, avisale al usuario
en vez de intentar poner una contraseña vos: esas credenciales las administra
él directamente en ese archivo.

## Qué NO hace este script (por ahora)

- No crea productos nuevos desde cero (eso necesita SKU + costeo por piezas de
  melamina o por impresión 3D — no está armado todavía).
- No sube el precio ni cambia el costo del producto.
- No borra fotos viejas del storage cuando reemplazás una — quedan huérfanas,
  no rompe nada pero tampoco las limpia.
