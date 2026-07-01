/**
 * FacturaCPreview.jsx
 * Preview HTML de Factura C con diseño profesional argentino.
 * Se usa como vista previa antes de emitir y como confirmación post-emisión.
 */
import { fmtMoney } from '../../lib/format'

const fmtFecha = (iso) => {
  if (!iso) return new Date().toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' })
  const [y, m, d] = String(iso).slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

const CONCEPTOS = { 1: 'Productos', 2: 'Servicios', 3: 'Productos y Servicios' }

export default function FacturaCPreview({ venta, items, arcaConfig, branding, factOpts, onClose, onEmitir, emitiendo, modo }) {
  const esPreview  = !venta?.cae
  const nroPv      = String(arcaConfig?.punto_venta ?? 3).padStart(4, '0')
  const nroComp    = esPreview ? '????????' : String(venta?.nro_factura ?? 0).padStart(8, '0')
  const cuitFmt    = String(arcaConfig?.cuit ?? '').replace(/(\d{2})(\d{8})(\d{1})/, '$1-$2-$3')
  const razon      = arcaConfig?.razon_social || branding?.nombre || 'CC DISEÑOS'
  const logoUrl    = branding?.logo_url
  const fechaHoy   = fmtFecha(venta?.fecha)
  const ventaItems = items ?? venta?.venta_items ?? []
  const total      = Number(venta?.total ?? 0)
  const concepto   = CONCEPTOS[factOpts?.concepto ?? 1] || 'Productos'
  const receptor   = factOpts?.docTipo === 80 && factOpts?.docNro
    ? `CUIT: ${factOpts.docNro}` : (venta?.cliente_nombre || 'Consumidor Final')

  const W  = { maxWidth: 620, margin: '0 auto', fontFamily: 'Arial, sans-serif', fontSize: 12 }
  const BG = '#1a3a5c'   // azul oscuro header

  return (
    <div className="modal-overlay" style={{ zIndex: 1200, overflow: 'auto', alignItems: 'flex-start', paddingTop: 20, paddingBottom: 20 }}>
      <div style={{ width: '100%', ...W }}>

        {/* Acciones top */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, padding: '0 4px' }}>
          <div style={{ fontWeight: 700, color: 'white', fontSize: 14 }}>
            {esPreview ? '🔍 Vista previa de Factura C' : '✅ Factura C emitida'}
          </div>
          <button className="btn btn-sm" onClick={onClose} style={{ background: 'rgba(255,255,255,0.15)', color: 'white', border: '1px solid rgba(255,255,255,0.3)' }}>✕ Cerrar</button>
        </div>

        {/* ── FACTURA ────────────────────────────────────────────────────────── */}
        <div style={{ background: 'white', borderRadius: 10, overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.35)', position: 'relative' }}>

          {/* Marca de agua VISTA PREVIA */}
          {esPreview && (
            <div style={{
              position: 'absolute', top: '38%', left: '50%',
              transform: 'translate(-50%, -50%) rotate(-30deg)',
              fontSize: 52, fontWeight: 900, color: 'rgba(0,0,0,0.05)',
              pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 1, letterSpacing: 4,
            }}>VISTA PREVIA</div>
          )}

          {/* ── HEADER ─────────────────────────────────────────────────────── */}
          <div style={{ background: BG, color: 'white', display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', padding: '16px 20px', gap: 12 }}>

            {/* Izquierda: logo + razón social */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {logoUrl && (
                <img src={logoUrl} alt="logo" style={{ width: 52, height: 52, objectFit: 'contain', borderRadius: 6, background: 'rgba(255,255,255,0.12)', padding: 4 }} />
              )}
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, lineHeight: 1.2 }}>{razon}</div>
                <div style={{ fontSize: 10, opacity: 0.75, marginTop: 2 }}>CUIT: {cuitFmt}</div>
                <div style={{ fontSize: 10, opacity: 0.75 }}>Monotributista · Punto de venta: {nroPv}</div>
                {branding?.domicilio && <div style={{ fontSize: 10, opacity: 0.65 }}>{branding.domicilio}</div>}
              </div>
            </div>

            {/* Centro: letra de comprobante */}
            <div style={{ textAlign: 'center', border: '3px solid rgba(255,255,255,0.6)', borderRadius: 8, padding: '8px 18px' }}>
              <div style={{ fontSize: 28, fontWeight: 900, lineHeight: 1 }}>C</div>
              <div style={{ fontSize: 9, opacity: 0.8, marginTop: 2, letterSpacing: 1 }}>FACTURA</div>
            </div>

            {/* Derecha: número y fecha */}
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10, opacity: 0.7 }}>Comprobante Nro</div>
              <div style={{ fontFamily: 'monospace', fontSize: 15, fontWeight: 700 }}>{nroPv}-{nroComp}</div>
              <div style={{ fontSize: 10, opacity: 0.7, marginTop: 6 }}>Fecha de emisión</div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{fechaHoy}</div>
            </div>
          </div>

          {/* Alerta homologación */}
          {modo === 'homologacion' && (
            <div style={{ background: '#fef9c3', borderBottom: '1px solid #fcd34d', padding: '6px 20px', fontSize: 11, color: '#92400e', display: 'flex', alignItems: 'center', gap: 6 }}>
              🧪 <strong>Modo Homologación</strong> — Esta factura es de prueba y no tiene validez fiscal.
            </div>
          )}

          {/* ── DATOS RECEPTOR ─────────────────────────────────────────────── */}
          <div style={{ padding: '12px 20px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', gap: 32, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>Receptor</div>
              <div style={{ fontWeight: 700 }}>{receptor}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>Condición IVA</div>
              <div style={{ fontWeight: 600 }}>Consumidor Final</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>Concepto</div>
              <div style={{ fontWeight: 600 }}>{concepto}</div>
            </div>
          </div>

          {/* ── TABLA ITEMS ────────────────────────────────────────────────── */}
          <div style={{ padding: '0 20px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 0 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #1a3a5c' }}>
                  <th style={{ textAlign: 'left',  padding: '10px 6px', fontSize: 11, color: '#1a3a5c', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Descripción</th>
                  <th style={{ textAlign: 'center', padding: '10px 6px', fontSize: 11, color: '#1a3a5c', fontWeight: 700, textTransform: 'uppercase', width: 60 }}>Cant.</th>
                  <th style={{ textAlign: 'right',  padding: '10px 6px', fontSize: 11, color: '#1a3a5c', fontWeight: 700, textTransform: 'uppercase', width: 100 }}>P. Unitario</th>
                  <th style={{ textAlign: 'right',  padding: '10px 6px', fontSize: 11, color: '#1a3a5c', fontWeight: 700, textTransform: 'uppercase', width: 100 }}>Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {ventaItems.map((item, i) => {
                  const cant     = Number(item.cantidad ?? 1)
                  const subtotal = Number(item.subtotal ?? 0)
                  const precio   = cant > 0 ? subtotal / cant : 0
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#fafbfc' }}>
                      <td style={{ padding: '9px 6px' }}>{item.descripcion}</td>
                      <td style={{ padding: '9px 6px', textAlign: 'center', color: '#475569' }}>{cant}</td>
                      <td style={{ padding: '9px 6px', textAlign: 'right',  color: '#475569' }}>{fmtMoney(precio)}</td>
                      <td style={{ padding: '9px 6px', textAlign: 'right',  fontWeight: 600 }}>{fmtMoney(subtotal)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* ── TOTAL ──────────────────────────────────────────────────────── */}
          <div style={{ padding: '12px 20px', display: 'flex', justifyContent: 'flex-end' }}>
            <div style={{ background: BG, color: 'white', borderRadius: 8, padding: '10px 20px', minWidth: 200, textAlign: 'right' }}>
              <div style={{ fontSize: 11, opacity: 0.75, marginBottom: 2 }}>TOTAL</div>
              <div style={{ fontSize: 22, fontWeight: 900 }}>{fmtMoney(total)}</div>
            </div>
          </div>

          {/* ── CAE ────────────────────────────────────────────────────────── */}
          <div style={{ margin: '0 20px 16px', borderRadius: 8, border: `1px solid ${esPreview ? '#e2e8f0' : '#86efac'}`, background: esPreview ? '#f8fafc' : '#f0fdf4', padding: '10px 16px' }}>
            {esPreview ? (
              <div style={{ color: '#94a3b8', fontSize: 11, textAlign: 'center' }}>
                El CAE será asignado por ARCA al momento de la emisión
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>CAE</div>
                  <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13 }}>{venta?.cae}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Vto. CAE</div>
                  <div style={{ fontWeight: 600 }}>{fmtFecha(venta?.cae_vto)}</div>
                </div>
                <div style={{ marginLeft: 'auto', fontSize: 10, color: '#16a34a', fontWeight: 700 }}>
                  ✅ Comprobante autorizado por ARCA
                </div>
              </div>
            )}
          </div>

          {/* ── PIE ────────────────────────────────────────────────────────── */}
          <div style={{ borderTop: '1px solid #e2e8f0', padding: '8px 20px', background: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 10, color: '#94a3b8' }}>Generado por CC Gestión · Verificá en afip.gob.ar</div>
            <div style={{ fontSize: 10, color: '#94a3b8' }}>Comprobante electrónico</div>
          </div>
        </div>

        {/* ── Botones de acción ───────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 10, marginTop: 14, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose} style={{ background: 'rgba(255,255,255,0.15)', color: 'white', border: '1px solid rgba(255,255,255,0.3)' }}>
            Cerrar
          </button>
          {onEmitir && (
            <button className="btn btn-primary" onClick={onEmitir} disabled={emitiendo} style={{ minWidth: 160 }}>
              {emitiendo ? 'Enviando a ARCA…' : '🏛️ Confirmar y emitir'}
            </button>
          )}
        </div>

      </div>
    </div>
  )
}
