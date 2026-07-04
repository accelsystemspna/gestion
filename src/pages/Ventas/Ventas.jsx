import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { fmtMoney } from '../../lib/format'
import { calcInsumo, precioVenta } from '../../lib/pricing'

function snapSegs(segs) {
  const s = Number(segs) || 0
  if (s === 0) return { segs: 0, extraMins: 0 }
  const r = Math.ceil(s / 15) * 15
  return r >= 60 ? { segs: 0, extraMins: 1 } : { segs: r, extraMins: 0 }
}
const calcTarCost   = (tar, ts) => {
  if (!tar) return 0
  const h = ((Number(ts.fab_minutos) || 0) * 60 + (Number(ts.fab_segundos) || 0)) / 3600
  return h * (Number(tar.costo_hora) || 0)
}
const blankPieza     = { material_id: '', ancho: 0, alto: 0, cantidad: 1, gramos: 0, metros: 0, incremento: 0 }
const blankTarifaSel = { tarifa_id: '', fab_minutos: 0, fab_segundos: 0, incremento: 0 }
import VentaDetalle from './VentaDetalle'
import ImageThumb from '../../components/ImageThumb'

// ── Helpers ──────────────────────────────────────────────────────────────────
let _k = 0
const nk = () => `ci${++_k}`

