import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { fmtMoney } from '../../lib/format'
import { optimizarFoto } from '../../lib/imagenes'
import { cargarDatosDePrecio, precioActual, pinDeTelefono, subirImagenPedido, urlSeguimiento, mensajeSeguimiento } from '../../lib/pedidos'
import EstadoBadge from './EstadoBadge'

const FORMAS_PAGO = ['Efectivo', 'Transferencia', 'Mercado Pago', 'Tarjeta', 'Otro']
const sec = { fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--text-muted)', margin: '0 0 8px' }
const lbl = { fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }
const caja = { border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 12, background: 'var(--surface, var(--bg-card))' }

// Qué botón de avance corresponde a cada estado
const AVANCE = {
  aceptado:      { a: 'en_produccion', texto: 'Pasar a En producción' },
  en_produccion: { a: 'listo',         texto: 'Marcar como Listo' },
  listo:         { a: 'entregado',     texto: 'Marcar como Entregado' },
}

export default function PedidoDetalle({ pedido, onCambio, onCerrar, onEliminado }) {
  const { orgId } = useAuth()
  const [marca, setMarca] = useState(null)
  useEffect(() => {
    if (!orgId) return
    supabase.from('branding').select('nombre, url_seguimiento').eq('user_id', orgId).maybeSingle().then(({ data }) => setMarca(data || {}))
  }, [orgId])
  const [p, setP] = useState(pedido)
  const [eventos, setEventos] = useState([])
  const [edit, setEdit] = useState({})          // campos de texto en edición
  const [ocupado, setOcupado] = useState('')
  const [sena, setSena] = useState({ monto: '', forma: 'Transferencia' })
  const [copiado, setCopiado] = useState(false)

  const valor = (k) => (k in edit ? edit[k] : p[k] ?? '')
  const setCampo = (k, v) => setEdit((e) => ({ ...e, [k]: v }))
  const hayCambios = Object.keys(edit).length > 0
  const congelado = p.precio_congelado
  const cerrado = ['entregado', 'rechazado', 'cancelado'].includes(p.estado)

  const cargarEventos = async () => {
    const { data } = await supabase.from('pedido_eventos').select('*').eq('pedido_id', p.id).order('fecha', { ascending: false })
    setEventos(data || [])
  }
  useEffect(() => { cargarEventos() }, [p.id])   // eslint-disable-line react-hooks/exhaustive-deps

  // Al abrir se pide la versión más reciente del pedido (el precio pudo actualizarse recién, por cambios en los costos).
  useEffect(() => {
    supabase.from('pedidos').select('*').eq('id', pedido.id).single().then(({ data }) => {
      if (data && data.updated_at !== pedido.updated_at) { setP(data); onCambio?.(data) }
    })
  }, [pedido.id])   // eslint-disable-line react-hooks/exhaustive-deps

  // Aplica cambios en la base. El servidor puede tocar otros campos (aceptado, precio congelado...), por eso se usa la fila que vuelve.
  const guardar = async (cambios, etiqueta = 'guardar') => {
    setOcupado(etiqueta)
    const { data, error } = await supabase.from('pedidos').update(cambios).eq('id', p.id).select('*').single()
    setOcupado('')
    if (error) { alert('Error: ' + error.message); return null }
    setP(data); onCambio?.(data); await cargarEventos()
    return data
  }

  const guardarCambios = async () => {
    const cambios = { ...edit }
    if ('total' in cambios) cambios.total = Number(cambios.total) || 0
    if ('cliente_telefono' in cambios && !('pin' in cambios) && (!p.pin || p.pin === pinDeTelefono(p.cliente_telefono))) cambios.pin = pinDeTelefono(cambios.cliente_telefono) || null
    for (const k of ['cliente_telefono', 'cliente_email', 'descripcion', 'nota_cliente', 'nota_interna', 'sena_forma_pago']) if (k in cambios && cambios[k] === '') cambios[k] = null
    if ('entrega_estimada' in cambios && !cambios.entrega_estimada) cambios.entrega_estimada = null
    if (await guardar(cambios)) setEdit({})
  }

  const cambiarEstado = async (estado, confirmar) => {
    if (confirmar && !confirm(confirmar)) return
    await guardar({ estado }, 'estado')
  }

  const registrarSena = async () => {
    const monto = Number(sena.monto)
    if (!(monto > 0)) return alert('Poné el monto de la seña.')
    if (!confirm(`¿Registrar la seña de ${fmtMoney(monto)}?\n\nEl pedido pasa a "Aceptado" y el precio (${fmtMoney(p.total)}) queda congelado.`)) return
    if (await guardar({ sena_monto: monto, sena_forma_pago: sena.forma, sena_fecha: new Date().toISOString() }, 'sena')) setSena({ monto: '', forma: 'Transferencia' })
  }

  const recalcular = async () => {
    setOcupado('recalcular')
    const datos = await cargarDatosDePrecio([p])
    const r = precioActual(p, datos)
    setOcupado('')
    if (!r) return alert('Este pedido no tiene renglones de presupuesto para recalcular: el precio es el que cargaste a mano.')
    if (Math.abs(r.total - Number(p.total)) < 0.5) return alert('El precio ya está al día con los costos de hoy.')
    await guardar({ items: r.items, total: Math.round(r.total * 100) / 100 }, 'recalcular')
  }

  const descongelar = async () => {
    if (!confirm('¿Descongelar el precio? Lo vas a poder cambiar, y el cliente va a ver el cambio. Usalo solo si lo acordaron.')) return
    await guardar({ precio_congelado: false }, 'descongelar')
  }

  // ── Imágenes (referencia del cliente / cómo quedaría) ─────────────────────
  const subirFotos = async (e, campo) => {
    const archivos = [...(e.target.files || [])]
    e.target.value = ''
    if (!archivos.length) return
    setOcupado(campo)
    const nuevas = []
    for (const a of archivos) {
      try { nuevas.push(await subirImagenPedido(p.codigo, campo, a, optimizarFoto)) }
      catch (err) { alert('No se pudo subir una imagen: ' + err.message) }
    }
    setOcupado('')
    if (nuevas.length) await guardar({ [campo]: [...(p[campo] || []), ...nuevas] }, campo)
  }

  const quitarFoto = async (campo, url) => {
    if (!confirm('¿Quitar esta imagen del pedido?')) return
    const marca = '/storage/v1/object/public/productos/'
    const i = url.indexOf(marca)
    if (await guardar({ [campo]: (p[campo] || []).filter((u) => u !== url) }, campo) && i >= 0) {
      supabase.storage.from('productos').remove([decodeURI(url.slice(i + marca.length))]).catch(() => {})
    }
  }

  const copiarDatos = async () => {
    const texto = mensajeSeguimiento(p, marca)
    try { await navigator.clipboard.writeText(texto); setCopiado(true); setTimeout(() => setCopiado(false), 2000) } catch { prompt('Copiá este mensaje:', texto) }
  }

  const copiarLink = async () => {
    const url = urlSeguimiento(p, marca)
    try { await navigator.clipboard.writeText(url); setCopiado('link'); setTimeout(() => setCopiado(false), 2000) } catch { prompt('Copiá este link:', url) }
  }

  // Cerrar con la ✕ (no al hacer clic afuera): si hay cambios sin guardar, se pregunta.
  const cerrar = () => {
    if (Object.keys(edit).length && !confirm('Tenés cambios sin guardar. ¿Cerrar igual y perderlos?')) return
    onCerrar()
  }

  const eliminar = async () => {
    if (!confirm(`¿Eliminar el pedido ${p.codigo} de ${p.cliente_nombre}? Esto no se puede deshacer.`)) return
    const { error } = await supabase.from('pedidos').delete().eq('id', p.id)
    if (error) return alert('Error: ' + error.message)
    onEliminado?.(p.id)
  }

  const fotos = (campo, titulo, ayuda) => (
    <div style={caja} key={campo}>
      <div style={{ ...sec, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span>{titulo}</span>
        <label className="btn btn-sm btn-primary" style={{ textTransform: 'none', letterSpacing: 0, cursor: ocupado ? 'not-allowed' : 'pointer', opacity: ocupado ? 0.5 : 1 }}>
          {ocupado === campo ? 'Subiendo...' : '📷 Agregar fotos'}
          <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => subirFotos(e, campo)} disabled={!!ocupado} />
        </label>
      </div>
      {ayuda && <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--text-muted)' }}>{ayuda}</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {(p[campo] || []).map((url) => (
          <div key={url} style={{ position: 'relative' }}>
            <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="" loading="lazy" style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)', display: 'block' }} /></a>
            <button type="button" onClick={() => quitarFoto(campo, url)} style={{ position: 'absolute', top: -6, right: -6, background: 'var(--danger)', color: '#fff', border: 'none', borderRadius: '50%', width: 18, height: 18, fontSize: 11, cursor: 'pointer' }}>✕</button>
          </div>
        ))}
        <label style={{ cursor: ocupado === campo ? 'not-allowed' : 'pointer' }}>
          <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => subirFotos(e, campo)} disabled={!!ocupado} />
          <div style={{ width: 84, height: 84, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: '1px dashed var(--primary)', borderRadius: 8, color: 'var(--primary)', fontSize: 11 }}>
            <span style={{ fontSize: 20 }}>+</span>{ocupado === campo ? 'Subiendo...' : 'Agregar'}
          </div>
        </label>
      </div>
    </div>
  )

  const avance = AVANCE[p.estado]
  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 1000, width: '97vw', display: 'flex', flexDirection: 'column', maxHeight: '94vh' }}>
        <div className="modal-header">
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {p.cliente_nombre} <EstadoBadge estado={p.estado} />
            </h3>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              Pedido <code style={{ fontWeight: 700 }}>{p.codigo}</code> · PIN <code style={{ fontWeight: 700 }}>{p.pin_requerido === false ? 'sin PIN' : (p.pin || '—')}</code>
              <button type="button" className="btn btn-sm btn-ghost" style={{ marginLeft: 8 }} onClick={copiarDatos}>{copiado === true ? '✓ Copiado' : '📋 Copiar mensaje para el cliente'}</button>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={cerrar} title="Cerrar">✕</button>
        </div>

        <div className="modal-body" style={{ overflowY: 'auto', flex: 1, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16, alignItems: 'start' }}>
          {/* ── Columna 1 ── */}
          <div>
            <div style={caja}>
              <div style={sec}>Cliente</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div style={{ gridColumn: '1/-1' }}><label style={lbl}>Nombre</label><input className="input" value={valor('cliente_nombre')} onChange={(e) => setCampo('cliente_nombre', e.target.value)} /></div>
                <div><label style={lbl}>Celular</label><input className="input" value={valor('cliente_telefono')} onChange={(e) => setCampo('cliente_telefono', e.target.value)} /></div>
                <div><label style={lbl}>PIN de seguimiento</label><input className="input" value={valor('pin')} maxLength={6} onChange={(e) => setCampo('pin', e.target.value)} />
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Por defecto, últimos 3 del celular.</span></div>
                <div style={{ gridColumn: '1/-1' }}><label style={lbl}>Email</label><input className="input" value={valor('cliente_email')} onChange={(e) => setCampo('cliente_email', e.target.value)} /></div>
              </div>
            </div>

            <div style={caja}>
              <div style={sec}>Seguimiento para el cliente</div>
              {urlSeguimiento(p, marca) ? (
                <>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input className="input" readOnly value={urlSeguimiento(p, marca)} onFocus={(e) => e.target.select()} style={{ fontSize: 12 }} />
                    <button type="button" className="btn btn-sm" onClick={copiarLink}>{copiado === 'link' ? '✓ Copiado' : 'Copiar link'}</button>
                  </div>
                  <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
                    El cliente abre el link y pone el PIN (últimos 3 números de su celular). Después su celular lo recuerda y no se lo vuelve a pedir. Si el cliente no tiene celular cargado, el link entra directo.
                  </p>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginTop: 8, cursor: 'pointer' }}>
                    <input type="checkbox" checked={(('pin_requerido' in edit) ? edit.pin_requerido : p.pin_requerido) !== false} onChange={(e) => setCampo('pin_requerido', e.target.checked)} />
                    Pedir el PIN para entrar (si lo destildás, el link entra directo)
                  </label>
                </>
              ) : (
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>{marca && !marca.url_seguimiento
                  ? <>Este negocio todavía no tiene su sitio de seguimiento. Cargá la dirección en <strong>Configuración → Marca → Sitio de seguimiento de pedidos</strong>.</>
                  : 'Generando el link…'}</p>
              )}
            </div>

            <div style={caja}>
              <div style={sec}>De qué se trata</div>
              <label style={lbl}>Título</label>
              <input className="input" value={valor('titulo')} onChange={(e) => setCampo('titulo', e.target.value)} style={{ marginBottom: 10 }} />
              <label style={lbl}>Detalle del pedido</label>
              <textarea className="input" rows={4} value={valor('descripcion')} onChange={(e) => setCampo('descripcion', e.target.value)} style={{ resize: 'vertical' }} />
              {Array.isArray(p.items) && p.items.length > 0 && (
                <div style={{ marginTop: 10, fontSize: 12 }}>
                  {p.items.map((it, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '3px 0', borderTop: i ? '1px solid var(--border)' : 'none' }}>
                      <span style={{ color: 'var(--text-muted)' }}>{it.cantidad || 1} × {it.nombre}</span><span>{fmtMoney(it.subtotal)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={caja}>
              <div style={sec}>Precio, seña y saldo</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--primary)' }}>{fmtMoney(p.total)}</div>
                {congelado
                  ? <span style={{ fontSize: 12, fontWeight: 700, color: '#15803d' }}>🔒 Precio congelado</span>
                  : <span style={{ fontSize: 12, color: '#b45309' }}>↻ Se actualiza solo si cambian los materiales (hasta que haya seña)</span>}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '10px 0' }}>
                {!congelado && p.items?.length > 0 && <button className="btn btn-sm" onClick={recalcular} disabled={!!ocupado}>{ocupado === 'recalcular' ? 'Calculando...' : '↻ Recalcular con costos de hoy'}</button>}
                {congelado && !cerrado && <button className="btn btn-sm" onClick={descongelar} disabled={!!ocupado}>Descongelar precio</button>}
              </div>
              {!congelado && !p.items?.length && (
                <div style={{ marginBottom: 10 }}>
                  <label style={lbl}>Precio ($) — cargado a mano</label>
                  <input className="input" type="number" value={valor('total')} onChange={(e) => setCampo('total', e.target.value)} />
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13, padding: '10px 0', borderTop: '1px solid var(--border)' }}>
                <div><div style={lbl}>Seña</div><strong>{fmtMoney(p.sena_monto)}</strong>
                  {p.sena_fecha && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{new Date(p.sena_fecha).toLocaleDateString('es-AR')}{p.sena_forma_pago ? ` · ${p.sena_forma_pago}` : ''}</div>}</div>
                <div><div style={lbl}>Saldo a cobrar</div><strong style={{ color: Number(p.saldo) > 0 ? '#b45309' : '#15803d' }}>{fmtMoney(p.saldo)}</strong></div>
              </div>

              {Number(p.sena_monto) === 0 && !cerrado && (
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                  <label style={lbl}>Registrar seña</label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <input className="input" type="number" placeholder="Monto" style={{ width: 130 }} value={sena.monto} onChange={(e) => setSena((s) => ({ ...s, monto: e.target.value }))} />
                    <select className="select" style={{ width: 'auto' }} value={sena.forma} onChange={(e) => setSena((s) => ({ ...s, forma: e.target.value }))}>{FORMAS_PAGO.map((f) => <option key={f}>{f}</option>)}</select>
                    <button className="btn btn-primary btn-sm" onClick={registrarSena} disabled={!!ocupado}>{ocupado === 'sena' ? 'Guardando...' : 'Registrar seña'}</button>
                  </div>
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '6px 0 0' }}>Al registrarla, el pedido queda <strong>Aceptado</strong> y el precio se congela.</p>
                </div>
              )}
              {Number(p.sena_monto) > 0 && !cerrado && (
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                  <label style={lbl}>Corregir el monto de la seña (si pagó más)</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input className="input" type="number" style={{ width: 140 }} value={valor('sena_monto')} onChange={(e) => setCampo('sena_monto', e.target.value)} />
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center' }}>Se guarda con “Guardar cambios”.</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Columna 2 ── */}
          <div>
            {fotos('imagenes_referencia', 'Imágenes de referencia (del cliente)', 'Las fotos o ideas que nos pasó el cliente. Se achican solas para no ocupar espacio.')}
            {fotos('imagenes_resultado', 'Cómo quedaría (imágenes nuestras)', 'El diseño o la simulación del producto terminado. El cliente la va a ver en el seguimiento.')}

            <div style={caja}>
              <div style={sec}>Notas y entrega</div>
              <label style={lbl}>Mensaje para el cliente (lo va a ver en el seguimiento)</label>
              <textarea className="input" rows={2} value={valor('nota_cliente')} onChange={(e) => setCampo('nota_cliente', e.target.value)} style={{ resize: 'vertical', marginBottom: 10 }} />
              <label style={lbl}>Nota interna (solo nosotros)</label>
              <textarea className="input" rows={2} value={valor('nota_interna')} onChange={(e) => setCampo('nota_interna', e.target.value)} style={{ resize: 'vertical', marginBottom: 10 }} />
              <label style={lbl}>Fecha estimada de entrega</label>
              <input className="input" type="date" value={valor('entrega_estimada') || ''} onChange={(e) => setCampo('entrega_estimada', e.target.value)} style={{ width: 180 }} />
            </div>

            <div style={caja}>
              <div style={sec}>Línea de tiempo</div>
              {eventos.length === 0 ? <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Sin movimientos todavía.</div> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
                  {eventos.map((ev) => (
                    <div key={ev.id} style={{ fontSize: 12, display: 'flex', gap: 8 }}>
                      <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{new Date(ev.fecha).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                      <span>{ev.detalle}{!ev.visible_cliente && <em style={{ color: 'var(--text-muted)' }}> (interno)</em>}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {avance && <button className="btn btn-primary" onClick={() => cambiarEstado(avance.a)} disabled={!!ocupado}>{avance.texto}</button>}
            {p.estado === 'presupuestado' && <button className="btn" style={{ color: 'var(--danger)' }} onClick={() => cambiarEstado('rechazado', '¿Marcar el presupuesto como rechazado por el cliente?')} disabled={!!ocupado}>Rechazado</button>}
            {!cerrado && p.estado !== 'presupuestado' && <button className="btn" style={{ color: 'var(--danger)' }} onClick={() => cambiarEstado('cancelado', '¿Cancelar este pedido?')} disabled={!!ocupado}>Cancelar pedido</button>}
            {cerrado && p.estado !== 'entregado' && <button className="btn" onClick={() => cambiarEstado(p.sena_monto > 0 ? 'aceptado' : 'presupuestado')} disabled={!!ocupado}>Reabrir</button>}
            <button className="btn btn-ghost" style={{ color: 'var(--danger)' }} onClick={eliminar}>🗑 Eliminar</button>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {hayCambios && <button className="btn" onClick={() => setEdit({})}>Descartar cambios</button>}
            <button className="btn btn-primary" onClick={guardarCambios} disabled={!hayCambios || !!ocupado}>{ocupado === 'guardar' ? 'Guardando...' : 'Guardar cambios'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
