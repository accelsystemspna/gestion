#!/usr/bin/env node
// Borra del Storage (bucket "productos") archivos que NINGUNA tabla usa, a partir de una lista ya revisada.
//
// POR DEFECTO NO BORRA NADA: solo muestra qué haría. Para borrar de verdad hay que pasar --ejecutar.
//
// Uso:
//   node scripts/limpiar-storage.mjs --lista huerfanos.json --mas-de-dias 30
//        (simulación: cuenta y muestra qué se borraría)
//   node scripts/limpiar-storage.mjs --lista huerfanos.json --mas-de-dias 30 --respaldar-en "G:/Mi unidad/Creativos/respaldo-storage" --ejecutar
//        (baja una copia de cada archivo a esa carpeta, y recién después los borra)
//
// La lista es un JSON [{ ruta, bytes, fecha, dias }] (la arma el análisis de archivos sin uso).
// Antes de borrar, el script vuelve a comprobar que ningún producto ni imagen compartida use el archivo
// (si encuentra uno en uso, lo saltea). Mismo .env.local que los demás scripts.
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
const { supabase } = await import('../src/lib/supabase.js')

const args = process.argv.slice(2)
const val = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined)
const ejecutar = args.includes('--ejecutar')
const archivoLista = val('--lista')
const minDias = Number(val('--mas-de-dias') ?? 30)
const dirRespaldo = val('--respaldar-en')
const fallar = (m) => { console.error('✕ ' + m); process.exit(1) }

if (!archivoLista || !fs.existsSync(archivoLista)) fallar('Pasá --lista ruta/al/huerfanos.json')
if (ejecutar && !dirRespaldo) fallar('Para borrar de verdad hay que indicar dónde guardar el respaldo: --respaldar-en "carpeta"')
const lista = JSON.parse(fs.readFileSync(archivoLista, 'utf8')).filter((x) => x.dias > minDias)
if (!lista.length) fallar(`Ningún archivo de la lista tiene más de ${minDias} días.`)

const { error: eLogin } = await supabase.auth.signInWithPassword({ email: process.env.GESTION_EMAIL, password: process.env.GESTION_PASSWORD })
if (eLogin) fallar('No se pudo iniciar sesión: ' + eLogin.message)

// Re-chequeo: rutas que hoy usan los productos y las imágenes compartidas
const enUso = new Set()
const marca = '/storage/v1/object/public/productos/'
const juntar = (v) => { for (const t of [].concat(v ?? [])) { const s = String(t); const i = s.indexOf(marca); if (i >= 0) enUso.add(decodeURI(s.slice(i + marca.length).split('?')[0])) } }
for (let d = 0; ; d += 1000) {
  const { data } = await supabase.from('productos').select('imagen_url, imagen_web_url, imagenes_web, ml_imagenes').range(d, d + 999)
  for (const p of data || []) { juntar(p.imagen_url); juntar(p.imagen_web_url); juntar(p.imagenes_web); juntar(p.ml_imagenes) }
  if (!data || data.length < 1000) break
}
const { data: comp } = await supabase.from('imagenes_compartidas').select('url')
for (const c of comp || []) juntar(c.url)

const aBorrar = lista.filter((x) => !enUso.has(x.ruta))
const salteadas = lista.length - aBorrar.length
const mb = (a) => Math.round(a.reduce((s, x) => s + x.bytes, 0) / 1048576 * 10) / 10
console.log(`Lista: ${lista.length} archivos de más de ${minDias} días (${mb(lista)} MB) | en uso según el re-chequeo (se saltean): ${salteadas} | a borrar: ${aBorrar.length} (${mb(aBorrar)} MB)`)

if (!ejecutar) {
  console.log('\nSIMULACIÓN — no se borró nada. Ejemplos:')
  for (const x of aBorrar.slice(0, 8)) console.log(`  ${x.ruta}  ${(x.bytes / 1024).toFixed(0)} KB  (${x.dias} días)`)
  console.log('\nPara borrar de verdad: agregá --respaldar-en "carpeta" --ejecutar')
  process.exit(0)
}

// 1) respaldo
fs.mkdirSync(dirRespaldo, { recursive: true })
let bajados = 0
for (let i = 0; i < aBorrar.length; i += 6) {
  await Promise.all(aBorrar.slice(i, i + 6).map(async (x) => {
    const destino = path.join(dirRespaldo, x.ruta)
    if (fs.existsSync(destino)) { bajados++; return }
    const { data, error } = await supabase.storage.from('productos').download(x.ruta)
    if (error || !data) fallar(`No se pudo respaldar ${x.ruta}: ${error?.message}. No se borró nada.`)
    fs.mkdirSync(path.dirname(destino), { recursive: true })
    fs.writeFileSync(destino, Buffer.from(await data.arrayBuffer()))
    bajados++
  }))
}
console.log(`Respaldo listo: ${bajados} archivos en ${dirRespaldo}`)

// 2) borrado (solo si el respaldo completo salió bien)
let borrados = 0
for (let i = 0; i < aBorrar.length; i += 100) {
  const { error } = await supabase.storage.from('productos').remove(aBorrar.slice(i, i + 100).map((x) => x.ruta))
  if (error) fallar(`Error al borrar (se borraron ${borrados}): ${error.message}`)
  borrados += Math.min(100, aBorrar.length - i)
}
console.log(`✓ Borrados ${borrados} archivos (${mb(aBorrar)} MB). El respaldo quedó en ${dirRespaldo}.`)
