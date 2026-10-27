#!/usr/bin/env node
// Encuentra en la computadora la imagen ORIGINAL (calidad completa) de un producto a partir de su código (SKU).
//
// Para qué: los creativos tienen que hacerse con la original, no con la versión liviana que usan las pantallas
// ni con la copia comprimida del Storage. Orquestador solo necesita el SKU: este script le dice dónde está el archivo.
//
// Uso:
//   node scripts/buscar-original.mjs CUA000123            → imprime la mejor coincidencia (y las otras, si hay)
//   node scripts/buscar-original.mjs CUA000123 --json     → salida en JSON (para otros scripts)
//   node scripts/buscar-original.mjs --estructura         → muestra la carpeta de originales (para ver cómo están nombrados)
//
// Configuración (una sola vez), en .env.local de la raíz del proyecto — el mismo archivo de GESTION_EMAIL:
//   GESTION_ORIGINALES_DIR=C:/ruta/a/la/carpeta/de/los/PNG
// La carpeta se busca incluyendo subcarpetas. Cómo se reconoce el archivo de un producto:
//   1) el nombre del archivo contiene el SKU (CUA000123.png, CUA000123-homero.png, homero_CUA000123.png...), o
//   2) si no hay ninguno, el nombre del archivo se parece al NOMBRE del producto en Gestión ("Homero Dona" → homero-dona.png).
//
// Códigos de salida: 0 = encontrado · 1 = no encontrado · 2 = falta configurar la carpeta / error.
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
    if (process.env[m[1]] === undefined) process.env[m[1]] = v
  }
}
const raiz = path.resolve(import.meta.dirname, '..')
cargarEnv(path.join(raiz, '.env'))
cargarEnv(path.join(raiz, '.env.local'))

const args = process.argv.slice(2)
const comoJson = args.includes('--json')
const sku = (args.find((a) => !a.startsWith('--')) || '').toUpperCase()
const EXT = /\.(png|jpe?g|webp)$/i

function salir(codigo, mensaje, extra = {}) {
  if (comoJson) console.log(JSON.stringify({ ok: codigo === 0, mensaje, ...extra }))
  else console.error((codigo === 0 ? '' : '✕ ') + mensaje)
  process.exit(codigo)
}

const dir = (process.env.GESTION_ORIGINALES_DIR || '').trim()
if (!dir) {
  salir(2, 'Falta configurar la carpeta de originales. Pedile al usuario la ruta de la carpeta donde están los PNG y agregá en ' +
    'C:/Proyectos/gestion-app/.env.local la línea:  GESTION_ORIGINALES_DIR=C:/ruta/a/la/carpeta')
}
if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
  salir(2, `La carpeta de originales no existe o no es accesible: ${dir}. Si es un tema de permisos, pedile acceso al usuario.`)
}

function listar(base) {
  const salida = []
  const recorrer = (d) => {
    let entradas
    try { entradas = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entradas) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) recorrer(p)
      else if (EXT.test(e.name)) salida.push(p)
    }
  }
  recorrer(base)
  return salida
}

const normalizar = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const archivos = listar(dir)

if (args.includes('--estructura')) {
  console.log(`Carpeta: ${dir}\nImágenes encontradas (png/jpg/webp, con subcarpetas): ${archivos.length}`)
  for (const a of archivos.slice(0, 40)) console.log('  ' + path.relative(dir, a).replace(/\\/g, '/'))
  if (archivos.length > 40) console.log(`  … y ${archivos.length - 40} más`)
  process.exit(0)
}

if (!/^[A-Z]{3}\d{6}(-V\d+)?$/.test(sku)) salir(2, 'Pasame el código del producto (ej. CUA000123). Uso: node scripts/buscar-original.mjs CUA000123')

// Orden de preferencia: PNG primero, y entre iguales el de mayor tamaño (suele ser el de más calidad).
const puntaje = (p) => (/\.png$/i.test(p) ? 2 : /\.webp$/i.test(p) ? 0 : 1)
const ordenar = (lista) => [...lista].sort((a, b) => puntaje(b) - puntaje(a) || fs.statSync(b).size - fs.statSync(a).size)

