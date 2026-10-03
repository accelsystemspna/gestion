# Gestión — notas para Claude Code

App de gestión (React + Vite + Supabase, sin TypeScript, UI en español) para un
negocio de carpintería / corte láser / impresión 3D. Deploy en
`gestion.ccdesign.com.ar` (Hostinger, publica sola al pushear `dist/` a `main`).

## Completar un producto para la web (fotos, descripción, categoría, tienda)

Cuando te pidan cargar/completar productos para que se vean en una tienda online
(fotos, descripción, categoría web, "usar imágenes compartidas", activarlo en tal
tienda), **no lo hagas a mano por el navegador** (abrir el formulario, subir cada
foto con clics, etc.) — es lento y gasta muchos tokens. Usá en cambio:

```bash
node scripts/completar-producto-web.mjs ruta/al/pedido.json
```

El script asume que **el producto ya existe** (tiene SKU y costo cargados) — no
crea productos nuevos ni calcula costos de melamina/impresión 3D. Leé el
comentario al principio de `scripts/completar-producto-web.mjs` para la forma
exacta del JSON (descripción, `imagen_principal`, `imagen_portada_web`,
`galeria_web`, `subcategoria`, `categorias_web`, `tiendas`,
`usar_imagenes_compartidas`, `activo`, `sincronizar`).

Flujo típico cuando el usuario te da una carpeta de fotos y te pide cargar un
producto:
1. Mirá las fotos (herramienta Read: acepta imágenes) para saber cuál conviene
   como portada y cuál va a la galería, y para escribir/mejorar la descripción.
2. Armá el JSON con el Write tool en un archivo temporal (evita problemas de
   comillas del shell) y corré el script con Bash.
3. El script sube las fotos al mismo storage que usa el formulario, actualiza la
   fila en `productos` y sincroniza con las tiendas asignadas (WooCommerce y/o
   el portal mayorista), igual que el botón "Guardar" de la pantalla Productos.
4. Contale al usuario qué cambió y el resultado de la sincronización por tienda.

**Antes de la primera vez**, el usuario tiene que crear `.env.local` en la raíz
(ya está en `.gitignore`) con `GESTION_EMAIL` y `GESTION_PASSWORD` — el login
normal de Gestión. El script entra con esa cuenta (mismos permisos que tiene en
el programa, nada más). Nunca le pidas esas credenciales por el chat: son ellos
quienes las escriben en el archivo.

Si en algún momento hace falta ADEMÁS crear productos nuevos desde cero (SKU +
costo por piezas de melamina o por gramos/tiempo de impresión 3D), avisá que ese
flujo todavía no está armado — es más laborioso porque replica el asistente de
costos del formulario (`src/pages/Productos/ProductoForm.jsx`).

## Publicar en Mercado Libre

Segundo paso del mismo flujo (después de `completar-producto-web.mjs`, que deja fotos y
descripción en el producto): `scripts/publicar-en-ml.mjs ruta/al/pedido.json`. Lee título,
fotos, descripción, medidas y SKU del producto, calcula el precio con la lista "Mercado Libre"
y copia envío/garantía/marca de una publicación ya existente del negocio en esa categoría.
**Por defecto solo VALIDA** (ML revisa, no publica); para publicar de verdad el JSON tiene que
llevar `"publicar": true` — confirmalo con el usuario antes. La forma del JSON está en el
comentario del script. La cuenta de ML tiene que estar conectada (Configuración → Integraciones).
La descripción se manda en texto plano (el HTML se convierte). Las fotos tienen que tener URL
pública (las locales se suben solas).
