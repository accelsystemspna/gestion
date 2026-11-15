import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { fmtMoney } from '../../lib/format'
import { generarFacturaC } from '../../lib/facturaC'
import { facturaParteEnPanel, sincronizarTicketCliente } from '../../lib/documentosCliente'
import { receptorDeCliente, fmtCuit, NOMBRE_DOC, DOC_CONSUMIDOR } from '../../lib/cuit'
import { FORMAS_COBRO, redondear, emitirParte, ventaParaFactura, arcaParaFactura, numeroFactura } from '../../lib/cobro'

const lbl = { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }
const hoy = () => new Date().toLocaleDateString('en-CA')
const fmtFecha = (d) => (d ? new Date(String(d).slice(0, 10) + 'T12:00:00').toLocaleDateString('es-AR') : '')
const nroVenta = (n) => '#' + String(n ?? 0).padStart(4, '0')
const detallePago = (v) => `Pago a cuenta de la venta ${nroVenta(v?.numero)}`

/**
 * Cuenta corriente de un cliente: lo que debe, los pagos a cuenta (entregas parciales) y su factura.
 * Un pago se reparte entre las ventas pendientes, de la más vieja a la más nueva (o a una elegida).
 */
export default function CuentaCorriente({ cliente, onCambio }) {
  const { orgId } = useAuth()
  const [ventas, setVentas] = useState(null)     // ventas en cta. cte. (todas, para nombrar los pagos)
  const [pagos, setPagos] = useState([])
  const [facturas, setFacturas] = useState({})    // id → factura
  const [arca, setArca] = useState(null)
  const [branding, setBranding] = useState(null)
  const [ficha, setFicha] = useState(null)
  const [falta, setFalta] = useState(false)
  const [form, setForm] = useState(null)          // { importe, forma, fecha, venta }
  const [fact, setFact] = useState(null)          // { grupo, cf, solicitudes: { pagoId: uuid } }
  const [ocupado, setOcupado] = useState(null)
  const [msg, setMsg] = useState(null)
  const [recien, setRecien] = useState(null)      // grupo del pago recién cargado

  const cargar = useCallback(async () => {
    const [{ data: vs, error: e1 }, { data: ps, error: e2 }, { data: a }, { data: b }, { data: c }] = await Promise.all([
      supabase.from('ventas').select('id, numero, fecha, total, cobrado_cc, estado, factura_emitida')
        .eq('cliente_id', cliente.id).eq('forma_pago', 'cuenta_corriente').order('fecha').order('numero'),
      supabase.from('cc_pagos').select('*').eq('cliente_id', cliente.id).order('fecha', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('arca_config').select('user_id, cuit, punto_venta, razon_social, domicilio, iibb, inicio_actividades, modo').eq('user_id', orgId).maybeSingle(),
      supabase.from('branding').select('*').eq('user_id', orgId).maybeSingle(),
      supabase.from('clientes').select('id, nombre, telefono, cuit, cuit_tipo, condicion_iva').eq('id', cliente.id).maybeSingle(),
    ])
    if (e1 || e2) { setFalta(true); return }
    const ids = [...new Set((ps ?? []).map((p) => p.factura_id).filter(Boolean))]
    const { data: fs } = ids.length ? await supabase.from('facturas').select('*').in('id', ids) : { data: [] }
    setFalta(false)
    setVentas(vs ?? [])
    setPagos(ps ?? [])
    setFacturas(Object.fromEntries((fs ?? []).map((f) => [f.id, f])))
    setArca(a ?? null)
    setBranding(b ?? {})
    setFicha(c ?? cliente)
  }, [cliente, orgId])
  useEffect(() => { cargar() }, [cargar])

  if (falta) return <div style={{ fontSize: 12, color: '#92400e' }}>Para cargar pagos a cuenta falta correr supabase_cc_pagos.sql en Supabase.</div>
  if (!ventas) return <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Cargando…</div>

  const modo = arca?.modo === 'produccion' ? 'produccion' : 'homologacion'
  const ventaDe = Object.fromEntries(ventas.map((v) => [v.id, v]))
  const faltaDe = (v) => redondear(Math.max(Number(v.total) - (Number(v.cobrado_cc) || 0), 0))
  const pendientes = ventas.filter((v) => ['pendiente', 'parcial'].includes(v.estado) && faltaDe(v) > 0)
  const deuda = redondear(pendientes.reduce((a, v) => a + faltaDe(v), 0))

  // Pagos agrupados (un pago puede repartirse entre varias ventas)
  const grupos = []
  for (const p of pagos) {
    let g = grupos.find((x) => x.grupo === p.grupo)
    if (!g) { g = { grupo: p.grupo, fecha: p.fecha, forma: p.forma, partes: [] }; grupos.push(g) }
    g.partes.push(p)
  }
  const facturaValida = (p) => { const f = facturas[p.factura_id]; return f && f.estado === 'emitida' && f.modo === modo ? f : null }
  const sinFacturar = (g) => g.partes.filter((p) => !facturaValida(p) && !ventaDe[p.venta_id]?.factura_emitida)
  const ficharec = receptorDeCliente(ficha)

  // ── Registrar pago ─────────────────────────────────────────────────────────
  const abrir = () => { setForm({ importe: '', forma: 'Transferencia', fecha: hoy(), venta: '' }); setMsg(null); setRecien(null) }
  const tope = form?.venta ? faltaDe(ventaDe[form.venta] ?? {}) : deuda
  const guardar = async () => {
    const importe = redondear(form.importe)
    if (importe <= 0) return setMsg({ tipo: 'error', texto: 'Escribí un importe mayor a cero.' })
    if (importe > tope) return setMsg({ tipo: 'error', texto: `No puede superar lo que debe (${fmtMoney(tope)}). Lo que sobre cargalo como saldo a favor.` })
    setOcupado('pago'); setMsg(null)
    const { data, error } = await supabase.rpc('registrar_pago_cc', {
      p_cliente: cliente.id, p_importe: importe, p_fecha: form.fecha, p_forma: form.forma, p_venta: form.venta ? Number(form.venta) : null,
    })
    setOcupado(null)
    if (error) return setMsg({ tipo: 'error', texto: 'No se pudo guardar el pago: ' + error.message })
    setForm(null)
    await cargar()
    setRecien(data?.[0]?.grupo ?? null)
    for (const p of data ?? []) sincronizarTicketCliente(p.venta_id)
    onCambio?.()
  }

  const anular = async (g) => {
    const total = redondear(g.partes.reduce((a, p) => a + Number(p.importe), 0))
    if (!window.confirm(`¿Anular el pago de ${fmtMoney(total)} del ${fmtFecha(g.fecha)}? Vuelve a quedar como deuda.`)) return
    setOcupado('anular-' + g.grupo); setMsg(null)
    const { error } = await supabase.rpc('anular_pago_cc', { p_grupo: g.grupo })
    setOcupado(null)
    if (error) return setMsg({ tipo: 'error', texto: 'No se pudo anular: ' + error.message })
    if (recien === g.grupo) setRecien(null)
    await cargar()
    for (const p of g.partes) sincronizarTicketCliente(p.venta_id)
    onCambio?.()
    setMsg({ tipo: 'ok', texto: 'Pago anulado.' })
  }

  // ── Facturar un pago ───────────────────────────────────────────────────────
  const abrirFactura = (g) => {
    setRecien(null); setMsg(null)
    setFact({ grupo: g.grupo, cf: ficharec.docTipo === DOC_CONSUMIDOR, solicitudes: Object.fromEntries(sinFacturar(g).map((p) => [p.id, crypto.randomUUID()])) })
  }
  const receptor = fact?.cf ? { docTipo: DOC_CONSUMIDOR, docNro: '', condIva: 'Consumidor Final' } : ficharec
  const base = { cliente_nombre: ficha?.nombre ?? cliente.nombre, cliente_telefono: ficha?.telefono ?? cliente.telefono, forma_pago: null }

  const emitir = async () => {
    const g = grupos.find((x) => x.grupo === fact.grupo)
    if (!g) return
    setOcupado('factura'); setMsg(null)
    const hechas = []
    for (const p of sinFacturar(g)) {
      const res = await emitirParte({
        ventaId: p.venta_id, concepto: 'saldo', importe: Number(p.importe), detalle: detallePago(ventaDe[p.venta_id]),
        receptor, solicitudId: fact.solicitudes[p.id] ?? crypto.randomUUID(),
      })
      if (!res.ok) {
        setOcupado(null)
        setMsg({ tipo: 'error', texto: (hechas.length ? `Se emitieron ${hechas.length} de ${sinFacturar(g).length}. ` : '') + 'No se emitió la factura: ' + res.error })
        await cargar()
        return
      }
      const f = res.factura
      await supabase.from('cc_pagos').update({ factura_id: f.id }).eq('id', p.id)
      if (arca) await facturaParteEnPanel({ factura: f, base, clienteId: cliente.id, arcaConfig: arca, branding, orgId })
      if (f.modo === 'produccion') await sincronizarTicketCliente(p.venta_id)
      hechas.push(f)
    }
    setFact(null); setOcupado(null)
    await cargar()
    setMsg({ tipo: 'ok', texto: hechas.map((f) => `Factura C ${numeroFactura(f)} por ${fmtMoney(f.importe)}`).join(' · ') + ' emitida.' })
    onCambio?.()
  }

  const bajar = (f) => generarFacturaC({ venta: ventaParaFactura(f, base), arcaConfig: arcaParaFactura(f, arca ?? {}), branding: branding ?? {}, download: true })

  const gRecien = recien && grupos.find((x) => x.grupo === recien)
  const gFact = fact && grupos.find((x) => x.grupo === fact.grupo)
  const importeFact = gFact ? redondear(sinFacturar(gFact).reduce((a, p) => a + Number(p.importe), 0)) : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <div style={lbl}>Debe</div>
          <span style={{ fontSize: 22, fontWeight: 700, color: deuda > 0 ? '#b45309' : '#15803d' }}>{deuda > 0 ? fmtMoney(deuda) : 'Al día'}</span>
        </div>
        {!form && deuda > 0 && <button className="btn btn-sm btn-primary" onClick={abrir} disabled={!!ocupado}>Registrar pago</button>}
      </div>

      {pendientes.length > 0 && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
          {pendientes.map((v, i) => (
            <div key={v.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '8px 12px', fontSize: 13, borderTop: i ? '1px solid var(--border)' : 'none' }}>
              <div>
                <span style={{ fontWeight: 600 }}>Venta {nroVenta(v.numero)}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}> · {fmtFecha(v.fecha)} · total {fmtMoney(v.total)}</span>
                {Number(v.cobrado_cc) > 0 && <div style={{ fontSize: 12, color: '#15803d' }}>Pagó {fmtMoney(v.cobrado_cc)}</div>}
              </div>
              <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Falta</div>
                <strong style={{ color: '#b45309' }}>{fmtMoney(faltaDe(v))}</strong>
              </div>
            </div>
          ))}
        </div>
      )}

      {form && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>Registrar pago a cuenta</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 0.8fr) minmax(0, 1.1fr) minmax(0, 1.1fr)', gap: 8 }}>
            <label><div style={lbl}>Importe ($)</div><input className="input" type="number" min={0} autoFocus value={form.importe} onChange={(e) => setForm((f) => ({ ...f, importe: e.target.value }))} /></label>
            <label><div style={lbl}>Forma</div><select className="select" value={form.forma} onChange={(e) => setForm((f) => ({ ...f, forma: e.target.value }))}>{FORMAS_COBRO.map((x) => <option key={x}>{x}</option>)}</select></label>
            <label><div style={lbl}>Fecha</div><input className="input" type="date" value={form.fecha} onChange={(e) => setForm((f) => ({ ...f, fecha: e.target.value }))} /></label>
          </div>
          {pendientes.length > 1 && (
            <label><div style={lbl}>Aplicar a</div>
              <select className="select" value={form.venta} onChange={(e) => setForm((f) => ({ ...f, venta: e.target.value }))}>
                <option value="">Las ventas más viejas primero</option>
                {pendientes.map((v) => <option key={v.id} value={v.id}>Venta {nroVenta(v.numero)} · falta {fmtMoney(faltaDe(v))}</option>)}
              </select>
            </label>
          )}
          {redondear(form.importe) > 0 && redondear(form.importe) <= tope && (
            <div style={{ fontSize: 13 }}>Después de este pago queda debiendo <strong>{fmtMoney(redondear(deuda - redondear(form.importe)))}</strong>.</div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-sm" onClick={() => { setForm(null); setMsg(null) }} disabled={!!ocupado}>Cancelar</button>
            <button className="btn btn-sm btn-primary" onClick={guardar} disabled={!!ocupado}>{ocupado === 'pago' ? 'Guardando…' : 'Guardar pago'}</button>
          </div>
        </div>
      )}

      {gRecien && !fact && (
        <div role="status" style={{ border: '1px solid var(--border)', background: 'var(--accent-tenue)', borderRadius: 'var(--radius-sm)', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontWeight: 600 }}>
            Pago de {fmtMoney(gRecien.partes.reduce((a, p) => a + Number(p.importe), 0))} guardado. {deuda > 0 ? `Queda debiendo ${fmtMoney(deuda)}.` : 'Quedó al día.'}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {arca && sinFacturar(gRecien).length > 0 && (
              <button className="btn btn-sm btn-primary" onClick={() => abrirFactura(gRecien)}>Facturar este pago</button>
            )}
            <button className="btn btn-sm btn-ghost" onClick={() => setRecien(null)}>{arca && sinFacturar(gRecien).length > 0 ? 'Más tarde' : 'Listo'}</button>
          </div>
          {sinFacturar(gRecien).length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>La venta ya estaba facturada, así que este pago no lleva factura aparte.</div>}
        </div>
      )}

      {gFact && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>Facturar pago de {fmtMoney(importeFact)}{modo === 'homologacion' ? ' (prueba, sin validez fiscal)' : ''}</div>
          {sinFacturar(gFact).map((p) => (
            <div key={p.id} style={{ fontSize: 13, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span>Factura C · {detallePago(ventaDe[p.venta_id])}</span><strong>{fmtMoney(p.importe)}</strong>
            </div>
          ))}
          {sinFacturar(gFact).length > 1 && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>El pago cubre varias ventas: sale una factura por cada una.</div>}
          <div style={{ fontSize: 13 }}>
            A nombre de: <strong>{fact.cf ? 'Consumidor final' : `${ficha?.nombre} · ${NOMBRE_DOC[receptor.docTipo] ?? ''} ${fmtCuit(receptor.docNro)}`}</strong>
          </div>
          {ficharec.docTipo !== DOC_CONSUMIDOR && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <input type="checkbox" checked={fact.cf} onChange={(e) => setFact((f) => ({ ...f, cf: e.target.checked }))} /> Facturar a consumidor final
            </label>
          )}
          {modo === 'produccion' && (
            <div style={{ fontSize: 12, background: '#fef2f2', border: '1px solid #fecaca', color: '#7f1d1d', borderRadius: 'var(--radius-sm)', padding: '6px 10px' }}>
              Se emite en ARCA una <strong>factura real</strong>. Una vez emitida no se puede anular desde el programa.
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-sm" onClick={() => setFact(null)} disabled={!!ocupado}>Cancelar</button>
            <button className="btn btn-sm btn-primary" onClick={emitir} disabled={!!ocupado}>{ocupado === 'factura' ? 'Emitiendo…' : `Emitir factura${sinFacturar(gFact).length > 1 ? 's' : ''}`}</button>
          </div>
        </div>
      )}

      {msg && (
        <div style={{ fontSize: 13, padding: '8px 12px', borderRadius: 'var(--radius-sm)', background: msg.tipo === 'ok' ? '#f0fdf4' : '#fef2f2', color: msg.tipo === 'ok' ? '#15803d' : '#dc2626', border: `1px solid ${msg.tipo === 'ok' ? '#86efac' : '#fca5a5'}` }}>
          {msg.texto}
        </div>
      )}

      {grupos.length > 0 && (
        <div>
          <div style={{ ...lbl, marginBottom: 6 }}>Pagos a cuenta</div>
          <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
            {grupos.map((g, i) => {
              const total = redondear(g.partes.reduce((a, p) => a + Number(p.importe), 0))
              const pend = sinFacturar(g)
              const emitidas = g.partes.map(facturaValida).filter(Boolean)
              const algunaFacturada = g.partes.some((p) => p.factura_id)
              return (
                <div key={g.grupo} style={{ padding: '8px 12px', fontSize: 13, borderTop: i ? '1px solid var(--border)' : 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span><strong>{fmtMoney(total)}</strong> <span style={{ color: 'var(--text-muted)' }}>· {fmtFecha(g.fecha)}{g.forma ? ' · ' + g.forma : ''}</span></span>
                    <span style={{ display: 'flex', gap: 6 }}>
                      {arca && pend.length > 0 && !fact && <button className="btn btn-sm" onClick={() => abrirFactura(g)} disabled={!!ocupado}>Facturar</button>}
                      {!algunaFacturada && <button className="btn btn-sm btn-ghost" onClick={() => anular(g)} disabled={!!ocupado}>Anular</button>}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {g.partes.map((p) => `Venta ${nroVenta(ventaDe[p.venta_id]?.numero)}${g.partes.length > 1 ? ' ' + fmtMoney(p.importe) : ''}`).join(' · ')}
                  </div>
                  <div style={{ fontSize: 12, color: pend.length ? '#b45309' : '#15803d', display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                    {pend.length ? 'Sin facturar' : emitidas.length ? 'Facturado' : 'La venta ya estaba facturada'}
                    {emitidas.map((f) => (
                      <button key={f.id} className="btn btn-sm btn-ghost" style={{ padding: '0 6px', fontSize: 12 }} onClick={() => bajar(f)} title="Bajar PDF">N° {numeroFactura(f)}</button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
