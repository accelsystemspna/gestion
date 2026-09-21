// Pantalla de un pedido de WooCommerce dentro del programa: lo mismo que se ve en el panel de WooCommerce.
import { useEffect, useState } from 'react'
import ImageThumb from '../../../components/ImageThumb'
import { fmtMoney } from '../../../lib/format'
import {
  ESTADOS_ELEGIBLES, estadoWooInfo, invocarWoo, pedidoWooPorId, direccionLineas, hayDireccion, dniDe, totalesPedido,
  urlAdminPedido, fmtFechaHora, esLocalUrl, textoPlano,
} from '../../../lib/wooPanel'
import { Aviso, Cajon, EstadoWoo, Tarjeta } from './ui'

const Fila = ({ k, v, fuerte, color }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '3px 0', fontSize: fuerte ? 16 : 13, fontWeight: fuerte ? 800 : 400, color }}>
    <span style={{ color: fuerte ? undefined : 'var(--text-muted)' }}>{k}</span><span style={{ textAlign: 'right' }}>{v}</span>
  </div>
)

function Direccion({ titulo, dir, extra }) {
  const lineas = direccionLineas(dir)
  return (
    <Tarjeta titulo={titulo}>
      {hayDireccion(dir) ? (
        <address style={{ fontStyle: 'normal', fontSize: 14, lineHeight: 1.55 }}>
          {lineas.map((l, i) => <div key={i} style={{ fontWeight: i === 0 ? 700 : 400 }}>{l}</div>)}
        </address>
      ) : <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Sin dirección cargada.</div>}
      {extra}
    </Tarjeta>
  )
}

