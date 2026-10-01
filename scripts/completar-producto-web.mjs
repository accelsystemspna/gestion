#!/usr/bin/env node
// Completa un producto YA EXISTENTE para que se vea en la web: fotos, descripción,
// categoría web, imágenes compartidas y tienda(s) donde mostrarlo. Al final sincroniza
// con la(s) tienda(s) igual que hace el botón "Guardar" del formulario de Productos.
//
// No crea productos nuevos ni calcula el costo (piezas de melamina / impresión 3D):
// el producto tiene que existir de antes, con su SKU.
//
// Uso:
//   node scripts/completar-producto-web.mjs ruta/al/pedido.json
//
// Antes de usarlo una vez: crear .env.local (ya está en .gitignore, nunca se sube)
// en la raíz del proyecto con:
//   GESTION_EMAIL=tu-email-de-gestion
//   GESTION_PASSWORD=tu-contraseña-de-gestion
// El script entra con esa cuenta, igual que si fuera el navegador: no hace nada que
// esa cuenta no pueda hacer ya en el programa.
//
// Forma del JSON de entrada (todos los campos son opcionales salvo "sku"):
// {
//   "sku": "MEL000012",
//   "descripcion": "texto nuevo (reemplaza al actual)",
//   "seo_titulo": "...", "seo_descripcion": "...",
//   "imagen_principal":   "C:/ruta/foto1.jpg",   // reemplaza imagen_url (foto interna)
//   "imagen_portada_web": "C:/ruta/foto2.jpg",   // reemplaza imagen_web_url (portada en la web)
//   "galeria_web": ["C:/ruta/foto3.jpg", "C:/ruta/foto4.jpg"],  // se agregan a imagenes_web
//   "reemplazar_galeria": false,        // true = las fotos anteriores de la galería se borran
//   "subcategoria": "Nombre exacto o parecido",     // clasificación interna (subcategoria_id)
//   "categorias_web": ["Homero", "Ofertas"],        // categorías en las que aparece en la tienda
//   "reemplazar_categorias_web": false,             // true = reemplaza en vez de sumar
//   "tiendas": ["Mayorista Local", "Tienda CC Design"],  // dónde mostrarlo (se suman a las que ya tenía)
//   "reemplazar_tiendas": false,
//   "usar_imagenes_compartidas": true,   // default true
//   "activo": true,                      // default true
//   "peso_kg": 0.3,                                 // envío: peso del paquete
//   "paquete_largo": 45, "paquete_ancho": 29, "paquete_alto": 0.3,  // envío: medidas del paquete (cm)
//   "sincronizar": true                  // default true: empujar el cambio a las tiendas ahora
// }
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

// ── Variables de entorno (.env y .env.local; .env.local pisa a .env) ───────────
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
const { syncToWoo, cargarImagenesCompartidas, conCategoriasWeb } = await import('../src/lib/wooSync.js')
const { syncMayorista } = await import('../src/lib/mayoristaSync.js')

function fallar(msg) { console.error('✕ ' + msg); process.exit(1) }

const jsonPath = process.argv[2]
if (!jsonPath) fallar('Uso: node scripts/completar-producto-web.mjs ruta/al/pedido.json')
let pedido
try { pedido = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) } catch (err) { fallar('No pude leer/parsear ' + jsonPath + ': ' + err.message) }
if (!pedido.sku) fallar('Falta "sku" en el JSON.')

if (!process.env.GESTION_EMAIL || !process.env.GESTION_PASSWORD) {
  fallar('Faltan GESTION_EMAIL / GESTION_PASSWORD en .env.local (ver el comentario al principio de este script).')
}
{
  const { error } = await supabase.auth.signInWithPassword({ email: process.env.GESTION_EMAIL, password: process.env.GESTION_PASSWORD })
  if (error) fallar('No se pudo iniciar sesión en gestión: ' + error.message)
}

const normalizar = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()

