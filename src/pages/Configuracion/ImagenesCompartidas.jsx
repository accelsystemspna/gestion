import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { resyncProductosPorLista } from '../../lib/recalcularCC'
import { cargarImagenesCompartidas } from '../../lib/wooSync'

const BUCKET = 'productos'

export default function ImagenesCompartidas() {
  const [items, setItems]         = useState([])
  const [loading, setLoading]     = useState(true)
  const [uploading, setUploading] = useState(false)
  const [pendiente, setPendiente] = useState(false)   // hay cambios sin enviar a la web
  const [enviando, setEnviando]   = useState(false)
  const [resultado, setResultado] = useState('')

  const load = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('imagenes_compartidas').select('*').order('orden').order('id')
    if (error) alert('Error: ' + error.message)
    setItems(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const huboCambio = () => { setPendiente(true); setResultado('') }

  const handleUpload = async (e) => {
    const files = [...(e.target.files || [])]
    e.target.value = ''
    if (!files.length) return
    setUploading(true)
    let orden = items.reduce((m, i) => Math.max(m, i.orden), 0)
    for (const file of files) {
      const ext = file.name.split('.').pop()
      const path = `compartidas/${Date.now()}-${Math.round(Math.random() * 1e6)}.${ext}`
      const { error } = await supabase.storage.from(BUCKET).upload(path, file)
      if (error) { alert('Error al subir imagen: ' + error.message); continue }
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
      const { error: err2 } = await supabase.from('imagenes_compartidas').insert({
        nombre: file.name.replace(/\.[^.]+$/, ''), url: data.publicUrl, orden: ++orden,
      })
      if (err2) alert('Error: ' + err2.message)
    }
    setUploading(false)
    huboCambio()
    load()
  }

  const mover = async (idx, dir) => {
    const a = items[idx], b = items[idx + dir]
    if (!a || !b) return
    // Si tienen el mismo orden (datos viejos), se reasigna por posición
    const ordenA = a.orden === b.orden ? idx + dir : b.orden
    const ordenB = a.orden === b.orden ? idx : a.orden
    await Promise.all([
      supabase.from('imagenes_compartidas').update({ orden: ordenA }).eq('id', a.id),
      supabase.from('imagenes_compartidas').update({ orden: ordenB }).eq('id', b.id),
    ])
    huboCambio()
    load()
  }

  const toggleActiva = async (it) => {
    await supabase.from('imagenes_compartidas').update({ activa: !it.activa }).eq('id', it.id)
    huboCambio()
    load()
  }

  const renombrar = async (it, nombre) => {
    if (nombre === (it.nombre || '')) return
    await supabase.from('imagenes_compartidas').update({ nombre: nombre.trim() || null }).eq('id', it.id)
    setItems(prev => prev.map(x => x.id === it.id ? { ...x, nombre } : x))
  }

  const borrar = async (it) => {
    if (!confirm('¿Eliminar esta imagen compartida? Deja de mostrarse en todos los productos.')) return
    const { error } = await supabase.from('imagenes_compartidas').delete().eq('id', it.id)
    if (error) return alert('Error: ' + error.message)
    const marca = `/object/public/${BUCKET}/`
    const i = it.url.indexOf(marca)
    if (i >= 0) await supabase.storage.from(BUCKET).remove([decodeURIComponent(it.url.slice(i + marca.length))])
    huboCambio()
    load()
  }

  const enviarALaWeb = async () => {
    setEnviando(true)
    setResultado('')
    try {
      await cargarImagenesCompartidas({ force: true })
      const r = await resyncProductosPorLista()
      setResultado(`Listo: ${r.sincronizados}/${r.total} producto(s) actualizados en la web.`)
      setPendiente(false)
    } catch (err) {
      setResultado('Error al enviar: ' + err.message)
    } finally {
      setEnviando(false)
    }
  }

  const activas = items.filter(i => i.activa).length

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0, maxWidth: 560 }}>
          Imágenes que se repiten en todos los productos (ej. tamaños, envíos, cuidados). Se suben una sola vez y la web las
          reutiliza en vez de cargar una copia por producto. Aparecen en la galería después de las fotos propias de cada producto.
        </p>
        <label className="btn btn-primary btn-sm" style={{ cursor: uploading ? 'not-allowed' : 'pointer', opacity: uploading ? 0.6 : 1 }}>
          {uploading ? 'Subiendo...' : '+ Subir imágenes'}
          <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleUpload} disabled={uploading} />
        </label>
      </div>

      {(pendiente || resultado) && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          padding: '10px 14px', marginBottom: 14, borderRadius: 8,
          background: pendiente ? '#fffbeb' : '#f0fdf4',
          border: `1px solid ${pendiente ? '#fcd34d' : '#86efac'}`,
        }}>
          <span style={{ fontSize: 13, flex: 1, color: '#1f2937' }}>
            {pendiente ? 'Hay cambios que todavía no se enviaron a la web.' : resultado}
          </span>
          {pendiente && (
            <button className="btn btn-primary btn-sm" onClick={enviarALaWeb} disabled={enviando}>
              {enviando ? 'Enviando…' : 'Enviar cambios a la web'}
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>Cargando...</div>
      ) : items.length === 0 ? (
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)', border: '1px dashed var(--border)', borderRadius: 8 }}>
          Todavía no hay imágenes compartidas. Subí la primera.
        </div>
      ) : (
        <>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
            {activas} activa{activas !== 1 ? 's' : ''} de {items.length} · el orden de arriba hacia abajo es el orden en la galería.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map((it, idx) => (
              <div key={it.id} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px',
                border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-card)',
                opacity: it.activa ? 1 : 0.5, flexWrap: 'wrap',
              }}>
                <img src={it.url} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)', flexShrink: 0 }} />
                <input
                  className="input"
                  defaultValue={it.nombre || ''}
                  placeholder="Nombre (solo para vos)"
                  onBlur={(e) => renombrar(it, e.target.value)}
                  style={{ flex: 1, minWidth: 140, fontSize: 13 }}
                />
                <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                  <button className="btn btn-sm btn-ghost" onClick={() => mover(idx, -1)} disabled={idx === 0} title="Subir">↑</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => mover(idx, 1)} disabled={idx === items.length - 1} title="Bajar">↓</button>
                  <button className="btn btn-sm" onClick={() => toggleActiva(it)}>{it.activa ? 'Activa' : 'Pausada'}</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => borrar(it)} style={{ color: 'var(--danger)' }}>Eliminar</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
