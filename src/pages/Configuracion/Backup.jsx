import { useState, useEffect, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'

// ── tablas que se incluyen en el backup ───────────────────────────────────────
const TABLAS = [
  { key: 'branding',        label: 'Branding' },
  { key: 'rubros',          label: 'Rubros' },
  { key: 'categorias',      label: 'Categorías' },
  { key: 'listas_precios',  label: 'Listas de precios' },
  { key: 'materiales',      label: 'Materiales' },
  { key: 'tarifas',         label: 'Tarifas' },
  { key: 'productos',       label: 'Productos' },
  { key: 'presupuestos',    label: 'Presupuestos' },
  { key: 'clientes',        label: 'Clientes' },
  { key: 'compras',         label: 'Compras' },
]

const FRECUENCIAS = [
  { value: 'diario',   label: 'Diario',   days: 1 },
  { value: 'semanal',  label: 'Semanal',  days: 7 },
  { value: 'mensual',  label: 'Mensual',  days: 30 },
]

const LS_KEY = 'backup_schedule'

function loadSchedule() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || null } catch { return null }
}
function saveSchedule(s) {
  localStorage.setItem(LS_KEY, JSON.stringify(s))
}

function nextDate(frecuencia) {
  const days = FRECUENCIAS.find((f) => f.value === frecuencia)?.days ?? 7
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString()
}

function fmtDatetime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function isOverdue(iso) {
  if (!iso) return false
  return new Date(iso) <= new Date()
}

// ── helpers de descarga ───────────────────────────────────────────────────────
function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

function downloadXLSX(data, filename) {
  const wb = XLSX.utils.book_new()
  for (const [sheet, rows] of Object.entries(data)) {
    if (!rows?.length) continue
    const ws = XLSX.utils.json_to_sheet(rows)
    XLSX.utils.book_append_sheet(wb, ws, sheet.slice(0, 31))
  }
  XLSX.writeFile(wb, filename)
}