export default function DetallePedidoWoo({ tienda, wooId, onClose, onCambio }) {
  const local = esLocalUrl(tienda?.url)
  const [fila, setFila] = useState(null)         // fila de pedidos_web
  const [cargando, setCargando] = useState(true)
  const [msg, setMsg] = useState(null)
  const [nuevoEstado, setNuevoEstado] = useState('')
  const [trabajando, setTrabajando] = useState(false)
  const [nota, setNota] = useState('')
  const [notaCliente, setNotaCliente] = useState(false)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      setCargando(true)
      const guardado = await pedidoWooPorId(tienda.id, wooId)
      if (vivo && guardado.fila) { setFila(guardado.fila); setNuevoEstado(guardado.fila.estado) }
      // Con acceso a la tienda se refresca el pedido y se traen las notas.
      if (!local) {
        const r = await invocarWoo('pedido', tienda.id, { woo_id: wooId })
        if (vivo && r.ok) {
          setFila(f => ({ ...(f || {}), woo_id: wooId, estado: r.pedido.status, datos: r.pedido, notas: r.notas }))
          setNuevoEstado(r.pedido.status)
        } else if (vivo && !guardado.fila) setMsg({ tipo: 'error', texto: r.error })
      }
      if (vivo) setCargando(false)
    })()
    return () => { vivo = false }
  }, [tienda.id, wooId, local])

  const o = fila?.datos
  const t = o ? totalesPedido(o) : null

  const cambiarEstado = async () => {
    if (!o || nuevoEstado === o.status) return
    const info = estadoWooInfo(nuevoEstado)
    const aviso = nuevoEstado === 'refunded'
      ? 'Ojo: "Reembolsado" solo cambia el estado, no devuelve el dinero (eso se hace desde WooCommerce).\n\n'
      : nuevoEstado === 'cancelled' ? 'Se cancela el pedido y se anula la venta en el programa.\n\n' : ''
    if (!window.confirm(`${aviso}¿Pasar el pedido #${o.number || o.id} a "${info.label}"?`)) return
    setTrabajando(true); setMsg(null)
    const r = await invocarWoo('estado', tienda.id, { woo_id: wooId, status: nuevoEstado })
    setTrabajando(false)
    if (!r.ok) { setMsg({ tipo: 'error', texto: r.error }); return }
    setFila(f => ({ ...f, estado: r.pedido.status, datos: r.pedido }))
    setMsg({ tipo: 'ok', texto: `Estado cambiado a "${info.label}" en WooCommerce${r.sincronizado ? ' y en el programa' : ' (el programa se actualiza con el aviso de WooCommerce)'}.` })
    onCambio?.()
  }

  const agregarNota = async () => {
    if (!nota.trim()) return
    setTrabajando(true)
    const r = await invocarWoo('nota', tienda.id, { woo_id: wooId, texto: nota.trim(), para_cliente: notaCliente })
    setTrabajando(false)
    if (!r.ok) { setMsg({ tipo: 'error', texto: r.error }); return }
    setFila(f => ({ ...f, notas: [...(f.notas || []), r.nota] }))
    setNota(''); setNotaCliente(false)
  }

  const notas = [...(fila?.notas || [])].sort((a, b) => String(b.date_created).localeCompare(String(a.date_created)))
  const dni = dniDe(o)

  return (
    <Cajon
      titulo={o ? `Pedido #${o.number || o.id}` : `Pedido #${wooId}`}
      subtitulo={o ? `${tienda.nombre} · creado ${fmtFechaHora(fila?.fecha_creado || o.date_created_gmt && o.date_created_gmt + 'Z')}` : undefined}
      onClose={onClose}
    >
      {cargando && !o && <div style={{ color: 'var(--text-muted)' }}>Cargando pedido…</div>}
      {msg && <Aviso tipo={msg.tipo} onClose={() => setMsg(null)}>{msg.texto}</Aviso>}
      {!o && !cargando && <Aviso tipo="error">No se encontró el pedido en el programa.</Aviso>}

      {o && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Estado y acciones */}
          <Tarjeta>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <EstadoWoo estado={o.status} />
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  {o.payment_method_title || o.payment_method || 'Sin medio de pago'}
                  {o.transaction_id ? ` · transacción ${o.transaction_id}` : ''}
                </span>
              </div>
              <a className="btn btn-sm" href={urlAdminPedido(tienda, o.id)} target="_blank" rel="noreferrer">Abrir en WooCommerce ↗</a>
            </div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
              <span>Creado: {fmtFechaHora(fila.fecha_creado)}</span>
              {o.date_paid_gmt && <span>Pagado: {fmtFechaHora(o.date_paid_gmt + 'Z')}</span>}
              {o.date_completed_gmt && <span>Completado: {fmtFechaHora(o.date_completed_gmt + 'Z')}</span>}
              <span>Actualizado: {fmtFechaHora(fila.fecha_modificado)}</span>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }} htmlFor="woo-estado">Cambiar estado</label>
              <select id="woo-estado" className="input" style={{ padding: '6px 10px', fontSize: 13, width: 'auto' }} value={nuevoEstado}
                onChange={(e) => setNuevoEstado(e.target.value)} disabled={local || trabajando}>
                {ESTADOS_ELEGIBLES.map(k => <option key={k} value={k}>{estadoWooInfo(k).label}</option>)}
              </select>
              <button className="btn btn-sm btn-primary" disabled={local || trabajando || nuevoEstado === o.status} onClick={cambiarEstado}>
                {trabajando ? 'Guardando…' : 'Guardar estado'}
              </button>
              {local && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Esta tienda es local: el estado se cambia desde su administrador.</span>}
            </div>
          </Tarjeta>

          {/* Facturación y envío */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
            <Direccion titulo="Facturación" dir={o.billing} extra={(
              <div style={{ marginTop: 10, fontSize: 13, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {o.billing?.email && <a href={`mailto:${o.billing.email}`}>{o.billing.email}</a>}
                {o.billing?.phone && <a href={`https://wa.me/${String(o.billing.phone).replace(/\D/g, '')}`} target="_blank" rel="noreferrer">{o.billing.phone} · WhatsApp</a>}
                {dni && <span><span style={{ color: 'var(--text-muted)' }}>DNI / CUIT:</span> <strong>{dni}</strong></span>}
              </div>
            )} />
            <Direccion titulo="Envío" dir={hayDireccion(o.shipping) ? o.shipping : null}
              extra={o.shipping_lines?.length ? <div style={{ marginTop: 10, fontSize: 13, color: 'var(--text-muted)' }}>Método: <strong style={{ color: 'var(--text)' }}>{o.shipping_lines.map(s => s.method_title).join(', ')}</strong></div> : null} />
          </div>

          {o.customer_note && (
            <Tarjeta titulo="Nota del cliente">
              <div style={{ fontSize: 14, fontStyle: 'italic' }}>“{o.customer_note}”</div>
            </Tarjeta>
          )}

          {/* Productos */}
          <Tarjeta titulo={`Productos (${o.line_items?.length || 0})`}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {(o.line_items || []).map((li) => {
                const unit = Number(li.quantity) ? Number(li.subtotal) / Number(li.quantity) : Number(li.price) || 0
                return (
                  <div key={li.id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                    {li.image?.src
                      ? <ImageThumb src={li.image.src} size={56} radius={8} alt={li.name} />
                      : <div style={{ width: 56, height: 56, borderRadius: 8, background: 'var(--bg-muted)', fontSize: 10, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Sin foto</div>}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700 }}>{li.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{li.sku ? `SKU ${li.sku}` : 'Sin SKU'}{(li.meta_data || []).filter(m => !String(m.key).startsWith('_')).map(m => ` · ${m.display_key || m.key}: ${m.display_value || m.value}`).join('')}</div>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'right' }}>{fmtMoney(unit)} × {li.quantity}</div>
                    <div style={{ fontWeight: 800, minWidth: 96, textAlign: 'right' }}>{fmtMoney(li.subtotal)}</div>
                  </div>
                )
              })}
            </div>

            <div style={{ marginTop: 12, maxWidth: 380, marginLeft: 'auto' }}>
              <Fila k="Subtotal" v={fmtMoney(t.subtotal)} />
              {(o.coupon_lines || []).map(c => <Fila key={c.id || c.code} k={`Cupón: ${c.code}`} v={`− ${fmtMoney(Math.abs(Number(c.discount) || 0))}`} color="#15803d" />)}
              {t.cargos.map((c, i) => <Fila key={i} k={c.nombre} v={c.monto < 0 ? `− ${fmtMoney(Math.abs(c.monto))}` : fmtMoney(c.monto)} color={c.monto < 0 ? '#15803d' : undefined} />)}
              {o.shipping_lines?.length > 0 && <Fila k={`Envío (${o.shipping_lines.map(s => s.method_title).join(', ')})`} v={t.envio ? fmtMoney(t.envio) : 'Gratis'} />}
              {t.impuestos > 0 && <Fila k="Impuestos" v={fmtMoney(t.impuestos)} />}
              <div style={{ borderTop: '2px solid var(--border)', marginTop: 6, paddingTop: 6 }}>
                <Fila k="Total" v={fmtMoney(t.total)} fuerte />
              </div>
              {t.reembolsado > 0 && <Fila k="Reembolsado" v={`− ${fmtMoney(t.reembolsado)}`} color="#b91c1c" />}
            </div>
          </Tarjeta>

          {/* Notas */}
          <Tarjeta titulo="Notas del pedido">
            {!local ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
                <textarea className="input" rows={2} placeholder="Escribí una nota… (por ejemplo: “llamé al cliente para confirmar la dirección”)"
                  value={nota} onChange={(e) => setNota(e.target.value)} style={{ resize: 'vertical' }} />
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input type="checkbox" checked={notaCliente} onChange={(e) => setNotaCliente(e.target.checked)} />
                    Enviar al cliente por email
                  </label>
                  <button className="btn btn-sm btn-primary" disabled={trabajando || !nota.trim()} onClick={agregarNota}>Agregar nota</button>
                </div>
              </div>
            ) : <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>Las notas se ven y se agregan desde el administrador de la tienda local.</div>}
            {notas.length === 0 ? <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{cargando ? 'Cargando notas…' : 'Sin notas.'}</div> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {notas.map((n) => (
                  <div key={n.id} style={{
                    padding: '8px 12px', borderRadius: 8, fontSize: 13,
                    background: n.customer_note ? '#e0f2fe' : 'var(--bg-muted)', color: n.customer_note ? '#0c4a6e' : 'var(--text)',
                    borderLeft: `3px solid ${n.customer_note ? '#0284c7' : 'var(--border)'}`,
                  }}>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{textoPlano(n.note)}</div>
                    <div style={{ fontSize: 11, opacity: 0.7, marginTop: 3 }}>
                      {fmtFechaHora(n.date_created_gmt ? n.date_created_gmt + 'Z' : n.date_created)} · {n.customer_note ? 'Nota al cliente' : n.added_by === 'system' || n.author === 'system' ? 'Sistema' : 'Nota privada'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Tarjeta>

          <details style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            <summary style={{ cursor: 'pointer' }}>Ver datos completos del pedido (tal cual los manda WooCommerce)</summary>
            <pre style={{ maxHeight: 320, overflow: 'auto', padding: 10, background: 'var(--bg-muted)', borderRadius: 8, fontSize: 11 }}>{JSON.stringify(o, null, 2)}</pre>
          </details>
        </div>
      )}
    </Cajon>
  )
}
