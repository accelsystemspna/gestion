import { useMemo, useRef, useState } from 'react'
import { celularValido, filtrarClientes } from '../lib/accesoCliente'

const avatar = (tam, fuente) => ({ width: tam, height: tam, borderRadius: '50%', background: 'var(--primary)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: fuente, fontWeight: 800, flexShrink: 0 })

/**
 * Busca un cliente por nombre o celular. Si no está, se ofrece crearlo con lo que se escribió.
 * `texto` queda aunque no se elija a nadie: sirve de nombre para sacar un PDF suelto.
 */
export default function ClienteSelector({ clientes, cargando, texto, seleccionado, onTexto, onElegir, onLimpiar, onCrear, onCargarCelular, inputStyle }) {
  const [abierto, setAbierto] = useState(false)
  const [rect, setRect] = useState(null)
  const inputRef = useRef(null)

  const sugerencias = useMemo(() => filtrarClientes(clientes, texto).slice(0, 8), [clientes, texto])

  if (seleccionado) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 10px', border: '1px solid var(--primary)', borderRadius: 6, background: 'var(--bg-highlight)' }}>
        <div style={avatar(26, 12)}>{(seleccionado.nombre || '?').charAt(0).toUpperCase()}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{seleccionado.nombre}</div>
          {celularValido(seleccionado.telefono)
            ? <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{seleccionado.telefono}</div>
            : <button type="button" onClick={onCargarCelular} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 11, fontWeight: 600, color: '#b45309', textDecoration: 'underline' }}>Falta el celular: cargarlo</button>}
        </div>
        <button type="button" title="Cambiar cliente" onClick={onLimpiar} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 15, padding: '0 2px', lineHeight: 1 }}>✕</button>
      </div>
    )
  }

  return (
    <>
      <input
        ref={inputRef}
        className="input"
        style={inputStyle}
        value={texto}
        onChange={(e) => onTexto(e.target.value)}
        onFocus={() => {
          if (inputRef.current) {
            const r = inputRef.current.getBoundingClientRect()
            setRect({ top: r.bottom, left: r.left, width: r.width })
          }
          setAbierto(true)
        }}
        onBlur={() => setTimeout(() => setAbierto(false), 200)}
        placeholder="Buscá por nombre o celular"
        autoComplete="off"
      />
      {/* Dropdown con position:fixed — escapa cualquier overflow:hidden del árbol padre */}
      {abierto && rect && (
        <div style={{ position: 'fixed', top: rect.top, left: rect.left, width: rect.width, zIndex: 9999, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-card)', boxShadow: '0 8px 24px rgba(0,0,0,0.14)', maxHeight: 300, overflowY: 'auto' }}>
          {cargando ? (
            <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-muted)' }}>Cargando clientes...</div>
          ) : sugerencias.map((c) => (
            <div key={c.id}
              onMouseDown={(e) => { e.preventDefault(); setAbierto(false); onElegir(c) }}
              style={{ padding: '9px 12px', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 9, borderBottom: '1px solid var(--border)' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-highlight)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-card)' }}
            >
              <div style={avatar(28, 12)}>{(c.nombre || '?').charAt(0).toUpperCase()}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{c.nombre}</div>
                {c.telefono && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.telefono}</div>}
              </div>
            </div>
          ))}
          {!cargando && (
            <div
              onMouseDown={(e) => { e.preventDefault(); setAbierto(false); onCrear(texto.trim()) }}
              style={{ padding: '10px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: 'var(--primary)' }}
            >
              + Crear cliente{texto.trim() ? ` "${texto.trim()}"` : ''}
            </div>
          )}
        </div>
      )}
    </>
  )
}