// ── componente principal ──────────────────────────────────────────────────────
export default function Backup() {
  const [loading,    setLoading]    = useState(false)
  const [progress,   setProgress]   = useState('')   // mensaje de progreso
  const [schedule,   setSchedule]   = useState(loadSchedule)
  const [restoring,  setRestoring]  = useState(false)
  const [restoreMsg, setRestoreMsg] = useState('')
  const [lastBackup, setLastBackup] = useState(() => localStorage.getItem('backup_last') || null)
  const [showConfirm, setShowConfirm] = useState(null)  // 'json' | 'xlsx' | 'restore'
  const [restoreFile, setRestoreFile] = useState(null)
  const [restoreData, setRestoreData] = useState(null)

  // ── alerta de backup pendiente ─────────────────────────────────────────────
  const isVencido = schedule?.enabled && isOverdue(schedule?.next)

  // ── fetch de todas las tablas ──────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    const result = {}
    for (const t of TABLAS) {
      setProgress(`Exportando ${t.label}…`)
      const { data } = await supabase.from(t.key).select('*')
      result[t.key] = data || []
    }
    setProgress('')
    return result
  }, [])

  // ── backup manual ──────────────────────────────────────────────────────────
  async function handleBackup(format) {
    setLoading(true)
    setShowConfirm(null)
    try {
      const data = await fetchAll()
      const fecha = new Date().toISOString().slice(0, 10)
      const meta  = {
        version:    1,
        fecha,
        app:        'gestion-app',
        tablas:     Object.keys(data),
        registros:  Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])),
      }

      if (format === 'json') {
        downloadJSON({ _meta: meta, ...data }, `backup-${fecha}.json`)
      } else {
        const sheetsData = {}
        for (const [k, rows] of Object.entries(data)) {
          sheetsData[k] = rows
        }
        sheetsData['_meta'] = [meta]
        downloadXLSX(sheetsData, `backup-${fecha}.xlsx`)
      }

      // Actualizar última fecha + próximo backup si hay programación
      const now = new Date().toISOString()
      localStorage.setItem('backup_last', now)
      setLastBackup(now)
      if (schedule?.enabled) {
        const updated = { ...schedule, last: now, next: nextDate(schedule.frecuencia) }
        setSchedule(updated)
        saveSchedule(updated)
      }
    } catch (err) {
      alert('Error al generar el backup: ' + err.message)
    } finally {
      setLoading(false)
      setProgress('')
    }
  }

  // ── programación ──────────────────────────────────────────────────────────
  function toggleSchedule(enabled) {
    const updated = enabled
      ? { enabled: true, frecuencia: schedule?.frecuencia || 'semanal', next: nextDate(schedule?.frecuencia || 'semanal'), last: schedule?.last || null }
      : { ...schedule, enabled: false }
    setSchedule(updated)
    saveSchedule(updated)
  }

  function changeFrecuencia(frecuencia) {
    const updated = { ...schedule, frecuencia, next: nextDate(frecuencia) }
    setSchedule(updated)
    saveSchedule(updated)
  }

  // ── restaurar ─────────────────────────────────────────────────────────────
  async function handleRestoreFile(file) {
    if (!file) return
    setRestoreMsg('')
    try {
      const text = await file.text()
      const json = JSON.parse(text)
      setRestoreFile(file.name)
      setRestoreData(json)
      setShowConfirm('restore')
    } catch {
      setRestoreMsg('El archivo no es un backup válido (JSON mal formado).')
    }
  }

  async function confirmRestore() {
    if (!restoreData) return
    setRestoring(true)
    setShowConfirm(null)
    setRestoreMsg('')
    let ok = 0, fail = 0

    for (const t of TABLAS) {
      const rows = restoreData[t.key]
      if (!Array.isArray(rows) || rows.length === 0) continue
      setProgress(`Restaurando ${t.label}…`)
      // upsert: inserta o actualiza por id
      const { error } = await supabase.from(t.key).upsert(rows, { onConflict: 'id', ignoreDuplicates: false })
      if (error) fail++
      else ok++
    }

    setRestoring(false)
    setProgress('')
    setRestoreData(null)
    setRestoreFile(null)
    setRestoreMsg(
      fail === 0
        ? `✅ Restauración completada. ${ok} tablas importadas correctamente.`
        : `⚠️ ${ok} tablas OK, ${fail} con errores. Revisá la consola.`
    )
  }

  return (
    <div style={{ maxWidth: 700 }}>

      {/* alerta backup vencido */}
      {isVencido && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          background: '#fffbeb', border: '1px solid #fcd34d',
          borderRadius: 8, padding: '12px 16px', marginBottom: 20,
        }}>
          <span style={{ fontSize: 20 }}>⚠️</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, color: '#92400e', fontSize: 14 }}>Backup pendiente</div>
            <div style={{ fontSize: 13, color: '#b45309', marginTop: 2 }}>
              El backup programado venció el {fmtDatetime(schedule.next)}. Te recomendamos generarlo ahora.
            </div>
          </div>
          <button
            onClick={() => setShowConfirm('json')}
            style={{ padding: '7px 14px', background: '#f59e0b', border: 'none', borderRadius: 6, color: 'white', fontWeight: 600, cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap' }}
          >
            Hacer backup
          </button>
        </div>
      )}

      {/* ── sección backup manual ───────────────────────────────────────────── */}
      <Section title="💾 Backup manual" subtitle="Descargá una copia de todos tus datos">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <BackupCard
            icon="{ }"
            title="Exportar como JSON"
            desc="Formato técnico. Recomendado para restaurar datos exactamente."
            color="#3b82f6"
            onClick={() => setShowConfirm('json')}
            disabled={loading}
          />
          <BackupCard
            icon="📊"
            title="Exportar como Excel"
            desc="Una hoja por tabla. Útil para revisar o editar manualmente."
            color="#16a34a"
            onClick={() => setShowConfirm('xlsx')}
            disabled={loading}
          />
        </div>

        {(loading || progress) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, color: 'var(--text-muted)' }}>
            <Spinner />
            {progress || 'Generando backup…'}
          </div>
        )}

        {lastBackup && !loading && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
            Último backup: {fmtDatetime(lastBackup)}
          </div>
        )}

        <div style={{ marginTop: 12, padding: 12, background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>📦 INCLUYE</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {TABLAS.map((t) => (
              <span key={t.key} style={{ fontSize: 11, padding: '3px 9px', borderRadius: 12, background: 'var(--border)', color: 'var(--text-muted)' }}>
                {t.label}
              </span>
            ))}
          </div>
        </div>
      </Section>

      {/* ── programación automática ─────────────────────────────────────────── */}
      <Section title="🕐 Backup automático" subtitle="Recibís un aviso dentro de la app cuando es momento de hacer el backup">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Recordatorio programado</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
              La app te avisará cuando sea hora de hacer el backup
            </div>
          </div>
          <Toggle value={!!schedule?.enabled} onChange={toggleSchedule} />
        </div>

        {schedule?.enabled && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 16, background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>FRECUENCIA</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {FRECUENCIAS.map((f) => (
                  <button
                    key={f.value}
                    onClick={() => changeFrecuencia(f.value)}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 6,
                      border: '1px solid',
                      borderColor: schedule.frecuencia === f.value ? 'var(--primary)' : 'var(--border)',
                      background: schedule.frecuencia === f.value ? 'var(--primary)' : 'var(--surface)',
                      color: schedule.frecuencia === f.value ? 'white' : 'var(--text-muted)',
                      fontWeight: schedule.frecuencia === f.value ? 600 : 400,
                      cursor: 'pointer',
                      fontSize: 13,
                    }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <InfoRow label="Último backup" value={fmtDatetime(schedule.last)} />
              <InfoRow
                label="Próximo aviso"
                value={fmtDatetime(schedule.next)}
                highlight={isOverdue(schedule.next)}
              />
            </div>
          </div>
        )}
      </Section>

      {/* ── restaurar ───────────────────────────────────────────────────────── */}
      <Section title="📂 Restaurar backup" subtitle="Importá un backup JSON para recuperar tus datos">
        <div
          onDrop={(e) => { e.preventDefault(); handleRestoreFile(e.dataTransfer.files[0]) }}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => document.getElementById('restore-input').click()}
          style={{
            border: '2px dashed var(--border)',
            borderRadius: 10,
            padding: '28px 20px',
            textAlign: 'center',
            cursor: 'pointer',
            background: 'var(--surface)',
            transition: 'border-color 0.15s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--primary)')}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
        >
          <div style={{ fontSize: 28, marginBottom: 8 }}>📂</div>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
            Arrastrá un archivo .json de backup o hacé clic
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Solo archivos generados por esta app
          </div>
        </div>
        <input
          id="restore-input"
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={(e) => handleRestoreFile(e.target.files[0])}
        />

        {(restoring || (progress && restoring)) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, padding: '10px 14px', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, color: 'var(--text-muted)' }}>
            <Spinner />
            {progress || 'Restaurando datos…'}
          </div>
        )}

        {restoreMsg && (
          <div style={{
            marginTop: 12, padding: '10px 14px', borderRadius: 8, fontSize: 14,
            background: restoreMsg.startsWith('✅') ? '#f0fdf4' : '#fffbeb',
            border: `1px solid ${restoreMsg.startsWith('✅') ? '#bbf7d0' : '#fcd34d'}`,
            color: restoreMsg.startsWith('✅') ? '#166534' : '#92400e',
          }}>
            {restoreMsg}
          </div>
        )}

        <div style={{ marginTop: 12, padding: '10px 14px', background: '#fef2f2', borderRadius: 8, border: '1px solid #fecaca', fontSize: 13, color: '#991b1b' }}>
          ⚠️ <strong>Atención:</strong> restaurar un backup reemplaza los datos existentes que tengan el mismo ID. Hacé un backup actual antes de restaurar.
        </div>
      </Section>

      {/* ── modal confirmación ───────────────────────────────────────────────── */}
      {showConfirm && (
        <ConfirmModal
          title={
            showConfirm === 'restore'
              ? 'Restaurar backup'
              : `Generar backup ${showConfirm.toUpperCase()}`
          }
          body={
            showConfirm === 'restore'
              ? `Se importarán los datos de "${restoreFile}". Los registros con el mismo ID serán reemplazados. ¿Continuás?`
              : `Se descargarán todas las tablas en un archivo .${showConfirm}. ¿Continuás?`
          }
          confirmLabel={showConfirm === 'restore' ? 'Restaurar' : 'Descargar'}
          confirmColor={showConfirm === 'restore' ? '#d97706' : 'var(--primary)'}
          onConfirm={() => {
            if (showConfirm === 'restore') confirmRestore()
            else handleBackup(showConfirm)
          }}
          onCancel={() => { setShowConfirm(null); setRestoreData(null); setRestoreFile(null) }}
        />
      )}
    </div>
  )
}

