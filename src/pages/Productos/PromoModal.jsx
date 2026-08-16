import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { syncToWoo } from '../../lib/wooSync'

const PROMO_TIPOS = {
  descuento_pct:      { label: 'Descuento %' },
  descuento_monto:    { label: 'Descuento $ fijo' },
  nxm:                { label: 'Lleva N, paga M (2x1/3x2)' },
  segunda_unidad_pct: { label: '2da unidad a % del precio' },
}
const PROMO_CANALES = {
  local: '🏪 Solo local',
  web:   '🌐 Solo web',
  ambos: '🏪🌐 Ambos',
}

export default function PromoModal({ producto, tiendas, listas, onClose, onSaved }) {
  const [form, setForm] = useState({
    promo_activa:      producto.promo_activa ?? false,
    promo_tipo:        producto.promo_tipo || 'descuento_pct',
    promo_valor:       producto.promo_valor ?? '',
    promo_lleva:       producto.promo_lleva ?? 2,
    promo_paga:        producto.promo_paga ?? 1,
    promo_canal:       producto.promo_canal || 'ambos',
    promo_fecha_desde: producto.promo_fecha_desde || '',
    promo_fecha_hasta: producto.promo_fecha_hasta || '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const handleSave = async () => {
    setSaving(true)
    const payload = {
      promo_activa:      !!form.promo_activa,
      promo_tipo:        form.promo_activa ? form.promo_tipo : null,
      promo_valor:       form.promo_activa && form.promo_valor !== '' ? Number(form.promo_valor) : null,
      promo_lleva:       form.promo_activa && form.promo_tipo === 'nxm' ? Number(form.promo_lleva) || 1 : null,
      promo_paga:        form.promo_activa && form.promo_tipo === 'nxm' ? Number(form.promo_paga) || 1 : null,
      promo_canal:       form.promo_activa ? form.promo_canal : null,
      promo_fecha_desde: form.promo_fecha_desde || null,
      promo_fecha_hasta: form.promo_fecha_hasta || null,
    }
    const { error } = await supabase.from('productos').update(payload).eq('id', producto.id)
    setSaving(false)
    if (error) { alert('Error: ' + error.message); return }

    syncToWoo({ tiendas, listas, producto: { ...producto, ...payload } })
      .catch((err) => console.error('[wooSync]', err))

    onSaved?.()
    onClose()
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <h3 style={{ fontSize: 16 }}>🏷️ Oferta — {producto.nombre}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
            <input type="checkbox" checked={form.promo_activa} onChange={(e) => set('promo_activa', e.target.checked)} />
            <span style={{ fontWeight: 600, fontSize: 14 }}>Oferta activa en este producto</span>
          </label>

          {form.promo_activa && (
            <>
              <div className="field">
                <label>Tipo de oferta</label>
                <select className="select" value={form.promo_tipo} onChange={(e) => set('promo_tipo', e.target.value)}>
                  {Object.entries(PROMO_TIPOS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>

              {form.promo_tipo === 'nxm' ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div className="field">
                    <label>Lleva</label>
                    <input className="input" type="number" min="1" value={form.promo_lleva} onChange={(e) => set('promo_lleva', e.target.value)} />
                  </div>
                  <div className="field">
                    <label>Paga</label>
                    <input className="input" type="number" min="1" value={form.promo_paga} onChange={(e) => set('promo_paga', e.target.value)} />
                  </div>
                  <span style={{ gridColumn: 'span 2', fontSize: 11, color: 'var(--text-muted)' }}>
                    2x1 → lleva 2, paga 1. 3x2 → lleva 3, paga 2.
                  </span>
                </div>
              ) : (
                <div className="field">
                  <label>{form.promo_tipo === 'descuento_monto' ? 'Monto de descuento ($)' : form.promo_tipo === 'segunda_unidad_pct' ? '2da unidad al… (%)' : 'Porcentaje de descuento (%)'}</label>
                  <input className="input" type="number" step="0.01" value={form.promo_valor} onChange={(e) => set('promo_valor', e.target.value)}
                    placeholder={form.promo_tipo === 'segunda_unidad_pct' ? 'Ej: 50 = mitad de precio' : '0'} />
                </div>
              )}

              <div className="field">
                <label>¿Dónde aplica?</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {Object.entries(PROMO_CANALES).map(([k, label]) => (
                    <button key={k} type="button" onClick={() => set('promo_canal', k)}
                      style={{
                        flex: 1, padding: '7px 8px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                        border: `1px solid ${form.promo_canal === k ? 'var(--primary)' : 'var(--border)'}`,
                        background: form.promo_canal === k ? 'var(--primary-faint)' : 'var(--surface)',
                        color: form.promo_canal === k ? 'var(--primary)' : 'var(--text)',
                      }}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="field">
                  <label>Desde (opcional)</label>
                  <input className="input" type="date" value={form.promo_fecha_desde} onChange={(e) => set('promo_fecha_desde', e.target.value)} />
                </div>
                <div className="field">
                  <label>Hasta (opcional)</label>
                  <input className="input" type="date" value={form.promo_fecha_hasta} onChange={(e) => set('promo_fecha_hasta', e.target.value)} />
                </div>
              </div>
            </>
          )}

        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </div>
    </div>
  )
}
