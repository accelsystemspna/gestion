import { useState, useRef } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'

// columnas que intentamos mapear automáticamente
const CAMPO_ALIASES = {
  nombre:    ['nombre', 'name', 'cliente', 'razón social', 'razon social', 'empresa'],
  email:     ['email', 'correo', 'mail', 'e-mail'],
  telefono:  ['telefono', 'teléfono', 'tel', 'celular', 'whatsapp', 'phone'],
  direccion: ['direccion', 'dirección', 'domicilio', 'address'],
  etiqueta:  ['etiqueta', 'categoria', 'categoría', 'grupo', 'tag', 'tipo'],
  notas:     ['notas', 'nota', 'observaciones', 'comentarios', 'notes'],
}

function autoMap(headers) {
  const mapping = {}
  headers.forEach((h) => {
    const lower = (h || '').toLowerCase().trim()
    for (const [campo, aliases] of Object.entries(CAMPO_ALIASES)) {
      if (aliases.some((a) => lower.includes(a))) {
        if (!mapping[campo]) mapping[campo] = h
      }
    }
  })
  return mapping
}

const inputStyle = {
  width: '100%',
  padding: '7px 10px',
  border: '1px solid var(--border)',
  borderRadius: 6,
  fontSize: 13,
  background: 'var(--surface)',
  color: 'inherit',
  boxSizing: 'border-box',
}

