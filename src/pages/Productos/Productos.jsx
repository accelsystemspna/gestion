import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fmtMoney } from '../../lib/format'
import { precioVenta } from '../../lib/pricing'
import ProductoForm from './ProductoForm'
import BarcodeModal from './BarcodeModal'
import ImageThumb from '../../components/ImageThumb'
import { exportCatalogoPDF } from '../../lib/pdf'
import { exportCatalogoCSV } from '../../lib/csv'

export default function Productos() {
  const [items, setItems] = useState([])
  const [listas, setListas] = useState([])
  const [categorias, setCategorias] = useState([])
  const [subcategorias, setSubcategorias] = useState([])
  const [rubros, setRubros] = useState([])
  const [branding, setBranding] = useState({})
  const [listaSel, setListaSel] = useState('')
  const [rubrosSel, setRubrosSel] = useState([])   // array de IDs (multi)
  const [categoriaSel, setCategoriaSel] = useState('')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null)
  const [formKey, setFormKey] = useState(0)
  const [loading, setLoading] = useState(true)
  const [exportModal, setExportModal] = useState(null)  // null | 'pdf' | 'csv'
  const [sortCol, setSortCol]   = useState('sku')       // columna activa
  const [sortDir, setSortDir]   = useState('asc')       // 'asc' | 'desc'
  const [mostrarInactivos, setMostrarInactivos] = useState(false)
  const [barcodeProduct, setBarcodeProduct] = useState(null)
  const [exportingPDF, setExportingPDF] = useState(false)
  const [exportingCSV, setExportingCSV] = useState(false)

  const load = async () => {
    setLoading(true)
    const [p, l, c, br, r, sc] = await Promise.all([
      supabase.from('productos').select('*').order('created_at', { ascending: false }),
      supabase.from('listas_precios').select('*').order('created_at'),
      supabase.from('categorias').select('*').order('nombre'),
      supabase.from('branding').select('*').eq('id', 1).maybeSingle(),
      supabase.from('rubros').select('*').order('created_at'),
      supabase.from('subcategorias').select('*').order('nombre'),
    ])
    setItems(p.data || [])
    setListas(l.data || [])
    setCategorias(c.data || [])
    setBranding(br.data || {})
    setRubros(r.data || [])
    setSubcategorias(sc.data || [])
    // no auto-select: user must choose a list explicitly
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const lista = useMemo(() => listas.find((l) => l.id === listaSel), [listas, listaSel])

  const toggleRubro = (id) => {
    const sid = String(id)
    setRubrosSel((prev) => {
      const next = prev.includes(sid) ? prev.filter((x) => x !== sid) : [...prev, sid]
      // Si la categoría seleccionada ya no pertenece a ningún rubro activo, la limpiamos
      if (next.length > 0 && categoriaSel) {
        const cat = categorias.find((c) => String(c.id) === String(categoriaSel))
        if (cat && !next.includes(String(cat.rubro_id))) setCategoriaSel('')
      }
      return next
    })
  }

  // Categorías del dropdown filtradas por rubros activos
  const categoriasFiltradas = useMemo(() => {
    if (rubrosSel.length === 0) return categorias
    return categorias.filter((c) => rubrosSel.includes(String(c.rubro_id)))
  }, [categorias, rubrosSel])

  const filtrados = useMemo(() => {
    let result = items
    if (rubrosSel.length > 0) {
      const catIds = categorias
        .filter((c) => rubrosSel.includes(String(c.rubro_id)))
        .map((c) => c.id)
      result = result.filter((p) => catIds.includes(p.categoria_id))
    }
    if (categoriaSel) result = result.filter((p) => String(p.categoria_id) === String(categoriaSel))
    const q = search.trim().toLowerCase()
    if (q) result = result.filter(
      (p) => p.nombre.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q) || (p.descripcion || '').toLowerCase().includes(q)
    )
    if (!mostrarInactivos) result = result.filter((p) => p.activo !== false)
    return result
  }, [items, search, categoriaSel, rubrosSel, categorias, mostrarInactivos])

  const ordenados = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1
    return [...filtrados].sort((a, b) => {
      let va = '', vb = ''
      if (sortCol === 'sku') {
        va = a.sku || ''; vb = b.sku || ''
      } else if (sortCol === 'nombre') {
        va = a.nombre || ''; vb = b.nombre || ''
      } else if (sortCol === 'rubro') {
        const catA = categorias.find((c) => c.id === a.categoria_id)
        const catB = categorias.find((c) => c.id === b.categoria_id)
        const rubroA = catA?.rubro_id ? rubros.find((r) => r.id === catA.rubro_id) : null
        const rubroB = catB?.rubro_id ? rubros.find((r) => r.id === catB.rubro_id) : null
        va = rubroA?.nombre || ''; vb = rubroB?.nombre || ''
      } else if (sortCol === 'categoria') {
        const catA = categorias.find((c) => c.id === a.categoria_id)
        const catB = categorias.find((c) => c.id === b.categoria_id)
        va = catA?.nombre || ''; vb = catB?.nombre || ''
      }
      return va.localeCompare(vb, 'es', { sensitivity: 'base' }) * dir
    })
  }, [filtrados, sortCol, sortDir, categorias, rubros])

  const toggleSort = (col) => {
    if (sortCol === col) setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const handleToggleActivo = async (id, currentActivo) => {
    const nuevoEstado = currentActivo === false ? true : false
    const { error } = await supabase.from('productos').update({ activo: nuevoEstado }).eq('id', id)
    if (error) alert('Error: ' + error.message)
    else setItems((prev) => prev.map((p) => p.id === id ? { ...p, activo: nuevoEstado } : p))
  }

  const handleDelete = async (id) => {
    if (!confirm('¿Eliminar este producto?')) return
    const { error } = await supabase.from('productos').delete().eq('id', id)
    if (error) alert('Error: ' + error.message)
    else load()
  }

  const getCatLabel = () => categoriaSel
    ? categorias.find((c) => String(c.id) === String(categoriaSel))?.nombre
    : rubrosSel.length > 0
      ? rubros.filter((r) => rubrosSel.includes(String(r.id))).map((r) => r.nombre).join(', ')
      : ''

  const handleExportPDF = async (opts) => {
    setExportingPDF(true)
    setExportModal(null)
    await exportCatalogoPDF({ productos: filtrados, lista, categoriaLabel: getCatLabel(), branding, categorias, subcategorias, opts })
    setExportingPDF(false)
  }

  const handleExportCSV = (opts) => {
    setExportModal(null)
    exportCatalogoCSV(filtrados, lista, categorias, precioVenta, opts)
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 24, marginBottom: 4 }}>Productos</h1>
          <p style={{ color: 'var(--text-muted)' }}>Catálogo con cálculo de costos automático</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={() => { setFormKey(k => k + 1); setEditing({}) }}>+ Nuevo producto</button>
          <button
            className="btn"
            onClick={() => setExportModal('pdf')}
            disabled={exportingPDF || filtrados.length === 0}
          >
            {exportingPDF ? 'Generando…' : '📄 Catálogo PDF'}
          </button>
          <button
            className="btn"
            onClick={() => setExportModal('csv')}
            disabled={filtrados.length === 0}
          >
            📊 Exportar CSV
          </button>
        </div>
      </div>

      {/* Filtro de rubros — chips multi-selección */}
      {rubros.length > 0 && (
        <div className="card" style={{ padding: '10px 16px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginRight: 2, whiteSpace: 'nowrap' }}>Rubros:</span>

          {/* Chip "Todos" */}
          <button
            className="btn btn-sm"
            onClick={() => { setRubrosSel([]); setCategoriaSel('') }}
            style={{
              borderColor: rubrosSel.length === 0 ? 'var(--primary)' : 'var(--border)',
              background: rubrosSel.length === 0 ? '#e0f2fe' : 'white',
              color: rubrosSel.length === 0 ? 'var(--primary)' : 'var(--text-muted)',
              fontWeight: rubrosSel.length === 0 ? 700 : 400,
            }}
          >
            Todos
          </button>

          {rubros.map((r) => {
            const sel = rubrosSel.includes(String(r.id))
            return (
              <button
                key={r.id}
                className="btn btn-sm"
                onClick={() => toggleRubro(r.id)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  borderColor: sel ? r.color : 'var(--border)',
                  background: sel ? `${r.color}18` : 'white',
                  color: sel ? r.color : 'var(--text-muted)',
                  fontWeight: sel ? 700 : 400,
                  position: 'relative',
                }}
              >
                {r.emoji && <span style={{ fontSize: 14 }}>{r.emoji}</span>}
                {r.nombre}
                {sel && (
                  <span style={{
                    width: 16, height: 16, borderRadius: '50%',
                    background: r.color, color: 'white',
                    fontSize: 10, fontWeight: 800,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    marginLeft: 2,
                  }}>✓</span>
                )}
              </button>
            )
          })}

          {rubrosSel.length > 0 && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 4 }}>
              {filtrados.length} producto{filtrados.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}

      {/* Filtros secundarios */}
      <div className="card" style={{ padding: 16, marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          className="input"
          placeholder="Buscar por nombre, SKU o descripción..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 200 }}
        />
        <select
          className="select"
          value={categoriaSel}
          onChange={(e) => setCategoriaSel(e.target.value)}
          style={{ width: 'auto' }}
        >
          <option value="">Todas las categorías</option>
          {categoriasFiltradas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <select
          className="select"
          value={listaSel}
          onChange={(e) => setListaSel(e.target.value)}
          style={{ width: 'auto', borderColor: !listaSel ? 'var(--warning)' : undefined }}
        >
          <option value="">— Elegir lista de precios —</option>
          {listas.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
        </select>
        {/* Toggle mostrar inactivos */}
        <button
          className="btn btn-sm"
          onClick={() => setMostrarInactivos((v) => !v)}
          style={{
            borderColor: mostrarInactivos ? '#fca5a5' : 'var(--border)',
            background: mostrarInactivos ? '#fff1f2' : 'white',
            color: mostrarInactivos ? '#dc2626' : 'var(--text-muted)',
            fontWeight: mostrarInactivos ? 700 : 400,
            whiteSpace: 'nowrap',
          }}
        >
          {mostrarInactivos ? '● Mostrando inactivos' : '○ Ver inactivos'}
        </button>
      </div>

      {!listaSel && listas.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--warning-bg)', border: '1px solid var(--warning-border)', borderRadius: 8, padding: '10px 16px', marginBottom: 12 }}>
          <span style={{ fontSize: 18, lineHeight: 1 }}>⚠️</span>
          <span style={{ fontWeight: 600, color: 'var(--warning)', fontSize: 13 }}>
            Seleccioná una lista de precios para ver los precios de venta.
          </span>
        </div>
      )}

      {loading ? (
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>Cargando...</div>
      ) : filtrados.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
          {items.length === 0 ? 'No hay productos. Creá el primero.' : 'No hay productos que coincidan con los filtros.'}
        </div>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 40 }}></th>
                {[
                  { col: 'sku',       label: 'SKU' },
                  { col: 'nombre',    label: 'Nombre' },
                ].map(({ col, label }) => (
                  <th
                    key={col}
                    onClick={() => toggleSort(col)}
                    style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      {label}
                      <span style={{ fontSize: 11, opacity: sortCol === col ? 1 : 0.3, color: sortCol === col ? 'var(--primary)' : 'inherit' }}>
                        {sortCol === col ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
                      </span>
                    </span>
                  </th>
                ))}
                <th style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>
                  <div style={{ fontSize: 12 }}>Medida</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400 }}>alto × ancho</div>
                </th>
                {[
                  { col: 'rubro',     label: 'Rubro' },
                  { col: 'categoria', label: 'Categoría' },
                ].map(({ col, label }) => (
                  <th
                    key={col}
                    onClick={() => toggleSort(col)}
                    style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      {label}
                      <span style={{ fontSize: 11, opacity: sortCol === col ? 1 : 0.3, color: sortCol === col ? 'var(--primary)' : 'inherit' }}>
                        {sortCol === col ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
                      </span>
                    </span>
                  </th>
                ))}
                <th style={{ textAlign: 'right' }}>Precio</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {ordenados.map((p) => {
                const venta   = precioVenta(Number(p.costo_base), lista)
                const cat     = categorias.find((c) => c.id === p.categoria_id)
                const rubro   = cat?.rubro_id ? rubros.find((r) => r.id === cat.rubro_id) : null
                const activo  = p.activo !== false
                return (
                  <tr key={p.id} style={activo ? undefined : { opacity: 0.55, background: '#fafafa' }}>
                    <td style={{ padding: '6px 8px', width: 48 }}>
                      <ImageThumb src={p.imagen_url} size={40} />
                    </td>
                    <td><code style={{ fontSize: 12 }}>{p.sku}</code></td>
                    <td>
                      <strong>{p.nombre}</strong>
                      {p.descripcion && (
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                          {p.descripcion.length > 60 ? p.descripcion.slice(0, 60) + '…' : p.descripcion}
                        </div>
                      )}
                    </td>
                    <td style={{ whiteSpace: 'nowrap', fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
                      {p.alto_producto && p.ancho_producto
                        ? <span>{p.alto_producto} × {p.ancho_producto} <span style={{ fontSize: 11 }}>cm</span></span>
                        : p.alto_producto
                        ? <span>{p.alto_producto} <span style={{ fontSize: 11 }}>cm alt.</span></span>
                        : p.ancho_producto
                        ? <span>{p.ancho_producto} <span style={{ fontSize: 11 }}>cm anch.</span></span>
                        : <span style={{ opacity: 0.35 }}>—</span>
                      }
                    </td>
                    <td>
                      {rubro ? (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          fontSize: 12, padding: '2px 8px', borderRadius: 999,
                          background: `${rubro.color}18`, color: rubro.color,
                          border: `1px solid ${rubro.color}44`, fontWeight: 600,
                        }}>
                          {rubro.emoji && <span style={{ fontSize: 13 }}>{rubro.emoji}</span>}
                          {rubro.nombre}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
                      )}
                    </td>
                    <td>
                      {cat
                        ? <span className="badge">{cat.nombre}</span>
                        : <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
                      }
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600, fontSize: 15, color: lista ? 'var(--success)' : 'var(--text-muted)' }}>
                      {lista ? fmtMoney(venta) : '—'}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {/* Pill de estado — click rápido para toggle */}
                      <button
                        className="btn btn-sm"
                        title={activo ? 'Click para desactivar' : 'Click para activar'}
                        onClick={() => handleToggleActivo(p.id, p.activo)}
                        style={{
                          fontSize: 11, padding: '2px 8px', marginRight: 4,
                          background: activo ? '#f0fdf4' : '#fff1f2',
                          color: activo ? '#16a34a' : '#dc2626',
                          border: `1px solid ${activo ? '#86efac' : '#fca5a5'}`,
                          fontWeight: 700,
                        }}
                      >
                        {activo ? '● Activo' : '● Inactivo'}
                      </button>
                      <button className="btn btn-sm btn-ghost" title="Generar etiqueta con código de barras" onClick={() => setBarcodeProduct(p)}>🏷️</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => { setFormKey(k => k + 1); setEditing(p) }}>Editar</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => handleDelete(p.id)} style={{ color: 'var(--danger)' }}>Eliminar</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {barcodeProduct && (
        <BarcodeModal
          producto={barcodeProduct}
          lista={lista}
          branding={branding}
          onClose={() => setBarcodeProduct(null)}
        />
      )}

      {exportModal && (
        <ExportModal
          mode={exportModal}
          tieneLista={!!lista}
          onCancel={() => setExportModal(null)}
          onExport={exportModal === 'pdf' ? handleExportPDF : handleExportCSV}
        />
      )}

      {editing && (
        <ProductoForm
          key={formKey}
          initial={Object.keys(editing).length > 0 ? editing : null}
          onCancel={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
          onSavedNext={() => load()}
          onSavedVariant={(variantData) => { load(); setFormKey(k => k + 1); setEditing(variantData) }}
        />
      )}
    </div>
  )
}

// ─── Modal de opciones de exportación ────────────────────────────────────────
const defaultOpts = {
  mostrarCategorias:    true,
  mostrarSubcategorias: true,
  mostrarNombre:        true,
  mostrarSku:           true,
  mostrarDimensiones:   true,
  mostrarPrecio:        true,
  columnas:             3,
}

function ExportModal({ mode, tieneLista, onCancel, onExport }) {
  const [opts, setOpts] = useState({ ...defaultOpts })
  const toggle = (k) => setOpts((o) => ({ ...o, [k]: !o[k] }))

  const isPdf = mode === 'pdf'

  const Row = ({ label, desc, field }) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{label}</div>
        {desc && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{desc}</div>}
      </div>
      <button
        onClick={() => toggle(field)}
        style={{
          width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
          background: opts[field] ? 'var(--primary)' : '#cbd5e1',
          position: 'relative', flexShrink: 0, transition: 'background 0.2s',
        }}
      >
        <span style={{
          position: 'absolute', top: 3,
          left: opts[field] ? 22 : 4,
          width: 18, height: 18, borderRadius: 9,
          background: 'white', transition: 'left 0.2s',
        }} />
      </button>
    </div>
  )

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <h3 style={{ fontSize: 16 }}>
            {isPdf ? '📄 Opciones del catálogo PDF' : '📊 Opciones de exportación CSV'}
          </h3>
          <button className="btn btn-ghost btn-sm" onClick={onCancel}>✕</button>
        </div>

        <div className="modal-body" style={{ padding: '0 20px' }}>
          {isPdf && (
            <>
              <Row label="Encabezado de categoría"    desc="Banda oscura con el nombre del rubro/categoría"  field="mostrarCategorias" />
              <Row label="Encabezado de subcategoría" desc="Línea divisora con el nombre de subcategoría"    field="mostrarSubcategorias" />
              <Row label="Nombre del producto"         desc="Nombre visible debajo del SKU en cada card"     field="mostrarNombre" />
              <Row label="SKU en cada card"            desc="Código del producto en la parte superior"        field="mostrarSku" />
              <Row label="Dimensiones"                 desc="Ancho × alto del producto"                      field="mostrarDimensiones" />
              <Row label="Precio"                      desc={tieneLista ? 'Precio según la lista seleccionada' : 'No hay lista seleccionada — no se mostrará precio'} field="mostrarPrecio" />

              {/* Selector de columnas */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>Columnas por fila</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>Cards por fila en la grilla</div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[2, 3].map((n) => (
                    <button
                      key={n}
                      onClick={() => setOpts((o) => ({ ...o, columnas: n }))}
                      className="btn btn-sm"
                      style={{
                        minWidth: 36,
                        background: opts.columnas === n ? 'var(--primary)' : undefined,
                        color:      opts.columnas === n ? 'white'          : undefined,
                        borderColor: opts.columnas === n ? 'var(--primary)' : undefined,
                        fontWeight: opts.columnas === n ? 700 : 400,
                      }}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {!isPdf && (
            <div style={{ padding: '12px 0', color: 'var(--text-muted)', fontSize: 13 }}>
              El CSV incluye todas las columnas (SKU, SKU base, nombre, categoría, precio, dimensiones, imagen).
              Las variantes se agrupan junto a su producto base.
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onCancel}>Cancelar</button>
          <button className="btn btn-primary" onClick={() => onExport(opts)}>
            {isPdf ? '📄 Generar PDF' : '📊 Descargar CSV'}
          </button>
        </div>
      </div>
    </div>
  )
}
