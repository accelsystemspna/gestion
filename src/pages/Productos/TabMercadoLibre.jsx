import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { precioVenta } from '../../lib/pricing'
import { fmtMoney } from '../../lib/format'
import { mlApi } from '../../lib/mlApi'

const soloTexto = (html) => String(html || '')
  .replace(/<\s*br\s*\/?>|<\/\s*(p|div|li|h[1-6])\s*>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim()

const ESTADOS = {
  active: ['Activa', '#15803d', 'rgba(22,163,74,0.12)'], paused: ['Pausada', '#b45309', 'rgba(217,119,6,0.14)'],
  closed: ['Cerrada', '#64748b', 'rgba(100,116,139,0.14)'], under_review: ['En revisión', '#6d28d9', 'rgba(109,40,217,0.12)'],
}
const lbl = { fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }
const sec = { fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }

// Pestaña "Mercado Libre" del producto: su propio título, fotos, descripción, categoría, atributos y
// precio (la web tiene los suyos), más el estado de las publicaciones y los botones para publicar.
export default function TabMercadoLibre({ form, set, setForm, listas, costoBase }) {
  const [pubs, setPubs]       = useState([])
  const [subiendo, setSubiendo] = useState(false)
  const [ocupado, setOcupado] = useState('')
  const [msg, setMsg]         = useState(null)
  const [sugeridas, setSugeridas] = useState([])
  const [attrsCat, setAttrsCat]   = useState([])

  const lista = (listas || []).find((l) => /mercado\s*libre/i.test(l.nombre))
  const precioLista = lista ? Math.round(precioVenta(Number(costoBase) || 0, lista)) : null
  const precioFinal = Number(form.ml_precio) > 0 ? Number(form.ml_precio) : precioLista
  const imagenes = form.ml_imagenes || []
  const atributos = form.ml_atributos || {}
  const guardado = !!form.id

  const cargarPubs = async () => {
    if (!form.id) return
    const { data } = await supabase.from('ml_publicaciones').select('*').eq('producto_id', form.id).order('creada_en', { ascending: false })
    setPubs(data || [])
  }
  useEffect(() => { cargarPubs() }, [form.id])  // eslint-disable-line react-hooks/exhaustive-deps

  // Atributos de la categoría elegida (para completar los que pide ML)
  useEffect(() => {
    if (!form.ml_categoria_id) { setAttrsCat([]); return }
    mlApi('category_attributes', { categoria_ml: form.ml_categoria_id })
      .then((r) => setAttrsCat(r.atributos || [])).catch(() => setAttrsCat([]))
  }, [form.ml_categoria_id])

  const subir = async (e, destino) => {
    const files = [...(e.target.files || [])]
    if (!files.length) return
    setSubiendo(true)
    const nuevas = []
    for (const file of files) {
      const ext = file.name.split('.').pop()
      const path = `ml/${Date.now()}-${Math.round(Math.random() * 1e6)}.${ext}`
      const { error } = await supabase.storage.from('productos').upload(path, file)
      if (error) { alert('Error al subir imagen: ' + error.message); continue }
      nuevas.push(supabase.storage.from('productos').getPublicUrl(path).data.publicUrl)
    }
    if (nuevas.length) setForm((f) => ({ ...f, ml_imagenes: destino === 'portada' ? [nuevas[0], ...(f.ml_imagenes || []).slice(1), ...nuevas.slice(1)] : [...(f.ml_imagenes || []), ...nuevas] }))
    setSubiendo(false)
    e.target.value = ''
  }
  const quitar = (url) => set('ml_imagenes', imagenes.filter((u) => u !== url))
  const comoPortada = (url) => set('ml_imagenes', [url, ...imagenes.filter((u) => u !== url)])
  const copiarDeWeb = () => set('ml_imagenes', [...new Set([form.imagen_web_url, ...(form.imagenes_web || []), form.imagen_url].filter(Boolean))].slice(0, 12))

  const sugerir = async () => {
    setOcupado('sugerir'); setMsg(null)
    try {
      const r = await mlApi('predict_category', { titulo: form.ml_titulo || form.nombre })
      setSugeridas(r.categorias || [])
      if (r.categorias?.[0] && !form.ml_categoria_id) set('ml_categoria_id', r.categorias[0].id)
    } catch (err) { setMsg({ tipo: 'error', texto: err.message }) }
    setOcupado('')
  }

  const setAttr = (id, valor) => setForm((f) => {
    const a = { ...(f.ml_atributos || {}) }
    if (valor === '' || valor == null) delete a[id]; else a[id] = valor
    return { ...f, ml_atributos: a }
  })

  const pedido = () => ({
    titulo: form.ml_titulo || undefined, descripcion: form.ml_descripcion || undefined,
    imagenes: imagenes.length ? imagenes : undefined, atributos, categoria_ml: form.ml_categoria_id || undefined,
    precio: precioFinal, stock: Math.max(Number(form.stock_actual) || 0, 0) || 10,
  })

  const accion = async (cual) => {
    setMsg(null)
    if (!(precioFinal > 0)) return setMsg({ tipo: 'error', texto: 'Falta el precio: completalo abajo o creá una lista de precios "Mercado Libre".' })
    if (cual === 'publicar' && !confirm(`¿Publicar "${form.ml_titulo || form.nombre}" en Mercado Libre a ${fmtMoney(precioFinal)}?`)) return
    setOcupado(cual)
    try {
      const r = await mlApi('publish', { producto_id: form.id, validar: cual === 'validar', pedido: pedido() })
      if (cual === 'validar') setMsg({ tipo: 'ok', texto: 'Mercado Libre aprobó el producto. Todavía no está publicado.' + (r.avisos?.length ? ` Avisos: ${r.avisos.join(' · ')}` : '') })
      else { setMsg({ tipo: r.error_descripcion ? 'error' : 'ok', texto: `Publicado: ${r.item_id}.` + (r.error_descripcion ? ` La descripción no se pudo cargar: ${r.error_descripcion}` : '') }); await cargarPubs() }
    } catch (err) { setMsg({ tipo: 'error', texto: err.message }) }
    setOcupado('')
  }

  const actualizar = async (pub, cambios, etiqueta) => {
    setOcupado('upd' + pub.item_id); setMsg(null)
    try {
      await mlApi('update_item', { item_id: pub.item_id, ...cambios })
      setMsg({ tipo: 'ok', texto: etiqueta + ' en Mercado Libre.' }); await cargarPubs()
    } catch (err) { setMsg({ tipo: 'error', texto: err.message }) }
    setOcupado('')
  }

  const pedidas = attrsCat.filter((a) => a.obligatorio || a.condicional)
  const faltantes = attrsCat.filter((a) => a.obligatorio && !atributos[a.id] && a.id !== 'BRAND')

  return (
    <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 900 }}>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
        Lo de esta pestaña es solo para Mercado Libre: no cambia la web. Lo que dejes vacío se toma del producto
        (título, fotos y descripción generales). Se guarda con el botón <strong>Guardar</strong> del producto.
      </p>

      {/* Publicaciones */}
      <div>
        <div style={sec}>Publicaciones en Mercado Libre</div>
        {!guardado ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Guardá el producto para poder publicarlo.</div>
        ) : pubs.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Todavía no está publicado en Mercado Libre.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pubs.map((p) => {
              const [txt, color, bg] = ESTADOS[p.estado] || [p.estado || '—', '#64748b', 'rgba(100,116,139,0.14)']
              const ocup = ocupado === 'upd' + p.item_id
              return (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, color, background: bg }}>{txt}</span>
                  <a href={p.permalink} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 180 }}>{p.titulo}</a>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fmtMoney(p.precio)} · stock {p.stock ?? '—'} · {p.vendidos ?? 0} vendidos</span>
                  {p.estado === 'active' && <button type="button" className="btn btn-sm" disabled={ocup} onClick={() => actualizar(p, { estado: 'paused' }, 'Pausada')}>Pausar</button>}
                  {p.estado === 'paused' && <button type="button" className="btn btn-sm" disabled={ocup} onClick={() => actualizar(p, { estado: 'active' }, 'Reactivada')}>Reactivar</button>}
                  {p.estado !== 'closed' && (
                    <button type="button" className="btn btn-sm" disabled={ocup || !(precioFinal > 0)}
                      title="Manda a Mercado Libre el precio, el stock y la descripción de esta pestaña"
                      onClick={() => actualizar(p, { precio: precioFinal, stock: Math.max(Number(form.stock_actual) || 0, 1), descripcion: form.ml_descripcion || soloTexto(form.descripcion) }, 'Precio, stock y descripción actualizados')}>
                      {ocup ? '...' : 'Actualizar en ML'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Título y precio */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={lbl}>Título en Mercado Libre (máx. 60)</span>
          <input className="input" maxLength={60} value={form.ml_titulo || ''} onChange={(e) => set('ml_titulo', e.target.value)}
            placeholder={(String(form.seo_titulo || '').split('|')[0] || form.nombre || '').trim().slice(0, 60)} />
          <span style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>{(form.ml_titulo || '').length}/60</span>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={lbl}>Precio en ML ($)</span>
          <input className="input" type="number" value={form.ml_precio ?? ''} onChange={(e) => set('ml_precio', e.target.value === '' ? null : e.target.value)}
            placeholder={precioLista ? String(precioLista) : 'a mano'} />
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{precioLista ? `Vacío = lista "${lista.nombre}": ${fmtMoney(precioLista)}` : 'No hay lista "Mercado Libre"'}</span>
        </label>
      </div>

      {/* Fotos */}
      <div>
        <div style={{ ...sec, display: 'flex', alignItems: 'center', gap: 10 }}>
          Fotos para Mercado Libre
          <button type="button" className="btn btn-sm" style={{ textTransform: 'none', letterSpacing: 0 }} onClick={copiarDeWeb}>Copiar las de la web</button>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {imagenes.map((url, i) => (
            <div key={url} style={{ position: 'relative' }}>
              <img src={url} alt="" style={{ width: i === 0 ? 120 : 84, height: i === 0 ? 120 : 84, objectFit: 'cover', borderRadius: 8, border: i === 0 ? '2px solid var(--primary)' : '1px solid var(--border)', display: 'block' }} />
              {i === 0 && <span style={{ position: 'absolute', bottom: 4, left: 4, fontSize: 10, fontWeight: 700, background: 'var(--primary)', color: '#fff', padding: '1px 6px', borderRadius: 4 }}>Portada</span>}
              {i > 0 && <button type="button" onClick={() => comoPortada(url)} title="Usar de portada" style={{ position: 'absolute', bottom: 3, left: 3, fontSize: 10, border: 'none', borderRadius: 4, padding: '1px 5px', cursor: 'pointer' }}>★</button>}
              <button type="button" onClick={() => quitar(url)} style={{ position: 'absolute', top: -6, right: -6, background: 'var(--danger)', color: '#fff', border: 'none', borderRadius: '50%', width: 18, height: 18, fontSize: 11, cursor: 'pointer' }}>✕</button>
            </div>
          ))}
          <label style={{ cursor: subiendo ? 'not-allowed' : 'pointer' }}>
            <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => subir(e, imagenes.length ? 'galeria' : 'portada')} disabled={subiendo} />
            <div style={{ width: 84, height: 84, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: '1px dashed var(--primary)', borderRadius: 8, background: 'var(--bg-highlight)', color: 'var(--primary)', fontSize: 11 }}>
              <span style={{ fontSize: 20 }}>+</span>{subiendo ? 'Subiendo...' : 'Agregar'}
            </div>
          </label>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
          La primera es la portada. ML recomienda fondo claro y al menos 1200 px. Si no cargás ninguna se usan las de la web.
        </div>
      </div>

      {/* Descripción */}
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ ...lbl, display: 'flex', alignItems: 'center', gap: 10 }}>
          Descripción para Mercado Libre (texto plano, sin formato)
          <button type="button" className="btn btn-sm" onClick={() => set('ml_descripcion', soloTexto(form.descripcion))}>Tomar la general</button>
        </span>
        <textarea className="input" rows={7} value={form.ml_descripcion || ''} onChange={(e) => set('ml_descripcion', e.target.value)}
          placeholder="Vacío = se usa la descripción general del producto, pasada a texto." style={{ resize: 'vertical' }} />
      </label>

      {/* Categoría y atributos */}
      <div>
        <div style={sec}>Categoría y atributos</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 180 }}>
            <span style={lbl}>Categoría ML</span>
            <input className="input" value={form.ml_categoria_id || ''} onChange={(e) => set('ml_categoria_id', e.target.value.trim())} placeholder="MLA1635" />
          </label>
          <button type="button" className="btn btn-sm" onClick={sugerir} disabled={ocupado === 'sugerir'}>{ocupado === 'sugerir' ? 'Buscando...' : 'Sugerir categoría'}</button>
          {sugeridas.map((c) => (
            <button key={c.id} type="button" className="btn btn-sm" onClick={() => set('ml_categoria_id', c.id)}
              style={{ borderColor: form.ml_categoria_id === c.id ? 'var(--primary)' : undefined }}>{c.nombre} <span style={{ color: 'var(--text-muted)' }}>{c.id}</span></button>
          ))}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '6px 0 10px' }}>
          Vacía = la de tus publicaciones anteriores. Marca, medidas, peso y SKU salen del producto; envío, garantía y material se copian de una publicación tuya. Acá podés pisar o completar atributos.
        </div>
        {faltantes.length > 0 && (
          <div style={{ fontSize: 12, color: '#92400e', background: 'rgba(217,119,6,0.1)', padding: '6px 10px', borderRadius: 6, marginBottom: 8 }}>
            Esta categoría pide además: {faltantes.map((a) => a.nombre).join(', ')}.
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
          {[...pedidas.filter((a) => a.id !== 'BRAND'), ...attrsCat.filter((a) => !a.obligatorio && !a.condicional && ['PAINTING_THEME', 'COLOR', 'MAIN_COLOR', 'FILTRABLE_COLOR', 'PANEL_TYPE'].includes(a.id))].slice(0, 14).map((a) => (
            <label key={a.id} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={lbl}>{a.nombre}{a.obligatorio ? ' *' : ''}</span>
              <input className="input" list={`ml-av-${a.id}`} value={atributos[a.id] || ''} onChange={(e) => setAttr(a.id, e.target.value)} />
              {a.valores?.length > 0 && <datalist id={`ml-av-${a.id}`}>{a.valores.map((v) => <option key={v} value={v} />)}</datalist>}
            </label>
          ))}
        </div>
        {Object.keys(atributos).length > 0 && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
            Atributos propios de este producto: {Object.entries(atributos).map(([k, v]) => `${k}=${v}`).join(' · ')}
          </div>
        )}
      </div>

      {/* Acciones */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: 14 }}>
        <button type="button" className="btn" disabled={!guardado || !!ocupado} onClick={() => accion('validar')}>{ocupado === 'validar' ? 'Validando...' : 'Validar con Mercado Libre'}</button>
        <button type="button" className="btn btn-primary" disabled={!guardado || !!ocupado} onClick={() => accion('publicar')}>{ocupado === 'publicar' ? 'Publicando...' : '🛒 Publicar en Mercado Libre'}</button>
        {!guardado && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Guardá el producto primero.</span>}
        {guardado && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Validar y publicar usan lo que ves en esta pestaña ahora mismo; tocá Guardar para que también quede guardado en el producto.</span>}
      </div>
      {msg && (
        <div style={{ fontSize: 13, padding: '8px 12px', borderRadius: 6, color: msg.tipo === 'ok' ? '#15803d' : 'var(--danger)', background: msg.tipo === 'ok' ? 'rgba(22,163,74,0.1)' : 'rgba(239,68,68,0.08)' }}>{msg.texto}</div>
      )}
    </div>
  )
}
