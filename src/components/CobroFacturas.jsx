import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { fmtMoney } from '../lib/format'
import { portalApi } from '../lib/portalApi'
import { generarFacturaC } from '../lib/facturaC'
import { facturaParteEnPanel, sincronizarTicketCliente } from '../lib/documentosCliente'
import { receptorDeCliente, cuitValido, fmtCuit, NOMBRE_DOC, DOC_CONSUMIDOR } from '../lib/cuit'
import { FACTURAR_PARTES_EN_PRODUCCION, FORMAS_COBRO, DETALLE_FACTURA, CONCEPTOS, resumen, redondear, cargarFacturas, emitirParte, ventaParaFactura, arcaParaFactura, numeroFactura } from '../lib/cobro'

const lbl = { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }
const hoy = () => new Date().toLocaleDateString('en-CA')
const fmtFecha = (d) => (d ? new Date(String(d).slice(0, 10) + 'T12:00:00').toLocaleDateString('es-AR') : '')

const COLS_VENTA = 'id, org_id, numero, fecha, total, canal, cliente_id, cliente_nombre, cliente_telefono, forma_pago, factura_emitida, nro_factura, sena_monto, sena_fecha, sena_forma, saldo_cobrado, saldo_fecha, saldo_forma, cobro_pendiente_portal'
const COLS_PEDIDO = 'id, org_id, codigo, total, cliente_id, cliente_nombre, cliente_telefono, sena_monto, sena_fecha, sena_forma_pago, saldo_cobrado, saldo_fecha, saldo_forma'

/**
 * Seña, saldo y facturación en partes de una venta del portal mayorista (`ventaId`) o de un pedido (`pedidoId`).
 * En los pedidos la seña se carga en su propia pantalla (`editarSena` en false); acá se marca el saldo y se factura.
 */
