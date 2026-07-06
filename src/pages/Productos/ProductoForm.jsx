import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fmtMoney, padId } from '../../lib/format'
import { calcCosto3D, calcInsumo, precioVenta } from '../../lib/pricing'
import { recalcularCCPorProductos } from '../../lib/recalcularCC'
import { useAuth } from '../../lib/AuthContext'

const SKU_RE = /^[A-Z]{3}[0-9]{6}(-V\d+)?$/

// Definidos FUERA del componente para que React no los desmonte en cada render
// F: field compacto — label pequeño + control apilado
function F({ label, col, children }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:3, ...(col && { gridColumn:`span ${col}` }) }}>
      <label style={{ fontSize:12, fontWeight:600, color:'var(--text-muted)', lineHeight:1.2 }}>{label}</label>
      {children}
    </div>
  )
}
// si: objeto de estilo para inputs compactos
const si = (extra = {}) => ({ padding:'6px 9px', fontSize:14, ...extra })

function snapSegs(segs) {
  const s = Number(segs) || 0
  if (s === 0) return { segs: 0, extraMins: 0 }
  const r = Math.ceil(s / 15) * 15
  return r >= 60 ? { segs: 0, extraMins: 1 } : { segs: r, extraMins: 0 }
}

const blankPieza = { material_id: '', ancho: '', alto: '', cantidad: 1, gramos: '', metros: '', incremento: '' }
const blankTarifaSel = { tarifa_id: '', fab_minutos: '', fab_segundos: '', incremento: '' }

const blank = {
  nombre: '',
  sku: '',
  descripcion: '',
  categoria_id: '',
  subcategoria_id: '',
  alto_producto: '',
  ancho_producto: '',
  imagen_url: '',
  tiendas_ids: [],
  piezas: [{ ...blankPieza }],
  tarifas_sel: [{ ...blankTarifaSel }],
  gramos_filamento: '',
  imp_horas: '',
  imp_minutos: '',
  tarifa_id: '',
  activo: true,
}

const calcMaterialCost = calcInsumo

const calcTarifaCost = (tar, ts) => {
  if (!tar) return 0
  const horas = ((Number(ts.fab_minutos) || 0) * 60 + (Number(ts.fab_segundos) || 0)) / 3600
  return horas * (Number(tar.costo_hora) || 0)
}

// Borrador de "producto nuevo" en localStorage — solo para la creación
// (no para edición de productos existentes). Si el navegador recarga la
// página a medio cargar (p.ej. al volver de otro programa y encontrar una
// actualización), esto permite recuperar lo que se venía tipeando.
export const nuevoProductoDraftKey = (orgId) => `producto_nuevo_draft_${orgId || 'anon'}`