export default function ImportarModal({ onClose, onImported, etiquetasExistentes = [] }) {
  const { orgId } = useAuth()
  const fileRef = useRef(null)
  const [step, setStep] = useState('upload') // 'upload' | 'map' | 'preview' | 'done'
  const [sheets, setSheets] = useState([])        // [{ name, rows[] }]
  const [sheetMapping, setSheetMapping] = useState({})  // sheetName -> etiqueta
  const [colMapping, setColMapping] = useState({})       // campo -> headerName
  const [headers, setHeaders] = useState([])
  const [previewRows, setPreviewRows] = useState([])
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState(null)

  function handleFile(file) {
    if (!file) return
    setError('')
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' })
        const parsed = wb.SheetNames.map((name) => {
          const ws = wb.Sheets[name]
          const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
          return { name, rows }
        }).filter((s) => s.rows.length > 0)

        if (parsed.length === 0) {
          setError('El archivo no contiene datos.')
          return
        }

        setSheets(parsed)

        // etiqueta por hoja = nombre de hoja
        const sm = {}
        parsed.forEach((s) => { sm[s.name] = s.name })
        setSheetMapping(sm)

        // headers = keys de la primera fila de la primera hoja
        const firstHeaders = Object.keys(parsed[0].rows[0] || {})
        setHeaders(firstHeaders)
        setColMapping(autoMap(firstHeaders))

        setStep('map')
      } catch {
        setError('No se pudo leer el archivo. Asegurate de que sea .xlsx, .xls o .csv')
      }
    }
    reader.readAsArrayBuffer(file)
  }

  function handleDrop(e) {
    e.preventDefault()
    handleFile(e.dataTransfer.files[0])
  }

  function goPreview() {
    if (!colMapping.nombre) {
      setError('Tenés que mapear al menos la columna "Nombre".')
      return
    }
    setError('')
    // construir preview: primeras 5 filas de todas las hojas
    const rows = []
    sheets.forEach((s) => {
      s.rows.slice(0, 3).forEach((r) => {
        rows.push({
          nombre: r[colMapping.nombre] || '',
          email: r[colMapping.email] || '',
          telefono: r[colMapping.telefono] || '',
          etiqueta: sheetMapping[s.name] || s.name,
        })
      })
    })
    setPreviewRows(rows.slice(0, 9))
    setStep('preview')
  }

  async function handleImport() {
    setImporting(true)
    setError('')
    let inserted = 0
    let skipped = 0

    for (const sheet of sheets) {
      const etiqueta = sheetMapping[sheet.name] || sheet.name
      for (const row of sheet.rows) {
        const nombre = String(row[colMapping.nombre] || '').trim()
        if (!nombre) { skipped++; continue }
        const payload = {
          nombre,
          email: colMapping.email ? String(row[colMapping.email] || '').trim() || null : null,
          telefono: colMapping.telefono ? String(row[colMapping.telefono] || '').trim() || null : null,
          direccion: colMapping.direccion ? String(row[colMapping.direccion] || '').trim() || null : null,
          notas: colMapping.notas ? String(row[colMapping.notas] || '').trim() || null : null,
          etiqueta: etiqueta || null,
        }
        const { error: err } = await supabase.from('clientes').insert([{ ...payload, org_id: orgId }])
        if (err) skipped++
        else inserted++
      }
    }

    setResult({ inserted, skipped })
    setImporting(false)
    setStep('done')
  }

  const CAMPOS = [
    { key: 'nombre', label: 'Nombre *' },
    { key: 'email', label: 'Email' },
    { key: 'telefono', label: 'Teléfono' },
    { key: 'direccion', label: 'Dirección' },
    { key: 'etiqueta', label: 'Etiqueta / Categoría' },
    { key: 'notas', label: 'Notas' },
  ]

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 300,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        style={{
          background: 'var(--bg)',
          borderRadius: 10,
          width: '100%',
          maxWidth: 560,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
        }}
      >
        {/* cabecera */}
        <div
          style={{
            padding: '18px 20px 14px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>Importar clientes desde Excel</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              {step === 'upload' && 'Paso 1 — Subir archivo'}
              {step === 'map' && 'Paso 2 — Mapear columnas'}
              {step === 'preview' && 'Paso 3 — Vista previa'}
              {step === 'done' && 'Importación completada'}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--text-muted)' }}>×</button>
        </div>

        {/* cuerpo */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px' }}>

          {/* STEP 1: upload */}
          {step === 'upload' && (
            <div>
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => fileRef.current?.click()}
                style={{
                  border: '2px dashed var(--border)',
                  borderRadius: 10,
                  padding: '40px 20px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  background: 'var(--surface)',
                  transition: 'border-color 0.15s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--primary)')}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
              >
                <div style={{ fontSize: 36, marginBottom: 10 }}>📂</div>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Arrastrá tu archivo aquí o hacé clic</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Formatos soportados: .xlsx, .xls, .csv</div>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                style={{ display: 'none' }}
                onChange={(e) => handleFile(e.target.files[0])}
              />
              {error && <div style={{ color: '#ef4444', fontSize: 13, marginTop: 10 }}>{error}</div>}
              <div style={{ marginTop: 16, padding: 14, background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>💡 Consejos</div>
                <ul style={{ fontSize: 13, color: 'var(--text-muted)', paddingLeft: 18, lineHeight: 1.8, margin: 0 }}>
                  <li>Cada hoja del Excel se convertirá en una <strong>categoría/etiqueta</strong> de clientes.</li>
                  <li>La primera fila debe tener los encabezados de columna.</li>
                  <li>Se detectan automáticamente: nombre, email, teléfono, dirección.</li>
                </ul>
              </div>
            </div>
          )}

          {/* STEP 2: mapeo */}
          {step === 'map' && (
            <div>
              {/* hojas → etiquetas */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>
                  Hojas del archivo → Etiqueta de cliente
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {sheets.map((s) => (
                    <div key={s.name} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <div
                        style={{
                          flex: '0 0 160px',
                          fontSize: 13,
                          fontWeight: 600,
                          padding: '7px 10px',
                          background: 'var(--surface)',
                          border: '1px solid var(--border)',
                          borderRadius: 6,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        📋 {s.name} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({s.rows.length} filas)</span>
                      </div>
                      <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>→</span>
                      <input
                        style={{ ...inputStyle, flex: 1 }}
                        value={sheetMapping[s.name] ?? s.name}
                        onChange={(e) =>
                          setSheetMapping((m) => ({ ...m, [s.name]: e.target.value }))
                        }
                        placeholder="Nombre de etiqueta"
                        list="etiquetas-list"
                      />
                    </div>
                  ))}
                  <datalist id="etiquetas-list">
                    {etiquetasExistentes.map((e) => <option key={e} value={e} />)}
                  </datalist>
                </div>
              </div>

              {/* columnas → campos */}
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>
                  Columnas del Excel → Campos del cliente
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {CAMPOS.map(({ key, label }) => (
                    <div key={key}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
                      <select
                        style={inputStyle}
                        value={colMapping[key] ?? ''}
                        onChange={(e) =>
                          setColMapping((m) => ({ ...m, [key]: e.target.value || undefined }))
                        }
                      >
                        <option value="">— sin mapear —</option>
                        {headers.map((h) => (
                          <option key={h} value={h}>{h}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
              {error && <div style={{ color: '#ef4444', fontSize: 13, marginTop: 10 }}>{error}</div>}
            </div>
          )}

          {/* STEP 3: preview */}
          {step === 'preview' && (
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>
                Vista previa (primeros registros):
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr>
                      {['Nombre', 'Email', 'Teléfono', 'Etiqueta'].map((h) => (
                        <th
                          key={h}
                          style={{
                            padding: '8px 10px',
                            background: 'var(--surface)',
                            border: '1px solid var(--border)',
                            textAlign: 'left',
                            fontWeight: 600,
                            fontSize: 12,
                            color: 'var(--text-muted)',
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((r, i) => (
                      <tr key={i}>
                        {[r.nombre, r.email, r.telefono, r.etiqueta].map((v, j) => (
                          <td
                            key={j}
                            style={{
                              padding: '7px 10px',
                              border: '1px solid var(--border)',
                              maxWidth: 130,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {v || <span style={{ color: 'var(--text-muted)' }}>—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ marginTop: 14, padding: 12, background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, color: 'var(--text-muted)' }}>
                Se importarán{' '}
                <strong style={{ color: 'inherit' }}>
                  {sheets.reduce((s, sh) => s + sh.rows.length, 0)} clientes
                </strong>{' '}
                en total desde{' '}
                <strong style={{ color: 'inherit' }}>{sheets.length} {sheets.length === 1 ? 'hoja' : 'hojas'}</strong>.
              </div>
            </div>
          )}

          {/* STEP done */}
          {step === 'done' && result && (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
              <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>Importación completada</div>
              <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 20 }}>
                <strong style={{ color: 'inherit' }}>{result.inserted}</strong> clientes importados
                {result.skipped > 0 && ` · ${result.skipped} omitidos (sin nombre o duplicados)`}
              </div>
              <button
                onClick={onImported}
                style={{
                  padding: '10px 28px',
                  background: 'var(--primary)',
                  border: 'none',
                  borderRadius: 6,
                  color: 'white',
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                Ver clientes importados
              </button>
            </div>
          )}
        </div>

        {/* pie */}
        {step !== 'done' && (
          <div
            style={{
              padding: '14px 20px',
              borderTop: '1px solid var(--border)',
              display: 'flex',
              gap: 10,
              justifyContent: 'flex-end',
            }}
          >
            <button
              onClick={onClose}
              style={{
                padding: '8px 16px',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              Cancelar
            </button>
            {step === 'map' && (
              <button
                onClick={goPreview}
                style={{
                  padding: '8px 20px',
                  background: 'var(--primary)',
                  border: 'none',
                  borderRadius: 6,
                  color: 'white',
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                Vista previa →
              </button>
            )}
            {step === 'preview' && (
              <>
                <button
                  onClick={() => setStep('map')}
                  style={{
                    padding: '8px 16px',
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontSize: 14,
                  }}
                >
                  ← Ajustar
                </button>
                <button
                  onClick={handleImport}
                  disabled={importing}
                  style={{
                    padding: '8px 20px',
                    background: 'var(--primary)',
                    border: 'none',
                    borderRadius: 6,
                    color: 'white',
                    cursor: 'pointer',
                    fontSize: 14,
                    fontWeight: 600,
                  }}
                >
                  {importing ? 'Importando…' : '✓ Importar ahora'}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