// ── Datos base ──────────────────────────────────────────────────────────────
const [{ data: producto, error: errProd }, { data: subcategorias }, { data: tiendas }, { data: listas }] = await Promise.all([
  supabase.from('productos').select('*').eq('sku', pedido.sku.toUpperCase()).maybeSingle(),
  supabase.from('subcategorias').select('id, nombre, categoria_id'),
  supabase.from('tiendas').select('*'),
  supabase.from('listas_precios').select('*'),
])
if (errProd) fallar('Error al buscar el producto: ' + errProd.message)
if (!producto) fallar(`No existe ningún producto con SKU "${pedido.sku}". Este script no crea productos nuevos.`)

function buscarUno(lista, nombre, etiqueta) {
  const obj = normalizar(nombre)
  const exacto = lista.find((x) => normalizar(x.nombre) === obj)
  if (exacto) return exacto
  const parcial = lista.filter((x) => normalizar(x.nombre).includes(obj) || obj.includes(normalizar(x.nombre)))
  if (parcial.length === 1) return parcial[0]
  if (parcial.length > 1) fallar(`"${nombre}" (${etiqueta}) es ambiguo, coincide con: ${parcial.map((x) => x.nombre).join(', ')}`)
  fallar(`No encontré ${etiqueta} llamada/o "${nombre}". Opciones: ${lista.map((x) => x.nombre).join(', ')}`)
}

// ── Subir una imagen local al storage 'productos' (mismas rutas que usa el formulario) ──
async function subirImagen(rutaLocal, prefijoCarpeta) {
  if (!fs.existsSync(rutaLocal)) fallar(`No existe el archivo de imagen: ${rutaLocal}`)
  const buffer = fs.readFileSync(rutaLocal)
  const ext = (path.extname(rutaLocal).slice(1) || 'jpg').toLowerCase()
  const tipos = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' }
  const nombreArchivo = `${Date.now()}-${Math.round(Math.random() * 1e6)}.${ext}`
  const rutaStorage = prefijoCarpeta ? `${prefijoCarpeta}/${nombreArchivo}` : nombreArchivo
  const { error } = await supabase.storage.from('productos').upload(rutaStorage, buffer, { upsert: true, contentType: tipos[ext] || 'image/jpeg' })
  if (error) fallar(`No se pudo subir ${rutaLocal}: ${error.message}`)
  const { data } = supabase.storage.from('productos').getPublicUrl(rutaStorage)
  return data.publicUrl
}

// ── Armar los cambios ─────────────────────────────────────────────────────────
const cambios = {}
const resumen = []

if (pedido.descripcion != null) { cambios.descripcion = pedido.descripcion; resumen.push('descripción') }
if (pedido.seo_titulo != null) { cambios.seo_titulo = pedido.seo_titulo; resumen.push('SEO título') }
if (pedido.seo_descripcion != null) { cambios.seo_descripcion = pedido.seo_descripcion; resumen.push('SEO descripción') }

if (pedido.imagen_principal) {
  cambios.imagen_url = await subirImagen(pedido.imagen_principal, null)
  resumen.push('foto interna')
}
if (pedido.imagen_portada_web) {
  cambios.imagen_web_url = await subirImagen(pedido.imagen_portada_web, 'web')
  resumen.push('portada web')
}
if (Array.isArray(pedido.galeria_web) && pedido.galeria_web.length) {
  const nuevas = []
  for (const ruta of pedido.galeria_web) nuevas.push(await subirImagen(ruta, 'web'))
  cambios.imagenes_web = pedido.reemplazar_galeria ? nuevas : [...(producto.imagenes_web || []), ...nuevas]
  resumen.push(`galería (+${nuevas.length}${pedido.reemplazar_galeria ? ', reemplazada' : ''})`)
}

if (pedido.subcategoria) {
  const sub = buscarUno(subcategorias, pedido.subcategoria, 'la subcategoría')
  cambios.subcategoria_id = sub.id
  resumen.push(`subcategoría → ${sub.nombre}`)
}