export default function ProductoForm({ initial, onCancel, onSaved, onSavedNext, onSavedVariant }) {
  const { orgId } = useAuth()
  const draftKey = nuevoProductoDraftKey(orgId)
  const esNuevo = !initial
  const draftRestored = useRef(false)

  const [form, setForm] = useState(() => {
    if (initial) {
      return {
        ...blank,
        ...initial,
        categoria_id: initial.categoria_id || '',
        subcategoria_id: initial.subcategoria_id || '',
        imagen_url: initial.imagen_url || '',
        incremento: initial.incremento || 0,
        tiendas_ids: initial.tiendas_ids || [],
        tarifas_sel: initial.tarifas_producto || [{ ...blankTarifaSel }],
        piezas: initial.piezas || [{
          material_id: initial.material_id || '',
          ancho: initial.ancho_pieza || 0,
          alto: initial.alto_pieza || 0,
          cantidad: initial.cantidad_piezas || 1,
        }],
        activo: initial.activo !== false,  // existentes sin columna → true
      }
    }
    return { ...blank }
  })
  const [categorias, setCategorias] = useState([])
  const [subcategorias, setSubcategorias] = useState([])
  const [materiales, setMateriales] = useState([])
  const [tarifas, setTarifas] = useState([])
  const [listas, setListas] = useState([])
  const [tiendas, setTiendas] = useState([])
  const [rubros, setRubros] = useState([])
  const [rubroFiltro, setRubroFiltro] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [skuError, setSkuError] = useState(null)
  const [expandedPieza, setExpandedPieza] = useState(0)
  const [expandedTarifa, setExpandedTarifa] = useState(0)
  const [savedFlash, setSavedFlash] = useState(false)  // ✅ flash "Guardado"

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  // ── Borrador de producto nuevo (solo al crear, no al editar) ─────────────
  useEffect(() => {
    if (!esNuevo) { draftRestored.current = true; return }
    try {
      const raw = localStorage.getItem(draftKey)
      if (raw) setForm(JSON.parse(raw))
    } catch { /* borrador corrupto, se ignora */ }
    draftRestored.current = true
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!esNuevo || !draftRestored.current) return
    try { localStorage.setItem(draftKey, JSON.stringify(form)) } catch { /* localStorage lleno */ }
  }, [esNuevo, draftKey, form])

  const limpiarDraft = () => { try { localStorage.removeItem(draftKey) } catch { /* noop */ } }
  const handleCancel = () => { limpiarDraft(); onCancel() }

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') handleCancel() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onCancel])

  useEffect(() => {
    Promise.all([
      supabase.from('categorias').select('*').order('nombre'),
      supabase.from('materiales').select('*').order('id'),
      supabase.from('tarifas').select('*').order('id'),
      supabase.from('listas_precios').select('*').order('created_at'),
      supabase.from('tiendas').select('id, nombre, tipo, activa').eq('activa', true).order('created_at'),
      supabase.from('rubros').select('*').order('created_at'),
    ]).then(([c, m, t, l, ti, r]) => {
      setCategorias(c.data || [])
      setMateriales(m.data || [])
      setTarifas(t.data || [])
      setListas(l.data || [])
      setTiendas(ti.data || [])
      setRubros(r.data || [])
      // rubroFiltro arranca vacío (Todos) para no ocultar la categoría actual
    })
  }, [])

  useEffect(() => {
    if (!form.categoria_id) { setSubcategorias([]); return }
    supabase.from('subcategorias').select('*').eq('categoria_id', form.categoria_id).order('nombre')
      .then(({ data }) => setSubcategorias(data || []))
  }, [form.categoria_id])

  const catActual = useMemo(() => categorias.find((c) => c.id === Number(form.categoria_id)), [categorias, form.categoria_id])
  const tipoFab = catActual?.tipo_fabricacion || 'Melamina'
  const listaActual = useMemo(() => listas[0] || null, [listas])

  const tarifasFiltradas = useMemo(
    () => tarifas.filter((t) =>
      tipoFab === 'Melamina' ? t.tipo !== 'Impresión 3D' : t.tipo === 'Impresión 3D' || t.tipo === 'Otro'
    ),
    [tarifas, tipoFab],
  )

  const desglose = useMemo(() => {
    if (tipoFab !== 'Melamina') return null
    const piezasDetalle = form.piezas.map((pieza) => {
      const mat = materiales.find((m) => m.id === Number(pieza.material_id))
      const costoMat = calcMaterialCost(mat, pieza)
      const incremento = Number(pieza.incremento) || 0
      return { pieza, mat, costoMat, incremento, costo: costoMat * (1 + incremento / 100) }
    })
    const tarifasDetalle = form.tarifas_sel.map((ts) => {
      const tar = tarifas.find((t) => t.id === Number(ts.tarifa_id))
      const costoTar = calcTarifaCost(tar, ts)
      const incremento = Number(ts.incremento) || 0
      return { ts, tar, costoTar, incremento, costo: costoTar * (1 + incremento / 100) }
    })
    const costoMateriales = piezasDetalle.reduce((s, d) => s + d.costo, 0)
    const costoTarifas = tarifasDetalle.reduce((s, d) => s + d.costo, 0)
    return { piezasDetalle, tarifasDetalle, costoMateriales, costoTarifas, total: costoMateriales + costoTarifas }
  }, [form.piezas, form.tarifas_sel, form.incremento, materiales, tarifas, tipoFab])

  const costoBase = useMemo(() => {
    if (tipoFab === 'Melamina') return desglose?.total ?? 0
    const tar = tarifas.find((t) => t.id === Number(form.tarifa_id))
    return calcCosto3D({ tarifa: tar, gramos: form.gramos_filamento, horas: form.imp_horas, minutos: form.imp_minutos })
  }, [form, tarifas, tipoFab, desglose])

  const validateSku = (v) => {
    if (!v) return 'SKU requerido'
    if (!SKU_RE.test(v)) return 'Formato: 3 letras + 6 números (ej: MEL000001 o MEL000001-V2)'
    return null
  }

  const handleSku = (v) => {
    const up = v.toUpperCase()
    set('sku', up)
    setSkuError(validateSku(up))
  }

  const handleCategoriaChange = async (catId) => {
    setForm((f) => ({ ...f, categoria_id: catId, subcategoria_id: '' }))
    const cat = categorias.find((c) => c.id === Number(catId))
    if (cat && !form.id) {
      const { data } = await supabase
        .from('productos').select('sku').like('sku', `${cat.sku_prefijo}%`)
        .order('sku', { ascending: false }).limit(1)
      const prefLen = (cat.sku_prefijo || '').length
      const lastNum = data?.length ? parseInt(data[0].sku.slice(prefLen)) : 0
      const newSku = `${(cat.sku_prefijo || '').toUpperCase()}${String((isNaN(lastNum) ? 0 : lastNum) + 1).padStart(6, '0')}`
      setForm((f) => ({ ...f, categoria_id: catId, subcategoria_id: '', sku: newSku }))
      setSkuError(null)
    }
  }

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const ext = file.name.split('.').pop()
    const path = `${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('productos').upload(path, file, { upsert: true })
    if (error) { alert('Error al subir imagen: ' + error.message); setUploading(false); return }
    const { data } = supabase.storage.from('productos').getPublicUrl(path)
    set('imagen_url', data.publicUrl)
    setUploading(false)
  }

  const setPieza = (idx, k, v) => setForm((f) => {
    const piezas = [...f.piezas]; piezas[idx] = { ...piezas[idx], [k]: v }; return { ...f, piezas }
  })
  const addPieza = () => { setForm((f) => ({ ...f, piezas: [...f.piezas, { ...blankPieza }] })); setExpandedPieza(form.piezas.length) }
  const removePieza = (idx) => { setForm((f) => ({ ...f, piezas: f.piezas.filter((_, i) => i !== idx) })); setExpandedPieza((p) => p === idx ? null : p > idx ? p - 1 : p) }

  const setTarifaSel = (idx, k, v) => setForm((f) => {
    const tarifas_sel = [...f.tarifas_sel]; tarifas_sel[idx] = { ...tarifas_sel[idx], [k]: v }; return { ...f, tarifas_sel }
  })
  const addTarifa = () => {
    setForm((f) => ({ ...f, tarifas_sel: [...f.tarifas_sel, { ...blankTarifaSel }] }))
    setExpandedTarifa(form.tarifas_sel.length)
  }
  const removeTarifa = (idx) => {
    setForm((f) => ({ ...f, tarifas_sel: f.tarifas_sel.filter((_, i) => i !== idx) }))
    setExpandedTarifa((p) => p === idx ? null : p > idx ? p - 1 : p)
  }

  const getPiezaLabel = (pieza) => {
    const mat = materiales.find((m) => m.id === Number(pieza.material_id))
    if (!mat) return 'Sin configurar'
    const tipo = mat.tipo_medida || 'placa'
    const parts = [mat.nombre]
    if (tipo === 'placa' && pieza.ancho && pieza.alto) parts.push(`${pieza.ancho}×${pieza.alto} cm · ×${pieza.cantidad}`)
    if (tipo === 'peso')     parts.push(`${pieza.gramos} gr`)
    if (tipo === 'unidad')   parts.push(`×${pieza.cantidad}`)
    if (tipo === 'longitud') parts.push(`${pieza.metros} m`)
    return parts.join(' · ')
  }

  const handleSave = async (mode = 'close') => {
    const err = validateSku(form.sku)
    if (err) return setSkuError(err)
    if (!form.nombre) return alert('El nombre es requerido')
    if (!form.categoria_id) return alert('Seleccioná una categoría')
    setSaving(true)
    const payload = {
      nombre: form.nombre, sku: form.sku, descripcion: form.descripcion || null,
      categoria: tipoFab,
      categoria_id: Number(form.categoria_id),
      subcategoria_id: form.subcategoria_id ? Number(form.subcategoria_id) : null,
      alto_producto: form.alto_producto !== '' ? Number(form.alto_producto) : null,
      ancho_producto: form.ancho_producto !== '' ? Number(form.ancho_producto) : null,
      imagen_url: form.imagen_url || null,
      tiendas_ids: form.tiendas_ids || [],
      incremento: Number(form.incremento) || 0,
      piezas: tipoFab === 'Melamina' ? form.piezas : null,
      tarifas_producto: tipoFab === 'Melamina' ? form.tarifas_sel : null,
      material_id: null, tarifa_id: tipoFab === 'Impresión 3D' ? Number(form.tarifa_id) || null : null,
      ancho_pieza: null, alto_pieza: null, cantidad_piezas: null, fab_minutos: null, fab_segundos: null,
      gramos_filamento: tipoFab === 'Impresión 3D' ? Number(form.gramos_filamento) || null : null,
      imp_horas: tipoFab === 'Impresión 3D' ? Number(form.imp_horas) || null : null,
      imp_minutos: tipoFab === 'Impresión 3D' ? Number(form.imp_minutos) || null : null,
      costo_base: costoBase,
      activo: form.activo !== false,
    }
    const res = form.id
      ? await supabase.from('productos').update(payload).eq('id', form.id)
      : await supabase.from('productos').insert(payload)
    setSaving(false)
    if (res.error) return alert('Error: ' + res.error.message)
    limpiarDraft()

    // Si es una edición, recalcular en background todas las CC pendientes
    // que contengan este producto, sin bloquear el flujo de guardado.
    if (form.id) {
      recalcularCCPorProductos([form.id])
        .then(({ ventasActualizadas, clientesAfectados }) => {
          if (ventasActualizadas > 0) {
            console.log(
              `[CC Auto] Precios actualizados en ${ventasActualizadas} venta(s) ` +
              `de ${clientesAfectados} cliente(s) en cuenta corriente.`
            )
          }
        })
        .catch(err => console.error('[CC Auto] Error al recalcular CC:', err))
    }

    if (mode === 'next') {
      // Notificar al padre que recargue la lista, pero SIN cerrar el modal
      onSavedNext?.()
      // Mostrar flash "Guardado ✅" por 1.8 s
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 1800)
      // Mantener categoría seleccionada y generar nuevo SKU automáticamente
      const catId = form.categoria_id
      const cat = categorias.find((c) => c.id === Number(catId))
      let newSku = ''
      if (cat) {
        const { data } = await supabase
          .from('productos').select('sku').like('sku', `${cat.sku_prefijo}%`)
          .order('sku', { ascending: false }).limit(1)
        const lastNum = data?.length ? parseInt(data[0].sku.slice(3)) : 0
        newSku = `${cat.sku_prefijo}${String(lastNum + 1).padStart(6, '0')}`
      }
      setForm({
        ...blank,
        categoria_id: catId,
        subcategoria_id: '',
        sku: newSku,
        tiendas_ids: form.tiendas_ids,  // mantener los canales de venta también
      })
      setSkuError(null)
      setExpandedPieza(0)
      setExpandedTarifa(0)
      // Scroll al top del modal para ver el nuevo form
      document.querySelector('.modal-body')?.scrollTo({ top: 0, behavior: 'smooth' })
    } else if (mode === 'variant') {
      // Guardar ok → generar SKU de variante y re-abrir el form pre-cargado
      const baseSku = form.sku.replace(/-V\d+$/, '') // quitar sufijo -Vn si ya es variante
      const variantRegex = new RegExp(`^${baseSku.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-V(\\d+)$`)
      const { data: existingVariants } = await supabase
        .from('productos').select('sku').like('sku', `${baseSku}-V%`)
      const nums = (existingVariants ?? []).map(p => {
        const m = p.sku?.match(variantRegex)
        return m ? parseInt(m[1]) : 0
      }).filter(n => n > 0)
      const nextNum = nums.length > 0 ? Math.max(...nums) + 1 : 1
      const variantSku = `${baseSku}-V${nextNum}`

      onSavedNext?.() // recargar lista en el padre
      onSavedVariant?.({
        // Datos heredados del producto base
        nombre:           form.nombre,
        descripcion:      form.descripcion ?? '',
        sku:              variantSku,
        categoria_id:     form.categoria_id,
        subcategoria_id:  form.subcategoria_id,
        imagen_url:       form.imagen_url ?? null,
        incremento:       form.incremento ?? 0,
        tiendas_ids:      form.tiendas_ids ?? [],
        // Dimensiones del producto y materiales se resetean
        // para que el usuario ingrese los valores de la variante
        alto_producto:    '',
        ancho_producto:   '',
        piezas:           [{ ...blankPieza }],
        tarifas_producto: [{ ...blankTarifaSel }],
        gramos_filamento: 0,
        imp_horas:        0,
        imp_minutos:      0,
        tarifa_id:        '',
        // sin id → modo insertar
      })
    } else {
      onSaved()
    }
  }

  // ── Bloque reutilizable: materiales/piezas ───────────────────────────────
  const renderMateriales = () => (
    <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
      <div style={{ fontSize:12, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em' }}>Materiales / Piezas</div>
      <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
        {form.piezas.map((pieza, idx) => (
          <div key={idx} style={{ border:'1px solid var(--border)', borderRadius:6, overflow:'hidden' }}>
            <div style={{ display:'flex', alignItems:'center', padding:'5px 8px', background: expandedPieza === idx ? 'var(--bg-highlight)' : 'var(--bg-card)', gap:6 }}>
              <span style={{ fontSize:12, fontWeight:600, minWidth:48, color:'var(--text-muted)' }}>Pieza {idx+1}</span>
              <span style={{ flex:1, fontSize:12 }}>{getPiezaLabel(pieza)}</span>
              <button className="btn btn-sm btn-ghost" onClick={() => setExpandedPieza(expandedPieza === idx ? null : idx)} style={{ fontSize:12, padding:'3px 9px' }}>{expandedPieza === idx ? 'Cerrar' : 'Editar'}</button>
              {form.piezas.length > 1 && <button className="btn btn-sm btn-ghost" onClick={() => removePieza(idx)} style={{ color:'var(--danger)', fontSize:12, padding:'3px 9px' }}>✕</button>}
            </div>
            {expandedPieza === idx && (
              <div style={{ padding:10, borderTop:'1px solid var(--border)', background:'var(--bg-muted)' }}>
                {(() => {
                  const mat = materiales.find(m => m.id === Number(pieza.material_id))
                  const tipo = mat?.tipo_medida || 'placa'
                  const sinInsumo = !pieza.material_id
                  const disStyle = sinInsumo ? { opacity:0.4, pointerEvents:'none' } : {}
                  return (
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
                      <F label="Insumo" col={2}>
                        <select className="select" style={si()} value={pieza.material_id} onChange={e => setPieza(idx,'material_id',e.target.value)}>
                          <option value="">— Seleccionar insumo —</option>
                          {materiales.map(m=><option key={m.id} value={m.id}>{padId(m.id)} · {m.nombre}</option>)}
                        </select>
                      </F>
                      {sinInsumo ? (
                        <div style={{ gridColumn:'span 2', padding:'6px 0', fontSize:11, color:'var(--text-muted)', textAlign:'center' }}>
                          👆 Primero seleccioná el insumo
                        </div>
                      ) : (<>
                        {tipo==='placa' && <>
                          <F label="Alto (cm)"><input className="input" style={si()} type="number" step="0.1" value={pieza.alto} onChange={e=>setPieza(idx,'alto',e.target.value)} /></F>
                          <F label="Ancho (cm)"><input className="input" style={si()} type="number" step="0.1" value={pieza.ancho} onChange={e=>setPieza(idx,'ancho',e.target.value)} /></F>
                          <F label="Cantidad"><input className="input" style={si()} type="number" value={pieza.cantidad} onChange={e=>setPieza(idx,'cantidad',e.target.value)} /></F>
                        </>}
                        {tipo==='peso'    && <F label="Gramos (gr)"><input className="input" style={si()} type="number" step="0.1" value={pieza.gramos||0} onChange={e=>setPieza(idx,'gramos',e.target.value)} /></F>}
                        {tipo==='unidad'  && <F label="Cantidad"><input className="input" style={si()} type="number" value={pieza.cantidad} onChange={e=>setPieza(idx,'cantidad',e.target.value)} /></F>}
                        {tipo==='longitud'&& <F label="Metros"><input className="input" style={si()} type="number" step="0.01" value={pieza.metros||0} onChange={e=>setPieza(idx,'metros',e.target.value)} /></F>}
                        <F label="Incremento (%)"><input className="input" style={si()} type="number" step="0.01" placeholder="0" value={pieza.incremento} onChange={e=>setPieza(idx,'incremento',e.target.value)} /></F>
                      </>)}
                    </div>
                  )
                })()}
              </div>
            )}
          </div>
        ))}
      </div>
      <div style={{ textAlign:'right' }}>
        <button className="btn btn-sm btn-ghost" onClick={addPieza} style={{ fontSize:12 }}>+ Agregar pieza</button>
      </div>
    </div>
  )

  // ── Bloque reutilizable: tarifas ─────────────────────────────────────────
  const renderTarifas = () => (
    <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
      <div style={{ fontSize:12, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em' }}>Tarifas de fabricación</div>
      <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
        {form.tarifas_sel.map((ts, idx) => {
          const tar = tarifas.find(t => t.id === Number(ts.tarifa_id))
          const lbl = [tar?.nombre, (ts.fab_minutos||ts.fab_segundos)?`${ts.fab_minutos}m ${ts.fab_segundos}s`:null, ts.incremento>0?`+${ts.incremento}%`:null].filter(Boolean).join(' · ') || 'Sin configurar'
          return (
            <div key={idx} style={{ border:'1px solid var(--border)', borderRadius:6, overflow:'hidden' }}>
              <div style={{ display:'flex', alignItems:'center', padding:'5px 8px', background: expandedTarifa === idx ? 'var(--bg-highlight)' : 'var(--bg-card)', gap:6 }}>
                <span style={{ fontSize:12, fontWeight:600, minWidth:54, color:'var(--text-muted)' }}>Tarifa {idx+1}</span>
                <span style={{ flex:1, fontSize:12 }}>{lbl}</span>
                <button className="btn btn-sm btn-ghost" onClick={() => setExpandedTarifa(expandedTarifa === idx ? null : idx)} style={{ fontSize:12, padding:'3px 9px' }}>{expandedTarifa === idx ? 'Cerrar' : 'Editar'}</button>
                {form.tarifas_sel.length > 1 && <button className="btn btn-sm btn-ghost" onClick={() => removeTarifa(idx)} style={{ color:'var(--danger)', fontSize:12, padding:'3px 9px' }}>✕</button>}
              </div>
              {expandedTarifa === idx && (
                <div style={{ padding:10, borderTop:'1px solid var(--border)', background:'var(--bg-muted)' }}>
                  <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr', gap:6 }}>
                    <F label="Tarifa">
                      <select className="select" style={si()} value={ts.tarifa_id} onChange={e=>setTarifaSel(idx,'tarifa_id',e.target.value)}>
                        <option value="">— Seleccionar tarifa —</option>
                        {tarifasFiltradas.map(t=><option key={t.id} value={t.id}>{padId(t.id)} · {t.nombre}</option>)}
                      </select>
                    </F>
                    {!ts.tarifa_id ? (
                      <div style={{ gridColumn:'span 2', display:'flex', alignItems:'center', fontSize:11, color:'var(--text-muted)', paddingLeft:4 }}>
                        👆 Primero seleccioná la tarifa
                      </div>
                    ) : (<>
                      <F label="Tiempo (min / seg)">
                        <div style={{ display:'flex', gap:4 }}>
                          <input className="input" style={si()} type="number" placeholder="min" value={ts.fab_minutos} onChange={e=>setTarifaSel(idx,'fab_minutos',e.target.value)} />
                          <input className="input" style={si()} type="number" placeholder="seg" value={ts.fab_segundos}
                            onChange={e=>setTarifaSel(idx,'fab_segundos',e.target.value)}
                            onBlur={e=>{ const {segs,extraMins}=snapSegs(e.target.value); setTarifaSel(idx,'fab_segundos',segs); if(extraMins) setTarifaSel(idx,'fab_minutos',(Number(ts.fab_minutos)||0)+extraMins) }} />
                        </div>
                      </F>
                      <F label="Incr. (%)"><input className="input" style={si()} type="number" step="0.01" placeholder="0" value={ts.incremento} onChange={e=>setTarifaSel(idx,'incremento',e.target.value)} /></F>
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
  )

  // ── Estilos de columna — sin scroll, padding ajustado ────────────────────
  const col = {
    overflowY: 'hidden',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    padding: '14px 16px',
  }
  const secLabel = (txt) => (
    <div style={{ fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em', paddingBottom:5, borderBottom:'1px solid var(--border)' }}>{txt}</div>
  )

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth:'min(1500px, 99vw)', width:'100%', display:'flex', flexDirection:'column', maxHeight:'92vh' }}>
        <div className="modal-header">
          <h3>{form.id ? 'Editar producto' : 'Nuevo producto'}</h3>
          <button className="btn btn-ghost btn-sm" onClick={handleCancel}>✕</button>
        </div>

        {/* 3 columnas sin scroll — footer siempre visible */}
        <div className="modal-body" style={{ padding:0, flex:1, minHeight:0, display:'grid', gridTemplateColumns:'0.75fr 1.3fr 0.65fr', overflow:'hidden' }}>
          <div style={{ display:'contents' }}>

            {/* ══ COL 1 — Características ══════════════════ */}
            <div style={{ ...col, borderRight:'1px solid var(--border)' }}>
              {secLabel('Características')}

              {/* Nombre + SKU */}
              <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:8 }}>
                <F label="Nombre"><input className="input" style={si()} value={form.nombre} onChange={e=>set('nombre',e.target.value)} /></F>
                <F label="SKU">
                  <input className="input" style={si(skuError?{borderColor:'var(--danger)'}:{})} value={form.sku} onChange={e=>handleSku(e.target.value)} placeholder="Auto" maxLength={9} />
                  {skuError && <span style={{ fontSize:10, color:'var(--danger)', lineHeight:1.2 }}>{skuError}</span>}
                </F>
              </div>

              {/* Rubro chips */}
              {rubros.length > 0 && (
                <F label="Rubro">
                  <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                    <button type="button" onClick={()=>setRubroFiltro('')} style={{ padding:'2px 9px', borderRadius:5, fontSize:11, cursor:'pointer', border:`1px solid ${!rubroFiltro?'var(--primary)':'var(--border)'}`, background:!rubroFiltro?'var(--primary-faint)':'var(--bg-cell)', color:!rubroFiltro?'var(--primary)':'var(--text-muted)', fontWeight:!rubroFiltro?600:400 }}>Todos</button>
                    {rubros.map(r => {
                      const sel = rubroFiltro === String(r.id)
                      return <button key={r.id} type="button" onClick={()=>setRubroFiltro(String(r.id))} style={{ display:'inline-flex', alignItems:'center', gap:3, padding:'2px 9px', borderRadius:5, cursor:'pointer', fontSize:11, border:`1px solid ${sel?r.color:'var(--border)'}`, background:sel?`${r.color}18`:'var(--bg-cell)', color:sel?r.color:'var(--text-muted)', fontWeight:sel?600:400 }}>{r.emoji&&<span>{r.emoji}</span>}{r.nombre}</button>
                    })}
                  </div>
                </F>
              )}

              {/* Categoría + Subcategoría */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                <F label="Categoría">
                  <select className="select" style={si()} value={form.categoria_id} onChange={e=>handleCategoriaChange(e.target.value)}>
                    <option value="">— Seleccionar —</option>
                    {(rubroFiltro?categorias.filter(c=>String(c.rubro_id)===rubroFiltro):categorias).map(c=><option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                  {(()=>{ const cat=form.categoria_id?categorias.find(c=>c.id===Number(form.categoria_id)):null; const rub=cat?.rubro_id?rubros.find(r=>r.id===cat.rubro_id):null; return rub?<span style={{ fontSize:10, color:rub.color, marginTop:2 }}>{rub.emoji} {rub.nombre}</span>:null })()}
                </F>
                <F label="Subcategoría">
                  <select className="select" style={si()} value={form.subcategoria_id} onChange={e=>set('subcategoria_id',e.target.value)} disabled={!form.categoria_id||subcategorias.length===0}>
                    <option value="">{!form.categoria_id?'— Elegí cat. —':subcategorias.length===0?'— Sin subcat. —':'— Seleccionar —'}</option>
                    {subcategorias.map(s=><option key={s.id} value={s.id}>{s.nombre}</option>)}
                  </select>
                </F>
              </div>

              {/* Alto + Ancho + Descripción */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                <F label="Alto (cm)"><input className="input" style={si()} type="number" step="0.1" value={form.alto_producto} onChange={e=>set('alto_producto',e.target.value)} placeholder="0" /></F>
                <F label="Ancho (cm)"><input className="input" style={si()} type="number" step="0.1" value={form.ancho_producto} onChange={e=>set('ancho_producto',e.target.value)} placeholder="0" /></F>
                <F label="Descripción" col={2}><input className="input" style={si()} value={form.descripcion||''} onChange={e=>set('descripcion',e.target.value)} /></F>
              </div>

              {/* Imagen — versión ultra compacta */}
              <F label="Imagen">
                {form.imagen_url ? (
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <div style={{ position:'relative', flexShrink:0 }}>
                      <img src={form.imagen_url} alt="" style={{ width:52, height:52, objectFit:'contain', borderRadius:5, border:'1px solid var(--border)', background:'#ffffff', display:'block' }} />
                      <button onClick={()=>set('imagen_url','')} style={{ position:'absolute', top:-5, right:-5, background:'var(--danger)', color:'#fff', border:'none', borderRadius:'50%', width:16, height:16, fontSize:10, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>✕</button>
                    </div>
                    <label style={{ cursor:'pointer' }}>
                      <input type="file" accept="image/*" style={{ display:'none' }} onChange={handleImageUpload} disabled={uploading} />
                      <span className="btn btn-sm" style={{ fontSize:11 }}>{uploading?'Subiendo...':'Cambiar'}</span>
                    </label>
                  </div>
                ) : (
                  <label style={{ cursor: uploading?'not-allowed':'pointer' }}>
                    <input type="file" accept="image/*" style={{ display:'none' }} onChange={handleImageUpload} disabled={uploading} />
                    <div style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 10px', border:'1px dashed var(--primary)', borderRadius:6, background:'var(--bg-highlight)' }}>
                      <span style={{ fontSize:16 }}>🖼️</span>
                      <span style={{ fontSize:12, color:'var(--primary)', fontWeight:500 }}>{uploading?'Subiendo...':'Subir imagen del producto'}</span>
                      <span style={{ fontSize:11, color:'var(--text-muted)', marginLeft:'auto' }}>JPG · PNG · WEBP</span>
                    </div>
                  </label>
                )}
              </F>
            </div>

            {/* ══ COL 2 — Materiales + Tarifas ═════════════ */}
            <div style={{ ...col, borderRight:'1px solid var(--border)' }}>
              {secLabel('Materiales y tarifas')}

              {!form.categoria_id
                ? <div style={{ marginTop:20, textAlign:'center', color:'var(--text-muted)', fontSize:12 }}>👈 Elegí una categoría</div>
                : tipoFab === 'Melamina'
                  ? <>{renderMateriales()}<div style={{ height:1, background:'var(--border)', margin:'4px 0' }} />{renderTarifas()}</>
                  : (
                    <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                      <F label="Tarifa de impresión"><select className="select" style={si()} value={form.tarifa_id} onChange={e=>set('tarifa_id',e.target.value)}><option value="">— Seleccionar —</option>{tarifasFiltradas.map(t=><option key={t.id} value={t.id}>{padId(t.id)} · {t.nombre}</option>)}</select></F>
                      <F label="Gramos de filamento"><input className="input" style={si()} type="number" step="0.1" value={form.gramos_filamento} onChange={e=>set('gramos_filamento',e.target.value)} /></F>
                      <F label="Tiempo de impresión (hs / min)">
                        <div style={{ display:'flex', gap:6 }}>
                          <input className="input" style={si()} type="number" placeholder="hs" value={form.imp_horas} onChange={e=>set('imp_horas',e.target.value)} />
                          <input className="input" style={si()} type="number" placeholder="min" value={form.imp_minutos} onChange={e=>set('imp_minutos',e.target.value)} />
                        </div>
                      </F>
                    </div>
                  )
              }
            </div>

            {/* ══ COL 3 — Costos (angosta, sin scroll) ═════ */}
            <div style={{ ...col, overflowY:'hidden', gap:7, padding:'12px 12px', background:'var(--bg-muted)' }}>
              {secLabel('Costos y precios')}

              {!form.categoria_id
                ? <div style={{ marginTop:16, textAlign:'center', color:'var(--text-muted)', fontSize:11 }}>Elegí una categoría</div>
                : (
                  <>
                    {/* Desglose */}
                    {tipoFab==='Melamina' && desglose && (
                      <div style={{ fontSize:12, display:'flex', flexDirection:'column', gap:2 }}>
                        {desglose.piezasDetalle.map((d,i)=>(
                          <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'1px 0', borderBottom:'1px solid var(--border)' }}>
                            <span style={{ color:'var(--text-muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:'55%' }}>P{i+1}{d.mat?` ${d.mat.nombre}`:''}</span>
                            <span style={{ fontWeight:600, whiteSpace:'nowrap' }}>{fmtMoney(d.costo)}</span>
                          </div>
                        ))}
                        {desglose.tarifasDetalle.map((d,i)=>(
                          <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'1px 0', borderBottom:'1px solid var(--border)' }}>
                            <span style={{ color:'var(--text-muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:'55%' }}>T{i+1}{d.tar?` ${d.tar.nombre}`:''}</span>
                            <span style={{ fontWeight:600, whiteSpace:'nowrap' }}>{fmtMoney(d.costo)}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Costo base */}
                    <div style={{ background:'var(--bg-highlight)', border:'1px solid var(--primary)', borderRadius:6, padding:'7px 9px' }}>
                      <div style={{ fontSize:11, color:'var(--primary)', fontWeight:600, textTransform:'uppercase' }}>Costo base</div>
                      <div style={{ fontSize:22, fontWeight:700, color:'var(--primary)', lineHeight:1.2 }}>{fmtMoney(costoBase)}</div>
                    </div>

                    {/* Precio por lista */}
                    {listas.length > 0 && costoBase > 0 && (
                      <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
                        <div style={{ fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase' }}>Precio de venta</div>
                        {listas.map(l=>(
                          <div key={l.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'4px 8px', borderRadius:5, background:'var(--bg-cell)', border:'1px solid var(--border)' }}>
                            <span style={{ fontSize:12, color:'var(--text-muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:'48%' }}>{l.nombre}</span>
                            <span style={{ fontSize:14, fontWeight:700, color:'var(--success)', whiteSpace:'nowrap' }}>{fmtMoney(precioVenta(costoBase,l))}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Canales de venta */}
                    {tiendas.length > 0 && (
                      <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
                        <div style={{ fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase' }}>Canales de venta</div>
                        {tiendas.map(t=>{
                          const COLORS={woocommerce:['#7c3aed','#f5f3ff'],mercadolibre:['#d97706','#fffbeb']}
                          const [color,bg]=COLORS[t.tipo]||['#64748b','#f1f5f9']
                          const sel=(form.tiendas_ids||[]).map(String).includes(String(t.id))
                          const toggle=()=>{ const ids=(form.tiendas_ids||[]).map(String); const sid=String(t.id); set('tiendas_ids',sel?ids.filter(i=>i!==sid):[...ids,sid]) }
                          return (
                            <label key={t.id} onClick={toggle} style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer', padding:'5px 8px', borderRadius:5, userSelect:'none', border:`1px solid ${sel?color:'var(--border)'}`, background:sel?bg:'var(--bg-cell)', transition:'all 0.15s' }}>
                              <div style={{ width:7, height:7, borderRadius:'50%', background:sel?color:'#cbd5e1', flexShrink:0 }} />
                              <span style={{ fontSize:12, fontWeight:sel?600:400, color:sel?color:'var(--text)', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.nombre}</span>
                              <span style={{ fontSize:10, fontWeight:700, padding:'1px 5px', borderRadius:3, background:sel?color:'#e2e8f0', color:sel?'white':'#94a3b8', flexShrink:0 }}>{t.tipo==='woocommerce'?'WC':'ML'}</span>
                            </label>
                          )
                        })}
                      </div>
                    )}
                  </>
                )
              }
            </div>

          </div>
        </div>

        {/* Footer fijo — siempre visible */}
        <div className="modal-footer" style={{ justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:16 }}>
            <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, fontWeight:600, color:'#16a34a', opacity:savedFlash?1:0, transition:'opacity 0.3s', minWidth:140 }}>
              <span style={{ fontSize:16 }}>✅</span> Producto guardado
            </div>
            {/* Toggle activo/inactivo */}
            <button
              type="button"
              onClick={() => set('activo', !form.activo)}
              style={{
                display:'flex', alignItems:'center', gap:7,
                padding:'4px 10px', borderRadius:20, cursor:'pointer',
                border:`1px solid ${form.activo !== false ? '#86efac' : '#fca5a5'}`,
                background: form.activo !== false ? '#f0fdf4' : '#fff1f2',
                color: form.activo !== false ? '#16a34a' : '#dc2626',
                fontSize:12, fontWeight:700, userSelect:'none',
              }}
            >
              <span style={{
                width:10, height:10, borderRadius:'50%',
                background: form.activo !== false ? '#22c55e' : '#ef4444',
                flexShrink:0,
              }} />
              {form.activo !== false ? 'Activo' : 'Inactivo'}
            </button>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button className="btn" onClick={handleCancel} disabled={saving}>Cancelar</button>
            {!form.id && (
              <button className="btn" onClick={()=>handleSave('next')} disabled={saving} style={{ fontWeight:500 }}>
                {saving ? 'Guardando...' : '+ Guardar y agregar otro'}
              </button>
            )}
            <button
              className="btn"
              onClick={() => handleSave('variant')}
              disabled={saving}
              title="Guarda este producto y abre un nuevo formulario pre-cargado con los mismos datos + SKU de variante"
              style={{ fontWeight:500, color:'var(--primary)', borderColor:'var(--primary)' }}
            >
              {saving ? 'Guardando...' : '🔀 Guardar y crear variante'}
            </button>
            <button className="btn btn-primary" onClick={()=>handleSave('close')} disabled={saving}>
              {saving ? 'Guardando...' : form.id ? 'Guardar cambios' : 'Guardar y cerrar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
