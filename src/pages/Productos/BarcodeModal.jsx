import { useEffect, useState } from 'react'
import { fmtMoney } from '../../lib/format'
import { precioVenta } from '../../lib/pricing'
import { generateLabelDataUrl, downloadLabelPNG, printLabel } from '../../lib/barcode'

export default function BarcodeModal({ producto, lista, branding, onClose }) {
  const precioStr = lista
    ? fmtMoney(precioVenta(Number(producto.costo_base), lista))
    : ''

  const hasDim = (producto.ancho_producto != null && producto.ancho_producto !== '') ||
                 (producto.alto_producto  != null && producto.alto_producto  !== '')

  const logoUrl = branding?.logo_url || null

  const [opts, setOpts] = useState({
    mostrarNombre:      true,
    mostrarDimensiones: hasDim,
    mostrarPrecio:      !!lista,
    mostrarLogo:        !!logoUrl,
    tamano:             'mediano',
  })

  const [previewUrl, setPreviewUrl] = useState('')
  const [generando,  setGenerando]  = useState(false)

  // Regenerar preview al cambiar opciones
  useEffect(() => {
    let cancelled = false
    setGenerando(true)
    generateLabelDataUrl(producto, {
      ...opts,
      precioStr,
      logoUrl: opts.mostrarLogo ? logoUrl : null,
    }).then((url) => {
      if (!cancelled) { setPreviewUrl(url); setGenerando(false) }
    }).catch(() => setGenerando(false))
    return () => { cancelled = true }
  }, [opts, producto, precioStr, logoUrl])

  // Cerrar con Escape
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const toggle = (k) => setOpts((o) => ({ ...o, [k]: !o[k] }))

  const PillSwitch = ({ on, onClick, disabled }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 40, height: 22, borderRadius: 11, border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: on && !disabled ? 'var(--primary)' : '#cbd5e1',
        position: 'relative', flexShrink: 0,
        transition: 'background 0.2s', opacity: disabled ? 0.4 : 1,
      }}
    >
      <span style={{
        position: 'absolute', top: 3,
        left: on && !disabled ? 20 : 3,
        width: 16, height: 16, borderRadius: 8,
        background: 'white', transition: 'left 0.2s',
      }} />
    </button>
  )

  const handleDownload = () => downloadLabelPNG(producto, {
    ...opts, precioStr, logoUrl: opts.mostrarLogo ? logoUrl : null,
  })
  const handlePrint = () => printLabel(producto, {
    ...opts, precioStr, logoUrl: opts.mostrarLogo ? logoUrl : null,
  })

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 520 }}>

        <div className="modal-header">
          <h3 style={{ fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            🏷️ Etiqueta con código de barras
            <code style={{ fontSize: 13, background: '#f1f5f9', padding: '2px 7px', borderRadius: 4, fontWeight: 400 }}>
              {producto.sku}
            </code>
          </h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Preview */}
          <div style={{
            background: '#f8fafc', borderRadius: 10, padding: 16, textAlign: 'center',
            border: '1px solid var(--border)', minHeight: 120,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {generando
              ? <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Generando…</span>
              : previewUrl
                ? <img src={previewUrl} alt="preview" style={{ maxWidth: '100%', borderRadius: 4, boxShadow: '0 1px 6px rgba(0,0,0,.12)' }} />
                : null
            }
          </div>

          {/* Opciones de contenido */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
              Incluir en la etiqueta
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {[
                {
                  field: 'mostrarLogo',
                  label: 'Logo de la empresa',
                  desc: logoUrl ? 'Se muestra a la izquierda del código' : 'Sin logo cargado en Configuración',
                  disabled: !logoUrl,
                },
                {
                  field: 'mostrarNombre',
                  label: 'Nombre del producto',
                  desc: producto.nombre,
                  disabled: false,
                },
                {
                  field: 'mostrarDimensiones',
                  label: 'Dimensiones',
                  desc: hasDim
                    ? [producto.ancho_producto && `${producto.ancho_producto} cm`, producto.alto_producto && `${producto.alto_producto} cm`].filter(Boolean).join(' × ')
                    : 'Sin dimensiones cargadas',
                  disabled: !hasDim,
                },
                {
                  field: 'mostrarPrecio',
                  label: 'Precio de venta',
                  desc: lista ? `${lista.nombre} — ${precioStr}` : 'Sin lista seleccionada',
                  disabled: !lista,
                },
              ].map(({ field, label, desc, disabled }) => (
                <div
                  key={field}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '9px 0', borderBottom: '1px solid var(--border)',
                    opacity: disabled ? 0.5 : 1,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
                    {desc && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{desc}</div>}
                  </div>
                  <PillSwitch on={opts[field]} onClick={() => !disabled && toggle(field)} disabled={disabled} />
                </div>
              ))}
            </div>
          </div>

          {/* Tamaño */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
              Tamaño de etiqueta
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {[
                { val: 'pequeno', label: 'Pequeño', sub: '~5 × 2 cm' },
                { val: 'mediano', label: 'Mediano', sub: '~8 × 3 cm' },
                { val: 'grande',  label: 'Grande',  sub: '~10 × 4 cm' },
              ].map(({ val, label, sub }) => (
                <button
                  key={val}
                  onClick={() => setOpts((o) => ({ ...o, tamano: val }))}
                  className="btn btn-sm"
                  style={{
                    flex: 1, height: 'auto', padding: '8px 4px',
                    background:  opts.tamano === val ? 'var(--primary)' : undefined,
                    color:       opts.tamano === val ? 'white'          : undefined,
                    borderColor: opts.tamano === val ? 'var(--primary)' : undefined,
                    fontWeight:  opts.tamano === val ? 700 : 400,
                  }}
                >
                  <span style={{ display: 'block', fontSize: 13 }}>{label}</span>
                  <span style={{ display: 'block', fontSize: 10, opacity: 0.75, marginTop: 2 }}>{sub}</span>
                </button>
              ))}
            </div>
          </div>

        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cerrar</button>
          <button className="btn" onClick={handlePrint}>🖨️ Imprimir</button>
          <button className="btn btn-primary" onClick={handleDownload}>⬇️ Descargar PNG</button>
        </div>

      </div>
    </div>
  )
}