const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const nowTime  = () => new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
const fmtDate  = (d) =>
  d ? new Date(d + 'T00:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'
const padNum   = (n) => String(n ?? 0).padStart(4, '0')

// ── Constantes de dominio ────────────────────────────────────────────────────
const COMPROBANTES = [
  { value: 'ticket',    label: 'Ticket',    color: '#6366f1', bg: '#eef2ff' },
  { value: 'factura_b', label: 'Factura B', color: '#0891b2', bg: '#ecfeff' },
  { value: 'factura_c', label: 'Factura C', color: '#0284c7', bg: '#e0f2fe' },
]

const FORMAS_PAGO = [
  { value: 'efectivo',         label: '💵 Efectivo' },
  { value: 'debito',           label: '💳 Débito' },
  { value: 'credito',          label: '💳 Crédito' },
  { value: 'transferencia',    label: '🏦 Transferencia' },
  { value: 'cuenta_corriente', label: '📒 Cta. corriente' },
]

const ESTADO_S = {
  pagado:    { color: '#16a34a', bg: '#dcfce7', label: 'Pagado' },
  pendiente: { color: '#d97706', bg: '#fef9c3', label: 'Pendiente' },
  parcial:   { color: '#7c3aed', bg: '#f5f3ff', label: 'Parcial' },
  anulado:   { color: '#64748b', bg: '#f1f5f9', label: 'Anulado' },
}

// ── Estilos inline reutilizables ──────────────────────────────────────────────
const inp = (ex = {}) => ({
  padding: '7px 10px', fontSize: 14, border: '1px solid var(--border)',
  borderRadius: 6, background: 'var(--surface)', color: 'inherit',
  width: '100%', boxSizing: 'border-box', outline: 'none', ...ex,
})

const tabBtn = (active) => ({
  padding: '4px 13px', borderRadius: 14, border: `1px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
  background: active ? 'var(--primary)' : 'var(--surface)',
  color: active ? 'white' : 'var(--text-muted)',
  fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
})

// ════════════════════════════════════════════════════════════════════════════
export default function Ventas() {
  const { orgId } = useAuth()
  const [mobilePestaña, setMobilePestaña] = useState('productos')

  // ── Datos maestros ───────────────────────────────────────────────────────
  const [productos,  setProductos]  = useState([])
  const [categorias, setCategorias] = useState([])
  const [listas,     setListas]     = useState([])
  const [clientes,   setClientes]   = useState([])
  const [materiales, setMateriales] = useState([])
  const [tarifas,    setTarifas]    = useState([])

  // ── Cabecera de la venta ─────────────────────────────────────────────────
  const [fecha,       setFecha]       = useState(todayStr())
  const [cliente,     setCliente]     = useState(null)
  const [cliSearch,   setCliSearch]   = useState('')
  const [cliResults,  setCliResults]  = useState([])
  const [listaSel,    setListaSel]    = useState('')
  const [comprobante, setComprobante] = useState('ticket')

  // ── Panel de productos ───────────────────────────────────────────────────
  const [catFiltro,  setCatFiltro]  = useState('')
  const [prodSearch, setProdSearch] = useState('')

  // ── Carrito ──────────────────────────────────────────────────────────────
  const [items,          setItems]          = useState([])
  const [descuento,      setDescuento]      = useState('')
  const [razonDescuento, setRazonDescuento] = useState('')
  const [formaPago,      setFormaPago]      = useState('efectivo')

  // ── UI ───────────────────────────────────────────────────────────────────
  const [searchParams] = useSearchParams()
  const [showHistorial,         setShowHistorial]         = useState(false)
  const [showHistorialCompleto, setShowHistorialCompleto] = useState(searchParams.get('historial') === '1')
  const [showSuccess,           setShowSuccess]           = useState(false)
  const [showCustom,       setShowCustom]       = useState(false)
  const [showDetalle,      setShowDetalle]      = useState(false)
  const [cliEditMode,      setCliEditMode]      = useState(false)
  const [showNuevoCliente, setShowNuevoCliente] = useState(false)
  const [nuevoCliForm,     setNuevoCliForm]     = useState({ nombre: '', telefono: '', email: '', direccion: '' })
  const [nuevoCliSaving,   setNuevoCliSaving]   = useState(false)
  const [detalleVentaId, setDetalleVentaId] = useState(null)
  const [ventasHoy,      setVentasHoy]      = useState([])
  const [savedVenta,     setSavedVenta]     = useState(null)
  const [saving,         setSaving]         = useState(false)
  const [arcaConfig,     setArcaConfig]     = useState(null)
  const [customForm,     setCustomForm]     = useState({ descripcion: '', precio: '', cantidad: 1 })
  const [customErr,      setCustomErr]      = useState('')
  const [inlineLibre,    setInlineLibre]    = useState({ descripcion: '', precio: '', cantidad: 1 })
  const [inlineErr,      setInlineErr]      = useState('')

  // ── Historial completo ───────────────────────────────────────────────────
  const [hcVentas,   setHcVentas]   = useState([])
  const [hcLoading,  setHcLoading]  = useState(false)
  const [hcDesde,    setHcDesde]    = useState('')
  const [hcHasta,    setHcHasta]    = useState('')
  const [hcEstado,   setHcEstado]   = useState('')
  const [hcBusqueda, setHcBusqueda] = useState('')

  // ── Cotizador de corte especial ──────────────────────────────────────────
  const [showCotizador,  setShowCotizador]  = useState(false)
  const [cotDesc,        setCotDesc]        = useState('')
  const [cotCantidad,    setCotCantidad]    = useState(1)
  const [cotPiezas,      setCotPiezas]      = useState([{ ...blankPieza }])
  const [cotTarifas,     setCotTarifas]     = useState([{ ...blankTarifaSel }])
  const [cotExpPiezas,   setCotExpPiezas]   = useState({ 0: true })
  const [cotExpTarifas,  setCotExpTarifas]  = useState({ 0: true })

  const prodSearchRef = useRef(null)

  // ── Carga inicial ────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      supabase.from('productos').select('id, nombre, sku, costo_base, imagen_url, categoria_id').eq('activo', true).order('nombre'),
      supabase.from('categorias').select('id, nombre').order('nombre'),
      supabase.from('listas_precios').select('*').order('created_at'),
      supabase.from('clientes').select('*').order('nombre'),
      supabase.from('materiales').select('*').order('nombre'),
      supabase.from('tarifas').select('*').order('id'),
      supabase.from('arca_config').select('*').eq('id', 1).maybeSingle(),
    ]).then(([pr, ca, li, cl, ma, ta, ar]) => {
      setProductos(pr.data ?? [])
      setCategorias(ca.data ?? [])
      setListas(li.data ?? [])
      setClientes(cl.data ?? [])
      setMateriales(ma.data ?? [])
      setTarifas(ta.data ?? [])
      setArcaConfig(ar.data ?? null)
    })
  }, [])

  // ── Borrador de venta en curso ───────────────────────────────────────────
  // En mobile, Android puede descargar/recargar la pestaña al bloquear la
  // pantalla; sin esto se perdía la venta que se estaba armando.
  const draftKey = `pos_draft_${orgId || 'anon'}`
  const draftRestored = useRef(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey)
      if (raw) {
        const d = JSON.parse(raw)
        if (d.fecha)       setFecha(d.fecha)
        if (d.cliente)     setCliente(d.cliente)
        if (d.listaSel)    setListaSel(d.listaSel)
        if (d.comprobante) setComprobante(d.comprobante)
        if (Array.isArray(d.items) && d.items.length) setItems(d.items)
        if (d.descuento)      setDescuento(d.descuento)
        if (d.razonDescuento) setRazonDescuento(d.razonDescuento)
        if (d.formaPago)      setFormaPago(d.formaPago)
      }
    } catch { /* borrador corrupto, se ignora */ }
    draftRestored.current = true
  }, [draftKey])

  useEffect(() => {
    if (!draftRestored.current) return
    const hayVentaEnCurso = items.length > 0 || !!cliente || !!listaSel
    try {
      if (hayVentaEnCurso) {
        localStorage.setItem(draftKey, JSON.stringify({ fecha, cliente, listaSel, comprobante, items, descuento, razonDescuento, formaPago }))
      } else {
        localStorage.removeItem(draftKey)
      }
    } catch { /* localStorage lleno o no disponible */ }
  }, [draftKey, fecha, cliente, listaSel, comprobante, items, descuento, razonDescuento, formaPago])

  // ── Ventas del día ───────────────────────────────────────────────────────
  const loadVentasHoy = useCallback(async () => {
    const hoy = todayStr()
    // Calcular el día siguiente para usar rango (más robusto que .eq para date y timestamptz)
    const nextDay = (() => {
      const d = new Date(); d.setDate(d.getDate() + 1)
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    })()
    const { data, error } = await supabase
      .from('ventas')
      .select('id, numero, comprobante, cliente_nombre, forma_pago, hora, total, estado, fecha, factura_emitida')
      .gte('fecha', hoy)
      .lt('fecha', nextDay)
      .order('numero', { ascending: false })
    if (error) console.error('[loadVentasHoy]', error)
    setVentasHoy(data ?? [])
  }, [])

  useEffect(() => { loadVentasHoy() }, [loadVentasHoy])

  // ── Cargar desde presupuesto (param ?from_presupuesto=id) ─────────────────
  useEffect(() => {
    const presId = searchParams.get('from_presupuesto')
    if (!presId) return
    supabase.from('presupuestos')
      .select('id, cliente, lista_id, items')
      .eq('id', presId)
      .maybeSingle()
      .then(({ data: p, error }) => {
        if (error || !p) { console.error('[from_presupuesto]', error); return }
        // Pre-cargar cliente
        if (p.cliente) setCliente({ nombre: p.cliente, id: null })
        // Pre-cargar lista
        if (p.lista_id) setListaSel(String(p.lista_id))
        // Convertir ítems del presupuesto en ítems del carrito
        const cartItems = (p.items ?? []).flatMap(it => {
          if (it.tipo === 'medida' && (it.costo_unitario ?? 0) > 0) {
            const costoBase = it.costo_unitario ?? 0
            const listaObj  = listas.find(l => String(l.id) === String(p.lista_id)) ?? null
            return [{
              _key: nk(), productoId: null, esLibre: true, esCotizador: true,
              nombre:    it.nombre || 'Trabajo a medida',
              costoBase,
              precio:    precioVenta(costoBase, listaObj),
              cantidad:  it.cantidad ?? 1,
            }]
          }
          if (it.tipo === 'producto') {
            return [{
              _key: nk(), productoId: it.producto_id ?? null, esLibre: false,
              nombre:     it.nombre ?? '',
              sku:        it.sku ?? '',
              imagen_url: null,
              precio:     it.precio ?? 0,
              cantidad:   it.cantidad ?? 1,
            }]
          }
          return []
        })
        if (cartItems.length) setItems(cartItems)
      })
  }, [searchParams])   // eslint-disable-line react-hooks/exhaustive-deps

  // ── Historial completo ────────────────────────────────────────────────────
  const loadHistorialCompleto = useCallback(async () => {
    setHcLoading(true)
    let query = supabase
      .from('ventas')
      .select('id, numero, comprobante, cliente_nombre, forma_pago, hora, total, estado, fecha, factura_emitida')
      .order('numero', { ascending: false })
      .limit(500)
    if (hcDesde) query = query.gte('fecha', hcDesde)
    if (hcHasta) {
      const d = new Date(hcHasta + 'T00:00:00'); d.setDate(d.getDate() + 1)
      const sig = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
      query = query.lt('fecha', sig)
    }
    if (hcEstado) query = query.eq('estado', hcEstado)
    const { data, error } = await query
    if (error) console.error('[loadHistorialCompleto]', error)
    setHcVentas(data ?? [])
    setHcLoading(false)
  }, [hcDesde, hcHasta, hcEstado])

  useEffect(() => {
    if (showHistorialCompleto) loadHistorialCompleto()
  }, [showHistorialCompleto, loadHistorialCompleto])

  const hcFiltradas = useMemo(() => {
    const q = hcBusqueda.trim().toLowerCase()
    if (!q) return hcVentas
    return hcVentas.filter(v =>
      (v.cliente_nombre ?? 'Consumidor Final').toLowerCase().includes(q) ||
      String(v.numero ?? '').includes(q)
    )
  }, [hcVentas, hcBusqueda])

  // ── Autocomplete clientes ─────────────────────────────────────────────────
  useEffect(() => {
    const q = cliSearch.trim().toLowerCase()
    if (!q || cliente) { setCliResults([]); return }
    setCliResults(clientes.filter(c => c.nombre.toLowerCase().includes(q)).slice(0, 6))
  }, [cliSearch, clientes, cliente])

  // ── Lista activa (objeto completo) ───────────────────────────────────────
  const lista = useMemo(
    () => listas.find(l => String(l.id) === String(listaSel)) ?? null,
    [listas, listaSel],
  )

  // ── Productos agrupados por categoría, ordenados por SKU ────────────────
  const groupedProductos = useMemo(() => {
    const q = prodSearch.trim().toLowerCase()
    let list = productos
    if (q) list = list.filter(p => p.nombre.toLowerCase().includes(q) || (p.sku ?? '').toLowerCase().includes(q))

    const sortBySku = (a, b) => (a.sku ?? '').localeCompare(b.sku ?? '', undefined, { numeric: true, sensitivity: 'base' })

    if (catFiltro && !q) {
      // Categoría activa sin búsqueda: lista plana ordenada por SKU, sin encabezado
      const filtered = list.filter(p => String(p.categoria_id) === catFiltro).sort(sortBySku)
      return [{ categoria: categorias.find(c => String(c.id) === catFiltro) ?? null, productos: filtered, showHeader: false }]
    }

    // Todas: agrupar por categoría respetando el orden de `categorias`
    const bycat = {}
    for (const p of list) {
      const key = String(p.categoria_id ?? '__sin__')
      if (!bycat[key]) bycat[key] = []
      bycat[key].push(p)
    }
    const groups = categorias
      .filter(c => bycat[String(c.id)])
      .map(c => ({ categoria: c, productos: bycat[String(c.id)].sort(sortBySku), showHeader: true }))
    if (bycat['__sin__']) {
      groups.push({ categoria: null, productos: bycat['__sin__'].sort(sortBySku), showHeader: true })
    }
    return groups
  }, [productos, categorias, catFiltro, prodSearch])

  // ── Desglose del cotizador ───────────────────────────────────────────────
  const cotDesglose = useMemo(() => {
    let total = 0
    const lines = []
    for (const p of cotPiezas) {
      const mat  = materiales.find(m => m.id === Number(p.material_id))
      const base = calcInsumo(mat, p)
      const sub  = base * (1 + (Number(p.incremento) || 0) / 100)
      total += sub
      lines.push({ label: mat ? mat.nombre : 'Sin insumo', sub })
    }
    for (const ts of cotTarifas) {
      const tar  = tarifas.find(t => t.id === Number(ts.tarifa_id))
      const base = calcTarCost(tar, ts)
      const sub  = base * (1 + (Number(ts.incremento) || 0) / 100)
      total += sub
      lines.push({ label: tar ? `${tar.nombre} ${ts.fab_minutos}m ${ts.fab_segundos}s` : 'Sin tarifa', sub })
    }
    const precioUnitario = precioVenta(total, lista)
    return { lines, costoBase: total, precioUnitario, precioTotal: precioUnitario * (Number(cotCantidad) || 1) }
  }, [cotPiezas, cotTarifas, materiales, tarifas, lista, cotCantidad])

  // ── Totales ──────────────────────────────────────────────────────────────
  const subtotal  = useMemo(() => items.reduce((s, i) => s + i.precio * i.cantidad, 0), [items])
  // El descuento solo se aplica a los ítems que no fueron excluidos manualmente
  // (p.ej. productos que no admiten descuento por pago en efectivo).
  const itemsConDescuento = useMemo(() => items.filter(i => i.aplicaDescuento !== false), [items])
  const baseDescuento = useMemo(() => itemsConDescuento.reduce((s, i) => s + i.precio * i.cantidad, 0), [itemsConDescuento])
  const descPct   = Math.min(100, Math.max(0, Number(descuento) || 0))
  const descMonto = baseDescuento * (descPct / 100)
  const total     = subtotal - descMonto

  // ── Seleccionar cliente ──────────────────────────────────────────────────
  const selectCliente = (c) => {
    setCliente(c)
    setCliSearch('')
    setCliResults([])
    if (c.lista_id) setListaSel(String(c.lista_id))
  }

  // ── Crear nuevo cliente rápido ───────────────────────────────────────────
  const abrirNuevoCliente = () => {
    setNuevoCliForm({ nombre: cliSearch.trim(), telefono: '', email: '', direccion: '' })
    setCliResults([])
    setShowNuevoCliente(true)
  }

  const guardarNuevoCliente = async () => {
    if (!nuevoCliForm.nombre.trim() || nuevoCliSaving) return
    setNuevoCliSaving(true)
    const payload = {
      nombre:    nuevoCliForm.nombre.trim(),
      telefono:  nuevoCliForm.telefono.trim()  || null,
      email:     nuevoCliForm.email.trim()     || null,
      direccion: nuevoCliForm.direccion.trim() || null,
    }
    const { data, error } = await supabase.from('clientes').insert(payload).select().single()
    if (error) { alert('Error al crear cliente: ' + error.message); setNuevoCliSaving(false); return }
    setClientes(prev => [...prev, data].sort((a, b) => a.nombre.localeCompare(b.nombre)))
    selectCliente(data)
    setShowNuevoCliente(false)
    setNuevoCliForm({ nombre: '', telefono: '', email: '', direccion: '' })
    setNuevoCliSaving(false)
  }

  // ── Agregar producto al carrito ──────────────────────────────────────────
  const addProducto = (p) => {
    if (!listaSel) return   // bloquear si no hay lista elegida
    const precio = precioVenta(Number(p.costo_base) || 0, lista)
    setItems(prev => {
      const idx = prev.findIndex(i => i.productoId === p.id && !i.esLibre)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = { ...next[idx], cantidad: next[idx].cantidad + 1 }
        return next
      }
      return [...prev, { _key: nk(), productoId: p.id, nombre: p.nombre, sku: p.sku ?? '', imagen_url: p.imagen_url ?? null, precio, cantidad: 1, esLibre: false }]
    })
  }

  // ── Controles de cantidad ────────────────────────────────────────────────
  const updateQty  = (key, delta) =>
    setItems(prev => prev.map(i => i._key === key ? { ...i, cantidad: Math.max(1, i.cantidad + delta) } : i))
  const setQty     = (key, val) =>
    setItems(prev => prev.map(i => i._key === key ? { ...i, cantidad: Math.max(1, Number(val) || 1) } : i))
  const removeItem = (key) => setItems(prev => prev.filter(i => i._key !== key))
  const toggleDescItem = (key) =>
    setItems(prev => prev.map(i => i._key === key ? { ...i, aplicaDescuento: i.aplicaDescuento === false ? true : false } : i))

  // ── Recalcular precios al cambiar lista ───────────────────────────────────
  useEffect(() => {
    setItems(prev => prev.map(i => {
      // Ítems libres con costoBase (cotizador o inline): recalcular al cambiar lista
      if (i.esLibre && i.costoBase != null) {
        return { ...i, precio: precioVenta(i.costoBase, lista) }
      }
      // Ítems libres sin costoBase (no deberían existir, pero por si acaso): no tocar
      if (i.esLibre) return i
      // Productos normales
      const p = productos.find(p => p.id === i.productoId)
      if (!p) return i
      return { ...i, precio: precioVenta(Number(p.costo_base) || 0, lista) }
    }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lista])

  // ── Agregar ítem libre (modal) ────────────────────────────────────────────
  const addCustom = () => {
    if (!customForm.descripcion.trim()) { setCustomErr('Ingresá una descripción.'); return }
    if (!customForm.precio || Number(customForm.precio) <= 0) { setCustomErr('Ingresá un precio mayor a 0.'); return }
    setItems(prev => [...prev, {
      _key: nk(), productoId: null,
      nombre: customForm.descripcion.trim(),
      // Sin costoBase: es el precio final tal cual lo escribe el vendedor,
      // no un costo al que haya que aplicarle el margen de la lista.
      precio: Number(customForm.precio),
      cantidad: Number(customForm.cantidad) || 1, esLibre: true,
    }])
    setCustomForm({ descripcion: '', precio: '', cantidad: 1 })
    setCustomErr('')
    setShowCustom(false)
  }

  // ── Agregar ítem libre (inline en la lista) ───────────────────────────────
  const addInlineLibre = () => {
    if (!inlineLibre.descripcion.trim()) { setInlineErr('Descripción requerida'); return }
    if (!inlineLibre.precio || Number(inlineLibre.precio) <= 0) { setInlineErr('Precio inválido'); return }
    setItems(prev => [...prev, {
      _key: nk(), productoId: null,
      nombre:    inlineLibre.descripcion.trim(),
      // Sin costoBase: es el precio final tal cual lo escribe el vendedor,
      // no un costo al que haya que aplicarle el margen de la lista.
      precio:    Number(inlineLibre.precio),
      cantidad:  Number(inlineLibre.cantidad) || 1, esLibre: true,
    }])
    setInlineLibre({ descripcion: '', precio: '', cantidad: 1 })
    setInlineErr('')
  }

  // ── Confirmar venta ───────────────────────────────────────────────────────
  const confirmarVenta = async () => {
    if (items.length === 0 || saving) return
    setSaving(true)

    // Número correlativo
    const { data: maxData } = await supabase
      .from('ventas').select('numero').order('numero', { ascending: false }).limit(1)
    const numero = (maxData?.[0]?.numero ?? 0) + 1

    const estado = formaPago === 'cuenta_corriente' ? 'pendiente' : 'pagado'

    const ventaPayload = {
      numero,
      fecha,
      hora:                 nowTime(),
      cliente_id:           cliente?.id ?? null,
      cliente_nombre:       cliente?.nombre ?? 'Consumidor Final',
      lista_id:             listaSel || null,
      lista_nombre:         lista?.nombre ?? null,
      comprobante,
      subtotal_items:       subtotal,
      descuento_porcentaje: descPct,
      descuento_monto:      descMonto,
      total,
      forma_pago:           formaPago,
      estado,
      notas:                descPct > 0 ? (razonDescuento.trim() || null) : null,
      org_id:               orgId,
    }

    const { data: ventaData, error: ventaErr } = await supabase
      .from('ventas').insert(ventaPayload).select().single()
    if (ventaErr) { alert('Error al guardar: ' + ventaErr.message); setSaving(false); return }

    const itemsPayload = items.map(i => ({
      venta_id:        ventaData.id,
      tipo:            i.esLibre ? 'custom' : 'producto',
      producto_id:     i.productoId ?? null,
      descripcion:     i.nombre,
      sku:             i.sku || '',
      cantidad:        i.cantidad,
      precio_unitario: i.precio,
      subtotal:        i.precio * i.cantidad,
      es_libre:        i.esLibre,
    }))

    // Insertar ítem por ítem para evitar que una constraint/RLS descarte filas silenciosamente
    const itemResults = await Promise.all(
      itemsPayload.map(ip => supabase.from('venta_items').insert(ip).select('id').single())
    )
    const firstErr = itemResults.find(r => r.error)
    if (firstErr) {
      const msg = firstErr.error.code === 'PGRST116'
        ? 'No se pudo guardar uno o más artículos (sin permiso). Revisá la configuración de la base de datos.'
        : 'Error en los ítems: ' + firstErr.error.message
      alert(msg)
      // Limpiar: borrar los ítems que sí se guardaron y la venta
      await supabase.from('venta_items').delete().eq('venta_id', ventaData.id)
      await supabase.from('ventas').delete().eq('id', ventaData.id)
      setSaving(false)
      return
    }

    // Cuenta corriente → actualizar saldo del cliente
    if (formaPago === 'cuenta_corriente' && cliente?.id) {
      const saldoActual = Number(cliente.saldo) || 0
      await supabase.from('clientes').update({ saldo: saldoActual - total }).eq('id', cliente.id)
      setCliente(c => c ? { ...c, saldo: (Number(c.saldo) || 0) - total } : c)
    }

    // Factura C → emitir a ARCA automáticamente
    let arcaResult = null
    if (comprobante === 'factura_c' && arcaConfig) {
      try {
        const { data: arcaData } = await supabase.functions.invoke('emitir-factura', {
          body: {
            accion:     'emitir',
            ventaId:    ventaData.id,
            concepto:   1,
            docTipo:    99,
            docNro:     '0',
            importeTotal: total,
          }
        })
        if (arcaData?.ok) {
          arcaResult = arcaData
          await supabase.from('ventas').update({
            cae:             arcaData.cae,
            cae_vto:         arcaData.caeVto,
            nro_factura:     arcaData.nroFactura,
            factura_emitida: true,
          }).eq('id', ventaData.id)
        }
      } catch (e) {
        console.warn('[ARCA] Error al emitir automáticamente:', e.message)
      }
    }

    try { localStorage.removeItem(draftKey) } catch { /* noop */ }
    setSavedVenta({ ...ventaData, items, arcaResult })
    setSaving(false)
    setShowSuccess(true)
    loadVentasHoy()
  }

  // ── Cotizador: helpers de piezas y tarifas ───────────────────────────────
  const setCotPieza = (i, k, v) => setCotPiezas(prev => prev.map((p, idx) => idx === i ? { ...p, [k]: v } : p))
  const addCotPieza = () => { const idx = cotPiezas.length; setCotPiezas(p => [...p, { ...blankPieza }]); setCotExpPiezas(e => ({ ...e, [idx]: true })) }
  const remCotPieza = (i) => { setCotPiezas(p => p.filter((_, idx) => idx !== i)); setCotExpPiezas(e => { const n = { ...e }; delete n[i]; return n }) }

  const setCotTarifa = (i, k, v) => setCotTarifas(prev => prev.map((t, idx) => idx === i ? { ...t, [k]: v } : t))
  const addCotTarifa = () => { const idx = cotTarifas.length; setCotTarifas(t => [...t, { ...blankTarifaSel }]); setCotExpTarifas(e => ({ ...e, [idx]: true })) }
  const remCotTarifa = (i) => { setCotTarifas(t => t.filter((_, idx) => idx !== i)); setCotExpTarifas(e => { const n = { ...e }; delete n[i]; return n }) }

  const agregarCotizadorAlCarrito = () => {
    const desc = cotDesc.trim() || 'Corte especial'
    setItems(prev => [...prev, {
      _key: nk(), productoId: null,
      nombre: desc,
      costoBase: cotDesglose.costoBase,       // guardamos el costo para poder recalcular si cambia la lista
      precio: cotDesglose.precioUnitario,
      cantidad: Number(cotCantidad) || 1,
      esLibre: true,
      esCotizador: true,
    }])
    // Reset cotizador
    setCotDesc(''); setCotCantidad(1)
    setCotPiezas([{ ...blankPieza }]); setCotTarifas([{ ...blankTarifaSel }])
    setCotExpPiezas({ 0: true }); setCotExpTarifas({ 0: true })
    setShowCotizador(false)
  }

  // ── Nueva venta (reset) ───────────────────────────────────────────────────
  const nuevaVenta = () => {
    setItems([])
    setDescuento('')
    setRazonDescuento('')
    setFormaPago('efectivo')
    setCliente(null)
    setCliSearch('')
    setCliEditMode(false)
    setComprobante('ticket')
    setListaSel('')
    setFecha(todayStr())   // siempre resetear al día actual
    setShowSuccess(false)
    setSavedVenta(null)
    setTimeout(() => prodSearchRef.current?.focus(), 100)
  }

  const compInfo = COMPROBANTES.find(c => c.value === comprobante) ?? COMPROBANTES[0]
  const totalVentasHoy = ventasHoy.reduce((s, v) => s + (v.total ?? 0), 0)

  // ════════════════════════════════════════════════════════════════════════
  return (
    <div className="pos-root" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ══════════════════════════════════════════════════════════
          BARRA SUPERIOR
      ══════════════════════════════════════════════════════════ */}
      <div className="pos-topbar" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0, flexWrap: 'wrap' }}>

        {/* Fecha */}
        <input
          className="pos-fecha"
          type="date" value={fecha} onChange={e => setFecha(e.target.value)}
          style={inp({ width: 136 })}
        />

        {/* Búsqueda / tarjeta de cliente */}
        <div className="pos-cliente-row" style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 220 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            {cliente ? (
              /* ── Cliente seleccionado ── */
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', border: '1px solid var(--primary)', borderRadius: 6, background: 'var(--bg-highlight)' }}>
                <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--primary)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, flexShrink: 0 }}>
                  {cliente.nombre.charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cliente.nombre}</div>
                  <div style={{ fontSize: 11, color: (Number(cliente.saldo) || 0) < 0 ? '#dc2626' : '#16a34a' }}>
                    {(Number(cliente.saldo) || 0) < 0 ? `Debe ${fmtMoney(Math.abs(cliente.saldo))}` : 'Al día ✓'}
                    {lista && <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>· {lista.nombre}</span>}
                  </div>
                </div>
                <button onClick={() => { setCliente(null); setCliSearch(''); setCliEditMode(false) }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16, padding: '0 2px' }}>✕</button>
              </div>
            ) : cliEditMode ? (
              /* ── Modo búsqueda activo ── */
              <>
                <input
                  autoFocus
                  style={inp({ paddingLeft: 34 })}
                  placeholder="👤 Buscar cliente..."
                  value={cliSearch}
                  onChange={e => setCliSearch(e.target.value)}
                  onBlur={() => { if (!cliSearch.trim()) setCliEditMode(false) }}
                />
                {cliSearch.trim() && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', marginTop: 2 }}>
                    <div
                      onClick={() => { setCliente(null); setCliSearch(''); setCliEditMode(false); setCliResults([]) }}
                      style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', cursor: 'pointer', fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-muted)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-card)'}
                    >
                      Consumidor Final (sin cliente)
                    </div>
                    {cliResults.length === 0 && (
                      <div style={{ padding: '8px 12px', fontSize: 13, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
                        Sin coincidencias para "{cliSearch.trim()}"
                      </div>
                    )}
                    {cliResults.map(c => {
                      const listaC = listas.find(l => String(l.id) === String(c.lista_id))
                      const saldo = Number(c.saldo) || 0
                      return (
                        <div key={c.id} onClick={() => { selectCliente(c); setCliEditMode(false) }}
                          style={{ padding: '9px 12px', borderBottom: '1px solid var(--border)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-muted)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-card)'}
                        >
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{c.nombre}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{listaC?.nombre ?? 'Sin lista asignada'}</div>
                          </div>
                          <span style={{ fontSize: 12, fontWeight: 700, color: saldo < 0 ? '#dc2626' : '#16a34a', whiteSpace: 'nowrap' }}>
                            {saldo < 0 ? `Debe ${fmtMoney(Math.abs(saldo))}` : 'Al día'}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </>
            ) : (
              /* ── Consumidor Final (por defecto) ── */
              <div
                onClick={() => setCliEditMode(true)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', cursor: 'pointer' }}
                title="Clic para asignar un cliente"
              >
                <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#e2e8f0', color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 }}>
                  👤
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>Consumidor Final</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Clic para asignar cliente</div>
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>✎</span>
              </div>
            )}
          </div>

          {/* Botón nuevo cliente */}
          {!cliente && (
            <button
              onClick={abrirNuevoCliente}
              title="Crear nuevo cliente"
              style={{ flexShrink: 0, padding: '7px 11px', borderRadius: 6, border: '1px solid var(--primary)', background: 'var(--bg-card)', color: 'var(--primary)', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              + Nuevo
            </button>
          )}
        </div>

        {/* Lista de precios */}
        <div className="pos-lista-wrap" style={{ position: 'relative', flexShrink: 0 }}>
          <select
            value={listaSel}
            onChange={e => setListaSel(e.target.value)}
            style={inp({ width: 160, borderColor: !listaSel ? '#f59e0b' : undefined, fontWeight: !listaSel ? 700 : undefined, color: !listaSel ? 'var(--warning)' : undefined })}
          >
            <option value="">⚠ Elegir lista...</option>
            {listas.map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}
          </select>
        </div>

        {/* Selector de comprobante */}
        <div className="pos-comprobante-wrap" style={{ position: 'relative', flexShrink: 0 }}>
          <select
            value={comprobante}
            onChange={e => setComprobante(e.target.value)}
            style={{ ...inp({ width: 148, paddingLeft: 10, fontWeight: 700, color: compInfo.color, background: compInfo.bg, borderColor: compInfo.color, cursor: 'pointer' }) }}
          >
            {COMPROBANTES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>

        {/* Ventas del día */}
        <button onClick={() => setShowHistorial(true)}
          className="pos-btn-hoy"
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>
          🧾 Hoy
          {ventasHoy.length > 0 && (
            <span style={{ background: 'var(--primary)', color: 'white', borderRadius: 10, fontSize: 11, padding: '1px 7px', fontWeight: 700 }}>{ventasHoy.length}</span>
          )}
        </button>

        {/* Historial completo */}
        <button onClick={() => setShowHistorialCompleto(true)}
          className="pos-btn-historial"
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>
          📋 Historial
        </button>
      </div>

      {/* ══════════════════════════════════════════════════════════
          PANEL PRINCIPAL — Productos (izq) + Carrito (der)
      ══════════════════════════════════════════════════════════ */}
      {/* Tab bar mobile */}
      <div className="pos-tab-bar" style={{ display: 'none', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <button
          onClick={() => setMobilePestaña('productos')}
          className={`pos-tab-btn${mobilePestaña === 'productos' ? ' activo' : ''}`}
        >
          📦 Productos
        </button>
        <button
          onClick={() => setMobilePestaña('carrito')}
          className={`pos-tab-btn${mobilePestaña === 'carrito' ? ' activo' : ''}`}
        >
          🛒 Carrito {items.length > 0 && `(${items.length})`}
        </button>
      </div>

      <div className="pos-main" style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '1.15fr 1fr', overflow: 'hidden' }}>

        {/* ──────────────────────────────────────────────────────
            IZQUIERDA — Grilla de productos
        ────────────────────────────────────────────────────── */}
        <div className={`pos-panel-productos${mobilePestaña === 'productos' ? ' activo' : ''}`} style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid var(--border)' }}>

          {/* Buscador + tabs de categorías */}
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              ref={prodSearchRef}
              style={inp()}
              placeholder="🔍 Buscar por nombre o código..."
              value={prodSearch}
              onChange={e => setProdSearch(e.target.value)}
            />
            <div style={{ display: 'flex', gap: 5, overflowX: 'auto', paddingBottom: 2 }}>
              <button onClick={() => setCatFiltro('')} style={tabBtn(!catFiltro)}>Todos</button>
              {categorias.map(c => (
                <button key={c.id} onClick={() => setCatFiltro(String(c.id))} style={tabBtn(catFiltro === String(c.id))}>
                  {c.nombre}
                </button>
              ))}
            </div>
          </div>

          {/* Lista de productos agrupada por categoría */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {groupedProductos.every(g => g.productos.length === 0) ? (
              <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)', fontSize: 13 }}>
                {prodSearch ? 'Sin resultados para tu búsqueda.' : 'No hay productos.'}
              </div>
            ) : (
              groupedProductos.map((group) => (
                <div key={group.categoria?.id ?? '__sin__'}>
                  {/* Encabezado de categoría */}
                  {group.showHeader && group.productos.length > 0 && (
                    <div style={{ padding: '5px 14px 4px', background: 'var(--bg-muted)', borderBottom: '1px solid var(--border)', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, position: 'sticky', top: 0, zIndex: 2 }}>
                      <span style={{ fontSize: 11, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        {group.categoria?.nombre ?? 'Sin categoría'}
                      </span>
                      <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 500 }}>{group.productos.length} productos</span>
                    </div>
                  )}
                  {/* Filas de producto */}
                  {group.productos.map((p, idx) => {
                    const precio  = precioVenta(Number(p.costo_base) || 0, lista)
                    const inCart  = items.some(i => i.productoId === p.id)
                    const cartQty = items.find(i => i.productoId === p.id)?.cantidad
                    return (
                      <div key={p.id} onClick={() => addProducto(p)}
                        title={!listaSel ? 'Elegí una lista de precios primero' : undefined}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 14px', borderBottom: '1px solid var(--border)', background: inCart ? 'var(--bg-highlight)' : idx % 2 === 1 ? 'var(--surface)' : 'transparent', cursor: listaSel ? 'pointer' : 'not-allowed', opacity: listaSel ? 1 : 0.5, transition: 'background 0.1s' }}
                        onMouseEnter={e => { if (listaSel) e.currentTarget.style.background = 'var(--primary-faint)' }}
                        onMouseLeave={e => { e.currentTarget.style.background = inCart ? 'var(--bg-highlight)' : idx % 2 === 1 ? 'var(--surface)' : 'transparent' }}
                      >
                        <ImageThumb src={p.imagen_url} size={34} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: inCart ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: inCart ? 'var(--primary)' : 'var(--text)' }}>
                            {p.nombre}
                          </div>
                          {p.sku && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{p.sku}</div>}
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 800, whiteSpace: 'nowrap', flexShrink: 0, color: listaSel ? 'var(--primary)' : '#94a3b8' }}>
                          {listaSel ? fmtMoney(precio) : '—'}
                        </div>
                        {inCart && (
                          <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--primary)', color: 'white', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            {cartQty}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              ))
            )}
          </div>

          {/* ── Ítem libre inline + botón cotizador ── */}
          <div style={{ borderTop: '2px dashed var(--border)', padding: '7px 14px', flexShrink: 0, background: 'var(--bg-muted)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: '#6366f1', textTransform: 'uppercase', letterSpacing: '0.06em' }}>✏️ Ítem libre</div>
              <button onClick={() => setShowCotizador(true)}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 11px', borderRadius: 6, border: '1px solid var(--warning-border)', background: 'var(--warning-bg)', color: 'var(--warning)', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                ✂️ Cotizar corte especial
              </button>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                placeholder="Descripción del ítem..."
                value={inlineLibre.descripcion}
                onChange={e => { setInlineLibre(p => ({ ...p, descripcion: e.target.value })); setInlineErr('') }}
                onKeyDown={e => e.key === 'Enter' && addInlineLibre()}
                style={{ flex: 1, padding: '6px 9px', fontSize: 13, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-card)', color: 'inherit', outline: 'none', minWidth: 0 }}
              />
              <input
                type="number" placeholder="$" step="0.01"
                value={inlineLibre.precio}
                onChange={e => { setInlineLibre(p => ({ ...p, precio: e.target.value })); setInlineErr('') }}
                onKeyDown={e => e.key === 'Enter' && addInlineLibre()}
                style={{ width: 80, padding: '6px 9px', fontSize: 13, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-card)', color: 'inherit', outline: 'none', textAlign: 'right' }}
              />
              <input
                type="number" placeholder="×1" min={1}
                value={inlineLibre.cantidad}
                onChange={e => setInlineLibre(p => ({ ...p, cantidad: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && addInlineLibre()}
                style={{ width: 50, padding: '6px 7px', fontSize: 13, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-card)', color: 'inherit', outline: 'none', textAlign: 'center' }}
              />
              <button onClick={addInlineLibre}
                style={{ padding: '6px 13px', borderRadius: 6, border: 'none', background: '#6366f1', color: 'white', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
                + Agregar
              </button>
            </div>
            {inlineErr && <div style={{ fontSize: 11, color: '#dc2626', marginTop: 3 }}>{inlineErr}</div>}
          </div>
        </div>

        {/* ──────────────────────────────────────────────────────
            DERECHA — Carrito / Ticket
        ────────────────────────────────────────────────────── */}
        <div className={`pos-panel-carrito${mobilePestaña === 'carrito' ? ' activo' : ''}`} style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Aviso: sin lista */}
          {!listaSel && (
            <div style={{ margin: '8px 12px 0', padding: '8px 12px', borderRadius: 7, background: 'var(--warning-bg)', border: '1px solid var(--warning-border)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <span style={{ fontSize: 16 }}>⚠️</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--warning)' }}>Elegí una lista de precios para poder agregar productos.</span>
            </div>
          )}

          {/* Lista de ítems */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 5 }}>
            {items.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 10, color: 'var(--text-muted)' }}>
                <span style={{ fontSize: 40 }}>🛒</span>
                <span style={{ fontSize: 13 }}>El carrito está vacío</span>
                <span style={{ fontSize: 12 }}>Hacé clic en un producto para agregar</span>
              </div>
            ) : (
              items.map(item => (
                <div className="pos-cart-row" key={item._key} style={{ display: 'flex', gap: 8, padding: '8px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', alignItems: 'center' }}>
                  {descPct > 0 && (
                    <input type="checkbox" className="pos-cart-check" checked={item.aplicaDescuento !== false} onChange={() => toggleDescItem(item._key)}
                      title="Aplicar descuento a este ítem" style={{ width: 16, height: 16, flexShrink: 0, cursor: 'pointer' }} />
                  )}
                  {item.imagen_url && (
                    <span className="pos-cart-thumb" style={{ display: 'flex', flexShrink: 0 }}>
                      <ImageThumb src={item.imagen_url} size={38} radius={5} />
                    </span>
                  )}
                  <div className="pos-cart-info" style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 1 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.nombre}</span>
                    </div>
                    {item.sku && <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace', marginBottom: 1 }}>SKU: {item.sku}</div>}
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fmtMoney(item.precio)} c/u</div>
                  </div>
                  {/* Controles de cantidad */}
                  <div className="pos-cart-qty" style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                    <button onClick={() => updateQty(item._key, -1)}
                      style={{ width: 26, height: 26, borderRadius: 4, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text)' }}>−</button>
                    <input type="number" value={item.cantidad} onChange={e => setQty(item._key, e.target.value)}
                      style={{ width: 40, textAlign: 'center', padding: '2px 4px', fontSize: 13, border: '1px solid var(--border)', borderRadius: 4, background: 'var(--surface)', color: 'inherit', outline: 'none' }} />
                    <button onClick={() => updateQty(item._key, +1)}
                      style={{ width: 26, height: 26, borderRadius: 4, border: 'none', background: 'var(--primary)', color: 'white', cursor: 'pointer', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                  </div>
                  <div className="pos-cart-total" style={{ fontSize: 14, fontWeight: 700, minWidth: 64, textAlign: 'right', flexShrink: 0 }}>{fmtMoney(item.precio * item.cantidad)}</div>
                  <button className="pos-cart-remove" onClick={() => removeItem(item._key)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 15, padding: '2px 3px', flexShrink: 0 }}>✕</button>
                </div>
              ))
            )}
          </div>

          {/* Footer: descuento / pago / totales / confirmar */}
          <div style={{ borderTop: '2px solid var(--border)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 9, flexShrink: 0 }}>

            {/* Descuento + Forma de pago */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: 8 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>Descuento (%)</label>
                <input type="number" min={0} max={100} placeholder="0"
                  value={descuento} onChange={e => setDescuento(e.target.value)}
                  style={{ padding: '6px 9px', fontSize: 14, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', color: 'inherit', width: '100%', boxSizing: 'border-box', outline: 'none' }}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>Forma de pago</label>
                <select value={formaPago} onChange={e => setFormaPago(e.target.value)}
                  style={{ padding: '6px 9px', fontSize: 13, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', color: 'inherit', width: '100%', boxSizing: 'border-box', outline: 'none' }}>
                  {FORMAS_PAGO.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </div>
            </div>

            {descPct > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>Motivo del descuento (opcional)</label>
                <input type="text" placeholder="Ej: pago en efectivo" value={razonDescuento} onChange={e => setRazonDescuento(e.target.value)}
                  style={{ padding: '6px 9px', fontSize: 13, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', color: 'inherit', width: '100%', boxSizing: 'border-box', outline: 'none' }}
                />
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  Tildá arriba, en cada ítem del carrito, cuáles reciben el descuento ({itemsConDescuento.length} de {items.length} lo tienen aplicado).
                </span>
              </div>
            )}

            {/* Totales */}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text-muted)' }}>
                <span>Subtotal</span><span style={{ fontWeight: 600 }}>{fmtMoney(subtotal)}</span>
              </div>
              {descMonto > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#dc2626' }}>
                  <span>Descuento ({descPct}% · {itemsConDescuento.length}/{items.length} ítems)</span><span>−{fmtMoney(descMonto)}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 22, fontWeight: 800, color: 'var(--primary)', marginTop: 4 }}>
                <span>Total</span><span>{fmtMoney(total)}</span>
              </div>
            </div>

            {/* CTA */}
            <button onClick={confirmarVenta} disabled={items.length === 0 || saving}
              style={{ width: '100%', padding: '13px', borderRadius: 8, border: 'none', background: items.length === 0 ? '#e2e8f0' : 'var(--primary)', color: items.length === 0 ? '#94a3b8' : 'white', fontSize: 16, fontWeight: 800, cursor: items.length === 0 ? 'not-allowed' : 'pointer', transition: 'all 0.15s', letterSpacing: '0.01em' }}>
              {saving ? '⏳ Procesando...' : '✔ Confirmar venta'}
            </button>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════
          MODAL — Ítem libre
      ══════════════════════════════════════════════════════════ */}
      {showCustom && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--bg)', borderRadius: 10, padding: 24, width: 380, boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16 }}>✏️ Agregar ítem libre</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Descripción</label>
                <input style={inp()} placeholder="Ej: Servicio de instalación"
                  value={customForm.descripcion} onChange={e => setCustomForm(p => ({ ...p, descripcion: e.target.value }))} autoFocus />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Precio unitario</label>
                  <input style={inp()} type="number" step="0.01" placeholder="0.00"
                    value={customForm.precio} onChange={e => setCustomForm(p => ({ ...p, precio: e.target.value }))} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Cantidad</label>
                  <input style={inp()} type="number" min={1}
                    value={customForm.cantidad} onChange={e => setCustomForm(p => ({ ...p, cantidad: e.target.value }))} />
                </div>
              </div>
              {customErr && <div style={{ fontSize: 12, color: '#dc2626', fontWeight: 500 }}>{customErr}</div>}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
              <button onClick={() => { setShowCustom(false); setCustomErr('') }}
                style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontSize: 13 }}>Cancelar</button>
              <button onClick={addCustom}
                style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: 'var(--primary)', color: 'white', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>Agregar</button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          MODAL — Cotizador de corte especial
      ══════════════════════════════════════════════════════════ */}
      {showCotizador && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: 'var(--bg)', borderRadius: 12, width: '100%', maxWidth: 700, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 16px 48px rgba(0,0,0,0.3)' }}>

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 18px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--warning-bg)', borderRadius: '12px 12px 0 0' }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--warning)' }}>✂️ Cotizador de corte especial</div>
                <div style={{ fontSize: 12, color: '#b45309', marginTop: 2 }}>Calculá el costo y agregalo directo al carrito</div>
              </div>
              <button onClick={() => setShowCotizador(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--text-muted)' }}>✕</button>
            </div>

            {/* Body — 2 columnas: izq=calc, der=resumen */}
            <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '1fr 220px', overflow: 'hidden' }}>

              {/* ── Columna izquierda: descripción + piezas + tarifas ── */}
              <div style={{ overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12, borderRight: '1px solid var(--border)' }}>

                {/* Descripción y cantidad */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>Descripción del ítem</label>
                    <input style={{ ...inp(), fontSize: 13 }} placeholder="Ej: Corte especial melamina blanca..."
                      value={cotDesc} onChange={e => setCotDesc(e.target.value)} autoFocus />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>Cantidad</label>
                    <input type="number" min={1} style={{ ...inp({ width: 64 }), fontSize: 13, textAlign: 'center' }}
                      value={cotCantidad} onChange={e => setCotCantidad(e.target.value)} />
                  </div>
                </div>

                {/* MATERIALES */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid var(--border)', paddingBottom: 4 }}>Materiales / Piezas</div>
                  {cotPiezas.map((p, i) => {
                    const mat  = materiales.find(m => m.id === Number(p.material_id))
                    const tipo = mat?.tipo_medida || 'placa'
                    return (
                      <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 9px', background: cotExpPiezas[i] ? 'var(--bg-highlight)' : 'var(--surface)', cursor: 'pointer' }}
                          onClick={() => setCotExpPiezas(e => ({ ...e, [i]: !e[i] }))}>
                          <span style={{ fontSize: 10, color: 'var(--text-muted)', width: 10 }}>{cotExpPiezas[i] ? '▾' : '▸'}</span>
                          <span style={{ flex: 1, fontSize: 12 }}>{mat ? mat.nombre : `Pieza ${i + 1}`}</span>
                          {cotPiezas.length > 1 && <button onClick={e => { e.stopPropagation(); remCotPieza(i) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 12 }}>✕</button>}
                        </div>
                        {cotExpPiezas[i] && (
                          <div style={{ padding: '8px 10px', borderTop: '1px solid var(--border)', background: 'var(--bg-muted)' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                              <div style={{ gridColumn: 'span 2', display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)' }}>Insumo</label>
                                <select style={{ ...inp(), fontSize: 12, padding: '5px 7px' }} value={p.material_id} onChange={e => setCotPieza(i, 'material_id', e.target.value)}>
                                  <option value="">— Seleccionar —</option>
                                  {materiales.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
                                </select>
                              </div>
                              {tipo === 'placa' && (<>
                                {[['Ancho (cm)', 'ancho', 0.1], ['Alto (cm)', 'alto', 0.1], ['Cantidad', 'cantidad', 1]].map(([lbl, key, step]) => (
                                  <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                    <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)' }}>{lbl}</label>
                                    <input type="number" step={step} style={{ ...inp(), fontSize: 12, padding: '5px 7px' }} value={p[key]} onChange={e => setCotPieza(i, key, e.target.value)} />
                                  </div>
                                ))}
                              </>)}
                              {tipo === 'peso'    && <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)' }}>Gramos</label><input type="number" step="0.1" style={{ ...inp(), fontSize: 12, padding: '5px 7px' }} value={p.gramos || 0} onChange={e => setCotPieza(i, 'gramos', e.target.value)} /></div>}
                              {tipo === 'unidad'  && <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)' }}>Cantidad</label><input type="number" style={{ ...inp(), fontSize: 12, padding: '5px 7px' }} value={p.cantidad} onChange={e => setCotPieza(i, 'cantidad', e.target.value)} /></div>}
                              {tipo === 'longitud'&& <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)' }}>Metros</label><input type="number" step="0.01" style={{ ...inp(), fontSize: 12, padding: '5px 7px' }} value={p.metros || 0} onChange={e => setCotPieza(i, 'metros', e.target.value)} /></div>}
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)' }}>Incremento (%)</label>
                                <input type="number" step="0.1" placeholder="0" style={{ ...inp(), fontSize: 12, padding: '5px 7px' }} value={p.incremento} onChange={e => setCotPieza(i, 'incremento', e.target.value)} />
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                  <div style={{ textAlign: 'right' }}>
                    <button onClick={addCotPieza} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontWeight: 600 }}>+ Agregar pieza</button>
                  </div>
                </div>

                {/* TARIFAS */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid var(--border)', paddingBottom: 4 }}>Tarifas de fabricación</div>
                  {cotTarifas.map((ts, i) => {
                    const tar = tarifas.find(t => t.id === Number(ts.tarifa_id))
                    return (
                      <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 9px', background: cotExpTarifas[i] ? 'var(--bg-highlight)' : 'var(--surface)', cursor: 'pointer' }}
                          onClick={() => setCotExpTarifas(e => ({ ...e, [i]: !e[i] }))}>
                          <span style={{ fontSize: 10, color: 'var(--text-muted)', width: 10 }}>{cotExpTarifas[i] ? '▾' : '▸'}</span>
                          <span style={{ flex: 1, fontSize: 12 }}>{tar ? `${tar.nombre} — ${ts.fab_minutos}m ${ts.fab_segundos}s` : `Tarifa ${i + 1}`}</span>
                          {cotTarifas.length > 1 && <button onClick={e => { e.stopPropagation(); remCotTarifa(i) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 12 }}>✕</button>}
                        </div>
                        {cotExpTarifas[i] && (
                          <div style={{ padding: '8px 10px', borderTop: '1px solid var(--border)', background: 'var(--bg-muted)' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 6 }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)' }}>Tarifa</label>
                                <select style={{ ...inp(), fontSize: 12, padding: '5px 7px' }} value={ts.tarifa_id} onChange={e => setCotTarifa(i, 'tarifa_id', e.target.value)}>
                                  <option value="">— Seleccionar —</option>
                                  {tarifas.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                                </select>
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)' }}>Minutos</label>
                                <input type="number" min={0} style={{ ...inp(), fontSize: 12, padding: '5px 7px' }} value={ts.fab_minutos} onChange={e => setCotTarifa(i, 'fab_minutos', e.target.value)} />
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)' }}>Segundos</label>
                                <input type="number" min={0} max={59} style={{ ...inp(), fontSize: 12, padding: '5px 7px' }}
                                  value={ts.fab_segundos}
                                  onChange={e => setCotTarifa(i, 'fab_segundos', e.target.value)}
                                  onBlur={e => { const { segs, extraMins } = snapSegs(e.target.value); setCotTarifa(i, 'fab_segundos', segs); if (extraMins) setCotTarifa(i, 'fab_minutos', (Number(ts.fab_minutos) || 0) + extraMins) }} />
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)' }}>Incremento (%)</label>
                                <input type="number" step="0.1" placeholder="0" style={{ ...inp(), fontSize: 12, padding: '5px 7px' }} value={ts.incremento} onChange={e => setCotTarifa(i, 'incremento', e.target.value)} />
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                  <div style={{ textAlign: 'right' }}>
                    <button onClick={addCotTarifa} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontWeight: 600 }}>+ Agregar tarifa</button>
                  </div>
                </div>
              </div>

              {/* ── Columna derecha: resumen de costo ── */}
              <div style={{ padding: '14px 14px', display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--bg-muted)', overflowY: 'auto' }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Resumen</div>

                {/* Desglose línea a línea */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {cotDesglose.lines.map((l, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, borderBottom: '1px solid var(--border)', paddingBottom: 2 }}>
                      <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '58%' }}>{l.label}</span>
                      <span style={{ fontWeight: 600 }}>{fmtMoney(l.sub)}</span>
                    </div>
                  ))}
                </div>

                {/* Costo base */}
                <div style={{ background: '#ecfeff', border: '1px solid #a5f3fc', borderRadius: 6, padding: '7px 9px' }}>
                  <div style={{ fontSize: 10, color: '#0369a1', fontWeight: 700, textTransform: 'uppercase' }}>Costo base</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: '#0369a1' }}>{fmtMoney(cotDesglose.costoBase)}</div>
                </div>

                {/* Precio con lista */}
                <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 9px' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                    Precio {lista ? `(${lista.nombre})` : 'sin lista'}
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--primary)' }}>{fmtMoney(cotDesglose.precioUnitario)}</div>
                  {Number(cotCantidad) > 1 && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                      × {cotCantidad} = <strong>{fmtMoney(cotDesglose.precioTotal)}</strong>
                    </div>
                  )}
                </div>

                <div style={{ flex: 1 }} />

                {/* CTA */}
                <button
                  onClick={agregarCotizadorAlCarrito}
                  disabled={cotDesglose.precioUnitario <= 0}
                  style={{ width: '100%', padding: '10px 8px', borderRadius: 7, border: 'none', background: cotDesglose.precioUnitario > 0 ? '#f59e0b' : '#e2e8f0', color: cotDesglose.precioUnitario > 0 ? 'white' : '#94a3b8', fontSize: 13, fontWeight: 800, cursor: cotDesglose.precioUnitario > 0 ? 'pointer' : 'not-allowed' }}>
                  🛒 Agregar al carrito
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          MODAL — Venta confirmada ✅
      ══════════════════════════════════════════════════════════ */}
      {showSuccess && savedVenta && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--bg)', borderRadius: 14, padding: '28px 32px', width: 460, boxShadow: '0 16px 48px rgba(0,0,0,0.3)' }}>
            <div style={{ textAlign: 'center', marginBottom: 22 }}>
              <div style={{ fontSize: 52 }}>✅</div>
              <div style={{ fontSize: 22, fontWeight: 800, marginTop: 10 }}>¡Venta confirmada!</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: compInfo.color, background: compInfo.bg, padding: '2px 10px', borderRadius: 5 }}>
                  {compInfo.label} #{padNum(savedVenta.numero)}
                </span>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{savedVenta.hora}</span>
              </div>
            </div>

            {/* Resumen */}
            <div style={{ background: 'var(--surface)', borderRadius: 9, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 7, fontSize: 13 }}>
              {[
                ['Cliente',       savedVenta.cliente_nombre],
                ['Productos',     `${savedVenta.items.length} ítem${savedVenta.items.length !== 1 ? 's' : ''}`],
                ['Forma de pago', FORMAS_PAGO.find(f => f.value === savedVenta.forma_pago)?.label?.replace(/^[^ ]+ /, '') ?? savedVenta.forma_pago],
                ...(savedVenta.descuento_porcentaje > 0 ? [['Descuento', `${savedVenta.descuento_porcentaje}% · −${fmtMoney(savedVenta.descuento_monto)}`]] : []),
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>{k}</span>
                  <span style={{ fontWeight: 600 }}>{v}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 20, color: 'var(--primary)', paddingTop: 8, borderTop: '1px solid var(--border)', marginTop: 2 }}>
                <span>Total</span><span>{fmtMoney(savedVenta.total)}</span>
              </div>
            </div>

            {/* CAE si fue emitida a ARCA */}
            {savedVenta.arcaResult?.ok && (
              <div style={{ marginTop: 12, background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#15803d', marginBottom: 4 }}>✅ FACTURA C EMITIDA — ARCA</div>
                <div style={{ fontSize: 12, fontFamily: 'monospace', color: '#166534' }}>
                  Nro: {String(arcaConfig?.punto_venta ?? 3).padStart(4,'0')}-{String(savedVenta.arcaResult.nroFactura ?? 0).padStart(8,'0')}
                </div>
                <div style={{ fontSize: 12, fontFamily: 'monospace', color: '#166534' }}>CAE: {savedVenta.arcaResult.cae}</div>
                <div style={{ fontSize: 11, color: '#16a34a' }}>Vto: {savedVenta.arcaResult.caeVto}</div>
              </div>
            )}

            {/* Acciones */}
            <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
              <button onClick={() => { setDetalleVentaId(savedVenta.id); setShowDetalle(true) }}
                style={{ flex: 1, padding: '10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                📄 Ver comprobante
              </button>
              <button onClick={nuevaVenta}
                style={{ flex: 1, padding: '10px', borderRadius: 7, border: 'none', background: 'var(--primary)', color: 'white', cursor: 'pointer', fontSize: 14, fontWeight: 800 }}>
                + Nueva venta
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          PANEL LATERAL — Historial del día
      ══════════════════════════════════════════════════════════ */}
      {showHistorial && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex' }}>
          <div style={{ flex: 1, background: 'rgba(0,0,0,0.4)' }} onClick={() => setShowHistorial(false)} />
          <div style={{ width: 500, background: 'var(--bg)', display: 'flex', flexDirection: 'column', boxShadow: '-6px 0 24px rgba(0,0,0,0.18)', overflow: 'hidden' }}>

            {/* Header del panel */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>Ventas del día</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  {fmtDate(todayStr())} · <strong>{ventasHoy.length}</strong> ventas · <strong>{fmtMoney(totalVentasHoy)}</strong>
                </div>
              </div>
              <button onClick={() => setShowHistorial(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--text-muted)', padding: '2px 6px' }}>✕</button>
            </div>

            {/* Lista de ventas */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {ventasHoy.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 13 }}>
                  <div style={{ fontSize: 32, marginBottom: 10 }}>🧾</div>
                  Sin ventas registradas hoy.
                </div>
              ) : (
                ventasHoy.map(v => {
                  const est  = ESTADO_S[v.estado] ?? ESTADO_S.pendiente
                  const comp = COMPROBANTES.find(c => c.value === v.comprobante)
                  const fp   = FORMAS_PAGO.find(f => f.value === v.forma_pago)
                  return (
                    <div key={v.id}
                      onClick={() => { setDetalleVentaId(v.id); setShowDetalle(true); setShowHistorial(false) }}
                      style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', background: 'var(--surface)', display: 'flex', gap: 10, alignItems: 'flex-start', transition: 'border-color 0.12s' }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--primary)'}
                      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: comp?.color ?? '#64748b' }}>
                            {comp?.label ?? 'Ticket'} #{padNum(v.numero)}
                          </span>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 10, background: est.bg, color: est.color }}>{est.label}</span>
                          {v.factura_emitida && (
                            <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 10, background: '#dbeafe', color: '#1d4ed8' }}>🏛️ Facturado</span>
                          )}
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto', flexShrink: 0 }}>{fmtDate(v.fecha)}</span>
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {v.cliente_nombre ?? 'Consumidor Final'}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                          {v.hora ?? ''}
                          {fp && <span style={{ marginLeft: 6 }}>· {fp.label.replace(/^[^ ]+ /, '')}</span>}
                        </div>
                      </div>
                      <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--primary)', whiteSpace: 'nowrap' }}>{fmtMoney(v.total)}</div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          PANEL LATERAL — Historial completo
      ══════════════════════════════════════════════════════════ */}
      {showHistorialCompleto && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex' }}>
          <div style={{ flex: 1, background: 'rgba(0,0,0,0.4)' }} onClick={() => setShowHistorialCompleto(false)} />
          <div style={{ width: 560, background: 'var(--bg)', display: 'flex', flexDirection: 'column', boxShadow: '-6px 0 24px rgba(0,0,0,0.18)', overflow: 'hidden' }}>

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>📋 Historial de ventas</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  {hcLoading ? 'Cargando...' : `${hcFiltradas.length} venta${hcFiltradas.length !== 1 ? 's' : ''} · ${fmtMoney(hcFiltradas.reduce((s, v) => s + (v.total ?? 0), 0))}`}
                </div>
              </div>
              <button onClick={() => setShowHistorialCompleto(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--text-muted)', padding: '2px 6px' }}>✕</button>
            </div>

            {/* Filtros */}
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 7, flexWrap: 'wrap', flexShrink: 0, background: 'var(--surface)' }}>
              <input
                placeholder="🔍 Cliente o N° de venta..."
                value={hcBusqueda}
                onChange={e => setHcBusqueda(e.target.value)}
                style={inp({ flex: 1, minWidth: 160 })}
              />
              <input type="date" value={hcDesde} onChange={e => setHcDesde(e.target.value)}
                title="Desde" style={inp({ width: 140 })} />
              <input type="date" value={hcHasta} onChange={e => setHcHasta(e.target.value)}
                title="Hasta" style={inp({ width: 140 })} />
              <select value={hcEstado} onChange={e => setHcEstado(e.target.value)} style={inp({ width: 130 })}>
                <option value="">Todos los estados</option>
                <option value="pagado">Pagado</option>
                <option value="pendiente">Pendiente</option>
                <option value="parcial">Parcial</option>
                <option value="anulado">Anulado</option>
              </select>
              {(hcDesde || hcHasta || hcEstado || hcBusqueda) && (
                <button
                  onClick={() => { setHcDesde(''); setHcHasta(''); setHcEstado(''); setHcBusqueda('') }}
                  style={{ padding: '7px 11px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  ✕ Limpiar
                </button>
              )}
            </div>

            {/* Lista */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {hcLoading ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 13 }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>⏳</div>Cargando ventas...
                </div>
              ) : hcFiltradas.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 13 }}>
                  <div style={{ fontSize: 32, marginBottom: 10 }}>📋</div>
                  Sin ventas que coincidan.
                </div>
              ) : hcFiltradas.map(v => {
                const est  = ESTADO_S[v.estado] ?? ESTADO_S.pendiente
                const comp = COMPROBANTES.find(c => c.value === v.comprobante)
                const fp   = FORMAS_PAGO.find(f => f.value === v.forma_pago)
                return (
                  <div key={v.id}
                    onClick={() => { setDetalleVentaId(v.id); setShowDetalle(true); setShowHistorialCompleto(false) }}
                    style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', background: 'var(--surface)', display: 'flex', gap: 10, alignItems: 'flex-start' }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--primary)'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: comp?.color ?? '#64748b' }}>
                          {comp?.label ?? 'Ticket'} #{padNum(v.numero)}
                        </span>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 10, background: est.bg, color: est.color }}>{est.label}</span>
                        {v.factura_emitida && (
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 10, background: '#dbeafe', color: '#1d4ed8' }}>🏛️ Facturado</span>
                        )}
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto', flexShrink: 0 }}>{fmtDate(v.fecha)}</span>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {v.cliente_nombre ?? 'Consumidor Final'}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        {v.hora ?? ''}
                        {fp && <span style={{ marginLeft: 6 }}>· {fp.label.replace(/^[^ ]+ /, '')}</span>}
                      </div>
                    </div>
                    <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--primary)', whiteSpace: 'nowrap' }}>{fmtMoney(v.total)}</div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          MODAL — Nuevo cliente rápido
      ══════════════════════════════════════════════════════════ */}
      {showNuevoCliente && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--bg)', borderRadius: 10, padding: 24, width: 420, boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>

            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>👤 Nuevo cliente</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 18 }}>
              Se creará y quedará seleccionado en la venta actual
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

              {/* Nombre */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Nombre *</label>
                <input style={inp()} placeholder="Nombre completo o razón social" autoFocus
                  value={nuevoCliForm.nombre}
                  onChange={e => setNuevoCliForm(p => ({ ...p, nombre: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && guardarNuevoCliente()} />
              </div>

              {/* Teléfono + Email */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Teléfono</label>
                  <input style={inp()} placeholder="Ej: 11 2345-6789"
                    value={nuevoCliForm.telefono}
                    onChange={e => setNuevoCliForm(p => ({ ...p, telefono: e.target.value }))} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Email</label>
                  <input style={inp()} placeholder="correo@ejemplo.com" type="email"
                    value={nuevoCliForm.email}
                    onChange={e => setNuevoCliForm(p => ({ ...p, email: e.target.value }))} />
                </div>
              </div>

              {/* Dirección */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Dirección</label>
                <input style={inp()} placeholder="Calle, número, localidad (opcional)"
                  value={nuevoCliForm.direccion}
                  onChange={e => setNuevoCliForm(p => ({ ...p, direccion: e.target.value }))} />
              </div>

            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowNuevoCliente(false)}
                style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
              >
                Cancelar
              </button>
              <button
                onClick={guardarNuevoCliente}
                disabled={!nuevoCliForm.nombre.trim() || nuevoCliSaving}
                style={{ padding: '8px 20px', borderRadius: 6, border: 'none', background: !nuevoCliForm.nombre.trim() ? '#e2e8f0' : 'var(--primary)', color: !nuevoCliForm.nombre.trim() ? '#94a3b8' : 'white', cursor: !nuevoCliForm.nombre.trim() ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 700 }}
              >
                {nuevoCliSaving ? 'Guardando…' : '✔ Crear cliente'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          MODAL — Detalle de venta
      ══════════════════════════════════════════════════════════ */}
      {showDetalle && detalleVentaId && (
        <VentaDetalle
          ventaId={detalleVentaId}
          onClose={() => { setShowDetalle(false); setDetalleVentaId(null) }}
          onUpdated={loadVentasHoy}
        />
      )}
    </div>
  )
}
