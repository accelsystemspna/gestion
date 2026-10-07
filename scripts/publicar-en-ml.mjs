#!/usr/bin/env node
// Publica (o valida) en Mercado Libre un producto YA EXISTENTE del programa.
// Toma la configuración de la pestaña "Mercado Libre" del producto (y, si está vacía, título, fotos
// y descripción generales), más medidas y SKU; el resto de la publicación (envío,
// garantía, marca, material...) se copia de una publicación tuya de la misma categoría.
//
// POR DEFECTO SOLO VALIDA: Mercado Libre revisa el producto pero no se publica nada.
// Para publicar de verdad hay que poner  "publicar": true  en el JSON.
//
// Uso:
//   node scripts/publicar-en-ml.mjs ruta/al/pedido.json
//
// Mismo .env.local que completar-producto-web.mjs (GESTION_EMAIL / GESTION_PASSWORD).
// Y la cuenta de Mercado Libre tiene que estar conectada en Configuración → Integraciones.
//
// Forma del JSON (todo opcional salvo "sku"):
// {
//   "sku": "CUA000018",
//   "publicar": false,                 // true = publica de verdad (default: solo valida)
//   "precio": 60000,                   // si falta, se calcula con la lista "Mercado Libre"
//   "stock": 10,                       // si falta: stock del producto (o el de la publicación modelo)
//   "titulo": "Cuadro Tríptico ...",   // máx. 60 caracteres (default: título web sin "| marca", o el nombre)
//   "descripcion": "texto plano",      // default: la descripción del producto (el HTML se pasa a texto)
//   (titulo, descripcion, imagenes, atributos, categoria_ml y precio, si los pasás, se GUARDAN en la
//    pestaña Mercado Libre del producto: la configuración de la web no se toca)
//   "imagenes": ["C:/fotos/a.jpg", "https://..."],  // rutas locales (se suben) o URLs públicas; default: las del producto
//   "atributos": { "PAINTING_THEME": "Mandala", "COLOR": "Negro" },  // pisan lo copiado/calculado
//   "categoria_ml": "MLA1635",         // default: la de la publicación modelo
//   "plantilla_item_id": "MLA2118518732", // publicación tuya a copiar (default: una activa de la categoría)
//   "listing_type_id": "gold_pro"
// }
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

function cargarEnv(archivo) {
  if (!fs.existsSync(archivo)) return
  for (const linea of fs.readFileSync(archivo, 'utf8').split('\n')) {
    const m = /^\s*([\w.-]+)\s*=\s*(.*)\s*$/.exec(linea)
    if (!m) continue
    let v = m[2]
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    process.env[m[1]] = v
  }
}
const raiz = path.resolve(import.meta.dirname, '..')
cargarEnv(path.join(raiz, '.env'))
cargarEnv(path.join(raiz, '.env.local'))

const { supabase } = await import('../src/lib/supabase.js')
const { precioVenta } = await import('../src/lib/pricing.js')

function fallar(msg) { console.error('✕ ' + msg); process.exit(1) }

const jsonPath = process.argv[2]
if (!jsonPath) fallar('Uso: node scripts/publicar-en-ml.mjs ruta/al/pedido.json')
let pedido
try { pedido = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) } catch (err) { fallar('No pude leer/parsear ' + jsonPath + ': ' + err.message) }
if (!pedido.sku) fallar('Falta "sku" en el JSON.')
if (!process.env.GESTION_EMAIL || !process.env.GESTION_PASSWORD) fallar('Faltan GESTION_EMAIL / GESTION_PASSWORD en .env.local.')

const { data: sesion, error: errLogin } = await supabase.auth.signInWithPassword({ email: process.env.GESTION_EMAIL, password: process.env.GESTION_PASSWORD })
if (errLogin) fallar('No se pudo iniciar sesión en gestión: ' + errLogin.message)

const sku = String(pedido.sku).toUpperCase()
const { data: producto, error: errProd } = await supabase.from('productos').select('*').eq('sku', sku).maybeSingle()
if (errProd) fallar('Error al buscar el producto: ' + errProd.message)
if (!producto) fallar(`No existe ningún producto con SKU "${sku}". Este script no crea productos nuevos.`)

