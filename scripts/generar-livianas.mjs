#!/usr/bin/env node
// Genera la versión LIVIANA de la foto principal de cada producto (para pantallas: Gestión y catálogo público).
//
//   · La ORIGINAL (productos.imagen_url) no se toca nunca.
//   · La liviana: máx. 1200 px de lado, PNG con paleta (mantiene la transparencia), unos 20-40 KB.
//   · Se guarda en el Storage con el código Y el nombre del archivo original:  productos/lite/v1/<SKU>_<archivo>.png
//     (así se encuentra sin ninguna columna nueva en la base, y si la original cambia, la liviana vieja deja de coincidir:
//     la pantalla cae a la original y nunca muestra una foto desactualizada). Misma regla que src/lib/imagenes.js.
//   · De dónde toma la original: de la carpeta de originales de la compu (GESTION_ORIGINALES_DIR, sin gastar
//     tráfico de Supabase) y, si el producto no tiene archivo ahí (combos, variantes), de imagen_url.
//
// Uso:
//   node scripts/generar-livianas.mjs               → genera las que faltan
//   node scripts/generar-livianas.mjs --forzar      → regenera todas (vuelve a subir)
//   node scripts/generar-livianas.mjs --sku CUA000001,CUA000002   → solo esos
//   node scripts/generar-livianas.mjs --simular     → no sube nada, solo cuenta y mide
//
// Mismo .env.local que los demás scripts (GESTION_EMAIL / GESTION_PASSWORD / GESTION_ORIGINALES_DIR).
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import sharp from 'sharp'

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

const { supabase } = await import('../src/lib/supabase.js')
const { nombreLiviana } = await import('../src/lib/imagenes.js')
const args = process.argv.slice(2)
const forzar = args.includes('--forzar')
const simular = args.includes('--simular')
const soloSkus = (args.includes('--sku') ? args[args.indexOf('--sku') + 1] || '' : '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
const LADO = 1200
const VERSION = 'v1'

function fallar(m) { console.error('✕ ' + m); process.exit(1) }
if (!process.env.GESTION_EMAIL || !process.env.GESTION_PASSWORD) fallar('Faltan GESTION_EMAIL / GESTION_PASSWORD en .env.local.')
const { error: eLogin } = await supabase.auth.signInWithPassword({ email: process.env.GESTION_EMAIL, password: process.env.GESTION_PASSWORD })
if (eLogin) fallar('No se pudo iniciar sesión: ' + eLogin.message)

// Productos con foto principal
const productos = []
for (let d = 0; ; d += 1000) {
  const { data, error } = await supabase.from('productos').select('sku, imagen_url').not('imagen_url', 'is', null).order('sku').range(d, d + 999)
  if (error) fallar(error.message)
  productos.push(...(data || []))
  if (!data || data.length < 1000) break
}
let lista = productos.filter((p) => p.sku && p.imagen_url)
if (soloSkus.length) lista = lista.filter((p) => soloSkus.includes(p.sku))

// Archivos originales de la compu (por código en el nombre)
const dirOrig = (process.env.GESTION_ORIGINALES_DIR || '').trim()
const archivos = new Map()
if (dirOrig && fs.existsSync(dirOrig)) {
  for (const n of fs.readdirSync(dirOrig)) {
    const m = /^([A-Z]{3}\d{6}(?:-V\d+)?)\.png$/i.exec(n)
    if (m) archivos.set(m[1].toUpperCase(), path.join(dirOrig, n))
  }
}

// Las que ya existen en el Storage (para saltearlas)
const yaExisten = new Set()
if (!forzar) {
  for (let off = 0; ; off += 1000) {
    const { data } = await supabase.storage.from('productos').list(`lite/${VERSION}`, { limit: 1000, offset: off })
    for (const f of data || []) yaExisten.add(f.name)
    if (!data || data.length < 1000) break
  }
}

const aHacer = lista.filter((p) => forzar || !yaExisten.has(nombreLiviana(p.sku, p.imagen_url)))
console.log(`Productos con foto: ${lista.length} | ya tienen liviana: ${lista.length - aHacer.length} | a generar: ${aHacer.length}` +
  `${simular ? ' (SIMULACIÓN: no se sube nada)' : ''} | originales en la carpeta: ${archivos.size}`)

let hechos = 0, kbAntes = 0, kbDespues = 0, desdeDisco = 0, desdeStorage = 0
const errores = []
async function procesar(p) {
  let origen
  if (archivos.has(p.sku)) { origen = fs.readFileSync(archivos.get(p.sku)); desdeDisco++ }
  else {
    const r = await fetch(p.imagen_url)
    if (!r.ok) throw new Error(`no se pudo bajar la original (HTTP ${r.status})`)
    origen = Buffer.from(await r.arrayBuffer()); desdeStorage++
  }
  const liviana = await sharp(origen).resize({ width: LADO, height: LADO, fit: 'inside', withoutEnlargement: true })
    .png({ palette: true, quality: 90, effort: 10, compressionLevel: 9 }).toBuffer()
  // Si por algún motivo la "liviana" pesa más que la original, se sube la original tal cual (nunca empeorar).
  const final = liviana.length < origen.length ? liviana : origen
  kbAntes += origen.length / 1024; kbDespues += final.length / 1024
  if (!simular) {
    const { error } = await supabase.storage.from('productos').upload(`lite/${VERSION}/${nombreLiviana(p.sku, p.imagen_url)}`, final, {
      upsert: true, contentType: 'image/png', cacheControl: '31536000',   // 1 año: las pantallas no la vuelven a pedir
    })
    if (error) throw new Error(error.message)
  }
  hechos++
}

const COLA = 4
let i = 0
await Promise.all(Array.from({ length: COLA }, async () => {
  while (i < aHacer.length) {
    const p = aHacer[i++]
    try { await procesar(p) } catch (e) { errores.push(`${p.sku}: ${e.message}`) }
    if ((hechos + errores.length) % 50 === 0) console.log(`  … ${hechos + errores.length}/${aHacer.length}`)
  }
}))

console.log(`\n${simular ? 'Simulado' : 'Listo'}: ${hechos} livianas | originales leídas del disco: ${desdeDisco}, del Storage: ${desdeStorage}`)
if (hechos) console.log(`Peso: ${Math.round(kbAntes / 1024 * 10) / 10} MB (originales) → ${Math.round(kbDespues / 1024 * 10) / 10} MB (livianas)  (-${Math.round(100 - kbDespues / kbAntes * 100)}%) | promedio liviana: ${Math.round(kbDespues / hechos)} KB`)
if (errores.length) { console.log(`Errores (${errores.length}):`); errores.slice(0, 15).forEach((e) => console.log('  · ' + e)) }
process.exit(errores.length ? 1 : 0)