// Por SKU en el nombre del archivo (no confundir CUA000012 con CUA000123: se pide que no haya un dígito pegado)
const porSku = (codigo) => {
  const re = new RegExp(`(^|[^A-Za-z0-9])${codigo}(?![0-9])`, 'i')
  return archivos.filter((a) => re.test(path.basename(a)))
}
let coincidencias = porSku(sku)
let criterio = 'sku'

// Variante (CUA000153-V1): comparte el dibujo con el producto base (CUA000153)
if (!coincidencias.length && /-V\d+$/.test(sku)) {
  coincidencias = porSku(sku.replace(/-V\d+$/, ''))
  if (coincidencias.length) criterio = `sku base ${sku.replace(/-V\d+$/, '')} (${sku} es una variante)`
}

// Por nombre del producto (consulta a Gestión) si el SKU no aparece en ningún archivo.
// Si el producto es un combo no tiene imagen propia: se devuelven las originales de los productos que lo forman.
let esCombo = false, componentes = []
if (!coincidencias.length) {
  try {
    const { supabase } = await import('../src/lib/supabase.js')
    if (process.env.GESTION_EMAIL && process.env.GESTION_PASSWORD) {
      await supabase.auth.signInWithPassword({ email: process.env.GESTION_EMAIL, password: process.env.GESTION_PASSWORD })
      const { data } = await supabase.from('productos').select('nombre, combo_items').eq('sku', sku).maybeSingle()
      if (Array.isArray(data?.combo_items) && data.combo_items.length) {
        esCombo = true
        const ids = data.combo_items.map((i) => i.producto_id)
        const { data: comp } = await supabase.from('productos').select('id, sku, nombre').in('id', ids)
        componentes = data.combo_items.map((i) => {
          const c = (comp || []).find((x) => x.id === i.producto_id)
          const f = c ? ordenar(porSku(c.sku))[0] : null
          return { sku: c?.sku || '?', nombre: c?.nombre || '', cantidad: i.cantidad, ruta: f ? f.replace(/\\/g, '/') : null }
        })
      } else if (data?.nombre) {
        const nombre = normalizar(data.nombre)
        coincidencias = archivos.filter((a) => normalizar(path.parse(a).name) === nombre)
        if (!coincidencias.length) {
          const palabras = nombre.split(' ').filter((w) => w.length > 2)
          coincidencias = palabras.length ? archivos.filter((a) => { const n = normalizar(path.parse(a).name); return palabras.every((w) => n.includes(w)) }) : []
        }
        criterio = `nombre "${data.nombre}"`
      }
    }
  } catch { /* sin conexión a Gestión: solo se usa el SKU */ }
}

if (esCombo) {
  const faltan = componentes.filter((c) => !c.ruta)
  if (comoJson) console.log(JSON.stringify({ ok: true, sku, combo: true, mensaje: 'Es un combo: no tiene imagen propia; estas son las originales de los productos que lo forman.', componentes }))
  else {
    console.log(`${sku} es un combo: no tiene imagen propia. Originales de los ${componentes.length} productos que lo forman:`)
    for (const c of componentes) console.log(`  ${c.sku}  x${c.cantidad}  ${c.nombre}  →  ${c.ruta || '(sin archivo original)'}`)
    if (faltan.length) console.error(`(Faltan los originales de: ${faltan.map((c) => c.sku).join(', ')})`)
  }
  process.exit(faltan.length === componentes.length ? 1 : 0)
}

if (!coincidencias.length) {
  salir(1, `No encontré ninguna imagen de ${sku} en ${dir} (busqué por código y por nombre). ` +
    'No inventes ni uses otra imagen: avisale al usuario y pedile que indique dónde está el archivo.', { sku })
}

const orden = ordenar(coincidencias)
const info = orden.map((p) => ({ ruta: p.replace(/\\/g, '/'), kb: Math.round(fs.statSync(p).size / 1024) }))
if (comoJson) {
  console.log(JSON.stringify({ ok: true, sku, criterio, mejor: info[0].ruta, candidatos: info }))
} else {
  console.log(info[0].ruta)
  if (info.length > 1) {
    console.error(`(Hay ${info.length} coincidencias por ${criterio}; usé la primera: PNG y de mayor tamaño. Las otras:)`)
    for (const i of info.slice(1)) console.error(`  ${i.ruta}  ${i.kb} KB`)
  }
}
