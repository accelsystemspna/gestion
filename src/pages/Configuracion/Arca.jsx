import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

// Definido FUERA del componente para evitar pérdida de foco en cada render
function Input({ label, value, onChange, type = 'text', placeholder }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>{label}</label>
      <input className="input" type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} style={{ fontSize: 14 }} />
    </div>
  )
}

export default function Arca() {
  const [form, setForm]       = useState({
    cuit: '', punto_venta: 3, razon_social: '', concepto: 1,
    modo: 'homologacion', cert_pem: '', key_pem: '',
  })
  const [saving,   setSaving]   = useState(false)
  const [testing,  setTesting]  = useState(false)
  const [saved,    setSaved]    = useState(false)
  const [testMsg,  setTestMsg]  = useState(null)  // { ok, msg }
  const [paso,     setPaso]     = useState(null)  // null | 'cert'

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    supabase.from('arca_config').select('*').eq('id', 1).maybeSingle()
      .then(({ data }) => { if (data) setForm(f => ({ ...f, ...data })) })
  }, [])

  const handleSave = async () => {
    if (!form.cuit)        return alert('Ingresá el CUIT')
    if (!form.razon_social) return alert('Ingresá la razón social')
    if (!form.cert_pem)    return alert('Pegá el certificado PEM')
    if (!form.key_pem)     return alert('Pegá la clave privada PEM')
    setSaving(true)
    const { error } = await supabase.from('arca_config').upsert({
      id: 1, ...form, updated_at: new Date().toISOString(),
    })
    setSaving(false)
    if (error) return alert('Error al guardar: ' + error.message)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  const handleTest = async () => {
    setTesting(true)
    setTestMsg(null)
    try {
      const { data, error } = await supabase.functions.invoke('emitir-factura', {
        body: { accion: 'test' },
      })
      if (error) throw new Error(error.message)
      if (data?.ok) setTestMsg({ ok: true,  msg: '✅ Conexión con ARCA exitosa. Token obtenido.' })
      else          setTestMsg({ ok: false, msg: '❌ ' + (data?.error || 'Error desconocido') })
    } catch (e) {
      setTestMsg({ ok: false, msg: '❌ ' + e.message })
    }
    setTesting(false)
  }


  return (
    <div style={{ maxWidth: 780, display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 44, height: 44, borderRadius: 10, background: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>
          🏛️
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 17 }}>Facturación electrónica — ARCA</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Emití Facturas C directamente desde la app</div>
        </div>
        <span style={{
          marginLeft: 'auto', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
          background: form.modo === 'produccion' ? '#dcfce7' : '#fef9c3',
          color:      form.modo === 'produccion' ? '#16a34a' : '#92400e',
          border:     `1px solid ${form.modo === 'produccion' ? '#86efac' : '#fcd34d'}`,
        }}>
          {form.modo === 'produccion' ? '● Producción' : '● Homologación (pruebas)'}
        </span>
      </div>

      {/* Paso 1: Extraer PEM */}
      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>
            📋 Paso previo — Extraer archivos PEM del certificado
          </div>
          <button className="btn btn-sm" onClick={() => setPaso(paso === 'cert' ? null : 'cert')}>
            {paso === 'cert' ? 'Ocultar' : 'Ver instrucciones'}
          </button>
        </div>
        {paso === 'cert' && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Abrí Git Bash en la carpeta donde está <code>ccgestion.p12</code> y ejecutá:
            </p>
            <div style={{ background: '#1e293b', borderRadius: 8, padding: '10px 14px', fontFamily: 'monospace', fontSize: 12, color: '#e2e8f0', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div><span style={{ color: '#94a3b8' }}># Extraer certificado:</span></div>
              <div>openssl pkcs12 -in ccgestion.p12 -nokeys -clcerts -out cert.pem</div>
              <div style={{ marginTop: 4 }}><span style={{ color: '#94a3b8' }}># Extraer clave privada:</span></div>
              <div>openssl pkcs12 -in ccgestion.p12 -nocerts -nodes -out key.pem</div>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Te pedirá la contraseña del .p12. Luego abrí los archivos <code>cert.pem</code> y <code>key.pem</code> con el Bloc de notas y pegá el contenido abajo.
            </p>
          </div>
        )}
      </div>

      {/* Formulario */}
      <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 14, borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
          Datos fiscales
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Input label="CUIT (sin guiones)" value={form.cuit}
            onChange={v => set('cuit', v)} placeholder="20370802395" />
          <Input label="Punto de venta" type="number" value={form.punto_venta}
            onChange={v => set('punto_venta', Number(v))} placeholder="3" />
        </div>
        <Input label="Razón social / Nombre" value={form.razon_social}
          onChange={v => set('razon_social', v)} placeholder="CC Diseños" />

        {/* Concepto */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Concepto por defecto</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {[{ v: 1, l: 'Productos' }, { v: 2, l: 'Servicios' }, { v: 3, l: 'Productos y servicios' }].map(({ v, l }) => (
              <button key={v} className="btn btn-sm" onClick={() => set('concepto', v)}
                style={{
                  background:  form.concepto === v ? 'var(--primary)' : undefined,
                  color:       form.concepto === v ? 'white' : undefined,
                  borderColor: form.concepto === v ? 'var(--primary)' : undefined,
                  fontWeight:  form.concepto === v ? 700 : 400,
                }}>
                {l}
              </button>
            ))}
          </div>
        </div>

        {/* Modo */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Modo</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {[['homologacion', '🧪 Homologación (pruebas)'], ['produccion', '🚀 Producción']].map(([v, l]) => (
              <button key={v} className="btn btn-sm" onClick={() => set('modo', v)}
                style={{
                  background:  form.modo === v ? (v === 'produccion' ? '#16a34a' : 'var(--primary)') : undefined,
                  color:       form.modo === v ? 'white' : undefined,
                  borderColor: form.modo === v ? (v === 'produccion' ? '#16a34a' : 'var(--primary)') : undefined,
                  fontWeight:  form.modo === v ? 700 : 400,
                }}>
                {l}
              </button>
            ))}
          </div>
          {form.modo === 'produccion' && (
            <p style={{ fontSize: 11, color: '#dc2626', marginTop: 2 }}>
              ⚠️ En modo Producción las facturas son reales y se reportan a ARCA.
            </p>
          )}
        </div>

        <div style={{ fontWeight: 700, fontSize: 14, borderBottom: '1px solid var(--border)', paddingBottom: 10, marginTop: 4 }}>
          Certificado digital
        </div>

        {/* Cert PEM */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>
            Certificado (cert.pem) — contenido completo incluyendo las líneas -----BEGIN CERTIFICATE-----
          </label>
          <textarea
            className="input"
            value={form.cert_pem}
            onChange={e => set('cert_pem', e.target.value)}
            placeholder="-----BEGIN CERTIFICATE-----&#10;MIIEv...&#10;-----END CERTIFICATE-----"
            rows={5}
            style={{ fontFamily: 'monospace', fontSize: 11, resize: 'vertical' }}
          />
        </div>

        {/* Key PEM */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>
            Clave privada (key.pem) — contenido completo incluyendo las líneas -----BEGIN PRIVATE KEY-----
          </label>
          <textarea
            className="input"
            value={form.key_pem}
            onChange={e => set('key_pem', e.target.value)}
            placeholder="-----BEGIN PRIVATE KEY-----&#10;MIIEv...&#10;-----END PRIVATE KEY-----"
            rows={5}
            style={{ fontFamily: 'monospace', fontSize: 11, resize: 'vertical' }}
          />
        </div>

        {/* Test result */}
        {testMsg && (
          <div style={{
            padding: '10px 14px', borderRadius: 8, fontSize: 13,
            background: testMsg.ok ? '#f0fdf4' : '#fff1f2',
            color:      testMsg.ok ? '#16a34a' : '#dc2626',
            border:     `1px solid ${testMsg.ok ? '#86efac' : '#fca5a5'}`,
          }}>
            {testMsg.msg}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
          <button className="btn" onClick={handleTest} disabled={testing || !form.cert_pem || !form.key_pem}>
            {testing ? 'Probando…' : '🔌 Probar conexión con ARCA'}
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Guardando…' : saved ? '✅ Guardado' : 'Guardar configuración'}
          </button>
        </div>
      </div>

    </div>
  )
}