// ── Precio: el pedido, o la lista de precios de Mercado Libre ───────────────
let precio = Number(pedido.precio)
if (!(precio > 0)) {
  const { data: listas } = await supabase.from('listas_precios').select('*')
  const lista = (listas || []).find((l) => /mercado\s*libre/i.test(l.nombre))
  if (!lista) fallar('No pasaste "precio" y no hay una lista de precios llamada "Mercado Libre".')
  precio = Math.round(precioVenta(Number(producto.costo_base) || 0, lista))
  console.log(`· Precio calculado con la lista "${lista.nombre}": $${precio}`)
}

// ── Imágenes: las locales se suben al storage para tener una URL pública ────
let imagenes
if (pedido.imagenes?.length) {
  imagenes = []
  const tipos = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }
  for (const ruta of pedido.imagenes) {
    if (/^https?:\/\//.test(ruta)) { imagenes.push(ruta); continue }
    if (!fs.existsSync(ruta)) fallar(`No existe el archivo de imagen: ${ruta}`)
    const ext = (path.extname(ruta).slice(1) || 'jpg').toLowerCase()
    const destino = `ml/${Date.now()}-${Math.round(Math.random() * 1e6)}.${ext}`
    const { error } = await supabase.storage.from('productos').upload(destino, fs.readFileSync(ruta), { upsert: true, contentType: tipos[ext] || 'image/jpeg' })
    if (error) fallar(`No se pudo subir ${ruta}: ${error.message}`)
    imagenes.push(supabase.storage.from('productos').getPublicUrl(destino).data.publicUrl)
  }
}

// Lo que se pasa por JSON queda guardado en la pestaña "Mercado Libre" del producto (separada de la web),
// así se puede revisar y retocar desde el programa y no hay que repetirlo.
{
  const guardar = {}
  if (pedido.titulo) guardar.ml_titulo = String(pedido.titulo).slice(0, 60)
  if (pedido.descripcion) guardar.ml_descripcion = pedido.descripcion
  if (imagenes) guardar.ml_imagenes = imagenes
  if (pedido.atributos) guardar.ml_atributos = { ...(producto.ml_atributos || {}), ...pedido.atributos }
  if (pedido.categoria_ml) guardar.ml_categoria_id = pedido.categoria_ml
  if (Number(pedido.precio) > 0) guardar.ml_precio = Number(pedido.precio)
  if (Object.keys(guardar).length) {
    const { error } = await supabase.from('productos').update(guardar).eq('id', producto.id)
    if (error) fallar('No se pudo guardar la configuración de Mercado Libre en el producto: ' + error.message)
    console.log('· Guardado en la pestaña Mercado Libre del producto: ' + Object.keys(guardar).join(', '))
  }
}

const validar = pedido.publicar !== true
const cuerpo = {
  action: 'publish', producto_id: producto.id, validar,
  pedido: {
    precio, stock: pedido.stock, titulo: pedido.titulo, descripcion: pedido.descripcion, imagenes,
    atributos: pedido.atributos, categoria_ml: pedido.categoria_ml, plantilla_item_id: pedido.plantilla_item_id,
    listing_type_id: pedido.listing_type_id, demora_dias: pedido.demora_dias,
  },
}
const res = await fetch(`${process.env.VITE_SUPABASE_URL}/functions/v1/ml-api`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sesion.session.access_token}`, apikey: process.env.VITE_SUPABASE_ANON_KEY },
  body: JSON.stringify(cuerpo),
})
const r = await res.json().catch(() => ({}))

if (r.vista) {
  console.log(`· "${r.vista.titulo}" · ${r.vista.categoria} · $${r.vista.precio} · stock ${r.vista.stock} · ${r.vista.fotos} foto(s) · modelo ${r.vista.plantilla}`)
  if (r.vista.condiciones) console.log('· condiciones de venta: ' + JSON.stringify(r.vista.condiciones) + ' · tipo ' + r.vista.listing_type_id + ' · envío ' + JSON.stringify(r.vista.shipping))
}
if (!r.ok) {
  console.error('✕ ' + (r.error || 'Error desconocido'))
  for (const e of r.errores || []) console.error('   - ' + e)
  process.exit(1)
}
if (validar) {
  console.log('✓ Mercado Libre aprobó el producto (todavía NO está publicado).')
  for (const a of r.avisos || []) console.log('   aviso: ' + a)
  console.log('  Para publicarlo de verdad, agregá  "publicar": true  al JSON.')
} else {
  console.log(`✓ Publicado: ${r.item_id} (${r.estado}) ${r.permalink}`)
  if (r.error_descripcion) console.log('  ⚠ La descripción no se pudo cargar: ' + r.error_descripcion)
}
