import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fmtMoney } from '../../lib/format'
import jsPDF from 'jspdf'
import { generarFacturaC, buildWhatsAppText } from '../../lib/facturaC'
import FacturaCPreview from './FacturaCPreview'

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
  pagado:    { color: '#16a34a', bg: '#dcfce7', label: 'Pagado' },
  pendiente: { color: '#d97706', bg: '#fef9c3', label: 'Pendiente' },
  parcial:   { color: '#7c3aed', bg: '#f5f3ff', label: 'Parcial' },
  anulado:   { color: '#64748b', bg: '#f1f5f9', label: 'Anulado' },
}

async function urlToDataUrl(url) {
  try {
    const resp = await fetch(url)
    const blob = await resp.blob()
    return await new Promise((res, rej) => {
      const reader = new FileReader()
      reader.onloadend = () => res(reader.result)
      reader.onerror = rej
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

export default function VentaDetalle({ ventaId, onClose, onUpdated }) {
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
  const [factOpts,       setFactOpts]       = useState({ concepto: 1, docTipo: 99, docNro: '' })
  const [emitiendo,      setEmitiendo]      = useState(false)
  const [factEmitida,    setFactEmitida]    = useState(null)   // datos tras emitir
  const [descargando,    setDescargando]    = useState(false)
  const [showPreview,    setShowPreview]    = useState(false)  // preview antes de emitir

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
      supabase.from('branding').select('*').eq('id', 1).maybeSingle(),
      supabase.from('arca_config').select('*').eq('id', 1).maybeSingle(),
    ]).then(([v, it, br, ar]) => {
      setVenta(v.data)
      setItems(it.data ?? [])
      setBranding(br.data)
      setArcaConfig(ar.data ?? null)
      if (ar.data) setFactOpts(o => ({ ...o, concepto: ar.data.concepto ?? 1 }))
      setLoading(false)
    })
  }, [ventaId])

  // ── Emitir Factura C ─────────────────────────────────────────────────────────
  const emitirFacturaC = async () => {
    setEmitiendo(true)
    try {
      const { data, error } = await supabase.functions.invoke('emitir-factura', {
        body: {
          venta_id: venta.id,
          importe:  venta.total,
          concepto: factOpts.concepto,
          doc_tipo: factOpts.docTipo,
          doc_nro:  factOpts.docTipo === 99 ? '0' : factOpts.docNro.replace(/-/g, ''),
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
      setFactEmitida({ ...venta, cae: data.cae, cae_vto: data.caeVto, nro_factura: data.nroFactura })
    } catch (e) {
      alert('Error al emitir factura: ' + e.message)
    }
    setEmitiendo(false)
  }

  const handleDescargarPDF = async () => {
    if (!factEmitida) return
    setDescargando(true)
    await generarFacturaC({ venta: factEmitida, arcaConfig, download: true })
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
    setVenta(v => ({ ...v, estado: 'anulado' }))
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
    await supabase.from('venta_items').delete().eq('venta_id', ventaId)
    await supabase.from('ventas').delete().eq('id', ventaId)
    setAccion(null)
    setShowEliminar(false)
    onUpdated?.()
    onClose()
  }

  // ── Exportar PDF ───────────────────────────────────────────────────────────
  const exportPDF = async () => {
    if (!venta) return
    const doc  = new jsPDF({ unit: 'pt', format: 'a4' })
    const pw   = doc.internal.pageSize.getWidth()
    const ph   = doc.internal.pageSize.getHeight()
    const comp = COMPROBANTES.find(c => c.value === venta.comprobante)
    const est  = ESTADO_S[venta.estado] ?? ESTADO_S.pendiente
    const DARK = [20, 20, 20]

    const negocio = branding?.nombre ?? branding?.nombre_negocio ?? 'Mi Empresa'

    // Franja superior delgada (neutra, sin color de marca)
    doc.setFillColor(...DARK)
    doc.rect(0, 0, pw, 4, 'F')

    // Logo
    let logoW = 0
    let y = 16
    if (branding?.logo_url) {
      const dataUrl = await urlToDataUrl(branding.logo_url)
      if (dataUrl) {
        doc.addImage(dataUrl, 40, y, 64, 64)
        logoW = 76
      }
    }

    // Slogan y contacto (a la derecha del logo; el nombre ya figura en el logo)
    const nameX = 40 + logoW
    if (branding?.slogan) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.setTextColor(100, 100, 100)
      doc.text(branding.slogan, nameX, y + 26)
    }

    const contactParts = [branding?.direccion, branding?.telefono, branding?.email].filter(Boolean)
    if (contactParts.length) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.setTextColor(120, 120, 120)
      const cy = branding?.slogan ? y + 42 : y + 30
      doc.text(contactParts.join('  |  '), nameX, cy)
    }

    // Comprobante info (derecha)
    const numStr = 'N' + String.fromCharCode(176) + ' ' + String(venta.numero ?? 0).padStart(4, '0')
    doc.setTextColor(...DARK)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(15)
    doc.text((comp?.label ?? 'Ticket') + ' ' + numStr, pw - 40, y + 18, { align: 'right' })

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(80, 80, 80)
    doc.text(fmtDate(venta.fecha), pw - 40, y + 34, { align: 'right' })
    if (venta.hora) doc.text(venta.hora, pw - 40, y + 48, { align: 'right' })

    // Estado (solo texto ASCII, sin unicode decorativo)
    const estRgb =
      venta.estado === 'pagado'    ? [22, 163, 74]   :
      venta.estado === 'pendiente' ? [217, 119, 6]   :
      venta.estado === 'anulado'   ? [100, 116, 139] : [124, 58, 237]
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...estRgb)
    doc.text(est.label.toUpperCase(), pw - 40, y + 64, { align: 'right' })

    y += 82

    // Separador grueso
    doc.setDrawColor(...DARK)
    doc.setLineWidth(1.5)
    doc.line(40, y, pw - 40, y)
    doc.setLineWidth(0.5)
    y += 14

    // Cliente / forma de pago
    doc.setTextColor(...DARK)
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.text('Cliente:', 40, y)
    doc.setFont('helvetica', 'normal')
    doc.text(venta.cliente_nombre ?? 'Consumidor Final', 95, y)

    const fpObj = FORMAS_PAGO.find(f => f.value === venta.forma_pago)
    const fpLblPdf = fpObj?.label ?? (venta.forma_pago ?? '')
    doc.setFont('helvetica', 'bold')
    doc.text('Forma de pago:', pw / 2, y)
    doc.setFont('helvetica', 'normal')
    doc.text(fpLblPdf, pw / 2 + 90, y)
    y += 18

    doc.setDrawColor(200, 200, 200)
    doc.setLineWidth(0.5)
    doc.line(40, y, pw - 40, y)
    y += 13

    // Posiciones de columnas de la tabla
    const X_DESC   = 50          // Descripcion — izquierda
    const X_CANT   = 355         // Cantidad    — centro
    const X_PRECIO = 450         // Precio      — centro
    const X_SUB    = pw - 45     // Subtotal    — derecha  (= 550)
    // Posiciones de la sección de totales
    const TOT_L    = pw - 245    // etiqueta izquierda (= 350)
    const TOT_V    = pw - 45     // valor derecha       (= 550)

    // Cabecera tabla
    doc.setFillColor(245, 245, 245)
    doc.rect(40, y - 2, pw - 80, 20, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(60, 60, 60)
    doc.text('DESCRIPCION', X_DESC,   y + 12)
    doc.text('CANT.',       X_CANT,   y + 12, { align: 'center' })
    doc.text('PRECIO',      X_PRECIO, y + 12, { align: 'center' })
    doc.text('SUBTOTAL',    X_SUB,    y + 12, { align: 'right' })
    y += 22

    // Filas de items
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(0, 0, 0)
    for (const [idx, it] of items.entries()) {
      if (idx % 2 === 0) {
        doc.setFillColor(251, 251, 251)
        doc.rect(40, y - 2, pw - 80, 19, 'F')
      }
      const desc = it.descripcion
      doc.text(desc,                         X_DESC,   y + 12)
      doc.text(String(it.cantidad),          X_CANT,   y + 12, { align: 'center' })
      doc.text(fmtMoney(it.precio_unitario), X_PRECIO, y + 12, { align: 'center' })
      doc.text(fmtMoney(it.subtotal),        X_SUB,    y + 12, { align: 'right' })
      doc.setDrawColor(225, 225, 225)
      doc.line(40, y + 17, pw - 40, y + 17)
      y += 21
    }
    y += 10

    // Totales
    doc.setDrawColor(160, 160, 160)
    doc.line(TOT_L, y, TOT_V, y)
    y += 12

    const rowTot = (label, value, bold, rgb) => {
      doc.setFont('helvetica', bold ? 'bold' : 'normal')
      doc.setFontSize(bold ? 13 : 10)
      doc.setTextColor(...(rgb ?? [40, 40, 40]))
      doc.text(label, TOT_L, y)
      doc.text(value, TOT_V, y, { align: 'right' })
      y += bold ? 24 : 16
    }

    rowTot('Subtotal:', fmtMoney(venta.subtotal_items ?? venta.total), false, null)
    if ((venta.descuento_porcentaje ?? 0) > 0) {
      rowTot(
        'Descuento (' + venta.descuento_porcentaje + '%):',
        '-' + fmtMoney(venta.descuento_monto),
        false, [200, 30, 30]
      )
    }

    // Caja TOTAL — rect centrado sobre el texto (baseline en y, fuente 13pt)
    doc.setFillColor(245, 245, 245)
    doc.roundedRect(TOT_L - 6, y - 14, TOT_V - TOT_L + 16, 22, 3, 3, 'F')
    rowTot('TOTAL:', fmtMoney(venta.total), true, DARK)

    // CAE
    if (venta.cae) {
      y += 8
      doc.setFontSize(9)
      doc.setTextColor(120, 120, 120)
      doc.text('CAE: ' + venta.cae + '   Vto: ' + (venta.cae_vencimiento ?? ''), 40, y)
    }

    // Footer oscuro
    doc.setFillColor(...DARK)
    doc.rect(0, ph - 24, pw, 24, 'F')
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(200, 200, 200)
    doc.text('Generado el ' + new Date().toLocaleString('es-AR'), 44, ph - 9)
    if (branding?.instagram) {
      doc.text('@' + branding.instagram.replace(/^@/, ''), pw - 44, ph - 9, { align: 'right' })
    }

    doc.save('comprobante-' + String(venta.numero ?? 0).padStart(4, '0') + '.pdf')
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--bg)', borderRadius: 10, padding: 32, fontSize: 14 }}>Cargando...</div>
    </div>
  )

  if (!venta) return null

  const comp       = COMPROBANTES.find(c => c.value === venta.comprobante)
  const est        = ESTADO_S[venta.estado] ?? ESTADO_S.pendiente
  const fpLbl      = FORMAS_PAGO.find(f => f.value === venta.forma_pago)?.label ?? venta.forma_pago
  const esAnulado  = venta.estado === 'anulado'
  const esPendiente = venta.estado === 'pendiente' || venta.estado === 'parcial'

  return (<>
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: 'var(--bg)', borderRadius: 12, width: '100%', maxWidth: 580, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 16px 48px rgba(0,0,0,0.3)' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 16, color: comp?.color }}>
                {comp?.label ?? 'Ticket'} #{String(venta.numero ?? 0).padStart(4, '0')}
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: est.bg, color: est.color }}>
                {est.label}
              </span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              {fmtDate(venta.fecha)}{venta.hora ? ' · ' + venta.hora : ''}
            </div>
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
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', flexShrink: 0 }}>
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
                      {it.descripcion}
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
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#dc2626' }}>
                <span>Descuento ({venta.descuento_porcentaje}%)</span>
                <span>-{fmtMoney(venta.descuento_monto)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 20, color: 'var(--primary)', paddingTop: 8, borderTop: '2px solid var(--border)', marginTop: 4 }}>
              <span>Total</span>
              <span>{fmtMoney(venta.total)}</span>
            </div>
          </div>

          {/* CAE */}
          {venta.cae && (
            <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 7, padding: '8px 12px', fontSize: 12 }}>
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
                  <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, padding: '12px 14px' }}>
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
                          style={{ padding: '7px 14px', borderRadius: 6, border: pagoForma === f.value ? 'none' : '1px solid var(--border)', background: pagoForma === f.value ? '#16a34a' : 'var(--surface)', color: pagoForma === f.value ? 'white' : 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                          {f.label}
                        </button>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => setShowPagoPicker(false)} disabled={!!accion}
                        style={{ flex: 1, padding: '8px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontSize: 13 }}>
                        Cancelar
                      </button>
                      <button onClick={marcarPagado} disabled={!!accion}
                        style={{ flex: 2, padding: '8px', borderRadius: 7, border: 'none', background: accion ? '#e2e8f0' : '#16a34a', color: accion ? '#94a3b8' : 'white', cursor: accion ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 700 }}>
                        {accion === 'pagando' ? 'Procesando...' : 'Confirmar pago'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setShowPagoPicker(true)} disabled={!!accion}
                    style={{ width: '100%', padding: '9px', borderRadius: 7, border: 'none', background: '#16a34a', color: 'white', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
                    Marcar como pagado
                  </button>
                )
              )}

              {!showPagoPicker && (
                <button onClick={anularVenta} disabled={!!accion}
                  style={{ width: '100%', padding: '8px', borderRadius: 7, border: '1px solid ' + (accion ? 'var(--border)' : '#ef4444'), background: 'transparent', color: accion ? '#94a3b8' : '#ef4444', cursor: accion ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 700 }}>
                  {accion === 'anulando' ? 'Procesando...' : 'Anular venta'}
                </button>
              )}
            </div>
          )}

          {/* Eliminar permanentemente */}
          {!showPagoPicker && (
            showEliminar ? (
              <div style={{ background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: 8, padding: '12px 14px' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#be123c', marginBottom: 10 }}>
                  Esta accion eliminara la venta permanentemente. No se puede deshacer.
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setShowEliminar(false)} disabled={!!accion}
                    style={{ flex: 1, padding: '8px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontSize: 13 }}>
                    Cancelar
                  </button>
                  <button onClick={eliminarVenta} disabled={!!accion}
                    style={{ flex: 2, padding: '8px', borderRadius: 7, border: 'none', background: accion ? '#e2e8f0' : '#dc2626', color: 'white', cursor: accion ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 700 }}>
                    {accion === 'eliminando' ? 'Eliminando...' : 'Si, eliminar'}
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setShowEliminar(true)} disabled={!!accion}
                style={{ width: '100%', padding: '7px', borderRadius: 7, border: '1px solid #fca5a5', background: 'transparent', color: '#dc2626', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                Eliminar permanentemente
              </button>
            )
          )}

          {/* Emitir Factura C */}
          {arcaConfig && venta.estado !== 'anulado' && (
            venta.factura_emitida ? (
              <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#16a34a', textTransform: 'uppercase', marginBottom: 4 }}>
                  ✅ Factura C emitida
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
            ) : (
              <button onClick={() => setShowFactModal(true)}
                style={{ width: '100%', padding: '9px', borderRadius: 7, border: '1px solid #2563eb', background: '#eff6ff', color: '#2563eb', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
                🏛️ Emitir Factura C
              </button>
            )
          )}

          {/* Imprimir / PDF */}
          {!showEliminar && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => window.print()}
                style={{ flex: 1, padding: '9px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                Imprimir
              </button>
              <button onClick={exportPDF}
                style={{ flex: 1, padding: '9px', borderRadius: 7, border: 'none', background: 'var(--primary)', color: 'white', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
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
            <h3 style={{ fontSize: 16, color: '#15803d' }}>✅ Factura C emitida</h3>
            <button className="btn btn-ghost btn-sm" onClick={() => setFactEmitida(null)}>✕</button>
          </div>
          <div className="modal-body" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* Preview de la factura */}
            <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', fontSize: 12 }}>
              {/* Header */}
              <div style={{ background: '#1e3a5f', color: 'white', padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{arcaConfig.razon_social || 'CC DISEÑOS'}</div>
                  <div style={{ opacity: 0.8, fontSize: 11 }}>CUIT: {String(arcaConfig.cuit || '').replace(/(\d{2})(\d{8})(\d{1})/, '$1-$2-$3')} · Monotributista</div>
                </div>
                <div style={{ textAlign: 'center', border: '2px solid white', padding: '4px 10px', borderRadius: 4 }}>
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
              📲 Compartir por WhatsApp
            </button>
            <button className="btn btn-primary" onClick={handleDescargarPDF} disabled={descargando}>
              {descargando ? 'Generando…' : '⬇️ Descargar PDF'}
            </button>
          </div>
        </div>
      </div>
    )}

    {showFactModal && venta && (
      <div className="modal-overlay" style={{ zIndex: 1100 }}>
        <div className="modal" style={{ maxWidth: 420 }}>
          <div className="modal-header">
            <h3 style={{ fontSize: 16 }}>🏛️ Emitir Factura C</h3>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowFactModal(false)}>✕</button>
          </div>
          <div className="modal-body" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>

            {arcaConfig.modo === 'homologacion' && (
              <div style={{ background: '#fef9c3', border: '1px solid #fcd34d', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#92400e' }}>
                🧪 Modo <strong>Homologación</strong> — esta factura es de prueba, no tiene validez fiscal.
              </div>
            )}

            <div style={{ background: '#f8fafc', borderRadius: 8, padding: '10px 14px' }}>
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
                      color:       factOpts.concepto === v ? 'white' : undefined,
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
                {[{ v: 99, l: 'Consumidor Final' }, { v: 80, l: 'Con CUIT' }].map(({ v, l }) => (
                  <button key={v} className="btn btn-sm"
                    onClick={() => setFactOpts(o => ({ ...o, docTipo: v }))}
                    style={{
                      flex: 1,
                      background:  factOpts.docTipo === v ? 'var(--primary)' : undefined,
                      color:       factOpts.docTipo === v ? 'white' : undefined,
                      borderColor: factOpts.docTipo === v ? 'var(--primary)' : undefined,
                      fontWeight:  factOpts.docTipo === v ? 700 : 400,
                    }}>
                    {l}
                  </button>
                ))}
              </div>
              {factOpts.docTipo === 80 && (
                <input className="input" placeholder="CUIT del cliente (sin guiones)"
                  value={factOpts.docNro} onChange={e => setFactOpts(o => ({ ...o, docNro: e.target.value }))}
                  style={{ fontSize: 14 }} />
              )}
            </div>

          </div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setShowFactModal(false)} disabled={emitiendo}>Cancelar</button>
            <button className="btn" onClick={() => setShowPreview(true)} disabled={emitiendo}
              style={{ borderColor: '#1a3a5c', color: '#1a3a5c' }}>
              🔍 Vista previa
            </button>
            <button className="btn btn-primary" onClick={emitirFacturaC} disabled={emitiendo}
              style={{ minWidth: 140 }}>
              {emitiendo ? 'Enviando a ARCA…' : '🏛️ Confirmar y emitir'}
            </button>
          </div>
        </div>
      </div>
    )}
  </>)
}
