import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fmtMoney } from '../../lib/format'
import { precioVenta } from '../../lib/pricing'
import { syncToWoo } from '../../lib/wooSync'
import { syncMayorista } from '../../lib/mayoristaSync'
import ImageThumb from '../../components/ImageThumb'
import { useAuth } from '../../lib/AuthContext'

const SKU_RE = /^[A-Z]{3}[0-9]{6}(-V\d+)?$/

// Múltiplo mayorista sugerido para un producto: el que tiene cargado, o si está en
// "Auto" la misma regla que usa el portal (alto ≥ 30 cm → 3, el resto → 2).
function multiploDe(producto) {
  if (producto?.multiplo_mayorista) return Number(producto.multiplo_mayorista)
  return (Number(producto?.alto_producto) || 0) >= 30 ? 3 : 2
}

const field = { display: 'flex', flexDirection: 'column', gap: 4 }
const label = { fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }

export default function ComboForm({ initial, onCancel, onSaved, onAvanzado }) {
  const { orgId } = useAuth()
  const esNuevo = !initial?.id
  const [categorias, setCategorias] = useState([])
  const [subcategorias, setSubcategorias] = useState([])
  const [tiendas, setTiendas] = useState([])
  const [listas, setListas] = useState([])
  const [productos, setProductos] = useState([])
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)

  const [nombre, setNombre] = useState(initial?.nombre || '')
  const [sku, setSku] = useState(initial?.sku || '')
  const [categoriaId, setCategoriaId] = useState(initial?.categoria_id || '')
  const [subcategoriaId, setSubcategoriaId] = useState(initial?.subcategoria_id || '')
  const [imagenUrl, setImagenUrl] = useState(initial?.imagen_url || '')
  const [tiendasIds, setTiendasIds] = useState(initial?.tiendas_ids || [])
  const [activo, setActivo] = useState(initial?.activo !== false)
  const [enCatalogo, setEnCatalogo] = useState(initial?.mostrar_en_catalogo !== false)
  const [items, setItems] = useState(initial?.combo_items || [])

  // Buscador de productos para agregar al combo
  const [filtroCat, setFiltroCat] = useState('')
  const [filtroSub, setFiltroSub] = useState('')
  const [buscar, setBuscar] = useState('')

  useEffect(() => {
    Promise.all([
      supabase.from('categorias').select('*').order('nombre'),
      supabase.from('subcategorias').select('*').order('nombre'),
      supabase.from('tiendas').select('id, nombre, tipo, activa, url, webhook_secret, lista_id').eq('activa', true).order('created_at'),
      supabase.from('listas_precios').select('*').order('created_at'),
      supabase.from('productos').select('id, sku, nombre, imagen_url, costo_base, categoria_id, subcategoria_id, alto_producto, multiplo_mayorista, combo_items').order('sku'),
    ]).then(([c, s, t, l, p]) => {
      setCategorias(c.data || [])
      setSubcategorias(s.data || [])
      setTiendas(t.data || [])
      setListas(l.data || [])
      setProductos(p.data || [])
    })
  }, [])

  // El combo se guarda solo en categorías propias (las activadas por el Principal son de lectura).
  const categoriasCombo = useMemo(() => categorias.filter((c) => c.tipo_fabricacion === 'Combo' && c.org_id === orgId), [categorias, orgId])
  const catSel = useMemo(() => categorias.find((c) => c.id === Number(categoriaId)), [categorias, categoriaId])
  const esMayorista = !!catSel?.es_mayorista
  const subOpciones = useMemo(() => subcategorias.filter((s) => s.categoria_id === Number(categoriaId)), [subcategorias, categoriaId])

  // SKU automático al elegir categoría (si todavía no se tocó a mano)
  const handleCategoria = async (catId) => {
    setCategoriaId(catId)
    setSubcategoriaId('')
    const cat = categorias.find((c) => c.id === Number(catId))
    if (cat && esNuevo) {
      const { data } = await supabase.from('productos').select('sku').like('sku', `${cat.sku_prefijo}%`).order('sku', { ascending: false }).limit(1)
      const prefLen = (cat.sku_prefijo || '').length
      const lastNum = data?.length ? parseInt(data[0].sku.slice(prefLen)) : 0
      setSku(`${(cat.sku_prefijo || '').toUpperCase()}${String((isNaN(lastNum) ? 0 : lastNum) + 1).padStart(6, '0')}`)
    }
  }

  // ── Productos para elegir ──────────────────────────────────────────────────
  const subcategoriasFiltro = useMemo(() => subcategorias.filter((s) => s.categoria_id === Number(filtroCat)), [subcategorias, filtroCat])
  const productosDisponibles = useMemo(() => productos.filter((p) => !p.combo_items?.length && p.id !== initial?.id), [productos, initial])
  const productosFiltrados = useMemo(() => {
    let r = productosDisponibles
    if (filtroCat) r = r.filter((p) => p.categoria_id === Number(filtroCat))
    if (filtroSub) r = r.filter((p) => p.subcategoria_id === Number(filtroSub))
    const q = buscar.trim().toLowerCase()
    if (q) r = r.filter((p) => p.nombre.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q))
    return r
  }, [productosDisponibles, filtroCat, filtroSub, buscar])

  const detalle = useMemo(() => items.map((it) => {
    const prod = productos.find((p) => p.id === it.producto_id)
    return { ...it, prod, costo: (Number(prod?.costo_base) || 0) * (Number(it.cantidad) || 0) }
  }), [items, productos])
  const costoBase = useMemo(() => detalle.reduce((s, d) => s + d.costo, 0), [detalle])

  const agregar = (producto) => {
    // Portada del combo: si todavía no hay ninguna elegida, se toma la del
    // primer producto agregado (se puede cambiar después entre las fotos disponibles).
    setImagenUrl((prev) => prev || producto.imagen_url || '')
    setItems((prev) => {
      if (prev.find((it) => it.producto_id === producto.id)) return prev
      const cantidad = esMayorista ? multiploDe(producto) : 1
      return [...prev, { producto_id: producto.id, cantidad }]
    })
  }
  const cambiarCantidad = (productoId, cantidad) =>
    setItems((prev) => prev.map((it) => it.producto_id === productoId ? { ...it, cantidad: Math.max(1, Number(cantidad) || 1) } : it))
  const quitar = (productoId) => setItems((prev) => prev.filter((it) => it.producto_id !== productoId))

  // Fotos para elegir como portada del combo: las de los productos ya agregados.
  const fotosDisponibles = useMemo(
    () => [...new Set(detalle.map((d) => d.prod?.imagen_url).filter(Boolean))],
    [detalle],
  )

  const subirImagen = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const ext = file.name.split('.').pop()
    const path = `${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('productos').upload(path, file, { upsert: true })
    if (error) { alert('Error al subir la imagen: ' + error.message); setUploading(false); return }
    const { data } = supabase.storage.from('productos').getPublicUrl(path)
    setImagenUrl(data.publicUrl)
    setUploading(false)
  }

  const toggleTienda = (id) => {
    const sid = String(id)
    setTiendasIds((prev) => prev.map(String).includes(sid) ? prev.filter((x) => String(x) !== sid) : [...prev, sid])
  }

  const guardar = async () => {
    if (!nombre.trim()) return alert('Ingresá el nombre del combo.')
    if (!categoriaId) return alert('Elegí una categoría de combo (Configuración → Categorías → tipo Combo).')
    if (!SKU_RE.test(sku)) return alert('El SKU no es válido (3 letras + 6 números).')
    if (!items.length) return alert('Agregá al menos un producto al combo.')

    setSaving(true)
    const payload = {
      nombre: nombre.trim(), sku, categoria: 'Combo', categoria_id: Number(categoriaId),
      subcategoria_id: subcategoriaId ? Number(subcategoriaId) : null,
      imagen_url: imagenUrl || null, combo_items: items, costo_base: costoBase,
      tiendas_ids: tiendasIds, activo, mostrar_en_catalogo: enCatalogo, stock_actual: 0, usar_imagenes_compartidas: true,
    }
    const res = initial?.id
      ? await supabase.from('productos').update(payload).eq('id', initial.id)
      : await supabase.from('productos').insert(payload)
    setSaving(false)
    if (res.error) return alert('Error: ' + res.error.message)

    syncToWoo({ tiendas, listas, producto: { id: initial?.id, ...payload, categorias_web: [] } }).catch((err) => console.error('[wooSync]', err))
    syncMayorista({ skus: [sku] }).catch((err) => console.error('[mayoristaSync]', err))
    onSaved?.()
  }

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="modal" style={{ maxWidth: 900, width: '96vw' }}>
        <div className="modal-header">
          <h3 style={{ margin: 0 }}>{esNuevo ? '🧩 Nuevo combo' : `Editar combo — ${sku}`}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onCancel}>✕</button>
        </div>

        <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 18 }}>
          {/* ── Columna izquierda: datos básicos ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={field}>
              <label style={label}>Nombre</label>
              <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Combo 3 cuadros chicos" />
            </div>
            <div style={field}>
              <label style={label}>Categoría (de combo)</label>
              <select className="select" value={categoriaId} onChange={(e) => handleCategoria(e.target.value)}>
                <option value="">— Elegir —</option>
                {categoriasCombo.map((c) => <option key={c.id} value={c.id}>{c.nombre}{c.es_mayorista ? ' (mayorista)' : ''}</option>)}
              </select>
              {categoriasCombo.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--warning)' }}>No hay categorías de tipo Combo todavía — creá una en Configuración → Categorías.</div>
              )}
            </div>
            {subOpciones.length > 0 && (
              <div style={field}>
                <label style={label}>Subcategoría</label>
                <select className="select" value={subcategoriaId} onChange={(e) => setSubcategoriaId(e.target.value)}>
                  <option value="">— Sin subcategoría —</option>
                  {subOpciones.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                </select>
              </div>
            )}
            <div style={field}>
              <label style={label}>SKU</label>
              <input className="input" style={{ fontFamily: 'monospace' }} value={sku} onChange={(e) => setSku(e.target.value.toUpperCase())} />
            </div>

            <div style={field}>
              <label style={label}>Foto del combo</label>
              {imagenUrl && <ImageThumb src={imagenUrl} size={80} />}
              {fotosDisponibles.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {fotosDisponibles.map((url) => (
                    <button key={url} onClick={() => setImagenUrl(url)}
                      style={{ padding: 0, border: url === imagenUrl ? '2px solid var(--primary)' : '2px solid transparent', borderRadius: 6, cursor: 'pointer', background: 'none' }}>
                      <img src={url} alt="" style={{ width: 44, height: 44, objectFit: 'contain', borderRadius: 4, background: '#fff', display: 'block' }} />
                    </button>
                  ))}
                </div>
              )}
              <label className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', width: 'fit-content' }}>
                {uploading ? 'Subiendo...' : '📷 Subir otra foto'}
                <input type="file" accept="image/*" style={{ display: 'none' }} disabled={uploading} onChange={subirImagen} />
              </label>
            </div>

            <div style={field}>
              <label style={label}>Tiendas donde se vende</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {tiendas.map((t) => (
                  <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                    <input type="checkbox" checked={tiendasIds.map(String).includes(String(t.id))} onChange={() => toggleTienda(t.id)} />
                    {t.nombre}
                  </label>
                ))}
                {tiendas.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No hay tiendas activas.</div>}
              </div>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
              <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
              Activo
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
              <input type="checkbox" checked={enCatalogo} onChange={(e) => setEnCatalogo(e.target.checked)} />
              Mostrar en el catálogo público
            </label>

            {!esNuevo && (
              <button className="btn btn-sm btn-ghost" onClick={() => onAvanzado?.()}>⚙️ Opciones avanzadas (SEO, promociones, galería web...)</button>
            )}
          </div>

          {/* ── Columna derecha: armar el combo ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Productos del combo</div>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button className={`btn btn-sm${!filtroCat ? ' btn-primary' : ''}`} onClick={() => { setFiltroCat(''); setFiltroSub('') }}>Todas</button>
              {categorias.filter((c) => c.tipo_fabricacion !== 'Combo').map((c) => (
                <button key={c.id} className={`btn btn-sm${String(filtroCat) === String(c.id) ? ' btn-primary' : ''}`}
                  onClick={() => { setFiltroCat(c.id); setFiltroSub('') }}>{c.nombre}</button>
              ))}
            </div>
            {subcategoriasFiltro.length > 0 && (
              <select className="select" style={{ fontSize: 13, padding: '5px 8px' }} value={filtroSub} onChange={(e) => setFiltroSub(e.target.value)}>
                <option value="">Todas las subcategorías</option>
                {subcategoriasFiltro.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            )}
            <input className="input" placeholder="Buscar por nombre o SKU..." value={buscar} onChange={(e) => setBuscar(e.target.value)} />

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 8, maxHeight: 220, overflowY: 'auto', padding: 2 }}>
              {productosFiltrados.map((p) => {
                const yaAgregado = items.some((it) => it.producto_id === p.id)
                return (
                  <button key={p.id} onClick={() => agregar(p)} disabled={yaAgregado}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: 6, borderRadius: 8, cursor: yaAgregado ? 'default' : 'pointer',
                      border: yaAgregado ? '2px solid var(--primary)' : '1px solid var(--border)', background: yaAgregado ? 'var(--bg-highlight)' : 'var(--bg-card)', opacity: yaAgregado ? 0.7 : 1,
                    }}>
                    {p.imagen_url
                      ? <img src={p.imagen_url} alt="" style={{ width: 56, height: 56, objectFit: 'contain', borderRadius: 6, background: '#fff', border: '1px solid var(--border)', display: 'block' }} />
                      : <div style={{ width: 56, height: 56, borderRadius: 6, background: 'var(--bg-muted)' }} />}
                    <div style={{ fontSize: 11, textAlign: 'center', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>{p.nombre}</div>
                    <code style={{ fontSize: 10, color: 'var(--text-muted)' }}>{p.sku}</code>
                  </button>
                )
              })}
              {productosFiltrados.length === 0 && (
                <div style={{ gridColumn: '1/-1', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, padding: 10 }}>Sin resultados.</div>
              )}
            </div>

            <div style={{ height: 1, background: 'var(--border)' }} />

            {detalle.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: '14px 0' }}>Todavía no agregaste productos.</div>
            ) : (
              <table className="table">
                <thead><tr><th>Producto</th><th style={{ textAlign: 'right' }}>Cant.</th><th style={{ textAlign: 'right' }}>Costo</th><th></th></tr></thead>
                <tbody>
                  {detalle.map((d) => {
                    const opciones = esMayorista ? (() => { const m = multiploDe(d.prod); return [m, m * 2] })() : null
                    return (
                      <tr key={d.producto_id}>
                        <td style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {d.prod?.imagen_url ? <ImageThumb src={d.prod.imagen_url} size={30} /> : <div style={{ width: 30, height: 30, borderRadius: 4, background: 'var(--bg-muted)' }} />}
                          <div>
                            <strong style={{ fontSize: 13 }}>{d.prod?.nombre || '(producto eliminado)'}</strong>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{d.prod?.sku}</div>
                          </div>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {opciones ? (
                            <select className="select" style={{ padding: '4px 6px', fontSize: 13, width: 72 }} value={d.cantidad} onChange={(e) => cambiarCantidad(d.producto_id, e.target.value)}>
                              {[...new Set([...opciones, d.cantidad])].sort((a, b) => a - b).map((n) => <option key={n} value={n}>{n}</option>)}
                            </select>
                          ) : (
                            <input type="number" min={1} value={d.cantidad} onChange={(e) => cambiarCantidad(d.producto_id, e.target.value)}
                              className="input" style={{ width: 56, textAlign: 'right', padding: '4px 7px', fontSize: 13 }} />
                          )}
                        </td>
                        <td style={{ textAlign: 'right', fontSize: 13 }}>{fmtMoney(d.costo)}</td>
                        <td style={{ textAlign: 'right' }}>
                          <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => quitar(d.producto_id)}>Quitar</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}

            <div style={{ background: 'var(--bg-highlight)', border: '1px solid var(--primary)', borderRadius: 6, padding: '8px 10px' }}>
              <div style={{ fontSize: 11, color: 'var(--primary)', fontWeight: 600, textTransform: 'uppercase' }}>Costo base del combo</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--primary)' }}>{fmtMoney(costoBase)}</div>
            </div>
            {listas.length > 0 && costoBase > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 12 }}>
                {listas.map((l) => (
                  <div key={l.id} style={{ padding: '4px 8px', borderRadius: 6, background: 'var(--bg-muted)' }}>
                    <span style={{ color: 'var(--text-muted)' }}>{l.nombre}: </span>
                    <strong>{fmtMoney(precioVenta(costoBase, l))}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onCancel}>Cancelar</button>
          <button className="btn btn-primary" disabled={saving} onClick={guardar}>{saving ? 'Guardando...' : 'Guardar combo'}</button>
        </div>
      </div>
    </div>
  )
}