if (Array.isArray(pedido.categorias_web) && pedido.categorias_web.length) {
  const ids = pedido.categorias_web.map((n) => String(buscarUno(subcategorias, n, 'la categoría web').id))
  const previos = (producto.categorias_web_ids || []).map(String)
  cambios.categorias_web_ids = pedido.reemplazar_categorias_web ? [...new Set(ids)] : [...new Set([...previos, ...ids])]
  resumen.push('categorías web')
}

if (Array.isArray(pedido.tiendas) && pedido.tiendas.length) {
  const ids = pedido.tiendas.map((n) => String(buscarUno(tiendas, n, 'la tienda').id))
  const previos = (producto.tiendas_ids || []).map(String)
  cambios.tiendas_ids = pedido.reemplazar_tiendas ? [...new Set(ids)] : [...new Set([...previos, ...ids])]
  resumen.push('tiendas donde se muestra')
}

if (pedido.usar_imagenes_compartidas !== undefined) cambios.usar_imagenes_compartidas = !!pedido.usar_imagenes_compartidas
else if (producto.usar_imagenes_compartidas == null) cambios.usar_imagenes_compartidas = true
if (pedido.activo !== undefined) cambios.activo = !!pedido.activo
else if (producto.activo === false) cambios.activo = true

if (pedido.peso_kg != null) { cambios.peso_kg = Number(pedido.peso_kg); resumen.push('peso') }
if (pedido.paquete_largo != null) { cambios.paquete_largo = Number(pedido.paquete_largo); resumen.push('largo de envío') }
if (pedido.paquete_ancho != null) { cambios.paquete_ancho = Number(pedido.paquete_ancho); resumen.push('ancho de envío') }
if (pedido.paquete_alto != null) { cambios.paquete_alto = Number(pedido.paquete_alto); resumen.push('alto de envío') }

if (!Object.keys(cambios).length) fallar('El JSON no trae ningún cambio para aplicar.')

const { data: actualizado, error: errUpd } = await supabase.from('productos').update(cambios).eq('id', producto.id).select().single()
if (errUpd) fallar('No se pudo guardar: ' + errUpd.message)

console.log(`✓ ${actualizado.sku} — ${actualizado.nombre}: actualicé ${resumen.join(', ')}.`)

// ── Sincronizar con las tiendas (igual que el botón Guardar) ────────────────
if (pedido.sincronizar === false) {
  console.log('  (sincronizar:false → no se avisó a ninguna tienda; usá "Sincronizar ahora" en Integraciones cuando quieras.)')
  process.exit(0)
}

const idsTienda = (actualizado.tiendas_ids || []).map(String)
const tiendasDelProducto = tiendas.filter((t) => idsTienda.includes(String(t.id)))
const conWeb = conCategoriasWeb(actualizado, subcategorias)

const woo = tiendasDelProducto.filter((t) => t.tipo === 'woocommerce' && t.activa)
if (woo.length) {
  const compartidas = await cargarImagenesCompartidas({ force: true })
  for (const tienda of woo) {
    const ok = await syncToWoo({ tiendas: [tienda], listas, producto: conWeb, compartidas })
    console.log(`  ${ok ? '✓' : '✕'} WooCommerce "${tienda.nombre}"`)
  }
}

const mayoristas = tiendasDelProducto.filter((t) => t.tipo === 'mayorista' && t.activa)
if (mayoristas.length) {
  for (const tienda of mayoristas) {
    const r = await syncMayorista({ skus: [actualizado.sku], tienda })
    console.log(`  ${r.errores ? '✕' : '✓'} Portal mayorista "${tienda.nombre}" (${r.enviados}/${r.total})${r.detalle ? ': ' + r.detalle : ''}`)
  }
}

if (!woo.length && !mayoristas.length) {
  console.log('  Sin tiendas WooCommerce/mayorista activas asignadas: no se avisó a ningún sitio.')
}
