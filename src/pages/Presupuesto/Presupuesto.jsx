import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { fmtMoney } from '../../lib/format'
import { calcInsumo, precioVenta } from '../../lib/pricing'
import ImageThumb from '../../components/ImageThumb'
import { exportPresupuestoPDF } from '../../lib/pdf'

const blankPieza = { material_id: '', ancho: '', alto: '', cantidad: 1, gramos: '', metros: '', incremento: '' }
const blankTarifaSel = { tarifa_id: '', fab_minutos: '', fab_segundos: '', incremento: '' }

function snapSegs(segs) {
  const s = Number(segs) || 0
  if (s === 0) return { segs: 0, extraMins: 0 }
  const r = Math.ceil(s / 15) * 15
  return r >= 60 ? { segs: 0, extraMins: 1 } : { segs: r, extraMins: 0 }
}

const calcMatCost = calcInsumo

function calcTarCost(tar, ts) {
  if (!tar) return 0
  const h = ((Number(ts.fab_minutos) || 0) * 60 + (Number(ts.fab_segundos) || 0)) / 3600
  return h * (Number(tar.costo_hora) || 0)
}

let _kc = 0
const newKey = () => `k${++_kc}`

// ── Helpers de layout (FUERA del componente para evitar re-mount en cada render) ──
function F({ label, col, children }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:3, ...(col && { gridColumn:`span ${col}` }) }}>
      <label style={{ fontSize:12, fontWeight:600, color:'var(--text-muted)', lineHeight:1.2 }}>{label}</label>
      {children}
    </div>
  )
}
const si = (extra = {}) => ({ padding:'6px 9px', fontSize:14, ...extra })
const colStyle = {
  overflowY: 'auto',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: '14px 16px',
}
const secLabel = (txt) => (
  <div style={{ fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em', paddingBottom:5, borderBottom:'1px solid var(--border)', flexShrink:0 }}>{txt}</div>
)
const subLabel = (txt) => (
  <div style={{ fontSize:12, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em' }}>{txt}</div>
)

export default function Presupuesto() {
  const navigate = useNavigate()
  const [listas, setListas] = useState([])
  const [productos, setProductos] = useState([])
  const [materiales, setMateriales] = useState([])
  const [tarifas, setTarifas] = useState([])
  const [clientes, setClientes] = useState([])
  const [cliCargando, setCliCargando] = useState(true)
  const [branding, setBranding] = useState(null)

  // Cabecera
  const [cliente, setCliente] = useState('')
  const [cliInputFocused,  setCliInputFocused]  = useState(false)
  const [cliSeleccionado,  setCliSeleccionado]  = useState(null)
  const [reexportandoId,   setReexportandoId]   = useState(null)
  const [cliDropRect,      setCliDropRect]      = useState(null)
  const cliInputRef = useRef(null)
  const [listaSel, setListaSel] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [cantidad, setCantidad] = useState(1)
  const [notas, setNotas] = useState('')
  const [validez, setValidez] = useState('15 días')

  // Trabajo a medida (inline)
  const [piezas, setPiezas] = useState([{ ...blankPieza }])
  const [tarifasSel, setTarifasSel] = useState([{ ...blankTarifaSel }])
  const [expPiezas, setExpPiezas] = useState({ 0: true })
  const [expTarifas, setExpTarifas] = useState({ 0: true })

  // Productos de catálogo adicionales
  const [extras, setExtras] = useState([])
  const [search, setSearch] = useState('')
  const [showCatalogo, setShowCatalogo] = useState(false)

  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)

  // Historial de presupuestos
  const [showHistorial,  setShowHistorial]  = useState(false)
  const [historial,      setHistorial]      = useState([])
  const [histLoading,    setHistLoading]    = useState(false)

  useEffect(() => {
    Promise.all([
      supabase.from('listas_precios').select('*').order('created_at'),
      supabase.from('productos').select('*').order('nombre'),
      supabase.from('materiales').select('*').order('nombre'),
      supabase.from('tarifas').select('*').order('id'),
      supabase.from('branding').select('*').eq('id', 1).maybeSingle(),
    ]).then(([li, pr, ma, ta, br]) => {
      setListas(li.data || [])
      setProductos(pr.data || [])
      setMateriales(ma.data || [])
      setTarifas(ta.data || [])
      setBranding(br.data || {})
    })

    // Cargar clientes por separado con fallback:
    // intenta con lista_id (disponible tras la migración SQL),
    // si falla (columna aún no existe) carga sólo id + nombre
    supabase.from('clientes').select('id, nombre, lista_id').order('nombre')
      .then(({ data, error }) => {
        if (error) {
          console.warn('[Presupuesto] lista_id no existe aún, cargando sin ella:', error.message)
          return supabase.from('clientes').select('id, nombre').order('nombre')
        }
        return { data, error: null }
      })
      .then(({ data }) => {
        setClientes(data || [])
        setCliCargando(false)
      })
  }, [])

  const lista = useMemo(() => listas.find((l) => l.id === listaSel), [listas, listaSel])

  // Desglose del trabajo a medida
  const desglose = useMemo(() => {
    const lines = []
    let total = 0
    for (const p of piezas) {
      const mat = materiales.find((m) => m.id === Number(p.material_id))
      const base = calcMatCost(mat, p)
      const sub = base * (1 + (Number(p.incremento) || 0) / 100)
      total += sub
      const tipo = mat?.tipo_medida || 'placa'
      let detalle = ''
      if (tipo === 'placa') detalle = `${p.cantidad}× ${p.ancho}×${p.alto} cm`
      else if (tipo === 'peso') detalle = `${p.gramos || 0} gr`
      else if (tipo === 'unidad') detalle = `×${p.cantidad}`
      else if (tipo === 'longitud') detalle = `${p.metros || 0} m`
      lines.push({ label: mat ? `${mat.nombre} — ${detalle}` : 'Insumo sin seleccionar', sub })
    }
    for (const ts of tarifasSel) {
      const tar = tarifas.find((tf) => tf.id === Number(ts.tarifa_id))
      const base = calcTarCost(tar, ts)
      const sub = base * (1 + (Number(ts.incremento) || 0) / 100)
      total += sub
      lines.push({ label: tar ? `${tar.nombre} — ${ts.fab_minutos}m ${ts.fab_segundos}s` : 'Tarifa sin seleccionar', sub })
    }
    return { lines, total }
  }, [piezas, tarifasSel, materiales, tarifas])

  const ventaMedida = useMemo(() => precioVenta(desglose.total, lista), [desglose.total, lista])
  const costoMedida = ventaMedida * (Number(cantidad) || 1)

  const extrasConPrecio = useMemo(() => {
    return extras.map((it) => {
      const precio = precioVenta(Number(it.producto.costo_base), lista)
      return { ...it, precio, subtotal: precio * it.cantidad }
    })
  }, [extras, lista])

  const totalExtras = extrasConPrecio.reduce((a, it) => a + it.subtotal, 0)
  const totalGeneral = costoMedida + totalExtras

  const productosFiltrados = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return productos
      .filter((p) => p.nombre.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q))
      .slice(0, 12)
  }, [productos, search])

  const agregarProducto = (producto) => {
    setExtras((prev) => {
      const idx = prev.findIndex((it) => it.producto.id === producto.id)
      if (idx >= 0) {
        const next = [...prev]; next[idx] = { ...next[idx], cantidad: next[idx].cantidad + 1 }; return next
      }
      return [...prev, { _key: newKey(), producto, cantidad: 1 }]
    })
    setSearch('')
  }

  const cambiarCantidadExtra = (key, val) =>
    setExtras((prev) => prev.map((it) => it._key === key ? { ...it, cantidad: Math.max(1, Number(val) || 1) } : it))

  const quitarExtra = (key) => setExtras((prev) => prev.filter((it) => it._key !== key))

  // Piezas
  const setPieza = (i, k, v) => setPiezas((prev) => prev.map((p, idx) => idx === i ? { ...p, [k]: v } : p))
  const addPieza = () => { const idx = piezas.length; setPiezas((prev) => [...prev, { ...blankPieza }]); setExpPiezas((prev) => ({ ...prev, [idx]: true })) }
  const removePieza = (i) => { setPiezas((prev) => prev.filter((_, idx) => idx !== i)); setExpPiezas((prev) => { const n = { ...prev }; delete n[i]; return n }) }

  // Tarifas
  const setTarifaSel = (i, k, v) => setTarifasSel((prev) => prev.map((t, idx) => idx === i ? { ...t, [k]: v } : t))
  const addTarifa = () => { const idx = tarifasSel.length; setTarifasSel((prev) => [...prev, { ...blankTarifaSel }]); setExpTarifas((prev) => ({ ...prev, [idx]: true })) }
  const removeTarifa = (i) => { setTarifasSel((prev) => prev.filter((_, idx) => idx !== i)); setExpTarifas((prev) => { const n = { ...prev }; delete n[i]; return n }) }

  // Autocomplete de cliente — basado en foco, sin useEffect
  const cliSugerencias = useMemo(() => {
    if (!cliInputFocused || cliSeleccionado) return []
    const q = cliente.trim().toLowerCase()
    if (!q) return clientes.slice(0, 8)           // sin texto → mostrar los primeros 8
    return clientes.filter(c => c.nombre.toLowerCase().includes(q)).slice(0, 8)
  }, [cliInputFocused, cliente, clientes, cliSeleccionado])

  const seleccionarCliente = (c) => {
    setCliente(c.nombre)
    setCliSeleccionado(c)
    setCliInputFocused(false)
    setCliDropRect(null)
    if (c.lista_id) setListaSel(String(c.lista_id))  // funciona cuando se agregue la columna a la DB
  }

  const limpiarCliente = () => {
    setCliente('')
    setCliSeleccionado(null)
    setCliInputFocused(false)
  }

  // Cargar un presupuesto guardado en el formulario
  const cargarPresupuesto = (p) => {
    if (!window.confirm('¿Cargar este presupuesto? Se reemplazarán los datos actuales del formulario.')) return
    const medida = (p.items ?? []).find(it => it.tipo === 'medida')
    const prods  = (p.items ?? []).filter(it => it.tipo === 'producto')

    setCliente(p.cliente ?? '')
    setCliSeleccionado(null)
    setListaSel(p.lista_id ? String(p.lista_id) : '')
    setNotas(p.notas ?? '')

    if (medida) {
      setDescripcion(medida.nombre ?? '')
      setCantidad(medida.cantidad ?? 1)
      const pzs = medida.piezas?.length ? medida.piezas : [{ ...blankPieza }]
      const trs = medida.tarifas_sel?.length ? medida.tarifas_sel : [{ ...blankTarifaSel }]
      setPiezas(pzs)
      setTarifasSel(trs)
      setExpPiezas(Object.fromEntries(pzs.map((_, i) => [i, true])))
      setExpTarifas(Object.fromEntries(trs.map((_, i) => [i, true])))
    }

    const extrasRestaurados = prods.map(it => {
      const prod = productos.find(p2 => p2.id === it.producto_id) ?? {
        id: it.producto_id, nombre: it.nombre, sku: it.sku ?? '',
        costo_base: 0, imagen_url: null, categoria: it.categoria ?? null,
      }
      return { _key: newKey(), producto: prod, cantidad: it.cantidad ?? 1 }
    })
    setExtras(extrasRestaurados)
    setShowHistorial(false)
  }

  const guardar = async () => {
    if (!cliente.trim()) { alert('Ingresá el nombre del cliente antes de guardar.'); return }
    if (!listaSel) { alert('Seleccioná una lista de precios antes de guardar.'); return }
    setSaving(true)
    const itemsMedida = {
      tipo: 'medida', nombre: descripcion || 'Trabajo a medida',
      cantidad: Number(cantidad) || 1, costo_unitario: ventaMedida, subtotal: costoMedida,
      piezas, tarifas_sel: tarifasSel,
    }
    const itemsExtras = extrasConPrecio.map((it) => ({
      tipo: 'producto', producto_id: it.producto.id, sku: it.producto.sku,
      nombre: it.producto.nombre, categoria: it.producto.categoria,
      cantidad: it.cantidad, precio: it.precio, subtotal: it.subtotal,
    }))
    const payload = {
      cliente: cliente || null, lista_id: listaSel || null, total: totalGeneral,
      items: [itemsMedida, ...itemsExtras], notas: notas || null,
    }
    const { error } = await supabase.from('presupuestos').insert(payload)
    setSaving(false)
    if (error) alert('Error: ' + error.message)
    else alert('Presupuesto guardado')
  }

  const loadHistorial = async () => {
    setHistLoading(true)
    const { data } = await supabase
      .from('presupuestos')
      .select('id, cliente, total, notas, created_at, lista_id, items')
      .order('created_at', { ascending: false })
      .limit(100)
    setHistorial(data ?? [])
    setHistLoading(false)
  }

  const abrirHistorial = () => { setShowHistorial(true); loadHistorial() }

  const convertirEnVenta = (p) => {
    setShowHistorial(false)
    navigate(`/ventas?from_presupuesto=${p.id}`)
  }

  const eliminarPresupuesto = async (id) => {
    if (!window.confirm('Eliminar este presupuesto?')) return
    await supabase.from('presupuestos').delete().eq('id', id)
    setHistorial(prev => prev.filter(p => p.id !== id))
  }

  const exportar = async () => {
    if (!cliente.trim()) { alert('Ingresá el nombre del cliente antes de exportar el PDF.'); return }
    if (!listaSel) { alert('Seleccioná una lista de precios antes de exportar.'); return }
    setExporting(true)
    try {
      const itemsPDF = []
      if (desglose.total > 0) {
        itemsPDF.push({ sku: '—', nombre: descripcion || 'Trabajo a medida', cantidad: Number(cantidad) || 1, precio: ventaMedida, imagen_url: null })
      }
      for (const it of extrasConPrecio) {
        itemsPDF.push({ sku: it.producto.sku, nombre: it.producto.nombre, cantidad: it.cantidad, precio: it.precio, imagen_url: it.producto.imagen_url || null })
      }
      await exportPresupuestoPDF({ presupuesto: null, items: itemsPDF, cliente, branding, lista, validez })
    } catch (err) {
      alert('Error generando PDF: ' + err.message)
    } finally {
      setExporting(false)
    }
  }

  // Re-exportar PDF desde el historial
  const reexportarPDF = async (p) => {
    if (!p.items) { alert('Este presupuesto no tiene ítems guardados.'); return }
    setReexportandoId(p.id)
    try {
      const listaObj = listas.find(l => l.id === p.lista_id) ?? null
      const itemsPDF = []
      for (const it of p.items) {
        if (it.tipo === 'medida' && (it.subtotal > 0 || it.costo_unitario > 0)) {
          itemsPDF.push({
            sku: '—',
            nombre: it.nombre || 'Trabajo a medida',
            cantidad: it.cantidad ?? 1,
            precio: it.costo_unitario ?? 0,
            imagen_url: null,
          })
        } else if (it.tipo === 'producto') {
          itemsPDF.push({
            sku: it.sku ?? '—',
            nombre: it.nombre ?? '',
            cantidad: it.cantidad ?? 1,
            precio: it.precio ?? 0,
            imagen_url: null,
          })
        }
      }
      await exportPresupuestoPDF({ presupuesto: null, items: itemsPDF, cliente: p.cliente ?? '', branding, lista: listaObj, validez: '15 días' })
    } catch (err) {
      alert('Error generando PDF: ' + err.message)
    } finally {
      setReexportandoId(null)
    }
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'calc(100vh - 60px)', overflow:'hidden' }}>

      {/* ── Barra superior ─────────────────────────────────────────────── */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 20px', borderBottom:'1px solid var(--border)', flexShrink:0, background:'var(--surface)' }}>
        <h1 style={{ fontSize:20, fontWeight:700, margin:0 }}>Nuevo presupuesto</h1>
        <div style={{ display:'flex', gap:8 }}>
          <button className="btn" onClick={abrirHistorial}>
            📋 Historial
          </button>
          <button className="btn" onClick={guardar} disabled={saving}>
            {saving ? 'Guardando...' : '💾 Guardar'}
          </button>
          <button
            className="btn btn-primary"
            onClick={exportar}
            disabled={exporting || !listaSel}
            title={!listaSel ? 'Seleccioná una lista de precios primero' : ''}
          >
            {exporting ? 'Generando...' : '📄 Exportar PDF'}
          </button>
        </div>
      </div>

      {/* ── Aviso lista no seleccionada ─────────────────────────────────── */}
      {!listaSel && listas.length > 0 && (
        <div style={{ display:'flex', alignItems:'center', gap:10, background:'#fffbeb', borderBottom:'1px solid #fcd34d', padding:'7px 20px', flexShrink:0 }}>
          <span style={{ fontSize:16 }}>⚠️</span>
          <span style={{ fontWeight:600, color:'#92400e', fontSize:13 }}>Seleccioná una lista de precios antes de continuar. El PDF no se puede exportar sin lista.</span>
        </div>
      )}

      {/* ── 3 columnas ──────────────────────────────────────────────────── */}
      <div style={{ flex:1, minHeight:0, display:'grid', gridTemplateColumns:'0.7fr 1.3fr 0.65fr', overflow:'hidden' }}>

        {/* ══ COL 1 — Datos del presupuesto ══════════════════════════════ */}
        <div style={{ ...colStyle, borderRight:'1px solid var(--border)' }}>
          {secLabel('Datos del presupuesto')}

          <F label="Cliente *">
            <div style={{ display:'flex', flexDirection:'column', gap:0 }}>
              {cliSeleccionado ? (
                <div style={{ display:'flex', alignItems:'center', gap:7, padding:'6px 10px', border:'1px solid var(--primary)', borderRadius:6, background:'var(--bg-highlight)' }}>
                  <div style={{ width:26, height:26, borderRadius:'50%', background:'var(--primary)', color:'white', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:800, flexShrink:0 }}>
                    {cliente.charAt(0).toUpperCase()}
                  </div>
                  <span style={{ flex:1, fontSize:13, fontWeight:600 }}>{cliente}</span>
                  <button onClick={limpiarCliente} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', fontSize:15, padding:'0 2px', lineHeight:1 }}>✕</button>
                </div>
              ) : (
                <input
                  ref={cliInputRef}
                  className="input"
                  style={si()}
                  value={cliente}
                  onChange={e => { setCliente(e.target.value); setCliSeleccionado(null) }}
                  onFocus={() => {
                    if (cliInputRef.current) {
                      const r = cliInputRef.current.getBoundingClientRect()
                      setCliDropRect({ top: r.bottom + window.scrollY, left: r.left + window.scrollX, width: r.width })
                    }
                    setCliInputFocused(true)
                  }}
                  onBlur={() => setTimeout(() => { setCliInputFocused(false); setCliDropRect(null) }, 200)}
                  placeholder="Nombre o razón social *"
                  autoComplete="off"
                />
              )}
              {/* Dropdown con position:fixed — escapa cualquier overflow:hidden del árbol padre */}
              {cliInputFocused && !cliSeleccionado && cliDropRect && (
                <div style={{
                  position: 'fixed',
                  top: cliDropRect.top,
                  left: cliDropRect.left,
                  width: cliDropRect.width,
                  zIndex: 9999,
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  background: 'var(--bg-card)',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.14)',
                  maxHeight: 260,
                  overflowY: 'auto',
                }}>
                  {cliCargando ? (
                    <div style={{ padding:'10px 12px', fontSize:12, color:'var(--text-muted)' }}>Cargando clientes...</div>
                  ) : cliSugerencias.length === 0 ? (
                    <div style={{ padding:'10px 12px', fontSize:12, color:'var(--text-muted)' }}>
                      {clientes.length === 0
                        ? '⚠️ No hay clientes registrados aún'
                        : `Sin resultados para "${cliente}"`}
                    </div>
                  ) : (
                    cliSugerencias.map(c => (
                      <div key={c.id}
                        onMouseDown={e => { e.preventDefault(); seleccionarCliente(c) }}
                        style={{ padding:'9px 12px', cursor:'pointer', fontSize:13, display:'flex', alignItems:'center', gap:9, borderBottom:'1px solid var(--border)' }}
                        onMouseEnter={e => e.currentTarget.style.background='var(--bg-highlight)'}
                        onMouseLeave={e => e.currentTarget.style.background='var(--bg-card)'}
                      >
                        <div style={{ width:28, height:28, borderRadius:'50%', background:'var(--primary)', color:'white', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:800, flexShrink:0 }}>
                          {c.nombre.charAt(0).toUpperCase()}
                        </div>
                        <span style={{ fontWeight:600 }}>{c.nombre}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </F>

          <F label="Lista de precios">
            <select
              className="select"
              style={si(!listaSel ? { borderColor:'var(--warning)' } : {})}
              value={listaSel}
              onChange={e=>setListaSel(e.target.value)}
            >
              <option value="">— Elegir lista —</option>
              {listas.length === 0 && <option disabled>Sin listas creadas</option>}
              {listas.map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}
            </select>
          </F>

          <F label="Descripción del trabajo">
            <input className="input" style={si()} value={descripcion} onChange={e=>setDescripcion(e.target.value)} placeholder="Ej: Estante melamina 60×40 cm" />
          </F>

          <F label="Cantidad">
            <input className="input" style={si()} type="number" min={1} value={cantidad} onChange={e=>setCantidad(e.target.value)} />
          </F>

          <F label={<span>Validez <span style={{ fontSize:11, color:'var(--text-muted)', fontWeight:400 }}>— aparece en el PDF</span></span>}>
            <div style={{ display:'flex', alignItems:'center', gap:7 }}>
              <span style={{ fontSize:13, color:'var(--text-muted)', whiteSpace:'nowrap' }}>Válido por</span>
              <input className="input" style={si({ flex:1 })} value={validez} onChange={e=>setValidez(e.target.value)} placeholder="Ej: 15 días" />
            </div>
          </F>

          <div style={{ height:1, background:'var(--border)', flexShrink:0 }} />

          <F label="Notas / observaciones">
            <textarea className="textarea" value={notas} onChange={e=>setNotas(e.target.value)} style={{ fontSize:13, resize:'none', minHeight:90 }} />
          </F>
        </div>

        {/* ══ COL 2 — Materiales, Tarifas y Catálogo ═════════════════════ */}
        <div style={{ ...colStyle, borderRight:'1px solid var(--border)' }}>
          {secLabel('Materiales y tarifas')}

          {/* Piezas */}
          <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
            {subLabel('Materiales / Piezas')}
            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
              {piezas.map((p, i) => {
                const mat = materiales.find((m) => m.id === Number(p.material_id))
                const tipo = mat?.tipo_medida || 'placa'
                const lbl = mat ? (() => {
                  if (tipo === 'placa') return `${mat.nombre} — ${p.cantidad}× ${p.ancho}×${p.alto} cm`
                  if (tipo === 'peso') return `${mat.nombre} — ${p.gramos || 0} gr`
                  if (tipo === 'unidad') return `${mat.nombre} — ×${p.cantidad}`
                  if (tipo === 'longitud') return `${mat.nombre} — ${p.metros || 0} m`
                })() : `Insumo ${i + 1}`
                return (
                  <div key={i} style={{ border:'1px solid var(--border)', borderRadius:6, overflow:'hidden' }}>
                    <div
                      style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 10px', background: expPiezas[i] ? 'var(--bg-highlight)' : 'var(--surface)', cursor:'pointer' }}
                      onClick={() => setExpPiezas(prev => ({ ...prev, [i]: !prev[i] }))}
                    >
                      <span style={{ fontSize:11, color:'var(--text-muted)', width:12 }}>{expPiezas[i] ? '▾' : '▸'}</span>
                      <span style={{ flex:1, fontSize:13 }}>{lbl}</span>
                      {piezas.length > 1 && (
                        <button className="btn btn-sm btn-ghost" style={{ color:'var(--danger)', fontSize:12, padding:'2px 8px' }}
                          onClick={e => { e.stopPropagation(); removePieza(i) }}>✕</button>
                      )}
                    </div>
                    {expPiezas[i] && (
                      <div style={{ padding:'10px 12px', borderTop:'1px solid var(--border)', background:'var(--bg-muted)' }}>
                        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
                          <F label="Insumo" col={2}>
                            <select className="select" style={si()} value={p.material_id} onChange={e=>setPieza(i,'material_id',e.target.value)}>
                              <option value="">— Seleccionar insumo —</option>
                              {materiales.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
                            </select>
                          </F>
                          {!p.material_id ? (
                            <div style={{ gridColumn:'span 2', padding:'6px 0', fontSize:11, color:'var(--text-muted)', textAlign:'center' }}>
                              👆 Primero seleccioná el insumo
                            </div>
                          ) : (<>
                            {tipo === 'placa' && <>
                              <F label="Alto (cm)"><input className="input" style={si()} type="number" step="0.1" value={p.alto} onChange={e=>setPieza(i,'alto',e.target.value)} /></F>
                              <F label="Ancho (cm)"><input className="input" style={si()} type="number" step="0.1" value={p.ancho} onChange={e=>setPieza(i,'ancho',e.target.value)} /></F>
                              <F label="Cantidad"><input className="input" style={si()} type="number" min={1} value={p.cantidad} onChange={e=>setPieza(i,'cantidad',e.target.value)} /></F>
                            </>}
                            {tipo === 'peso' && <F label="Gramos (gr)"><input className="input" style={si()} type="number" step="0.1" value={p.gramos} onChange={e=>setPieza(i,'gramos',e.target.value)} /></F>}
                            {tipo === 'unidad' && <F label="Cantidad"><input className="input" style={si()} type="number" min={1} value={p.cantidad} onChange={e=>setPieza(i,'cantidad',e.target.value)} /></F>}
                            {tipo === 'longitud' && <F label="Metros"><input className="input" style={si()} type="number" step="0.01" value={p.metros} onChange={e=>setPieza(i,'metros',e.target.value)} /></F>}
                            <F label="Incremento (%)"><input className="input" style={si()} type="number" step="0.01" placeholder="0" value={p.incremento} onChange={e=>setPieza(i,'incremento',e.target.value)} /></F>
                          </>)}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <div style={{ textAlign:'right' }}>
              <button className="btn btn-sm btn-ghost" onClick={addPieza} style={{ fontSize:12 }}>+ Agregar pieza</button>
            </div>
          </div>

          <div style={{ height:1, background:'var(--border)', flexShrink:0 }} />

          {/* Tarifas */}
          <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
            {subLabel('Tarifas de fabricación')}
            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
              {tarifasSel.map((ts, i) => {
                const tar = tarifas.find((tf) => tf.id === Number(ts.tarifa_id))
                const lbl = tar ? `${tar.nombre} — ${ts.fab_minutos}m ${ts.fab_segundos}s` : `Tarifa ${i + 1}`
                return (
                  <div key={i} style={{ border:'1px solid var(--border)', borderRadius:6, overflow:'hidden' }}>
                    <div
                      style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 10px', background: expTarifas[i] ? 'var(--bg-highlight)' : 'var(--surface)', cursor:'pointer' }}
                      onClick={() => setExpTarifas(prev => ({ ...prev, [i]: !prev[i] }))}
                    >
                      <span style={{ fontSize:11, color:'var(--text-muted)', width:12 }}>{expTarifas[i] ? '▾' : '▸'}</span>
                      <span style={{ flex:1, fontSize:13 }}>{lbl}</span>
                      {tarifasSel.length > 1 && (
                        <button className="btn btn-sm btn-ghost" style={{ color:'var(--danger)', fontSize:12, padding:'2px 8px' }}
                          onClick={e => { e.stopPropagation(); removeTarifa(i) }}>✕</button>
                      )}
                    </div>
                    {expTarifas[i] && (
                      <div style={{ padding:'10px 12px', borderTop:'1px solid var(--border)', background:'var(--bg-muted)' }}>
                        <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr', gap:6 }}>
                          <F label="Tarifa">
                            <select className="select" style={si()} value={ts.tarifa_id} onChange={e=>setTarifaSel(i,'tarifa_id',e.target.value)}>
                              <option value="">— Seleccionar tarifa —</option>
                              {tarifas.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                            </select>
                          </F>
                          {!ts.tarifa_id ? (
                            <div style={{ gridColumn:'span 2', display:'flex', alignItems:'center', fontSize:11, color:'var(--text-muted)', paddingLeft:4 }}>
                              👆 Primero seleccioná la tarifa
                            </div>
                          ) : (<>
                            <F label="Minutos">
                              <input className="input" style={si()} type="number" min={0} value={ts.fab_minutos} onChange={e=>setTarifaSel(i,'fab_minutos',e.target.value)} />
                            </F>
                            <F label="Segundos">
                              <input className="input" style={si()} type="number" min={0} max={59}
                                value={ts.fab_segundos}
                                onChange={e=>setTarifaSel(i,'fab_segundos',e.target.value)}
                                onBlur={e=>{ const {segs,extraMins}=snapSegs(e.target.value); setTarifaSel(i,'fab_segundos',segs); if(extraMins) setTarifaSel(i,'fab_minutos',(Number(ts.fab_minutos)||0)+extraMins) }}
                              />
                            </F>
                            <F label="Incremento (%)">
                              <input className="input" style={si()} type="number" step="0.01" placeholder="0" value={ts.incremento} onChange={e=>setTarifaSel(i,'incremento',e.target.value)} />
                            </F>
                          </>)}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <div style={{ textAlign:'right' }}>
              <button className="btn btn-sm btn-ghost" onClick={addTarifa} style={{ fontSize:12 }}>+ Agregar tarifa</button>
            </div>
          </div>

          <div style={{ height:1, background:'var(--border)', flexShrink:0 }} />

          {/* Catálogo */}
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            <button
              style={{ background:'none', border:'none', cursor:'pointer', display:'flex', alignItems:'center', gap:7, fontWeight:600, fontSize:13, color:'var(--text)', padding:0 }}
              onClick={() => setShowCatalogo(v => !v)}
            >
              <span style={{ fontSize:11 }}>{showCatalogo ? '▾' : '▸'}</span>
              Agregar productos del catálogo
              {extras.length > 0 && (
                <span style={{ fontSize:11, background:'var(--primary)', color:'#fff', borderRadius:10, padding:'1px 8px' }}>{extras.length}</span>
              )}
            </button>

            {showCatalogo && (
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                <div style={{ position:'relative' }}>
                  <input className="input" style={si()} placeholder="Buscar por nombre o SKU..." value={search} onChange={e=>setSearch(e.target.value)} />
                  {productosFiltrados.length > 0 && (
                    <div style={{ position:'absolute', top:'100%', left:0, right:0, zIndex:20, background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:6, maxHeight:220, overflowY:'auto', boxShadow:'0 4px 12px rgba(0,0,0,0.08)', marginTop:2 }}>
                      {productosFiltrados.map(p => {
                        const venta = precioVenta(Number(p.costo_base), lista)
                        return (
                          <div key={p.id} onClick={() => agregarProducto(p)}
                            style={{ padding:'8px 12px', borderBottom:'1px solid var(--border)', cursor:'pointer', display:'flex', alignItems:'center', gap:10 }}
                            onMouseEnter={e => e.currentTarget.style.background='var(--bg-muted)'}
                            onMouseLeave={e => e.currentTarget.style.background='var(--bg-card)'}
                          >
                            {p.imagen_url
                              ? <ImageThumb src={p.imagen_url} size={36} />
                              : <div style={{ width:36, height:36, borderRadius:4, background:'var(--bg-muted)', flexShrink:0 }} />
                            }
                            <div style={{ flex:1, minWidth:0 }}>
                              <strong style={{ fontSize:14 }}>{p.nombre}</strong>
                              <code style={{ marginLeft:8, fontSize:11, color:'var(--text-muted)' }}>{p.sku}</code>
                            </div>
                            <span style={{ fontWeight:600, color:'var(--success)', flexShrink:0 }}>{fmtMoney(venta)}</span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                {extras.length > 0 && (
                  <table className="table">
                    <thead>
                      <tr>
                        <th style={{ width:44 }}></th>
                        <th>Producto</th>
                        <th style={{ textAlign:'right' }}>Cant.</th>
                        <th style={{ textAlign:'right' }}>Unit.</th>
                        <th style={{ textAlign:'right' }}>Subtotal</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {extrasConPrecio.map(it => (
                        <tr key={it._key}>
                          <td style={{ width:44, padding:'5px 6px' }}>
                            <ImageThumb src={it.producto.imagen_url} size={34} />
                          </td>
                          <td>
                            <strong style={{ fontSize:13 }}>{it.producto.nombre}</strong>
                            <div style={{ fontSize:11, color:'var(--text-muted)' }}>{it.producto.sku}</div>
                          </td>
                          <td style={{ textAlign:'right' }}>
                            <input type="number" min={1} value={it.cantidad}
                              onChange={e=>cambiarCantidadExtra(it._key,e.target.value)}
                              className="input" style={{ width:56, textAlign:'right', padding:'4px 7px', fontSize:13 }} />
                          </td>
                          <td style={{ textAlign:'right', fontSize:13 }}>{fmtMoney(it.precio)}</td>
                          <td style={{ textAlign:'right', fontWeight:600, fontSize:13 }}>{fmtMoney(it.subtotal)}</td>
                          <td style={{ textAlign:'right' }}>
                            <button className="btn btn-sm btn-ghost" onClick={() => quitarExtra(it._key)} style={{ color:'var(--danger)', fontSize:12 }}>Quitar</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ══ COL 3 — Resumen ════════════════════════════════════════════ */}
        <div style={{ ...colStyle, background:'var(--bg-muted)' }}>
          {secLabel('Resumen de costos')}

          {/* Desglose línea a línea */}
          {desglose.lines.length === 0 ? (
            <div style={{ marginTop:12, textAlign:'center', color:'var(--text-muted)', fontSize:13 }}>Completá los datos para ver el costo.</div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
              {desglose.lines.map((l, i) => (
                <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'2px 0', borderBottom:'1px solid var(--border)', fontSize:12 }}>
                  <span style={{ color:'var(--text-muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:'58%' }}>{l.label}</span>
                  <span style={{ fontWeight:600, whiteSpace:'nowrap' }}>{fmtMoney(l.sub)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Subtotal */}
          <div style={{ display:'flex', justifyContent:'space-between', fontSize:13, paddingTop:5, borderTop:'2px solid var(--border)', color:'var(--text-muted)' }}>
            <span>Subtotal materiales</span>
            <span style={{ fontWeight:600, color:'var(--text)' }}>{fmtMoney(desglose.total)}</span>
          </div>

          {/* Incremento por lista */}
          {lista && ventaMedida !== desglose.total && (
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:13, color:'var(--text-muted)' }}>
              <span style={{ display:'flex', alignItems:'center', gap:4 }}>
                <span style={{ fontSize:11, background:'var(--primary-faint)', color:'var(--primary)', borderRadius:4, padding:'1px 5px', fontWeight:600 }}>{lista.nombre}</span>
                incremento
              </span>
              <span style={{ fontWeight:600, color:'var(--success)' }}>+{fmtMoney(ventaMedida - desglose.total)}</span>
            </div>
          )}
          {!lista && (
            <div style={{ fontSize:12, color:'var(--warning)' }}>⚠️ Seleccioná una lista para ver el precio final</div>
          )}

          {/* Precio unitario */}
          <div style={{ background:'var(--bg-highlight)', border:'1px solid var(--primary)', borderRadius:6, padding:'8px 10px' }}>
            <div style={{ fontSize:11, color:'var(--primary)', fontWeight:600, textTransform:'uppercase' }}>Precio unitario</div>
            <div style={{ fontSize:22, fontWeight:700, color:'var(--primary)', lineHeight:1.2 }}>{fmtMoney(ventaMedida)}</div>
          </div>

          {Number(cantidad) > 1 && (
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:13, color:'var(--text-muted)' }}>
              <span>× {cantidad} unidades</span>
              <span style={{ fontWeight:600, color:'var(--text)' }}>{fmtMoney(costoMedida)}</span>
            </div>
          )}

          {totalExtras > 0 && (
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:13, color:'var(--text-muted)' }}>
              <span>Productos catálogo</span>
              <span style={{ fontWeight:600, color:'var(--text)' }}>{fmtMoney(totalExtras)}</span>
            </div>
          )}

          {(Number(cantidad) > 1 || totalExtras > 0) && (
            <div style={{ display:'flex', justifyContent:'space-between', fontWeight:700, fontSize:18, paddingTop:8, borderTop:'2px solid var(--border)', color:'var(--primary)' }}>
              <span>TOTAL</span>
              <span>{fmtMoney(totalGeneral)}</span>
            </div>
          )}
        </div>

      </div>

      {/* ── Panel historial de presupuestos ─────────────────────────────── */}
      {showHistorial && (
        <div style={{ position:'fixed', inset:0, zIndex:300, display:'flex' }}>
          <div style={{ flex:1, background:'rgba(0,0,0,0.4)' }} onClick={() => setShowHistorial(false)} />
          <div style={{ width:480, background:'var(--bg)', display:'flex', flexDirection:'column', boxShadow:'-6px 0 24px rgba(0,0,0,0.18)', overflow:'hidden' }}>

            {/* Header */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 18px', borderBottom:'1px solid var(--border)', flexShrink:0 }}>
              <div>
                <div style={{ fontWeight:700, fontSize:16 }}>📋 Presupuestos guardados</div>
                <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:2 }}>
                  {histLoading ? 'Cargando...' : `${historial.length} guardado${historial.length !== 1 ? 's' : ''}`}
                </div>
              </div>
              <button onClick={() => setShowHistorial(false)}
                style={{ background:'none', border:'none', cursor:'pointer', fontSize:20, color:'var(--text-muted)', padding:'2px 6px' }}>✕</button>
            </div>

            {/* Lista */}
            <div style={{ flex:1, overflowY:'auto', padding:'10px 14px', display:'flex', flexDirection:'column', gap:8 }}>
              {histLoading ? (
                <div style={{ textAlign:'center', padding:40, color:'var(--text-muted)', fontSize:13 }}>Cargando...</div>
              ) : historial.length === 0 ? (
                <div style={{ textAlign:'center', padding:40, color:'var(--text-muted)', fontSize:13 }}>
                  <div style={{ fontSize:32, marginBottom:10 }}>📄</div>
                  No hay presupuestos guardados.
                </div>
              ) : historial.map(p => {
                const fecha = new Date(p.created_at).toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' })
                const hora  = new Date(p.created_at).toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' })
                const listaObj = listas.find(l => l.id === p.lista_id)
                return (
                  <div key={p.id} style={{ padding:'11px 13px', border:'1px solid var(--border)', borderRadius:8, background:'var(--surface)', display:'flex', gap:10, alignItems:'flex-start' }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:3 }}>
                        <span style={{ fontSize:13, fontWeight:700 }}>
                          {p.cliente || 'Sin cliente'}
                        </span>
                        {listaObj && (
                          <span style={{ fontSize:10, background:'var(--primary-faint)', color:'var(--primary)', borderRadius:4, padding:'1px 6px', fontWeight:600 }}>
                            {listaObj.nombre}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize:18, fontWeight:800, color:'var(--primary)' }}>{fmtMoney(p.total ?? 0)}</div>
                      {p.notas && (
                        <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:3, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                          {p.notas}
                        </div>
                      )}
                      <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:4 }}>
                        {fecha} · {hora}
                      </div>
                    </div>
                    <div style={{ display:'flex', flexDirection:'column', gap:5, flexShrink:0 }}>
                      <button
                        onClick={() => convertirEnVenta(p)}
                        style={{ background:'#16a34a', border:'none', color:'white', borderRadius:6, padding:'6px 12px', cursor:'pointer', fontSize:12, fontWeight:700, display:'flex', alignItems:'center', gap:5 }}>
                        🛒 Confirmar venta
                      </button>
                      <button
                        onClick={() => cargarPresupuesto(p)}
                        style={{ background:'var(--primary)', border:'none', color:'white', borderRadius:6, padding:'5px 12px', cursor:'pointer', fontSize:12, fontWeight:700 }}>
                        Editar
                      </button>
                      <button
                        onClick={() => reexportarPDF(p)}
                        disabled={reexportandoId === p.id}
                        style={{ background:'#f0fdf4', border:'1px solid #86efac', color:'#15803d', borderRadius:6, padding:'4px 10px', cursor:'pointer', fontSize:12, fontWeight:600 }}>
                        {reexportandoId === p.id ? '...' : '📄 PDF'}
                      </button>
                      <button
                        onClick={() => eliminarPresupuesto(p.id)}
                        style={{ background:'none', border:'1px solid #fca5a5', color:'#dc2626', borderRadius:6, padding:'4px 10px', cursor:'pointer', fontSize:12, fontWeight:600 }}>
                        Eliminar
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