// ── sub-componentes ───────────────────────────────────────────────────────────
function Section({ title, subtitle, children }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 16 }}>{title}</div>
        {subtitle && <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</div>}
      </div>
      {children}
    </div>
  )
}

function BackupCard({ icon, title, desc, color, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '16px 18px',
        border: `1px solid ${color}44`,
        borderRadius: 10,
        background: `${color}08`,
        cursor: disabled ? 'not-allowed' : 'pointer',
        textAlign: 'left',
        opacity: disabled ? 0.6 : 1,
        transition: 'border-color 0.15s, background 0.15s',
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.borderColor = color }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = `${color}44` }}
    >
      <div style={{ fontSize: 22, marginBottom: 6 }}>{icon}</div>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>{desc}</div>
    </button>
  )
}

function Toggle({ value, onChange }) {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{
        width: 48,
        height: 26,
        borderRadius: 13,
        border: 'none',
        background: value ? 'var(--primary)' : 'var(--border)',
        cursor: 'pointer',
        position: 'relative',
        transition: 'background 0.2s',
        flexShrink: 0,
      }}
    >
      <div style={{
        position: 'absolute',
        top: 3,
        left: value ? 25 : 3,
        width: 20,
        height: 20,
        borderRadius: '50%',
        background: 'white',
        transition: 'left 0.2s',
        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
      }} />
    </button>
  )
}

function InfoRow({ label, value, highlight }) {
  return (
    <div style={{ background: 'var(--bg)', borderRadius: 6, padding: '10px 12px', border: '1px solid var(--border)' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>{label.toUpperCase()}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: highlight ? '#d97706' : 'inherit' }}>{value}</div>
    </div>
  )
}

function Spinner() {
  return (
    <div style={{
      width: 16, height: 16, borderRadius: '50%',
      border: '2px solid var(--border)',
      borderTopColor: 'var(--primary)',
      animation: 'spin 0.7s linear infinite',
      flexShrink: 0,
    }} />
  )
}

function ConfirmModal({ title, body, confirmLabel, confirmColor, onConfirm, onCancel }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 300,
      background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div style={{
        background: 'var(--bg)', borderRadius: 10, width: '100%', maxWidth: 400,
        padding: 24, boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
      }}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 10 }}>{title}</div>
        <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 22, lineHeight: 1.5 }}>{body}</div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{ padding: '8px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', fontSize: 14 }}
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            style={{ padding: '8px 20px', background: confirmColor, border: 'none', borderRadius: 6, color: 'white', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
