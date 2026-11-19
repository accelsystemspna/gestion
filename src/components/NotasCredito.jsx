import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtMoney } from '../lib/format'
import { redondear } from '../lib/cobro'
import { facturaAsociada, numeroNota, pdfNota, subirFacturaML, subirNotaML } from '../lib/mlFiscal'

const lbl = { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }
const fmtFecha = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '')

async function mensajeDeError(error) {
  try { const j = await error.context?.json?.(); if (j?.error) return j.error } catch { /* sin cuerpo */ }
  return error.message
}

/**
 * Notas de crédito de una venta facturada (devoluciones) y, si es de Mercado Libre,
 * la subida de la factura y de las notas a la venta en ML.
 */
export default function NotasCredito({ venta, items, arcaConfig, branding, onCambio }) {
  const [notas, setNotas] = useState(null)
  const [falta, setFalta] = useState(false)
  const [form, setForm] = useState(null)        // { importe, motivo, confirmar, solicitudId }
  const [ocupado, setOcupado] = useState(null)
  const [msg, setMsg] = useState(null)
  const [ventaAct, setVentaAct] = useState(venta)
  const esML = /^ML#/.test(venta.origen_ref || '')
  const modo = arcaConfig?.modo === 'produccion' ? 'produccion' : 'homologacion'

  const cargar = useCallback(async () => {
    const [{ data, error }, { data: v }] = await Promise.all([
      supabase.from('notas_credito').select('*').eq('venta_id', venta.id).is('factura_id', null).order('created_at'),
      supabase.from('ventas').select('*').eq('id', venta.id).maybeSingle(),
    ])
    if (error) { setFalta(true); return }
    setNotas(data ?? [])
    if (v) setVentaAct(v)
  }, [venta.id])
  useEffect(() => { cargar() }, [cargar])

  if (falta) return <div style={{ fontSize: 12, color: '#92400e' }}>Para hacer notas de crédito falta correr supabase_ml_facturacion.sql en Supabase.</div>
  if (!notas) return null

  const emitidas = notas.filter((n) => n.estado === 'emitida' && n.modo === modo)
  const acreditado = redondear(emitidas.reduce((a, n) => a + Number(n.importe), 0))
  const disponible = redondear(Math.max(Number(venta.total) - acreditado, 0))
  const importe = redondear(form?.importe)
  const errorForm = !form ? '' : importe <= 0 ? 'Escribí un importe mayor a cero.' : importe > disponible ? `No puede superar ${fmtMoney(disponible)}.` : !form.motivo.trim() ? 'Escribí el motivo.' : ''

  const abrir = () => { setMsg(null); setForm({ importe: String(disponible), motivo: 'Devolución', confirmar: false, solicitudId: crypto.randomUUID() }) }

  const emitir = async () => {
    setOcupado('nc'); setMsg(null)
    const { data, error } = await supabase.functions.invoke('emitir-factura', {
      body: { accion: 'nota_credito', venta_id: venta.id, importe, motivo: form.motivo.trim(), solicitud_id: form.solicitudId },
    })
    const err = error ? await mensajeDeError(error) : !data?.ok ? (data?.error || 'ARCA no la autorizó.') : null
    if (err) { setOcupado(null); setForm((f) => ({ ...f, confirmar: false })); setMsg({ tipo: 'error', texto: 'No se emitió la nota de crédito: ' + err }); await cargar(); return }
    const nota = data.nota
    let texto = `Nota de crédito C ${numeroNota(nota)} emitida por ${fmtMoney(nota.importe)}.`
    if (esML && nota.modo === 'produccion') {
      try { await subirNotaML({ nota, venta: ventaAct, arcaConfig, branding }); texto += ' Ya se subió a la venta en Mercado Libre.' }
      catch (e) { texto += ' No se pudo subir a Mercado Libre (' + e.message + '): probá con el botón.' }
    }
    setForm(null); setOcupado(null)
    await cargar()
    setMsg({ tipo: 'ok', texto })
    onCambio?.()
  }

  const subirFactura = async () => {
    setOcupado('subir'); setMsg(null)
    try { await subirFacturaML({ venta: ventaAct, items, arcaConfig, branding }); setMsg({ tipo: 'ok', texto: 'Factura subida a la venta en Mercado Libre.' }) }
    catch (e) { setMsg({ tipo: 'error', texto: 'No se pudo subir: ' + e.message }) }
    setOcupado(null); await cargar()
  }
  const subirNota = async (n) => {
    setOcupado('subir-' + n.id); setMsg(null)
    try { await subirNotaML({ nota: n, venta: ventaAct, arcaConfig, branding }); setMsg({ tipo: 'ok', texto: 'Nota de crédito subida a Mercado Libre.' }) }
    catch (e) { setMsg({ tipo: 'error', texto: 'No se pudo subir: ' + e.message }) }
    setOcupado(null); await cargar()
  }

  const estadoML = (subida, error) => subida
    ? <span style={{ color: '#15803d' }}>Subida a Mercado Libre</span>
    : <span style={{ color: '#b45309' }}>{error ? 'No se pudo subir a Mercado Libre: ' + error : 'Falta subir a Mercado Libre'}</span>

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
      {esML && modo === 'produccion' && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div><div style={lbl}>Factura en Mercado Libre</div>{estadoML(ventaAct.ml_factura_subida, ventaAct.ml_subida_error)}</div>
          {!ventaAct.ml_factura_subida && <button className="btn btn-sm" onClick={subirFactura} disabled={!!ocupado}>{ocupado === 'subir' ? 'Subiendo…' : 'Subir ahora'}</button>}
        </div>
      )}
      {esML && ventaAct.ml_factura_error && !ventaAct.factura_emitida && (
        <div style={{ color: '#b45309' }}>No se facturó sola: {ventaAct.ml_factura_error}</div>
      )}

      <div>
        <div style={lbl}>Notas de crédito</div>
        {emitidas.length === 0 && <div style={{ color: 'var(--text-muted)' }}>Ninguna. Si hay una devolución, se anula la factura con una nota de crédito.</div>}
        {notas.filter((n) => n.modo === modo).map((n) => (
          <div key={n.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', padding: '6px 0', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
            <div>
              {n.estado === 'emitida'
                ? <><strong>N° {numeroNota(n)}</strong> · {fmtMoney(n.importe)} · {fmtFecha(n.fecha)}</>
                : <><strong>{n.estado === 'fallida' ? 'No emitida' : 'Emitiéndose…'}</strong> · {fmtMoney(n.importe)}</>}
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{n.motivo}{n.estado === 'fallida' && n.error ? ' · ' + n.error : ''}</div>
              {esML && n.estado === 'emitida' && n.modo === 'produccion' && <div style={{ fontSize: 12 }}>{estadoML(n.ml_subida, n.ml_subida_error)}</div>}
            </div>
            {n.estado === 'emitida' && (
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-sm btn-ghost" onClick={() => pdfNota({ nota: n, venta: ventaAct, arcaConfig, branding: branding ?? {}, download: true })}>PDF</button>
                {esML && n.modo === 'produccion' && !n.ml_subida && <button className="btn btn-sm" onClick={() => subirNota(n)} disabled={!!ocupado}>{ocupado === 'subir-' + n.id ? 'Subiendo…' : 'Subir a ML'}</button>}
              </div>
            )}
          </div>
        ))}
      </div>

      {form ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          <div style={{ fontWeight: 600 }}>Nota de crédito sobre la {facturaAsociada({ asoc_pto_vta: arcaConfig.punto_venta, asoc_nro: venta.nro_factura, asoc_fecha: venta.factura_fecha || venta.fecha })}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2fr)', gap: 8 }}>
            <label><div style={lbl}>Importe ($)</div><input className="input" type="number" min={0} value={form.importe} onChange={(e) => setForm((f) => ({ ...f, importe: e.target.value, confirmar: false }))} /></label>
            <label><div style={lbl}>Motivo (sale en el comprobante)</div><input className="input" value={form.motivo} onChange={(e) => setForm((f) => ({ ...f, motivo: e.target.value, confirmar: false }))} /></label>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {importe >= disponible && disponible > 0 ? 'Anula la factura completa.' : 'Anula una parte (por ejemplo, si devolvieron algunos productos).'} Se puede acreditar hasta {fmtMoney(disponible)}.
          </div>
          {errorForm && <div style={{ color: '#dc2626', fontSize: 12 }}>{errorForm}</div>}
          {form.confirmar ? (
            <div style={{ background: modo === 'produccion' ? '#fef2f2' : '#fffbeb', border: `1px solid ${modo === 'produccion' ? '#fecaca' : '#fcd34d'}`, color: modo === 'produccion' ? '#7f1d1d' : '#78350f', borderRadius: 'var(--radius-sm)', padding: '8px 10px' }}>
              Se emite en ARCA {modo === 'produccion' ? <strong>en producción (comprobante real)</strong> : 'en homologación (de prueba)'} una Nota de crédito C por <strong>{fmtMoney(importe)}</strong>. Una vez emitida no se puede deshacer.
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
                <button className="btn btn-sm" onClick={() => setForm((f) => ({ ...f, confirmar: false }))} disabled={!!ocupado}>Volver</button>
                <button className="btn btn-sm btn-primary" onClick={emitir} disabled={!!ocupado}>{ocupado === 'nc' ? 'Emitiendo…' : 'Confirmar y emitir'}</button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-sm" onClick={() => setForm(null)}>Cancelar</button>
              <button className="btn btn-sm btn-primary" disabled={!!errorForm} onClick={() => setForm((f) => ({ ...f, confirmar: true }))}>Emitir nota de crédito</button>
            </div>
          )}
        </div>
      ) : disponible > 0 && (
        <div><button className="btn btn-sm" onClick={abrir} disabled={!!ocupado}>Hacer nota de crédito</button></div>
      )}

      {msg && (
        <div style={{ fontSize: 13, padding: '8px 12px', borderRadius: 'var(--radius-sm)', background: msg.tipo === 'ok' ? '#f0fdf4' : '#fef2f2', color: msg.tipo === 'ok' ? '#15803d' : '#dc2626', border: `1px solid ${msg.tipo === 'ok' ? '#86efac' : '#fca5a5'}` }}>
          {msg.texto}
        </div>
      )}
    </div>
  )
}
