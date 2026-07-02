import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { fmtMoney } from '../../lib/format'
import { precioVenta } from '../../lib/pricing'
import ImageThumb from '../../components/ImageThumb'
import { useAuth } from '../../lib/AuthContext'

let _k = 0
const newKey = () => `vi${++_k}`

function today() {
  return new Date().toISOString().slice(0, 10)
}

const inputStyle = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid var(--border)',
  borderRadius: 6,
  fontSize: 14,
  background: 'var(--surface)',
  color: 'inherit',
  boxSizing: 'border-box',
}

// ── ítem personalizado vacío ──────────────────────────────────────────────────
const blankCustom = { descripcion: '', cantidad: 1, precio_unitario: '' }

export default function NuevaVenta({ venta, onClose, onSaved }) {
  const { orgId } = useAuth()
  // datos de cabecera
  const [clienteNombre, setClienteNombre] = useState('')
  const [clienteId,     setClienteId]     = useState(null)
  const [listaSel,      setListaSel]       = useState('')
  const [fecha,         setFecha]          = useState(today())
  const [notas,         setNotas]          = useState('')
  const [estado,        setEstado]         = useState('pendiente')

  // items de la venta
  const [items, setItems] = useState([])

  // datos maestros
  const [listas,    setListas]    = useState([])
  const [clientes,  setClientes]  = useState([])
  const [productos, setProductos] = useState([])

  // búsqueda de productos
  const [search,        setSearch]        = useState('')
  const [searchResults, setSearchResults] = useState([])
  const searchRef = useRef(null)

  // ítem personalizado
  const [showCustom, setShowCustom] = useState(false)
  const [custom,     setCustom]     = useState({ ...blankCustom })
  const [customErr,  setCustomErr]  = useState('')

  // clientes autocomplete
  const [clienteSearch,   setClienteSearch]   = useState('')
  const [clienteResults,  setClienteResults]  = useState([])
  const [showClienteSug,  setShowClienteSug]  = useState(false)

  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  // ── carga inicial ──────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      supabase.from('listas_precios').select('*').order('created_at'),
      supabase.from('clientes').select('id, nombre, email, telefono').order('nombre'),
      supabase.from('productos').select('id, nombre, sku, costo_base, imagen_url, categoria_id').order('nombre'),
    ]).then(([l, c, p]) => {
      setListas(l.data ?? [])
      setClientes(c.data ?? [])
      setProductos(p.data ?? [])
    })
  }, [])

  // ── si es edición, cargar datos de la venta ────────────────────────────────
  useEffect(() => {
    if (!venta?.id) return
    setClienteNombre(venta.cliente_nombre ?? '')
    setClienteId(venta.cliente_id ?? null)
    setListaSel(venta.lista_id ?? '')
    setFecha(venta.fecha ?? today())
    setNotas(venta.notas ?? '')
    setEstado(venta.estado ?? 'pendiente')
    supabase.from('venta_items').select('*').eq('venta_id', venta.id).then(({ data }) => {
      setItems((data ?? []).map(i => ({ ...i, _key: newKey() })))
    })
  }, [venta])

  // ── lista de precios seleccionada ──────────────────────────────────────────
  const lista = useMemo(() => listas.find(l => l.id === listaSel), [listas, listaSel])

  // ── búsqueda de productos del catálogo ────────────────────────────────────
  useEffect(() => {
    const q = search.trim().toLowerCase()
    if (!q) { setSearchResults([]); return }
    setSearchResults(
      productos
        .filter(p =>
          p.nombre.toLowerCase().includes(q) ||
          (p.sku ?? '').toLowerCase().includes(q)
        )
        .slice(0, 10)
    )
  }, [search, productos])

  // ── sugerencias de clientes ───────────────────────────────────────────────
  useEffect(() => {
    const q = clienteSearch.trim().toLowerCase()
    if (!q) { setClienteResults([]); return }
    setClienteResults(
      clientes.filter(c => c.nombre.toLowerCase().includes(q)).slice(0, 6)
    )
  }, [clienteSearch, clientes])

  // ── total ─────────────────────────────────────────────────────────────────
  const total = useMemo(
    () => items.reduce((s, i) => s + (Number(i.precio_unitario) * Number(i.cantidad)), 0),
    [items]
  )

  // ── agregar producto del catálogo ─────────────────────────────────────────
  function agregarProducto(p) {
    const precio = precioVenta(Number(p.costo_base), lista)
    setItems(prev => {
      const idx = prev.findIndex(i => i.producto_id === p.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = { ...next[idx], cantidad: Number(next[idx].cantidad) + 1 }
        return next
      }
      return [...prev, {
        _key: newKey(),
        tipo: 'producto',
        producto_id: p.id,
        descripcion: p.nombre,
        sku: p.sku ?? '',
        cantidad: 1,
        precio_unitario: precio,
      }]
    })
    setSearch('')
    setSearchResults([])
    searchRef.current?.focus()
  }

  // ── agregar ítem personalizado ────────────────────────────────────────────
  function agregarCustom() {
    if (!custom.descripcion.trim()) { setCustomErr('Ingresá una descripción.'); return }
    if (!custom.precio_unitario || Number(custom.precio_unitario) <= 0) { setCustomErr('Ingresá un precio mayor a 0.'); return }
    setItems(prev => [...prev, {
      _key: newKey(),
      tipo: 'custom',
      producto_id: null,
      descripcion: custom.descripcion.trim(),
      sku: '',
      cantidad: Number(custom.cantidad) || 1,
      precio_unitario: Number(custom.precio_unitario),
    }])
    setCustom({ ...blankCustom })
    setCustomErr('')
    setShowCustom(false)
  }

  // ── modificar item existente ──────────────────────────────────────────────
  const updateItem = (key, field, value) =>
    setItems(prev => prev.map(i => i._key === key ? { ...i, [field]: value } : i))

  const removeItem = (key) =>
    setItems(prev => prev.filter(i => i._key !== key))

  // ── guardar ───────────────────────────────────────────────────────────────
  async function handleSave(estadoGuardar) {
    if (items.length === 0) { setError('Agregá al menos un producto.'); return }
    setSaving(true)
    setError('')

    const ventaPayload = {
      cliente_id:    clienteId ?? null,
      cliente_nombre: clienteNombre.trim() || null,
      lista_id:      listaSel || null,
      fecha,
      total,
      org_id: orgId,
      estado:        estadoGuardar ?? estado,
      notas:         notas.trim() || null,
    }

    let ventaId = venta?.id

    if (ventaId) {
      // Edición: actualizar cabecera y reemplazar items
      const { error: err } = await supabase.from('ventas').update(ventaPayload).eq('id', ventaId)
      if (err) { setError(err.message); setSaving(false); return }
      await supabase.from('venta_items').delete().eq('venta_id', ventaId)
    } else {
      // Nueva venta
      const { data, error: err } = await supabase.from('ventas').insert(ventaPayload).select().single()
      if (err) { setError(err.message); setSaving(false); return }
      ventaId = data.id
    }

    // Insertar items
    const itemsPayload = items.map(i => ({
      venta_id:       ventaId,
      tipo:           i.tipo,
      producto_id:    i.producto_id ?? null,
      descripcion:    i.descripcion,
      sku:            i.sku ?? '',
      cantidad:       Number(i.cantidad),
      precio_unitario: Number(i.precio_unitario),
      subtotal:       Number(i.cantidad) * Number(i.precio_unitario),
    }))

    const { error: errItems } = await supabase.from('venta_items').insert(itemsPayload)
    if (errItems) { setError(errItems.message); setSaving(false); return }

    setSaving(false)
    onSaved()
  }

  // ── teclado ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const titulo = venta?.id ? `Venta #${venta.numero ?? '—'}` : 'Nueva venta'

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 300,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'stretch', justifyContent: 'center',
      padding: 20,
    }}>
      <div style={{
        background: 'var(--bg)',
        borderRadius: 12,
        width: '100%',
        maxWidth: 900,
        display: 'flex',
        flexDirection: 'column',
        maxHeight: '100%',
        boxShadow: '0 16px 48px rgba(0,0,0,0.3)',
      }}>

        {/* ── cabecera del modal ── */}
        <div style={{ padding: '18px 24px 14px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 18 }}>{titulo}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: 'var(--text-muted)', lineHeight: 1 }}>×</button>
        </div>

        {/* ── cuerpo (scrollable) ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 24px', display: 'flex', gap: 20, flexWrap: 'wrap' }}>

          {/* ── Columna izquierda: datos + productos ── */}
          <div style={{ flex: '1 1 480px', display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Datos de cabecera */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>DATOS DE LA VENTA</div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                {/* Cliente con autocomplete */}
                <div style={{ position: 'relative' }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>Cliente</label>
                  <input
                    style={inputStyle}
                    value={clienteNombre}
                    onChange={e => {
                      setClienteNombre(e.target.value)
                      setClienteSearch(e.target.value)
                      setClienteId(null)
                      setShowClienteSug(true)
                    }}
                    onBlur={() => setTimeout(() => setShowClienteSug(false), 150)}
                    placeholder="Nombre o buscar..."
                  />
                  {showClienteSug && clienteResults.length > 0 && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, zIndex: 50, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', marginTop: 2 }}>
                      {clienteResults.map(c => (
                        <div
                          key={c.id}
                          onMouseDown={() => {
                            setClienteNombre(c.nombre)
                            setClienteId(c.id)
                            setShowClienteSug(false)
                          }}
                          style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid var(--border)' }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--surface)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                          <strong>{c.nombre}</strong>
                          {c.telefono && <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: 11 }}>{c.telefono}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Fecha */}
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>Fecha</label>
                  <input style={inputStyle} type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {/* Lista de precios */}
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>Lista de precios</label>
                  <select style={inputStyle} value={listaSel} onChange={e => setListaSel(e.target.value)}>
                    <option value="">Sin lista (precio manual)</option>
                    {listas.map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}
                  </select>
                </div>

                {/* Estado */}
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>Estado</label>
                  <select style={inputStyle} value={estado} onChange={e => setEstado(e.target.value)}>
                    <option value="pendiente">Pendiente de cobro</option>
                    <option value="pagado">Pagado</option>
                    <option value="cancelado">Cancelado</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Buscar productos del catálogo */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-muted)', marginBottom: 10 }}>AGREGAR PRODUCTOS</div>
              {!lista && (
                <div style={{ fontSize: 12, color: '#d97706', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 6, padding: '6px 10px', marginBottom: 10 }}>
                  ⚠️ Sin lista de precios — los productos se agregan al costo base. Podés editarlo manualmente.
                </div>
              )}
              <div style={{ position: 'relative' }}>
                <input
                  ref={searchRef}
                  style={inputStyle}
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="🔍  Buscar por nombre o SKU..."
                  autoFocus
                />
                {searchResults.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, zIndex: 50, boxShadow: '0 6px 20px rgba(0,0,0,0.12)', marginTop: 4, maxHeight: 280, overflowY: 'auto' }}>
                    {searchResults.map(p => {
                      const precio = precioVenta(Number(p.costo_base), lista)
                      return (
                        <div
                          key={p.id}
                          onClick={() => agregarProducto(p)}
                          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--surface)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                          {p.imagen_url
                            ? <ImageThumb src={p.imagen_url} size={36} />
                            : <div style={{ width: 36, height: 36, borderRadius: 4, background: 'var(--bg-muted)', flexShrink: 0 }} />
                          }
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.nombre}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.sku}</div>
                          </div>
                          <div style={{ fontWeight: 700, color: 'var(--primary)', fontSize: 14, flexShrink: 0 }}>{fmtMoney(precio)}</div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Botón ítem personalizado */}
              <button
                onClick={() => { setShowCustom(v => !v); setCustomErr('') }}
                style={{ marginTop: 10, padding: '7px 14px', background: 'transparent', border: '1px dashed var(--border)', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: 'var(--text-muted)', width: '100%' }}
              >
                {showCustom ? '— Cerrar ítem personalizado' : '+ Agregar ítem personalizado (corte especial, servicio, etc.)'}
              </button>

              {showCustom && (
                <div style={{ marginTop: 10, padding: 12, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 3 }}>Descripción</label>
                      <input style={inputStyle} value={custom.descripcion} onChange={e => setCustom(p => ({ ...p, descripcion: e.target.value }))} placeholder="Ej: Corte especial 30x40" />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 3 }}>Cantidad</label>
                      <input style={inputStyle} type="number" min="0.001" step="0.001" value={custom.cantidad} onChange={e => setCustom(p => ({ ...p, cantidad: e.target.value }))} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 3 }}>Precio unit. ($)</label>
                      <input style={inputStyle} type="number" min="0" value={custom.precio_unitario} onChange={e => setCustom(p => ({ ...p, precio_unitario: e.target.value }))} placeholder="0" />
                    </div>
                  </div>
                  {customErr && <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 6 }}>{customErr}</div>}
                  <button
                    onClick={agregarCustom}
                    style={{ padding: '7px 16px', background: 'var(--primary)', border: 'none', borderRadius: 6, color: 'white', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
                  >
                    Agregar
                  </button>
                </div>
              )}
            </div>

            {/* Notas */}
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>Notas internas</label>
              <textarea
                style={{ ...inputStyle, height: 60, resize: 'vertical' }}
                value={notas}
                onChange={e => setNotas(e.target.value)}
                placeholder="Observaciones, condiciones de pago, entrega…"
              />
            </div>
          </div>

          {/* ── Columna derecha: items + total ── */}
          <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-muted)' }}>
              ITEMS ({items.length})
            </div>

            {items.length === 0 ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px dashed var(--border)', borderRadius: 8, color: 'var(--text-muted)', fontSize: 13, padding: 40, textAlign: 'center' }}>
                Buscá un producto o agregá<br />un ítem personalizado
              </div>
            ) : (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto' }}>
                {items.map(item => (
                  <ItemRow
                    key={item._key}
                    item={item}
                    onChange={(field, val) => updateItem(item._key, field, val)}
                    onRemove={() => removeItem(item._key)}
                  />
                ))}
              </div>
            )}

            {/* Total */}
            {items.length > 0 && (
              <div style={{ background: 'var(--surface)', border: '2px solid var(--border)', borderRadius: 8, padding: '14px 16px', marginTop: 4 }}>
                {items.map(item => (
                  <div key={item._key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>{item.descripcion}</span>
                    <span style={{ flexShrink: 0, marginLeft: 8 }}>
                      {item.cantidad} × {fmtMoney(item.precio_unitario)} = <strong style={{ color: 'var(--text)' }}>{fmtMoney(Number(item.cantidad) * Number(item.precio_unitario))}</strong>
                    </span>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 20, paddingTop: 10, marginTop: 6, borderTop: '2px solid var(--border)', color: 'var(--primary)' }}>
                  <span>TOTAL</span>
                  <span>{fmtMoney(total)}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── pie del modal ── */}
        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          {error && <div style={{ fontSize: 13, color: '#ef4444', flex: 1 }}>{error}</div>}
          {!error && <div style={{ flex: 1 }} />}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} disabled={saving} style={{ padding: '9px 18px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', fontSize: 14 }}>
              Cancelar
            </button>
            <button
              onClick={() => handleSave('pendiente')}
              disabled={saving}
              style={{ padding: '9px 18px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', fontSize: 14, fontWeight: 500 }}
            >
              {saving ? 'Guardando…' : 'Guardar pendiente'}
            </button>
            <button
              onClick={() => handleSave('pagado')}
              disabled={saving}
              style={{ padding: '9px 20px', background: 'var(--primary)', border: 'none', borderRadius: 6, color: 'white', cursor: 'pointer', fontSize: 14, fontWeight: 700 }}
            >
              {saving ? 'Guardando…' : '✓ Guardar como pagado'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── fila de item editable ──────────────────────────────────────────────────────
function ItemRow({ item, onChange, onRemove }) {
  const subtotal = Number(item.cantidad) * Number(item.precio_unitario)
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 1 }}>{item.descripcion}</div>
          {item.sku && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.sku}</div>}
          {item.tipo === 'custom' && (
            <span style={{ fontSize: 10, fontWeight: 600, background: '#f1f5f9', color: '#64748b', padding: '1px 6px', borderRadius: 4 }}>
              PERSONALIZADO
            </span>
          )}
        </div>
        <button
          onClick={onRemove}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 18, lineHeight: 1, padding: '0 2px', flexShrink: 0 }}
        >
          ×
        </button>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ flex: '0 0 80px' }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>CANT.</div>
          <input
            type="number"
            min="0.001"
            step="0.001"
            value={item.cantidad}
            onChange={e => onChange('cantidad', e.target.value)}
            style={{ width: '100%', padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 5, fontSize: 13, background: 'var(--bg)', color: 'inherit', textAlign: 'right' }}
          />
        </div>
        <div style={{ flex: '0 0 100px' }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>PRECIO UNIT.</div>
          <input
            type="number"
            min="0"
            value={item.precio_unitario}
            onChange={e => onChange('precio_unitario', e.target.value)}
            style={{ width: '100%', padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 5, fontSize: 13, background: 'var(--bg)', color: 'inherit', textAlign: 'right' }}
          />
        </div>
        <div style={{ flex: 1, textAlign: 'right' }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>SUBTOTAL</div>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--primary)' }}>{fmtMoney(subtotal)}</div>
        </div>
      </div>
    </div>
  )
}
