import { useEffect, useState } from 'react'
import { supabase }            from '../../lib/supabase'
import { fmtMoney }            from '../../lib/format'
import { generarFacturaC, buildWhatsAppText } from '../../lib/facturaC'
import { ventaParaFactura, arcaParaFactura, CONCEPTOS } from '../../lib/cobro'

const fmtFecha = (iso) => {
  if (!iso) return ''
  const [y, m, d] = String(iso).slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

export default function Facturas() {
  const [facturas,    setFacturas]    = useState([])
  const [arcaConfig,  setArcaConfig]  = useState({})
  const [branding,    setBranding]    = useState({})
  const [loading,     setLoading]     = useState(true)
  const [search,      setSearch]      = useState('')
  const [descargando, setDescargando] = useState(null)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const [fRes, aRes, bRes, pRes] = await Promise.all([
        supabase.from('ventas')
          .select('*, venta_items(descripcion, cantidad, subtotal)')
          .eq('factura_emitida', true)
          .order('fecha', { ascending: false }),
        supabase.from('arca_config').select('*').maybeSingle(),
        supabase.from('branding').select('*').maybeSingle(),
        // Facturas de seña o saldo (una venta o un pedido puede tener varias)
        supabase.from('facturas').select('*, ventas(cliente_nombre, cliente_telefono), pedidos(cliente_nombre, cliente_telefono)')
          .eq('estado', 'emitida').eq('modo', 'produccion'),
      ])
      const partes = (pRes.error ? [] : pRes.data ?? []).map((p) => {
        const base = { cliente_nombre: p.ventas?.cliente_nombre ?? p.pedidos?.cliente_nombre, cliente_telefono: p.ventas?.cliente_telefono ?? p.pedidos?.cliente_telefono }
        return { ...ventaParaFactura(p, base), id: 'p-' + p.id, fecha: p.fecha, parte: p }
      })
      setFacturas([...(fRes.data ?? []), ...partes].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))))
      setArcaConfig(aRes.data ?? {})
      setBranding(bRes.data ?? {})
      setLoading(false)
    }
    load()
  }, [])

  // Filtrar por búsqueda
  const filtradas = facturas.filter(f => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      (f.cliente_nombre || '').toLowerCase().includes(q) ||
      String(f.nro_factura || '').includes(q) ||
      String(f.cae || '').includes(q)
    )
  })

  // Agrupar por mes
  const porMes = {}
  for (const f of filtradas) {
    const key = String(f.fecha ?? '').slice(0, 7)   // "2026-06"
    if (!porMes[key]) porMes[key] = []
    porMes[key].push(f)
  }
  const mesesOrdenados = Object.keys(porMes).sort((a, b) => b.localeCompare(a))

  const mesLabel = (key) => {
    const [y, m] = key.split('-')
    return `${MESES[Number(m) - 1]} ${y}`
  }

  const handleDescargar = async (f) => {
    setDescargando(f.id)
    await generarFacturaC({ venta: f, arcaConfig: f.parte ? arcaParaFactura(f.parte, arcaConfig) : arcaConfig, branding, download: true })
    setDescargando(null)
  }

  const handleWhatsApp = (f) => {
    const texto = buildWhatsAppText({ venta: f, arcaConfig })
    window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank')
  }

  const totalGeneral = filtradas.reduce((s, f) => s + (Number(f.total) || 0), 0)

  return (
    <div>
      {/* Encabezado */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 24, marginBottom: 4 }}>Facturas emitidas</h1>
          <p style={{ color: 'var(--text-muted)' }}>
            Historial de facturas C emitidas a ARCA
          </p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{filtradas.length} facturas</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--primary)' }}>{fmtMoney(totalGeneral)}</div>
        </div>
      </div>

      {/* Buscador */}
      <div className="card" style={{ padding: 12, marginBottom: 16 }}>
        <input
          className="input"
          placeholder="Buscar por cliente, número de factura o CAE…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: '100%' }}
        />
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Cargando…</div>
      ) : filtradas.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
          {facturas.length === 0
            ? 'Todavía no emitiste ninguna factura.'
            : 'No hay facturas que coincidan con la búsqueda.'}
        </div>
      ) : (
        mesesOrdenados.map(mes => {
          const items     = porMes[mes]
          const totalMes  = items.reduce((s, f) => s + (Number(f.total) || 0), 0)
          return (
            <div key={mes} style={{ marginBottom: 28 }}>

              {/* Cabecera del mes */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', borderBottom: '2px solid var(--primary)', paddingBottom: 4 }}>
                  {mesLabel(mes)}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  {items.length} factura{items.length !== 1 ? 's' : ''} · <strong>{fmtMoney(totalMes)}</strong>
                </div>
              </div>

              {/* Tabla */}
              <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                <table className="table" style={{ marginBottom: 0 }}>
                  <thead>
                    <tr>
                      <th>Nro</th>
                      <th>Fecha</th>
                      <th>Cliente</th>
                      <th>CAE</th>
                      <th style={{ textAlign: 'right' }}>Total</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(f => {
                      const nroPv   = String(f.parte?.punto_venta ?? arcaConfig.punto_venta ?? 3).padStart(4, '0')
                      const nroComp = String(f.nro_factura ?? 0).padStart(8, '0')
                      return (
                        <tr key={f.id}>
                          <td>
                            <code style={{ fontSize: 12 }}>{nroPv}-{nroComp}</code>
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>{fmtFecha(f.fecha)}</td>
                          <td>
                            {f.cliente_nombre || <span style={{ color: 'var(--text-muted)' }}>Consumidor Final</span>}
                            {f.parte && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{CONCEPTOS[f.parte.concepto]}: {f.parte.detalle}</div>}
                          </td>
                          <td>
                            <code style={{ fontSize: 11, color: 'var(--text-muted)' }}>{f.cae}</code>
                            {f.cae_vto && (
                              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Vto: {fmtFecha(f.cae_vto)}</div>
                            )}
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--success)' }}>
                            {fmtMoney(Number(f.total))}
                          </td>
                          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <button
                              className="btn btn-sm btn-ghost"
                              disabled={descargando === f.id}
                              onClick={() => handleDescargar(f)}
                              title="Descargar PDF"
                            >
                              {descargando === f.id ? '…' : 'PDF'}
                            </button>
                            <button
                              className="btn btn-sm btn-ghost"
                              onClick={() => handleWhatsApp(f)}
                              title="Compartir por WhatsApp"
                              style={{ color: '#16a34a' }}
                            >
                              WA
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}
