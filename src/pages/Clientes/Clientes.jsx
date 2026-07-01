import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { precioVenta } from '../../lib/pricing'
import ClienteForm from './ClienteForm'
import ImportarModal from './ImportarModal'
import VentaDetalle from '../Ventas/VentaDetalle'

// ── helpers ──────────────────────────────────────────────────────────────────
function fmt(n) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n ?? 0)
}
function fmtDate(d) {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function padNum(n) { return String(n ?? 0).padStart(4, '0') }

const COMPROBANTES = {
  ticket:    { label: 'Ticket',    color: '#6366f1' },
  factura_b: { label: 'Factura B', color: '#0891b2' },
  factura_c: { label: 'Factura C', color: '#0284c7' },
}
const ESTADO_VENTA = {
  pagado:    { label: 'Pagado',    color: '#16a34a', bg: '#dcfce7' },
  pendiente: { label: 'Pendiente', color: '#d97706', bg: '#fef9c3' },
  parcial:   { label: 'Parcial',   color: '#7c3aed', bg: '#f5f3ff' },
  anulado:   { label: 'Anulado',   color: '#64748b', bg: '#f1f5f9' },
}
const FORMA_PAGO_LABEL = {
  efectivo:         'Efectivo',
  debito:           'Débito',
  credito:          'Crédito',
  transferencia:    'Transferencia',
  cuenta_corriente: 'Cta. cte.',
}

// ── styles ────────────────────────────────────────────────────────────────────
const S = {
  tabBar: {
    display: 'flex',
    gap: 0,
    borderBottom: '1px solid var(--border)',
    marginBottom: 20,
    overflowX: 'auto',
    flexShrink: 0,
  },
  tab: (active) => ({
    padding: '10px 18px',
    background: 'transparent',
    border: 'none',
    borderBottom: active ? '2px solid var(--primary)' : '2px solid transparent',
    color: active ? 'var(--primary)' : 'var(--text-muted)',
    fontWeight: 600,
    fontSize: 14,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  }),
  card: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '14px 16px',
    cursor: 'pointer',
    transition: 'border-color 0.15s',
  },
  badge: (color) => ({
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 12,
    fontSize: 11,
    fontWeight: 600,
    background: color + '22',
    color: color,
  }),
}