export default function CobroFacturas({ ventaId = null, pedidoId = null, referencia, editarSena = true, onCambio }) {
  const { orgId } = useAuth()
  const [reg, setReg] = useState(null)
  const [facturas, setFacturas] = useState([])
  const [arca, setArca] = useState(null)
  const [branding, setBranding] = useState(null)
  const [cliente, setCliente] = useState(null)
  const [falta, setFalta] = useState('')          // texto si todavía no se corrió el SQL
  const [cobro, setCobro] = useState(null)        // formulario de seña / saldo
  const [fact, setFact] = useState(null)          // formulario de factura: { concepto, importe, cf, confirmar, solicitudId }
  const [ocupado, setOcupado] = useState(null)
  const [msg, setMsg] = useState(null)

  const esVenta = !!ventaId
  const esPortal = esVenta && reg?.canal === 'web_mayorista'

  const cargar = useCallback(async () => {
    const consulta = esVenta
      ? supabase.from('ventas').select(COLS_VENTA).eq('id', ventaId).single()
      : supabase.from('pedidos').select(COLS_PEDIDO).eq('id', pedidoId).single()
    const [{ data: r, error }, lista, { data: a }, { data: b }] = await Promise.all([
      consulta,
      cargarFacturas({ ventaId, pedidoId }),
      supabase.from('arca_config').select('user_id, cuit, punto_venta, razon_social, domicilio, iibb, inicio_actividades, modo').eq('user_id', orgId).maybeSingle(),
      supabase.from('branding').select('*').eq('user_id', orgId).maybeSingle(),
    ])
    if (error || lista === null) { setFalta('Para cargar la seña y facturar en partes falta correr supabase_sena_facturas.sql en Supabase.'); return }
    setFalta('')
    setReg(r)
    setFacturas(lista)
    setArca(a ?? null)
    setBranding(b ?? {})
    if (r.cliente_id) {
      const { data: c } = await supabase.from('clientes').select('id, nombre, cuit, cuit_tipo, condicion_iva').eq('id', r.cliente_id).maybeSingle()
      setCliente(c ?? null)
    } else setCliente(null)
    return r
  }, [esVenta, ventaId, pedidoId, orgId])

  useEffect(() => {
    cargar().then((r) => {
      // Un cambio que no llegó al portal se vuelve a mandar al abrir
      if (r?.cobro_pendiente_portal && r.canal === 'web_mayorista') portalApi('order-payment', { venta_id: r.id }).catch(() => {})
    })
  }, [cargar])

  if (falta) return <div style={{ fontSize: 13, color: '#92400e', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, padding: '10px 12px' }}>{falta}</div>
  if (!reg) return <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Cargando cobro…</div>

  const modo = arca?.modo === 'produccion' ? 'produccion' : 'homologacion'
  const senaForma = esVenta ? reg.sena_forma : reg.sena_forma_pago
  const r = resumen({ total: reg.total, sena: reg.sena_monto, saldoCobrado: reg.saldo_cobrado, facturas, modo, facturadoAntes: !!reg.factura_emitida })
  const pct = r.total > 0 ? Math.min(100, (r.facturado / r.total) * 100) : 0
  const receptorFicha = receptorDeCliente(cliente)
  const base = { cliente_nombre: reg.cliente_nombre, cliente_telefono: reg.cliente_telefono, forma_pago: null }

  // ── Seña y saldo ───────────────────────────────────────────────────────────
  const abrirCobro = () => setCobro({
    sena: reg.sena_monto ? String(reg.sena_monto) : '', senaForma: senaForma || 'Transferencia', senaFecha: String(reg.sena_fecha ?? '').slice(0, 10) || hoy(),
    saldoCobrado: !!reg.saldo_cobrado, saldoForma: reg.saldo_forma || 'Transferencia', saldoFecha: reg.saldo_fecha || hoy(),
  })

  const guardarCobro = async () => {
    const sena = redondear(cobro.sena)
    if (editarSena && (sena < 0 || sena > r.total)) { setMsg({ tipo: 'error', texto: `La seña tiene que estar entre $0 y el total (${fmtMoney(r.total)}).` }); return }
    setOcupado('cobro'); setMsg(null)
    const cambios = {
      saldo_cobrado: cobro.saldoCobrado,
      saldo_fecha: cobro.saldoCobrado ? cobro.saldoFecha : null,
      saldo_forma: cobro.saldoCobrado ? cobro.saldoForma : null,
      ...(editarSena ? { sena_monto: sena, sena_fecha: sena ? cobro.senaFecha : null, sena_forma: sena ? cobro.senaForma : null } : {}),
      ...(esVenta ? { cobro_actualizado: new Date().toISOString(), cobro_pendiente_portal: esPortal } : {}),
    }
    const { error } = await supabase.from(esVenta ? 'ventas' : 'pedidos').update(cambios).eq('id', reg.id)
    if (error) { setOcupado(null); setMsg({ tipo: 'error', texto: 'No se pudo guardar: ' + error.message }); return }
    let texto = 'Cobro guardado.'
    if (esPortal) {
      const p = await portalApi('order-payment', { venta_id: reg.id })
      if (!p.ok) texto = `Cobro guardado. No se pudo avisar al portal (${p.error}): se reintenta al volver a abrir.`
      else if (p.pendiente) texto = 'Cobro guardado. El portal todavía no tiene la versión con seña: se le manda cuando la tenga.'
      else if (p.aplicado === false) texto = 'En el portal había un cambio más nuevo, así que quedó el del portal.'
      else texto = 'Cobro guardado y enviado al portal.'
    }
    setCobro(null); setOcupado(null)
    await cargar()
    setMsg({ tipo: 'ok', texto })
    onCambio?.()
  }

  // ── Facturar ───────────────────────────────────────────────────────────────
  const abrirFactura = (concepto) => {
    const sugerido = concepto === 'sena' ? Math.min(r.senaSinFacturar, r.falta) : r.falta
    setFact({ concepto, importe: String(sugerido || ''), cf: receptorFicha.docTipo === DOC_CONSUMIDOR, confirmar: false, solicitudId: crypto.randomUUID() })
    setMsg(null)
  }
  const importe = redondear(fact?.importe)
  const errorImporte = !fact ? '' : importe <= 0 ? 'Escribí un importe mayor a cero.' : importe > r.falta ? `No puede superar lo que falta facturar (${fmtMoney(r.falta)}).` : ''
  const receptor = fact?.cf ? { docTipo: DOC_CONSUMIDOR, docNro: '', condIva: 'Consumidor Final' } : receptorFicha

  const emitir = async () => {
    setOcupado('factura'); setMsg(null)
    const res = await emitirParte({ ventaId, pedidoId, concepto: fact.concepto, importe, detalle: DETALLE_FACTURA[fact.concepto](referencia), receptor, solicitudId: fact.solicitudId })
    if (!res.ok) { setOcupado(null); setFact((f) => ({ ...f, confirmar: false })); setMsg({ tipo: 'error', texto: 'No se emitió la factura: ' + res.error }); await cargar(); return }
    const f = res.factura
    // Copia para el panel del cliente y aviso al portal. Si fallan, la factura ya está emitida igual.
    if (arca) await facturaParteEnPanel({ factura: f, base, clienteId: reg.cliente_id, arcaConfig: arca, branding, orgId })
    if (esVenta && f.modo === 'produccion') await sincronizarTicketCliente(reg.id)
    if (esPortal && f.modo === 'produccion') await portalApi('order-payment', { venta_id: reg.id, solo_facturas: true }).catch(() => {})
    setFact(null); setOcupado(null)
    await cargar()
    setMsg({ tipo: 'ok', texto: `Factura C ${numeroFactura(f)} emitida por ${fmtMoney(f.importe)}.` })
    onCambio?.()
  }

  const bajar = (f) => generarFacturaC({ venta: ventaParaFactura(f, base), arcaConfig: arcaParaFactura(f, arca ?? {}), branding: branding ?? {}, download: true })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Cobro */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, fontSize: 13 }}>
        <div><div style={lbl}>Total</div><strong style={{ fontSize: 16 }}>{fmtMoney(r.total)}</strong></div>
        <div><div style={lbl}>Seña</div><strong style={{ fontSize: 16 }}>{fmtMoney(r.sena)}</strong>
          {r.sena > 0 && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{[fmtFecha(reg.sena_fecha), senaForma].filter(Boolean).join(' · ')}</div>}</div>
        <div><div style={lbl}>Saldo</div><strong style={{ fontSize: 16, color: r.saldo > 0 ? '#b45309' : '#15803d' }}>{reg.saldo_cobrado ? 'Cobrado' : fmtMoney(r.saldo)}</strong>
          {reg.saldo_cobrado && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{[fmtFecha(reg.saldo_fecha), reg.saldo_forma].filter(Boolean).join(' · ')}</div>}</div>
      </div>

      {cobro ? (
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {editarSena && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <label><div style={lbl}>Seña ($)</div><input className="input" type="number" min={0} value={cobro.sena} onChange={(e) => setCobro((c) => ({ ...c, sena: e.target.value }))} /></label>
              <label><div style={lbl}>Forma</div><select className="select" value={cobro.senaForma} onChange={(e) => setCobro((c) => ({ ...c, senaForma: e.target.value }))}>{FORMAS_COBRO.map((f) => <option key={f}>{f}</option>)}</select></label>
              <label><div style={lbl}>Fecha</div><input className="input" type="date" value={cobro.senaFecha} onChange={(e) => setCobro((c) => ({ ...c, senaFecha: e.target.value }))} /></label>
            </div>
          )}
          {editarSena && <div style={{ fontSize: 13 }}>Saldo: <strong>{cobro.saldoCobrado ? 'cobrado' : fmtMoney(Math.max(r.total - redondear(cobro.sena), 0))}</strong></div>}
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600 }}>
            <input type="checkbox" checked={cobro.saldoCobrado} onChange={(e) => setCobro((c) => ({ ...c, saldoCobrado: e.target.checked }))} /> Saldo cobrado
          </label>
          {cobro.saldoCobrado && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label><div style={lbl}>Forma</div><select className="select" value={cobro.saldoForma} onChange={(e) => setCobro((c) => ({ ...c, saldoForma: e.target.value }))}>{FORMAS_COBRO.map((f) => <option key={f}>{f}</option>)}</select></label>
              <label><div style={lbl}>Fecha</div><input className="input" type="date" value={cobro.saldoFecha} onChange={(e) => setCobro((c) => ({ ...c, saldoFecha: e.target.value }))} /></label>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-sm" onClick={() => setCobro(null)} disabled={!!ocupado}>Cancelar</button>
            <button className="btn btn-sm btn-primary" onClick={guardarCobro} disabled={!!ocupado}>{ocupado === 'cobro' ? 'Guardando…' : 'Guardar cobro'}</button>
          </div>
        </div>
      ) : (
        <div><button className="btn btn-sm" onClick={abrirCobro} disabled={!!ocupado}>{editarSena ? '💵 Cargar seña y saldo' : '💵 Marcar saldo cobrado'}</button></div>
      )}

      {/* Facturación */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <div style={lbl}>Facturación</div>
          <div style={{ fontSize: 13 }}>Facturado <strong>{fmtMoney(r.facturado)}</strong> de {fmtMoney(r.total)} · Falta <strong style={{ color: r.falta > 0 ? '#b45309' : '#15803d' }}>{fmtMoney(r.falta)}</strong></div>
        </div>
        <div style={{ height: 6, background: 'var(--bg-muted)', borderRadius: 4, overflow: 'hidden' }} aria-hidden="true">
          <div style={{ width: `${pct}%`, height: '100%', background: r.falta > 0 ? '#f59e0b' : '#16a34a' }} />
        </div>
        {modo === 'homologacion' && (
          <div style={{ fontSize: 12, color: '#92400e', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 6, padding: '6px 10px' }}>
            Modo prueba (homologación): estas facturas no tienen validez fiscal y no van al panel del cliente ni al portal.
          </div>
        )}
        {reg.factura_emitida && <div style={{ fontSize: 13 }}>Ya tiene una factura por el total (N° {String(reg.nro_factura ?? '').padStart(8, '0')}).</div>}
        {facturas.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {facturas.map((f) => (
              <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, opacity: f.estado === 'fallida' ? 0.6 : 1 }}>
                <span style={{ fontWeight: 700, minWidth: 44 }}>{CONCEPTOS[f.concepto]}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  {f.estado === 'emitida' ? `Factura C ${numeroFactura(f)} · ${fmtFecha(f.fecha)}` : f.estado === 'pendiente' ? 'Emitiéndose…' : `No se emitió: ${f.error || 'ARCA la rechazó'}`}
                  {f.modo === 'homologacion' && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: '#92400e' }}>PRUEBA</span>}
                </span>
                <strong>{fmtMoney(f.importe)}</strong>
                {f.estado === 'emitida' && <button className="btn btn-sm btn-ghost" onClick={() => bajar(f)} title="Bajar PDF">PDF</button>}
              </div>
            ))}
          </div>
        )}

        {!arca ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Para facturar, cargá los datos de ARCA en Configuración.</div>
        ) : fact ? (
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Facturar {CONCEPTOS[fact.concepto].toLowerCase()}</div>
            <label><div style={lbl}>Importe ($)</div>
              <input className="input" type="number" min={0} step="0.01" value={fact.importe} disabled={fact.confirmar}
                onChange={(e) => setFact((f) => ({ ...f, importe: e.target.value }))} style={{ maxWidth: 180, fontSize: 15, fontWeight: 700 }} /></label>
            {errorImporte && <div style={{ fontSize: 12, color: '#dc2626' }}>{errorImporte}</div>}
            <div style={{ fontSize: 13 }}>Detalle: <strong>{DETALLE_FACTURA[fact.concepto](referencia)}</strong></div>
            <div style={{ fontSize: 13 }}>
              A nombre de: <strong>{reg.cliente_nombre || 'Consumidor Final'}</strong>
              {' · '}{receptor.docTipo === DOC_CONSUMIDOR ? 'Consumidor Final' : `${NOMBRE_DOC[receptor.docTipo]} ${fmtCuit(receptor.docNro)} · ${receptor.condIva}`}
            </div>
            {cuitValido(cliente?.cuit) && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                <input type="checkbox" checked={fact.cf} disabled={fact.confirmar} onChange={(e) => setFact((f) => ({ ...f, cf: e.target.checked }))} /> Consumidor final
              </label>
            )}
            {fact.confirmar ? (
              <div style={{ background: modo === 'produccion' ? '#fef2f2' : '#fffbeb', border: `1px solid ${modo === 'produccion' ? '#fecaca' : '#fcd34d'}`, borderRadius: 6, padding: '8px 10px', fontSize: 13 }}>
                Se emite en ARCA {modo === 'produccion' ? <strong>en producción (factura real)</strong> : 'en homologación (de prueba)'} una Factura C por <strong>{fmtMoney(importe)}</strong>. Una vez emitida no se puede anular desde el programa.
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
                  <button className="btn btn-sm" onClick={() => setFact((f) => ({ ...f, confirmar: false }))} disabled={!!ocupado}>Volver</button>
                  <button className="btn btn-sm btn-primary" onClick={emitir} disabled={!!ocupado}>{ocupado === 'factura' ? 'Enviando a ARCA…' : 'Confirmar y emitir'}</button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-sm" onClick={() => setFact(null)}>Cancelar</button>
                <button className="btn btn-sm btn-primary" disabled={!!errorImporte} onClick={() => setFact((f) => ({ ...f, confirmar: true }))}>Emitir factura</button>
              </div>
            )}
          </div>
        ) : r.falta > 0 && !reg.factura_emitida && modo === 'produccion' && !FACTURAR_PARTES_EN_PRODUCCION ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', background: 'var(--bg-muted)', borderRadius: 6, padding: '8px 10px' }}>
            Facturar la seña y el saldo por separado se habilita cuando tu contador confirme cómo se describe cada factura. Mientras tanto podés cargar la seña y el saldo.
          </div>
        ) : r.falta > 0 && !reg.factura_emitida ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {r.senaSinFacturar > 0 && <button className="btn btn-sm" onClick={() => abrirFactura('sena')}>🧾 Facturar seña</button>}
            <button className="btn btn-sm" onClick={() => abrirFactura(r.facturado > 0 ? 'saldo' : 'total')}>🧾 Facturar {r.facturado > 0 ? 'saldo' : 'total'}</button>
          </div>
        ) : null}
      </div>

      {msg && <div style={{ fontSize: 13, color: msg.tipo === 'error' ? '#dc2626' : '#15803d' }}>{msg.texto}</div>}
    </div>
  )
}
