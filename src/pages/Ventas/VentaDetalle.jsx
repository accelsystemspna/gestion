import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fmtMoney } from '../../lib/format'
import { generarFacturaC, buildWhatsAppText } from '../../lib/facturaC'
import { facturaEnPanel, sincronizarTicketCliente, quitarTicketCliente } from '../../lib/documentosCliente'
import { generarComprobanteVenta } from '../../lib/comprobanteVenta'
import { CONDICIONES_IVA, DOC_CONSUMIDOR, DOC_CUIT, DOC_CUIL, NOMBRE_DOC, cuitValido, receptorDeCliente, soloDigitos } from '../../lib/cuit'
import { ajustarStock } from '../../lib/stock'
import FacturaCPreview from './FacturaCPreview'
import ImageThumb from '../../components/ImageThumb'
import { ESTADOS_WEB, FASES_FACTURABLES, estadoWebDe } from '../../lib/pedidosWeb'
import { useAuth } from '../../lib/AuthContext'

const fmtDate = (d) =>
  d ? new Date(d + 'T00:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'

const COMPROBANTES = [
  { value: 'ticket',    label: 'Ticket',    color: '#6366f1' },
  { value: 'factura_b', label: 'Factura B', color: '#0891b2' },
  { value: 'factura_c', label: 'Factura C', color: '#0284c7' },
]

const FORMAS_PAGO = [
  { value: 'efectivo',         label: 'Efectivo' },
  { value: 'debito',           label: 'Debito' },
  { value: 'credito',          label: 'Credito' },
  { value: 'transferencia',    label: 'Transferencia' },
  { value: 'cuenta_corriente', label: 'Cuenta corriente' },
]

const ESTADO_S = {
  pagado:              { color: '#16a34a', bg: '#dcfce7', label: 'Pagado' },
  pendiente:           { color: '#d97706', bg: '#fef9c3', label: 'Pendiente' },
  parcial:             { color: '#7c3aed', bg: '#f5f3ff', label: 'Parcial' },
  anulado:             { color: '#64748b', bg: '#f1f5f9', label: 'Anulado' },
  pendiente_revision:  { color: '#0891b2', bg: '#cffafe', label: 'Revisar' },
}

const CANAL_S = {
  web_minorista: { label: 'Web minorista', color: '#0891b2', bg: '#cffafe' },
  web_mayorista: { label: 'Web mayorista', color: '#7c3aed', bg: '#f5f3ff' },
}

export default function VentaDetalle({ ventaId, onClose, onUpdated }) {
  const { orgId } = useAuth()
  const [venta,         setVenta]         = useState(null)
  const [items,         setItems]         = useState([])
  const [loading,       setLoading]       = useState(true)
  const [branding,      setBranding]      = useState(null)
  const [accion,         setAccion]         = useState(null)
  const [showPagoPicker, setShowPagoPicker] = useState(false)
  const [pagoForma,      setPagoForma]      = useState('efectivo')
  const [showEliminar,   setShowEliminar]   = useState(false)
  const [arcaConfig,     setArcaConfig]     = useState(null)
  const [showFactModal,  setShowFactModal]  = useState(false)
  const [factOpts,       setFactOpts]       = useState({ concepto: 1, docTipo: DOC_CONSUMIDOR, docNro: '', condIva: 'Consumidor Final' })
  const [emitiendo,      setEmitiendo]      = useState(false)
  const [factEmitida,    setFactEmitida]    = useState(null)   // datos tras emitir
  const [descargando,    setDescargando]    = useState(false)
  const [showPreview,    setShowPreview]    = useState(false)  // preview antes de emitir

  // Fotos de los productos (para reconocer qué es cada renglón)
  const [imagenes, setImagenes] = useState({})
  useEffect(() => {
    const ids = [...new Set(items.map(i => i.producto_id).filter(Boolean))]
    if (!ids.length) return
    supabase.from('productos').select('id, imagen_url, imagen_web_url').in('id', ids)
      .then(({ data }) => setImagenes(Object.fromEntries((data ?? []).map(p => [p.id, p.imagen_url || p.imagen_web_url || null]))))
  }, [items])

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  useEffect(() => {
    setLoading(true)
    Promise.all([
      supabase.from('ventas').select('*').eq('id', ventaId).single(),
      supabase.from('venta_items').select('*').eq('venta_id', ventaId).order('id'),
      supabase.from('branding').select('*').eq('user_id', orgId).maybeSingle(),
      supabase.from('arca_config').select('*').eq('user_id', orgId).maybeSingle(),
    ]).then(([v, it, br, ar]) => {
      setVenta(v.data)
      // Si la ficha tiene CUIT o CUIL, la factura ya sale a su nombre
      if (v.data?.cliente_id) {
        supabase.from('clientes').select('cuit, cuit_tipo, condicion_iva').eq('id', v.data.cliente_id).maybeSingle()
          .then(({ data: cli }) => { if (cli?.cuit) setFactOpts(o => ({ ...o, ...receptorDeCliente(cli) })) })
      }
      setItems(it.data ?? [])
      setBranding(br.data)
      setArcaConfig(ar.data ?? null)
      if (ar.data) setFactOpts(o => ({ ...o, concepto: ar.data.concepto ?? 1 }))
      setLoading(false)
    })
  }, [ventaId])

  // ── Emitir Factura C ─────────────────────────────────────────────────────────
  const emitirFacturaC = async () => {
    if (factOpts.docTipo !== DOC_CONSUMIDOR && !cuitValido(factOpts.docNro)) {
      alert(`Revisá el ${NOMBRE_DOC[factOpts.docTipo]}: tiene que tener 11 números y el último no coincide.`)
      return
    }
    setEmitiendo(true)
    try {
      const { data, error } = await supabase.functions.invoke('emitir-factura', {
        body: {
          venta_id: venta.id,
          importe:  venta.total,
          concepto: factOpts.concepto,
          doc_tipo: factOpts.docTipo,
          doc_nro:  factOpts.docTipo === DOC_CONSUMIDOR ? '0' : soloDigitos(factOpts.docNro),
        },
      })
      if (error) throw new Error(error.message)
      if (!data?.ok) throw new Error(data?.error || 'Error al emitir')

      // Guardar en la DB
      await supabase.from('ventas').update({
        cae:             data.cae,
        cae_vto:         data.caeVto,
        nro_factura:     data.nroFactura,
        factura_emitida: true,
      }).eq('id', venta.id)

      // Actualizar estado local
      setVenta(v => ({
        ...v,
        cae:             data.cae,
        cae_vto:         data.caeVto,
        nro_factura:     data.nroFactura,
        factura_emitida: true,
      }))
      setShowFactModal(false)
      // Mostrar modal de éxito con preview, descarga y WhatsApp
      const conDoc = factOpts.docTipo !== DOC_CONSUMIDOR
      const datosFactura = {
        factura_fecha:    new Date().toLocaleDateString('en-CA'),
        factura_doc_tipo: factOpts.docTipo,
        factura_doc_nro:  conDoc ? soloDigitos(factOpts.docNro) : null,
        factura_cond_iva: conDoc ? factOpts.condIva : 'Consumidor Final',
      }
      // Para reimprimirla igual. Aparte: la factura ya quedó guardada aunque esto falle.
      supabase.from('ventas').update(datosFactura).eq('id', venta.id)
        .then(({ error: e }) => { if (e) console.warn('[factura] no se guardaron los datos del receptor', e.message) })
      const emitida = { ...venta, ...datosFactura, cae: data.cae, cae_vto: data.caeVto, nro_factura: data.nroFactura, venta_items: items }
      setFactEmitida(emitida)
      // Con factura, el cliente ve la factura en lugar del ticket.
      facturaEnPanel({ venta: emitida, items, arcaConfig, orgId }).then(() => sincronizarTicketCliente(venta.id))
    } catch (e) {
      alert('Error al emitir factura: ' + e.message)
    }
    setEmitiendo(false)
  }

  const handleDescargarPDF = async () => {
    if (!factEmitida) return
    setDescargando(true)
    await generarFacturaC({ venta: factEmitida, arcaConfig, branding: branding ?? {}, download: true })
    setDescargando(false)
  }

  const handleWhatsApp = () => {
    if (!factEmitida) return
    const texto = buildWhatsAppText({ venta: factEmitida, arcaConfig })
    window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank')
  }

  // ── Anular venta ───────────────────────────────────────────────────────────
  const anularVenta = async () => {
    if (!window.confirm('Anular esta venta? Esta accion no se puede deshacer.')) return
    setAccion('anulando')
    const { error: errUpd } = await supabase
      .from('ventas').update({ estado: 'anulado' }).eq('id', ventaId)
    if (errUpd) {
      alert('No se pudo anular la venta: ' + errUpd.message)
      setAccion(null)
      return
    }
    if (venta.forma_pago === 'cuenta_corriente' && venta.cliente_id) {
      const { data: cli } = await supabase.from('clientes').select('saldo').eq('id', venta.cliente_id).single()
      if (cli) {
        await supabase.from('clientes')
          .update({ saldo: (Number(cli.saldo) || 0) + (venta.total || 0) })
          .eq('id', venta.cliente_id)
      }
    }
    ajustarStock(items.map(i => ({ producto_id: i.producto_id, cantidad: -i.cantidad })))
      .catch(err => console.error('[stock]', err))
    setVenta(v => ({ ...v, estado: 'anulado' }))
    sincronizarTicketCliente(ventaId)
    setAccion(null)
    onUpdated?.()
  }

  // ── Marcar como pagado ─────────────────────────────────────────────────────
  const marcarPagado = async () => {
    setAccion('pagando')
    const { error: errUpd } = await supabase
      .from('ventas').update({ estado: 'pagado', forma_pago: pagoForma }).eq('id', ventaId)
    if (errUpd) {
      alert('No se pudo marcar como pagado: ' + errUpd.message)
      setAccion(null)
      return
    }
    if (venta.forma_pago === 'cuenta_corriente' && venta.cliente_id) {
      const { data: cli } = await supabase.from('clientes').select('saldo').eq('id', venta.cliente_id).single()
      if (cli) {
        await supabase.from('clientes')
          .update({ saldo: (Number(cli.saldo) || 0) + (venta.total || 0) })
          .eq('id', venta.cliente_id)
      }
    }
    setVenta(v => ({ ...v, estado: 'pagado', forma_pago: pagoForma }))
    sincronizarTicketCliente(ventaId)
    setAccion(null)
    setShowPagoPicker(false)
    onUpdated?.()
  }

  // ── Eliminar venta permanentemente ────────────────────────────────────────
  const eliminarVenta = async () => {
    setAccion('eliminando')
    // Si no estaba anulada y era CC, revertir saldo antes de borrar
    if (venta.estado !== 'anulado' && venta.forma_pago === 'cuenta_corriente' && venta.cliente_id) {
      const { data: cli } = await supabase.from('clientes').select('saldo').eq('id', venta.cliente_id).single()
      if (cli) {
        await supabase.from('clientes')
          .update({ saldo: (Number(cli.saldo) || 0) + (venta.total || 0) })
          .eq('id', venta.cliente_id)
      }
    }
    // Si no estaba anulada, el stock nunca se devolvió — devolverlo antes de borrar
    if (venta.estado !== 'anulado') {
      await ajustarStock(items.map(i => ({ producto_id: i.producto_id, cantidad: -i.cantidad })))
        .catch(err => console.error('[stock]', err))
    }
    await quitarTicketCliente(ventaId)
    await supabase.from('venta_items').delete().eq('venta_id', ventaId)
    await supabase.from('ventas').delete().eq('id', ventaId)
    setAccion(null)
    setShowEliminar(false)
    onUpdated?.()
    onClose()
  }

  // ── Exportar PDF ───────────────────────────────────────────────────────────
  const exportPDF = () => venta.factura_emitida && arcaConfig
    ? generarFacturaC({ venta: { ...venta, venta_items: items }, arcaConfig, branding: branding ?? {}, download: true })
    : generarComprobanteVenta({ venta, items, branding })

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--bg)', borderRadius: 'var(--radius-sm)', padding: 32, fontSize: 14 }}>Cargando...</div>
    </div>
  )

  if (!venta) return null

  const comp       = COMPROBANTES.find(c => c.value === venta.comprobante)
  const est        = ESTADO_S[venta.estado] ?? ESTADO_S.pendiente
  const fpLbl      = FORMAS_PAGO.find(f => f.value === venta.forma_pago)?.label ?? venta.forma_pago
  const esAnulado  = venta.estado === 'anulado'
  const esPendiente = venta.estado === 'pendiente' || venta.estado === 'parcial' || venta.estado === 'pendiente_revision'
  const canal = CANAL_S[venta.canal]
  // Un pedido de la web se factura recién cuando está armado (fase "Listo para despachar").
  const esPedidoWeb = !!venta.origen_ref
  const faseWeb = esPedidoWeb ? estadoWebDe(venta) : null
  const puedeFacturar = !esPedidoWeb || FASES_FACTURABLES.includes(faseWeb)

  return (<>
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: 'var(--bg)', borderRadius: 'var(--radius-sm)', width: '100%', maxWidth: 580, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 16px 48px rgba(0,0,0,0.3)' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 16, color: comp?.color }}>
                {comp?.label ?? 'Ticket'} #{String(venta.numero ?? 0).padStart(4, '0')}
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 'var(--radius-sm)', background: est.bg, color: est.color }}>
                {est.label}
              </span>
              {canal && (
                <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 'var(--radius-sm)', background: canal.bg, color: canal.color }}>
                  {canal.label}
                </span>
              )}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              {fmtDate(venta.fecha)}{venta.hora ? ' · ' + venta.hora : ''}
            </div>
            {canal && venta.notas && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, fontStyle: 'italic' }}>
                {venta.notas}
              </div>
            )}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--text-muted)', padding: '2px 6px' }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Datos */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[
              ['CLIENTE',       venta.cliente_nombre ?? 'Consumidor Final'],
              ['FORMA DE PAGO', fpLbl],
              ['COMPROBANTE',   comp?.label ?? '—', comp?.color],
            ].map(([k, v, c]) => (
              <div key={k}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.04em' }}>{k}</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: c ?? 'var(--text)' }}>{v}</div>
              </div>
            ))}
          </div>

          {/* Items */}
          <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden', flexShrink: 0 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--surface)' }}>
                  {['Descripción', 'Cant.', 'Precio', 'Subtotal'].map((h, i) => (
                    <th key={h} style={{ padding: '8px 10px', textAlign: i === 0 ? 'left' : 'right', fontSize: 11, color: 'var(--text-muted)', fontWeight: 700 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={it.id} style={{ borderTop: '1px solid var(--border)', background: i % 2 === 1 ? 'var(--surface)' : undefined }}>
                    <td style={{ padding: '8px 10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {imagenes[it.producto_id] && <ImageThumb src={imagenes[it.producto_id]} size={38} radius={5} alt={it.descripcion} />}
                        <div style={{ minWidth: 0 }}>
                          <div>{it.descripcion}</div>
                          {it.sku && <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)' }}>{it.sku}</div>}
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right' }}>{it.cantidad}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--text-muted)' }}>{fmtMoney(it.precio_unitario)}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700 }}>{fmtMoney(it.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totales */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
              <span>Subtotal</span>
              <span>{fmtMoney(venta.subtotal_items ?? venta.total)}</span>
            </div>
            {(venta.descuento_porcentaje ?? 0) > 0 && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#dc2626' }}>
                  <span>Descuento ({venta.descuento_porcentaje}%)</span>
                  <span>-{fmtMoney(venta.descuento_monto)}</span>
                </div>
                {venta.notas && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    Motivo: {venta.notas}
                  </div>
                )}
              </>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 20, color: 'var(--primary)', paddingTop: 8, borderTop: '2px solid var(--border)', marginTop: 4 }}>
              <span>Total</span>
              <span>{fmtMoney(venta.total)}</span>
            </div>
          </div>

          {/* CAE */}
          {venta.cae && (
            <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 'var(--radius-sm)', padding: '8px 12px', fontSize: 12 }}>
              <div style={{ fontWeight: 700, color: '#15803d' }}>CAE</div>
              <div style={{ fontFamily: 'monospace' }}>{venta.cae}</div>
              {venta.cae_vto && <div style={{ color: '#64748b' }}>Vto: {venta.cae_vto}</div>}
            </div>
          )}
        </div>

        {/* Footer con acciones */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>

          {/* Acciones de estado */}
          {!esAnulado && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

              {esPendiente && (
                showPagoPicker ? (
                  <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 'var(--radius-sm)', padding: '12px 14px' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#15803d', marginBottom: 10 }}>
                      ¿Cómo pagó el cliente?
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                      {[
                        { value: 'efectivo',      label: 'Efectivo' },
                        { value: 'debito',        label: 'Debito' },
                        { value: 'credito',       label: 'Credito' },
                        { value: 'transferencia', label: 'Transferencia' },
                      ].map(f => (
                        <button key={f.value} onClick={() => setPagoForma(f.value)}
                          style={{ padding: '7px 14px', borderRadius: 'var(--radius-sm)', border: pagoForma === f.value ? 'none' : '1px solid var(--border)', background: pagoForma === f.value ? '#16a34a' : 'var(--surface)', color: pagoForma === f.value ? 'white' : 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                          {f.label}
                        </button>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => setShowPagoPicker(false)} disabled={!!accion}
                        style={{ flex: 1, padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontSize: 13 }}>
                        Cancelar
                      </button>
                      <button onClick={marcarPagado} disabled={!!accion}
                        style={{ flex: 2, padding: '8px', borderRadius: 'var(--radius-sm)', border: 'none', background: accion ? '#e2e8f0' : '#16a34a', color: accion ? '#94a3b8' : 'white', cursor: accion ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 700 }}>
                        {accion === 'pagando' ? 'Procesando...' : 'Confirmar pago'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setShowPagoPicker(true)} disabled={!!accion}
                    style={{ width: '100%', padding: '9px', borderRadius: 'var(--radius-sm)', border: 'none', background: '#16a34a', color: 'white', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
                    Marcar como pagado
                  </button>
                )
              )}

              {!showPagoPicker && (
                <button onClick={anularVenta} disabled={!!accion}
                  style={{ width: '100%', padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid ' + (accion ? 'var(--border)' : '#ef4444'), background: 'transparent', color: accion ? '#94a3b8' : '#ef4444', cursor: accion ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 700 }}>
                  {accion === 'anulando' ? 'Procesando...' : 'Anular venta'}
                </button>
              )}
            </div>
          )}

          {/* Eliminar permanentemente */}
          {!showPagoPicker && (
            showEliminar ? (
              <div style={{ background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: 'var(--radius-sm)', padding: '12px 14px' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#be123c', marginBottom: 10 }}>
                  Esta accion eliminara la venta permanentemente. No se puede deshacer.
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setShowEliminar(false)} disabled={!!accion}
                    style={{ flex: 1, padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontSize: 13 }}>
                    Cancelar
                  </button>
                  <button onClick={eliminarVenta} disabled={!!accion}
                    style={{ flex: 2, padding: '8px', borderRadius: 'var(--radius-sm)', border: 'none', background: accion ? '#e2e8f0' : '#dc2626', color: 'white', cursor: accion ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 700 }}>
                    {accion === 'eliminando' ? 'Eliminando...' : 'Si, eliminar'}
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setShowEliminar(true)} disabled={!!accion}
                style={{ width: '100%', padding: '7px', borderRadius: 'var(--radius-sm)', border: '1px solid #fca5a5', background: 'transparent', color: '#dc2626', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                Eliminar permanentemente
              </button>
            )
          )}

          {/* Emitir Factura C */}
          {arcaConfig && venta.estado !== 'anulado' && (
            venta.factura_emitida ? (
              <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 'var(--radius-sm)', padding: '10px 12px' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#16a34a', textTransform: 'uppercase', marginBottom: 4 }}>
                  Factura C emitida
                </div>
                <div style={{ fontSize: 12, color: '#15803d' }}>
                  Nro: {String(arcaConfig.punto_venta).padStart(4,'0')}-{String(venta.nro_factura).padStart(8,'0')}
                </div>
                <div style={{ fontSize: 11, color: '#166534', marginTop: 2, wordBreak: 'break-all' }}>
                  CAE: {venta.cae}
                </div>
                <div style={{ fontSize: 11, color: '#166534' }}>
                  Vto: {venta.cae_vto}
                </div>
              </div>
            ) : !puedeFacturar ? (
              <div style={{ background: 'var(--bg-muted)', border: '1px dashed var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
                Todavía no se puede facturar: el pedido está en <strong>{ESTADOS_WEB[faseWeb]?.label}</strong>.
                Se habilita cuando esté <strong>Listo para despachar</strong> (se cambia desde Tiendas).
              </div>
            ) : (
              <button onClick={() => setShowFactModal(true)}
                style={{ width: '100%', padding: '9px', borderRadius: 'var(--radius-sm)', border: '1px solid #2563eb', background: '#eff6ff', color: '#2563eb', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
                Emitir Factura C
              </button>
            )
          )}

          {/* Imprimir / PDF */}
          {!showEliminar && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => window.print()}
                style={{ flex: 1, padding: '9px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                Imprimir
              </button>
              <button onClick={exportPDF}
                style={{ flex: 1, padding: '9px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--primary)', color: 'var(--on-primary)', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
                Exportar PDF
              </button>
            </div>
          )}
        </div>
      </div>
    </div>

    {/* ── Preview de factura (antes de emitir) ──────────────────────────── */}
    {showPreview && venta && arcaConfig && (
      <FacturaCPreview
        venta={{ ...venta, venta_items: items }}
        items={items}
        arcaConfig={arcaConfig}
        branding={branding}
        factOpts={factOpts}
        modo={arcaConfig.modo}
        onClose={() => setShowPreview(false)}
        onEmitir={() => { setShowPreview(false); emitirFacturaC() }}
        emitiendo={emitiendo}
      />
    )}

    {/* ── Modal éxito: factura emitida ──────────────────────────────────── */}
    {factEmitida && arcaConfig && (
      <div className="modal-overlay" style={{ zIndex: 1100 }}>
        <div className="modal" style={{ maxWidth: 460 }}>
          <div className="modal-header">
            <h3 style={{ fontSize: 16, color: '#15803d' }}>Factura C emitida</h3>
            <button className="btn btn-ghost btn-sm" onClick={() => setFactEmitida(null)}>✕</button>
          </div>
          <div className="modal-body" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* Preview de la factura */}
            <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden', fontSize: 12 }}>
              {/* Header */}
              <div style={{ background: '#1e3a5f', color: 'white', padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{arcaConfig.razon_social || 'CC DISEÑOS'}</div>
                  <div style={{ opacity: 0.8, fontSize: 11 }}>CUIT: {String(arcaConfig.cuit || '').replace(/(\d{2})(\d{8})(\d{1})/, '$1-$2-$3')} · Monotributista</div>
                </div>
                <div style={{ textAlign: 'center', border: '2px solid white', padding: '4px 10px', borderRadius: 'var(--radius-sm)' }}>
                  <div style={{ fontSize: 18, fontWeight: 800 }}>C</div>
                  <div style={{ fontSize: 9 }}>FACTURA</div>
                </div>
              </div>
              {/* Datos */}
              <div style={{ padding: '10px 14px', background: '#f8fafc', display: 'flex', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ color: 'var(--text-muted)' }}>Nro</div>
                  <div style={{ fontWeight: 700, fontFamily: 'monospace' }}>
                    {String(arcaConfig.punto_venta ?? 3).padStart(4,'0')}-{String(factEmitida.nro_factura ?? 0).padStart(8,'0')}
                  </div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-muted)' }}>Fecha</div>
                  <div style={{ fontWeight: 600 }}>{new Date().toLocaleDateString('es-AR')}</div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-muted)' }}>Total</div>
                  <div style={{ fontWeight: 700, color: 'var(--success)', fontSize: 15 }}>{fmtMoney(Number(factEmitida.total))}</div>
                </div>
              </div>
              {/* Cliente */}
              <div style={{ padding: '6px 14px', borderTop: '1px solid var(--border)' }}>
                <span style={{ color: 'var(--text-muted)' }}>Receptor: </span>
                <span style={{ fontWeight: 600 }}>{factEmitida.cliente_nombre || 'Consumidor Final'}</span>
              </div>
              {/* Items */}
              <div style={{ padding: '6px 14px', borderTop: '1px solid var(--border)' }}>
                {(factEmitida.venta_items ?? []).map((item, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                    <span>{item.descripcion} × {item.cantidad}</span>
                    <span style={{ fontWeight: 600 }}>{fmtMoney(Number(item.subtotal))}</span>
                  </div>
                ))}
              </div>
              {/* CAE */}
              <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border)', background: '#f0fdf4' }}>
                <div style={{ display: 'flex', gap: 16 }}>
                  <div><span style={{ color: 'var(--text-muted)' }}>CAE: </span><code style={{ fontSize: 11 }}>{factEmitida.cae}</code></div>
                  <div><span style={{ color: 'var(--text-muted)' }}>Vto: </span><span>{factEmitida.cae_vto}</span></div>
                </div>
              </div>
            </div>

          </div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setFactEmitida(null)}>Cerrar</button>
            <button className="btn" onClick={handleWhatsApp} style={{ color: '#16a34a', borderColor: '#86efac' }}>
              Compartir por WhatsApp
            </button>
            <button className="btn btn-primary" onClick={handleDescargarPDF} disabled={descargando}>
              {descargando ? 'Generando…' : 'Descargar PDF'}
            </button>
          </div>
        </div>
      </div>
    )}

    {showFactModal && venta && (
      <div className="modal-overlay" style={{ zIndex: 1100 }}>
        <div className="modal" style={{ maxWidth: 420 }}>
          <div className="modal-header">
            <h3 style={{ fontSize: 16 }}>Emitir Factura C</h3>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowFactModal(false)}>✕</button>
          </div>
          <div className="modal-body" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>

            {arcaConfig.modo === 'homologacion' && (
              <div style={{ background: '#fef9c3', border: '1px solid #fcd34d', borderRadius: 'var(--radius-sm)', padding: '8px 12px', fontSize: 12, color: '#92400e' }}>
                Modo <strong>Homologación</strong> — esta factura es de prueba, no tiene validez fiscal.
              </div>
            )}

            <div style={{ background: '#f8fafc', borderRadius: 'var(--radius-sm)', padding: '10px 14px' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Total a facturar</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--primary)' }}>{fmtMoney(venta.total)}</div>
              {venta.cliente_nombre && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{venta.cliente_nombre}</div>
              )}
            </div>

            {/* Concepto */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Concepto</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {[{ v: 1, l: 'Productos' }, { v: 2, l: 'Servicios' }, { v: 3, l: 'Ambos' }].map(({ v, l }) => (
                  <button key={v} className="btn btn-sm"
                    onClick={() => setFactOpts(o => ({ ...o, concepto: v }))}
                    style={{
                      flex: 1,
                      background:  factOpts.concepto === v ? 'var(--primary)' : undefined,
                      color:       factOpts.concepto === v ? 'var(--on-primary)' : undefined,
                      borderColor: factOpts.concepto === v ? 'var(--primary)' : undefined,
                      fontWeight:  factOpts.concepto === v ? 700 : 400,
                    }}>
                    {l}
                  </button>
                ))}
              </div>
            </div>

            {/* Receptor */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Receptor</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {[{ v: DOC_CONSUMIDOR, l: 'Consumidor Final' }, { v: DOC_CUIT, l: 'Con CUIT' }, { v: DOC_CUIL, l: 'Con CUIL' }].map(({ v, l }) => (
                  <button key={v} className="btn btn-sm"
                    onClick={() => setFactOpts(o => ({ ...o, docTipo: v }))}
                    style={{
                      flex: 1,
                      background:  factOpts.docTipo === v ? 'var(--primary)' : undefined,
                      color:       factOpts.docTipo === v ? 'var(--on-primary)' : undefined,
                      borderColor: factOpts.docTipo === v ? 'var(--primary)' : undefined,
                      fontWeight:  factOpts.docTipo === v ? 700 : 400,
                    }}>
                    {l}
                  </button>
                ))}
              </div>
              {factOpts.docTipo !== DOC_CONSUMIDOR && (
                <input className="input" placeholder={`${NOMBRE_DOC[factOpts.docTipo]} del cliente`}
                  value={factOpts.docNro} onChange={e => setFactOpts(o => ({ ...o, docNro: e.target.value }))}
                  style={{ fontSize: 14 }} />
              )}
              {factOpts.docTipo !== DOC_CONSUMIDOR && (
                <select className="select" value={factOpts.condIva} onChange={e => setFactOpts(o => ({ ...o, condIva: e.target.value }))} style={{ fontSize: 14 }}>
                  {CONDICIONES_IVA.map(v => <option key={v}>{v}</option>)}
                </select>
              )}
            </div>

          </div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setShowFactModal(false)} disabled={emitiendo}>Cancelar</button>
            <button className="btn" onClick={() => setShowPreview(true)} disabled={emitiendo}
              style={{ borderColor: '#1a3a5c', color: '#1a3a5c' }}>
              Vista previa
            </button>
            <button className="btn btn-primary" onClick={emitirFacturaC} disabled={emitiendo}
              style={{ minWidth: 140 }}>
              {emitiendo ? 'Enviando a ARCA…' : 'Confirmar y emitir'}
            </button>
          </div>
        </div>
      </div>
    )}
  </>)
}