// ── panel de detalle ──────────────────────────────────────────────────────────
function DetallePanel({ cliente, onClose, onEdit, onDelete }) {
  const [ventas,         setVentas]         = useState([])
  const [loading,        setLoading]        = useState(true)
  const [ventaDetalleId, setVentaDetalleId] = useState(null)
  const [recalculating,  setRecalculating]  = useState(false)
  const [recalcMsg,      setRecalcMsg]      = useState(null)  // { ok, text }

  const loadVentas = () => {
    if (!cliente) return
    setLoading(true)
    supabase
      .from('ventas')
      .select('id, numero, comprobante, fecha, hora, total, estado, forma_pago')
      .eq('cliente_id', cliente.id)
      .order('numero', { ascending: false })
      .then(({ data, error }) => {
        if (error) console.error('[loadVentas cliente]', error)
        setVentas(data ?? [])
        setLoading(false)
      })
  }

  useEffect(() => { loadVentas() }, [cliente])

  // ── Recalcular precios de ventas pendientes en cuenta corriente ──────────
  const recalcularPreciosCC = async () => {
    if (!window.confirm(
      '¿Actualizar los precios de las ventas pendientes en cuenta corriente?\n\n' +
      'Se recalcularán los precios de los productos según sus valores actuales.'
    )) return

    setRecalculating(true)
    setRecalcMsg(null)
    try {
      // 1. Ventas CC pendientes de este cliente
      const { data: ventasCC, error: errV } = await supabase
        .from('ventas')
        .select('id, lista_id, total')
        .eq('cliente_id', cliente.id)
        .eq('forma_pago', 'cuenta_corriente')
        .in('estado', ['pendiente', 'parcial'])
      if (errV) throw errV
      if (!ventasCC?.length) {
        setRecalcMsg({ ok: true, text: 'No hay ventas pendientes en cuenta corriente.' })
        return
      }

      // 2. Ítems de todas esas ventas de una sola query
      const ventaIds = ventasCC.map(v => v.id)
      const { data: todosItems, error: errI } = await supabase
        .from('venta_items')
        .select('id, venta_id, producto_id, cantidad, precio_unitario, subtotal')
        .in('venta_id', ventaIds)
      if (errI) throw errI

      // 3. Productos únicos referenciados
      const prodIds = [...new Set((todosItems ?? []).map(i => i.producto_id).filter(Boolean))]
      const { data: productos, error: errP } = await supabase
        .from('productos')
        .select('id, costo_base')
        .in('id', prodIds)
      if (errP) throw errP
      const prodMap = Object.fromEntries((productos ?? []).map(p => [p.id, p]))

      // 4. Listas de precios
      const { data: listas } = await supabase.from('listas_precios').select('*')
      const listaMap = Object.fromEntries((listas ?? []).map(l => [l.id, l]))

      // 5. Recalcular ítem a ítem y acumular los deltas por venta
      let saldoDelta = 0       // cuánto cambia el saldo del cliente
      let ventasActualizadas = 0

      for (const venta of ventasCC) {
        const lista   = listaMap[venta.lista_id] ?? null
        const items   = (todosItems ?? []).filter(i => i.venta_id === venta.id)
        let nuevoTotal = 0

        for (const item of items) {
          let nuevoPrecio = item.precio_unitario ?? 0
          if (item.producto_id && prodMap[item.producto_id]) {
            nuevoPrecio = precioVenta(Number(prodMap[item.producto_id].costo_base) || 0, lista)
          }
          const nuevoSubtotal = nuevoPrecio * (item.cantidad ?? 1)
          nuevoTotal += nuevoSubtotal

          // Actualizar ítem si el precio cambió
          if (Math.abs(nuevoPrecio - (item.precio_unitario ?? 0)) > 0.001) {
            await supabase
              .from('venta_items')
              .update({ precio_unitario: nuevoPrecio, subtotal: nuevoSubtotal })
              .eq('id', item.id)
          }
        }

        // Delta de esta venta sobre el saldo
        saldoDelta += (venta.total ?? 0) - nuevoTotal  // saldo sube si la deuda baja

        if (Math.abs(nuevoTotal - (venta.total ?? 0)) > 0.001) {
          await supabase.from('ventas').update({ total: nuevoTotal }).eq('id', venta.id)
          ventasActualizadas++
        }
      }

      // 6. Actualizar saldo del cliente
      if (Math.abs(saldoDelta) > 0.001) {
        const { data: cliActual } = await supabase
          .from('clientes').select('saldo').eq('id', cliente.id).single()
        const saldoActual = Number(cliActual?.saldo) || 0
        await supabase
          .from('clientes')
          .update({ saldo: saldoActual + saldoDelta })
          .eq('id', cliente.id)
      }

      setRecalcMsg({
        ok: true,
        text: ventasActualizadas > 0
          ? `✅ ${ventasActualizadas} venta${ventasActualizadas > 1 ? 's' : ''} actualizada${ventasActualizadas > 1 ? 's' : ''} al precio actual.`
          : '✅ Los precios ya estaban actualizados.'
      })
      loadVentas()
    } catch (err) {
      setRecalcMsg({ ok: false, text: '❌ Error: ' + (err.message ?? err) })
    } finally {
      setRecalculating(false)
    }
  }

  if (!cliente) return null

  const ventasActivas    = ventas.filter(v => v.estado !== 'anulado')
  const ventasCCPend     = ventas.filter(v => v.forma_pago === 'cuenta_corriente' && ['pendiente', 'parcial'].includes(v.estado))
  const total            = ventasActivas.reduce((s, v) => s + (v.total ?? 0), 0)
  const compras          = ventas // alias para no romper referencias en el JSX

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        display: 'flex',
        justifyContent: 'flex-end',
      }}
    >
      {/* overlay */}
      <div
        onClick={onClose}
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)' }}
      />
      {/* panel */}
      <div
        style={{
          position: 'relative',
          width: 420,
          maxWidth: '95vw',
          height: '100%',
          background: 'var(--bg)',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.18)',
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
        }}
      >
        {/* header */}
        <div
          style={{
            padding: '20px 20px 16px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              background: 'var(--primary)',
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {(cliente.nombre || '?').charAt(0).toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 17 }}>{cliente.nombre}</div>
            {cliente.email && (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{cliente.email}</div>
            )}
            {cliente.telefono && (
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{cliente.telefono}</div>
            )}
            {cliente.etiqueta && (
              <span style={{ ...S.badge('var(--primary)'), marginTop: 4, display: 'inline-block' }}>
                {cliente.etiqueta}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => onEdit(cliente)}
              style={{
                padding: '6px 12px',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              Editar
            </button>
            <button
              onClick={onClose}
              style={{
                padding: '6px 10px',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontSize: 18,
                color: 'var(--text-muted)',
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
        </div>

        {/* info extra */}
        {(cliente.direccion || cliente.notas) && (
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {cliente.direccion && (
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                📍 {cliente.direccion}
              </div>
            )}
            {cliente.notas && (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                💬 {cliente.notas}
              </div>
            )}
          </div>
        )}

        {/* resumen */}
        <div
          style={{
            padding: '14px 20px',
            borderBottom: '1px solid var(--border)',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 12,
          }}
        >
          <div style={{ background: 'var(--surface)', borderRadius: 8, padding: '12px 14px' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>COMPRAS</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{ventasActivas.length}</div>
          </div>
          <div style={{ background: 'var(--surface)', borderRadius: 8, padding: '12px 14px' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>TOTAL COMPRADO</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--primary)' }}>{fmt(total)}</div>
          </div>
        </div>

        {/* historial */}
        <div style={{ flex: 1, padding: '16px 20px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--text-muted)' }}>
            HISTORIAL DE COMPRAS
          </div>
          {loading ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>Cargando…</div>
          ) : ventas.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24, fontSize: 14 }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>🛒</div>
              Sin ventas registradas para este cliente
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {ventas.map((v) => {
                const comp = COMPROBANTES[v.comprobante] ?? { label: 'Ticket', color: '#6366f1' }
                const est  = ESTADO_VENTA[v.estado]     ?? ESTADO_VENTA.pendiente
                const anulado = v.estado === 'anulado'
                return (
                  <div key={v.id}
                    onClick={() => setVentaDetalleId(v.id)}
                    style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', background: 'var(--surface)', opacity: anulado ? 0.6 : 1, cursor: 'pointer', transition: 'border-color 0.12s' }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--primary)'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontWeight: 700, fontSize: 13, color: comp.color }}>
                          {comp.label} #{padNum(v.numero)}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmtDate(v.fecha)}</span>
                        {v.hora && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{v.hora}</span>}
                      </div>
                      <span style={{ fontWeight: 700, fontSize: 14, color: anulado ? '#94a3b8' : 'var(--primary)', textDecoration: anulado ? 'line-through' : 'none' }}>
                        {fmt(v.total)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: est.bg, color: est.color }}>
                        {est.label}
                      </span>
                      {v.forma_pago && (
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {FORMA_PAGO_LABEL[v.forma_pago] ?? v.forma_pago}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* acciones */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Recalcular precios CC — solo si hay ventas CC pendientes */}
          {ventasCCPend.length > 0 && (
            <button
              onClick={recalcularPreciosCC}
              disabled={recalculating}
              style={{
                width: '100%',
                padding: '8px',
                background: recalculating ? 'var(--surface)' : '#eff6ff',
                border: '1px solid #93c5fd',
                color: '#1d4ed8',
                borderRadius: 6,
                cursor: recalculating ? 'default' : 'pointer',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {recalculating ? '⏳ Actualizando precios…' : '🔄 Actualizar precios de cuenta corriente'}
            </button>
          )}

          {/* Mensaje resultado recálculo */}
          {recalcMsg && (
            <div
              style={{
                padding: '8px 12px',
                borderRadius: 6,
                fontSize: 13,
                background: recalcMsg.ok ? '#f0fdf4' : '#fef2f2',
                border: `1px solid ${recalcMsg.ok ? '#86efac' : '#fca5a5'}`,
                color: recalcMsg.ok ? '#15803d' : '#dc2626',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span>{recalcMsg.text}</span>
              <button
                onClick={() => setRecalcMsg(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, color: 'inherit', padding: 0, lineHeight: 1 }}
              >×</button>
            </div>
          )}

          <button
            onClick={() => onDelete(cliente)}
            style={{
              width: '100%',
              padding: '8px',
              background: 'transparent',
              border: '1px solid #fca5a5',
              color: '#ef4444',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            Eliminar cliente
          </button>
        </div>
      </div>

      {/* Modal detalle de venta */}
      {ventaDetalleId && (
        <VentaDetalle
          ventaId={ventaDetalleId}
          onClose={() => setVentaDetalleId(null)}
          onUpdated={loadVentas}
        />
      )}
    </div>
  )
}

// ── página principal ──────────────────────────────────────────────────────────
export default function Clientes() {
  const [clientes, setClientes] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('todos')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [showImportar, setShowImportar] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('clientes')
      .select('*')
      .order('nombre')
    setClientes(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // tabs dinámicas: 'todos' + etiquetas únicas
  const etiquetas = [...new Set(clientes.map((c) => c.etiqueta).filter(Boolean))].sort()
  const tabs = ['todos', ...etiquetas]

  const filtered = clientes.filter((c) => {
    const matchTab = tab === 'todos' || c.etiqueta === tab
    const q = search.toLowerCase()
    const matchSearch =
      !q ||
      (c.nombre || '').toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q) ||
      (c.telefono || '').toLowerCase().includes(q)
    return matchTab && matchSearch
  })

  async function handleDelete(cliente) {
    setConfirmDelete(null)
    setSelected(null)
    await supabase.from('compras').delete().eq('cliente_id', cliente.id)
    await supabase.from('clientes').delete().eq('id', cliente.id)
    load()
  }

  function openEdit(c) {
    setEditTarget(c)
    setShowForm(true)
    setSelected(null)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* título */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, marginBottom: 4 }}>Clientes</h1>
        <p style={{ color: 'var(--text-muted)' }}>
          Base de datos de clientes e historial de compras
        </p>
      </div>

      {/* barra de acciones */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre, email o teléfono…"
          style={{
            flex: 1,
            minWidth: 220,
            padding: '8px 12px',
            border: '1px solid var(--border)',
            borderRadius: 6,
            fontSize: 14,
            background: 'var(--surface)',
            color: 'inherit',
          }}
        />
        <button
          onClick={() => { setShowImportar(true) }}
          style={{
            padding: '8px 14px',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          📥 Importar Excel
        </button>
        <button
          onClick={() => { setEditTarget(null); setShowForm(true) }}
          style={{
            padding: '8px 14px',
            background: 'var(--primary)',
            border: 'none',
            borderRadius: 6,
            color: 'white',
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          + Nuevo cliente
        </button>
      </div>

      {/* tabs */}
      <div style={S.tabBar}>
        {tabs.map((t) => (
          <button key={t} style={S.tab(tab === t)} onClick={() => setTab(t)}>
            {t === 'todos' ? 'Todos' : t}
            <span
              style={{
                marginLeft: 6,
                background: tab === t ? 'var(--primary)' : 'var(--border)',
                color: tab === t ? 'white' : 'var(--text-muted)',
                borderRadius: 10,
                padding: '1px 7px',
                fontSize: 11,
              }}
            >
              {t === 'todos'
                ? clientes.length
                : clientes.filter((c) => c.etiqueta === t).length}
            </span>
          </button>
        ))}
      </div>

      {/* lista */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>
          Cargando clientes…
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>
          {search ? 'Sin resultados para la búsqueda.' : 'No hay clientes en esta categoría.'}
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 12,
          }}
        >
          {filtered.map((c) => (
            <ClienteCard
              key={c.id}
              cliente={c}
              onClick={() => setSelected(c)}
            />
          ))}
        </div>
      )}

      {/* panel detalle */}
      {selected && (
        <DetallePanel
          cliente={selected}
          onClose={() => setSelected(null)}
          onEdit={openEdit}
          onDelete={(c) => setConfirmDelete(c)}
        />
      )}

      {/* modal confirmar borrado */}
      {confirmDelete && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 300,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              background: 'var(--bg)',
              borderRadius: 10,
              padding: 28,
              width: 380,
              boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 10 }}>
              ¿Eliminar cliente?
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 20 }}>
              Se eliminarán <strong>{confirmDelete.nombre}</strong> y todo su historial de compras. Esta acción no se puede deshacer.
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setConfirmDelete(null)}
                style={{
                  padding: '8px 16px',
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                Cancelar
              </button>
              <button
                onClick={() => handleDelete(confirmDelete)}
                style={{
                  padding: '8px 16px',
                  background: '#ef4444',
                  border: 'none',
                  borderRadius: 6,
                  color: 'white',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* modal nuevo / editar cliente */}
      {showForm && (
        <ClienteForm
          cliente={editTarget}
          onClose={() => { setShowForm(false); setEditTarget(null) }}
          onSaved={() => { setShowForm(false); setEditTarget(null); load() }}
          etiquetas={etiquetas}
        />
      )}

      {/* modal importar */}
      {showImportar && (
        <ImportarModal
          onClose={() => setShowImportar(false)}
          onImported={() => { setShowImportar(false); load() }}
          etiquetasExistentes={etiquetas}
        />
      )}
    </div>
  )
}

// ── tarjeta cliente ───────────────────────────────────────────────────────────
function ClienteCard({ cliente: c, onClick }) {
  return (
    <div
      style={S.card}
      onClick={onClick}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--primary)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: 'var(--primary)',
            color: 'white',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 15,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {(c.nombre || '?').charAt(0).toUpperCase()}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontWeight: 600,
              fontSize: 14,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {c.nombre}
          </div>
          {c.etiqueta && (
            <span style={S.badge('var(--primary)')}>{c.etiqueta}</span>
          )}
        </div>
      </div>
      {c.email && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          ✉️ {c.email}
        </div>
      )}
      {c.telefono && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          📞 {c.telefono}
        </div>
      )}
    </div>
  )
}
