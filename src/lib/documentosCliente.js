import { supabase } from './supabase.js'
import { itemsPDFDe } from './pdf.js'
import { exportPresupuestoPDF } from './presupuestoPDF.js'
import { generarComprobanteVenta } from './comprobanteVenta.js'
import { generarFacturaC } from './facturaC.js'
import { clienteDeVenta } from './accesoCliente.js'
import { ventaParaFactura, arcaParaFactura, numeroFactura } from './cobro.js'

const BUCKET = 'documentos-clientes'

// El cliente ve esta ruta en el link firmado: no puede llevar ids. La carpeta coincide con la regla del bucket.
async function rutaNueva(orgId) {
  const huella = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(orgId))
  const carpeta = [...new Uint8Array(huella)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${carpeta}/${crypto.randomUUID()}.pdf`
}

/**
 * Guarda un PDF en los documentos del cliente, para que lo vea en su panel (bucket privado: se abre con link firmado).
 * Mejor esfuerzo: si falla, avisa por consola y no corta lo que se estaba haciendo (emitir la factura, crear el pedido).
 * @param {{ orgId: string, clienteId: string, pedidoId?: string|null, ventaId?: number|null, tipo: 'presupuesto'|'factura'|'recibo'|'ticket', titulo: string, fecha?: string, total?: number, blob: Blob }} doc
 * @returns {Promise<boolean>} si quedó guardado
 */
export async function guardarDocumentoCliente({ orgId, clienteId, pedidoId = null, ventaId = null, facturaId = null, tipo, titulo, fecha, total = 0, blob }) {
  try {
    const ruta = await rutaNueva(orgId)
    const { error: errorArchivo } = await supabase.storage.from(BUCKET).upload(ruta, blob, { contentType: 'application/pdf' })
    if (errorArchivo) throw errorArchivo
    const { error } = await supabase.from('cliente_documentos').insert({ org_id: orgId, cliente_id: clienteId, pedido_id: pedidoId, venta_id: ventaId, ...(facturaId ? { factura_id: facturaId } : {}), tipo, titulo, total: Number(total) || 0, ruta, ...(fecha ? { fecha } : {}) })
    if (error) {
      await supabase.storage.from(BUCKET).remove([ruta])
      throw error
    }
    return true
  } catch (err) {
    console.warn('[documentos] no se pudo guardar', titulo, err)
    return false
  }
}

async function borrarDocumentos(docs) {
  if (!docs.length) return
  await supabase.storage.from(BUCKET).remove(docs.map((d) => d.ruta))
  const { error } = await supabase.from('cliente_documentos').delete().in('id', docs.map((d) => d.id))
  if (error) throw error
}

// ── Presupuestos ─────────────────────────────────────────────────────────────

const tituloPresupuesto = (p) => `Presupuesto N° ${p.numero}`

/**
 * Deja el presupuesto en el panel del cliente. Un presupuesto da un solo documento:
 * si ya está y ahora hay pedido, solo lo vincula al pedido.
 */
export async function presupuestoEnPanel({ presupuesto, orgId, clienteId, celular, pedidoId = null, branding, validez = '15 días' }) {
  try {
    const titulo = tituloPresupuesto(presupuesto)
    const { data: yaEstan, error } = await supabase.from('cliente_documentos').select('id, pedido_id, cliente_id').eq('tipo', 'presupuesto').eq('titulo', titulo).limit(1)
    if (error) throw error
    if (yaEstan?.[0]) {
      const cambios = { ...(pedidoId && !yaEstan[0].pedido_id ? { pedido_id: pedidoId } : {}), ...(yaEstan[0].cliente_id !== clienteId ? { cliente_id: clienteId } : {}) }
      if (Object.keys(cambios).length) {
        const { error: errorVinculo } = await supabase.from('cliente_documentos').update(cambios).eq('id', yaEstan[0].id)
        if (errorVinculo) throw errorVinculo
      }
      return true
    }
    const blob = await exportPresupuestoPDF({ presupuesto, items: itemsPDFDe(presupuesto), cliente: presupuesto.cliente, celular, branding, validez, comoBlob: true })
    return await guardarDocumentoCliente({ orgId, clienteId, pedidoId, tipo: 'presupuesto', titulo, fecha: presupuesto.created_at, total: presupuesto.total, blob })
  } catch (err) {
    console.warn('[documentos] no se pudo armar el presupuesto', err)
    return false
  }
}

/** Al eliminar un presupuesto el cliente deja de verlo, salvo que sea parte de un pedido. */
export async function quitarPresupuestoDelPanel(presupuesto) {
  try {
    const { data } = await supabase.from('cliente_documentos').select('id, ruta').eq('tipo', 'presupuesto').eq('titulo', tituloPresupuesto(presupuesto)).is('pedido_id', null)
    await borrarDocumentos(data ?? [])
  } catch (err) {
    console.warn('[documentos] no se pudo quitar el presupuesto', err)
  }
}

// ── Facturas y tickets ───────────────────────────────────────────────────────

/** Copia de una factura ya emitida para el panel. Si falla, la factura ya está emitida igual. */
export async function facturaEnPanel({ venta, items, arcaConfig, orgId }) {
  try {
    const clienteId = await clienteDeVenta(venta)
    if (!clienteId) return
    const { data: branding } = await supabase.from('branding').select('*').eq('user_id', orgId).maybeSingle()
    const blob = await generarFacturaC({ venta: { ...venta, venta_items: items }, arcaConfig, branding: branding ?? {}, download: false, comoBlob: true })
    const puntoVenta = String(arcaConfig?.punto_venta ?? 3).padStart(4, '0')
    await guardarDocumentoCliente({ orgId, clienteId, ventaId: venta.id, tipo: 'factura', titulo: `Factura C ${puntoVenta}-${String(venta.nro_factura).padStart(8, '0')}`, total: venta.total, blob })
  } catch (err) {
    console.warn('[documentos] no se pudo armar la factura', err)
  }
}

/**
 * Copia para el panel de una factura de seña o saldo. Las de prueba (homologación) nunca van al panel.
 * `base` es la venta o el pedido, con el cliente.
 */
export async function facturaParteEnPanel({ factura, base, clienteId, arcaConfig, branding, orgId }) {
  try {
    if (factura.modo !== 'produccion' || !clienteId) return
    const blob = await generarFacturaC({ venta: ventaParaFactura(factura, base), arcaConfig: arcaParaFactura(factura, arcaConfig), branding: branding ?? {}, download: false, comoBlob: true })
    await guardarDocumentoCliente({
      orgId, clienteId, facturaId: factura.id, ventaId: factura.venta_id ?? null, pedidoId: factura.pedido_id ?? null,
      tipo: 'factura', titulo: `Factura C ${numeroFactura(factura)}`, fecha: factura.fecha, total: factura.importe, blob,
    })
  } catch (err) {
    console.warn('[documentos] no se pudo armar la factura', err)
  }
}

/** Ticket de un pedido cobrado: lo baja y deja la copia en el panel del cliente. */
export async function ticketPedido(pedidoId) {
  const { data: p, error } = await supabase.from('pedidos').select('*').eq('id', pedidoId).single()
  if (error) throw error
  const { data: branding } = await supabase.from('branding').select('*').eq('user_id', p.org_id).maybeSingle()
  const renglones = itemsPDFDe({ items: p.items || [] })
  const items = renglones.length
    ? renglones.map((r) => ({ descripcion: r.nombre, cantidad: r.cantidad, precio_unitario: r.precio, subtotal: r.precio * r.cantidad }))
    : [{ descripcion: p.titulo || `Pedido ${p.codigo}`, cantidad: 1, precio_unitario: Number(p.total) || 0, subtotal: Number(p.total) || 0 }]
  const pagado = !!p.saldo_cobrado || Number(p.saldo) <= 0
  const pesos = (n) => '$ ' + (Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const fecha = (d) => (d ? new Date(String(d).slice(0, 10) + 'T12:00:00').toLocaleDateString('es-AR') : '')
  const extra = [
    ...(Number(p.sena_monto) > 0 ? [`Seña: ${pesos(p.sena_monto)} · ${[fecha(p.sena_fecha), p.sena_forma_pago].filter(Boolean).join(' · ')}`] : []),
    ...(p.saldo_cobrado ? [`Saldo: cobrado · ${[fecha(p.saldo_fecha), p.saldo_forma].filter(Boolean).join(' · ')}`] : []),
  ]
  const venta = {
    numero: p.codigo, fecha: new Date().toLocaleDateString('en-CA'), hora: new Date().toTimeString().slice(0, 5),
    cliente_nombre: p.cliente_nombre, cliente_telefono: p.cliente_telefono, forma_pago: p.saldo_forma || p.sena_forma_pago || null,
    estado: pagado ? 'pagado' : 'pendiente', total: pagado ? p.total : p.saldo,
  }
  const blob = await generarComprobanteVenta({ venta, items, branding: branding ?? {}, paraCliente: true, extra })
  // Se baja
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `ticket-${p.codigo}.pdf`
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
  // Y queda en el panel del cliente, reemplazando el anterior de este pedido
  if (!p.cliente_id) return
  const titulo = `Ticket del pedido ${p.codigo}`
  const { data: anterior } = await supabase.from('cliente_documentos').select('id, ruta').eq('tipo', 'ticket').eq('pedido_id', p.id).maybeSingle()
  if (!anterior) {
    await guardarDocumentoCliente({ orgId: p.org_id, clienteId: p.cliente_id, pedidoId: p.id, tipo: 'ticket', titulo, total: venta.total, blob })
    return
  }
  const ruta = await rutaNueva(p.org_id)
  const { error: e1 } = await supabase.storage.from(BUCKET).upload(ruta, blob, { contentType: 'application/pdf' })
  if (e1) throw e1
  const { error: e2 } = await supabase.from('cliente_documentos').update({ ruta, titulo, total: Number(venta.total) || 0 }).eq('id', anterior.id)
  if (e2) { await supabase.storage.from(BUCKET).remove([ruta]); throw e2 }
  await supabase.storage.from(BUCKET).remove([anterior.ruta])
}

const llevaTicket = (v) => v.estado !== 'anulado' && v.estado !== 'cancelado' && v.estado_web !== 'cancelado' && !v.factura_emitida

/** Quita el ticket del panel. Se llama antes de borrar la venta: sin venta, el ticket quedaría suelto. */
export async function quitarTicketCliente(ventaIds) {
  try {
    const { data } = await supabase.from('cliente_documentos').select('id, ruta').eq('tipo', 'ticket').in('venta_id', [].concat(ventaIds))
    await borrarDocumentos(data ?? [])
  } catch (err) {
    console.warn('[documentos] no se pudo quitar el ticket', err)
  }
}

/**
 * Deja el ticket del panel igual a la venta: lo crea, lo rehace si cambió el estado o el total,
 * y lo quita si se anuló o ya tiene factura. Mejor esfuerzo: la venta nunca depende de esto.
 */
export async function sincronizarTicketCliente(ventaId) {
  try {
    const { data: venta, error } = await supabase.from('ventas').select('*').eq('id', ventaId).maybeSingle()
    if (error) throw error
    if (!venta) return
    // Con alguna factura de seña o saldo, el cliente ve esas facturas en lugar del ticket
    const { count: partes } = await supabase.from('facturas').select('id', { count: 'exact', head: true })
      .eq('venta_id', ventaId).eq('modo', 'produccion').eq('estado', 'emitida')
    const clienteId = llevaTicket(venta) && !partes ? await clienteDeVenta(venta) : null
    const { data: actual } = await supabase.from('cliente_documentos').select('id, ruta').eq('tipo', 'ticket').eq('venta_id', ventaId).maybeSingle()
    if (!clienteId) {
      if (actual) await borrarDocumentos([actual])
      return
    }
    const [{ data: items }, { data: branding }] = await Promise.all([
      supabase.from('venta_items').select('*').eq('venta_id', ventaId).order('id'),
      supabase.from('branding').select('*').eq('user_id', venta.org_id).maybeSingle(),
    ])
    const blob = await generarComprobanteVenta({ venta, items: items ?? [], branding, paraCliente: true })
    const titulo = `Ticket N° ${String(venta.numero ?? 0).padStart(4, '0')}`
    if (!actual) {
      await guardarDocumentoCliente({ orgId: venta.org_id, clienteId, ventaId, tipo: 'ticket', titulo, fecha: venta.fecha, total: venta.total, blob })
      return
    }
    const ruta = await rutaNueva(venta.org_id)
    const { error: errorArchivo } = await supabase.storage.from(BUCKET).upload(ruta, blob, { contentType: 'application/pdf' })
    if (errorArchivo) throw errorArchivo
    const { error: errorFila } = await supabase.from('cliente_documentos').update({ cliente_id: clienteId, titulo, total: Number(venta.total) || 0, ruta }).eq('id', actual.id)
    if (errorFila) {
      await supabase.storage.from(BUCKET).remove([ruta])
      throw errorFila
    }
    await supabase.storage.from(BUCKET).remove([actual.ruta])
  } catch (err) {
    console.warn('[documentos] no se pudo actualizar el ticket', ventaId, err)
  }
}

// ── Lo anterior a esta función ───────────────────────────────────────────────

/**
 * Presupuestos y tickets anteriores que faltan en el panel, armados con los datos ya guardados.
 * Sin factura no pide nada a ARCA. Se puede repetir: lo que ya está se saltea.
 * @returns {Promise<{ presupuestos: object[], ventas: object[], titulos: object[] }>}
 */
export async function buscarDocumentosFaltantes() {
  const [{ data: presupuestos, error: e1 }, { data: docs, error: e2 }, { data: pedidos, error: e3 }, { data: ventas, error: e4 }, { data: clientes }] = await Promise.all([
    supabase.from('presupuestos').select('id, numero, cliente, cliente_id, total, created_at, lista_id, items').not('cliente_id', 'is', null).order('created_at'),
    supabase.from('cliente_documentos').select('id, pedido_id, venta_id, tipo, titulo').in('tipo', ['presupuesto', 'ticket']),
    supabase.from('pedidos').select('id, presupuesto_id').not('presupuesto_id', 'is', null),
    supabase.from('ventas').select('id, numero, fecha, total, estado, estado_web, factura_emitida, cliente_id, cliente_nombre, cliente_telefono').order('fecha'),
    supabase.from('clientes').select('id, nombre, telefono'),
  ])
  const error = e1 || e2 || e3 || e4
  if (error) throw new Error(error.message)
  const pedidoDe = new Map((pedidos ?? []).map((p) => [p.presupuesto_id, p.id]))
  const nombreDe = new Map((clientes ?? []).map((c) => [c.id, c.nombre]))
  const celularDe = new Map((clientes ?? []).map((c) => [c.id, c.telefono]))
  const deP = (docs ?? []).filter((d) => d.tipo === 'presupuesto')
  const conTicket = new Set((docs ?? []).filter((d) => d.tipo === 'ticket').map((d) => d.venta_id))

  const faltanP = []
  const titulos = []
  for (const p of presupuestos ?? []) {
    const titulo = tituloPresupuesto(p)
    const pedidoId = pedidoDe.get(p.id) ?? null
    if (deP.some((d) => d.titulo === titulo)) continue
    // Los que pasaron a pedido antes del arreglo pudieron quedar como "Presupuesto N° undefined".
    const delPedido = pedidoId && deP.find((d) => d.pedido_id === pedidoId)
    if (delPedido) titulos.push({ id: delPedido.id, titulo })
    else faltanP.push({ ...p, pedidoId, cliente: p.cliente || nombreDe.get(p.cliente_id), celular: celularDe.get(p.cliente_id) })
  }

  const faltanV = []
  for (const v of ventas ?? []) {
    if (!llevaTicket(v) || conTicket.has(v.id)) continue
    const clienteId = await clienteDeVenta(v)
    if (clienteId) faltanV.push({ ...v, clienteNombre: nombreDe.get(clienteId) })
  }
  return { presupuestos: faltanP, ventas: faltanV, titulos }
}

/** Genera lo que encontró buscarDocumentosFaltantes. @returns {Promise<{ presupuestos: number, tickets: number, fallaron: number }>} */
export async function generarDocumentosFaltantes({ presupuestos, ventas, titulos }, orgId, onAvance) {
  const { data: branding } = await supabase.from('branding').select('*').eq('user_id', orgId).maybeSingle()
  const hecho = { presupuestos: 0, tickets: 0, fallaron: 0 }
  const total = presupuestos.length + ventas.length
  let n = 0
  for (const t of titulos) await supabase.from('cliente_documentos').update({ titulo: t.titulo }).eq('id', t.id)
  for (const p of presupuestos) {
    const ok = await presupuestoEnPanel({ presupuesto: p, orgId, clienteId: p.cliente_id, celular: p.celular, pedidoId: p.pedidoId, branding: branding ?? {} })
    if (ok) hecho.presupuestos++; else hecho.fallaron++
    onAvance?.(++n, total)
  }
  for (const v of ventas) {
    await sincronizarTicketCliente(v.id)
    const { count } = await supabase.from('cliente_documentos').select('id', { count: 'exact', head: true }).eq('tipo', 'ticket').eq('venta_id', v.id)
    if (count) hecho.tickets++; else hecho.fallaron++
    onAvance?.(++n, total)
  }
  return hecho
}
