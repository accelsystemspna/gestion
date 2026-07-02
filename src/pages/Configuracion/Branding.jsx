import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'

const FIELDS = [
  { key: 'nombre', label: 'Nombre del emprendimiento' },
  { key: 'slogan', label: 'Slogan' },
  { key: 'direccion', label: 'Dirección' },
  { key: 'telefono', label: 'Teléfono' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'web_mayorista', label: 'Web mayorista' },
  { key: 'web_minorista', label: 'Web minorista' },
]

const SOCIAL = [
  { key: 'instagram', label: 'Instagram' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'tiktok', label: 'TikTok' },
  { key: 'youtube', label: 'YouTube' },
  { key: 'pinterest', label: 'Pinterest' },
]

export default function Branding() {
  const { orgId } = useAuth()
  const [data, setData] = useState({})
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    if (!orgId) return
    supabase.from('branding').select('*').eq('user_id', orgId).maybeSingle()
      .then(({ data }) => setData(data || {}))
  }, [orgId])

  const set = (k, v) => setData((d) => ({ ...d, [k]: v }))

  const handleLogo = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setMsg(null)
    try {
      const ext = file.name.split('.').pop()
      const path = `logo-${Date.now()}.${ext}`
      const { error } = await supabase.storage.from('branding').upload(path, file, { upsert: true })
      if (error) throw error
      const { data: pub } = supabase.storage.from('branding').getPublicUrl(path)
      set('logo_url', pub.publicUrl)
    } catch (err) {
      setMsg({ type: 'error', text: err.message })
    } finally {
      setUploading(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setMsg(null)
    const { id: _id, ...rest } = data
    const payload = { ...rest, user_id: orgId, updated_at: new Date().toISOString() }
    const { error } = await supabase.from('branding').upsert(payload, { onConflict: 'user_id' })
    setSaving(false)
    setMsg(error ? { type: 'error', text: error.message } : { type: 'ok', text: 'Guardado correctamente' })
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap' }}>
        <div
          style={{
            width: 140,
            height: 140,
            borderRadius: 8,
            background: '#f1f5f9',
            border: '1px dashed var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          {data.logo_url ? (
            <img src={data.logo_url} alt="logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          ) : (
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Sin logo</span>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <label className="btn" style={{ cursor: 'pointer' }}>
            {uploading ? 'Subiendo...' : 'Subir logo'}
            <input type="file" accept="image/*" onChange={handleLogo} style={{ display: 'none' }} />
          </label>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
            PNG, JPG o SVG. Recomendado: cuadrado, fondo transparente.
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
        {FIELDS.map((f) => (
          <div className="field" key={f.key}>
            <label>{f.label}</label>
            <input
              className="input"
              type={f.type || 'text'}
              value={data[f.key] || ''}
              onChange={(e) => set(f.key, e.target.value)}
            />
          </div>
        ))}
      </div>

      <h3 style={{ marginTop: 24, marginBottom: 12, fontSize: 14, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Redes sociales
      </h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
        {SOCIAL.map((f) => (
          <div className="field" key={f.key}>
            <label>{f.label}</label>
            <input
              className="input"
              value={data[f.key] || ''}
              onChange={(e) => set(f.key, e.target.value)}
              placeholder={`@usuario o URL`}
            />
          </div>
        ))}
      </div>

      <div style={{ marginTop: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {msg ? (
          <div style={{ color: msg.type === 'error' ? 'var(--danger)' : 'var(--success)', fontSize: 13 }}>
            {msg.text}
          </div>
        ) : <div />}
        <button onClick={handleSave} className="btn btn-primary" disabled={saving}>
          {saving ? 'Guardando...' : 'Guardar cambios'}
        </button>
      </div>
    </div>
  )
}
