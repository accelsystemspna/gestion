import { useEffect, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import IconoMenu from './IconoMenu'

// Menú lateral personalizable: con el candado abierto se arrastran opciones y grupos.

const clonar = (m) => ({ grupos: m.grupos.map((g) => ({ ...g, items: [...g.items] })), ocultos: [...m.ocultos] })

function moverItem(menu, ruta, grupoId, refRuta, despues) {
  const m = clonar(menu)
  m.grupos.forEach((g) => { g.items = g.items.filter((r) => r !== ruta) })
  const destino = m.grupos.find((g) => g.id === grupoId)
  if (!destino) return menu
  const i = refRuta ? destino.items.indexOf(refRuta) : -1
  if (i < 0) destino.items.push(ruta)
  else destino.items.splice(i + (despues ? 1 : 0), 0, ruta)
  return m
}

function moverGrupo(menu, id, refId, despues) {
  const m = clonar(menu)
  const g = m.grupos.find((x) => x.id === id)
  m.grupos = m.grupos.filter((x) => x.id !== id)
  const i = m.grupos.findIndex((x) => x.id === refId)
  m.grupos.splice(Math.max(1, i + (despues ? 1 : 0)), 0, g)
  return m
}

const botonChico = {
  background: 'none', border: 'none', padding: 4, cursor: 'pointer', color: 'var(--text-light)',
  display: 'inline-flex', alignItems: 'center', borderRadius: 6,
}

export default function MenuLateral({ menu, items, editando, guardando, onCambio, onAbrir, onCerrar, onRestablecer, insignias = {} }) {
  const [arrastre, setArrastre] = useState(null) // { tipo: 'item' | 'grupo', id }
  const porRuta = Object.fromEntries(items.map((i) => [i.to, i]))

  const empezar = (e, tipo, id) => {
    e.preventDefault()
    setArrastre({ tipo, id })
  }

  // Mientras se arrastra, el menú se reordena en vivo según lo que hay bajo el puntero.
  // Se escucha en toda la ventana: al reubicar la opción, el elemento cambia de lugar
  // y dejaría de recibir los movimientos y el soltar.
  const mover = (e) => {
    if (!arrastre) return
    const el = document.elementFromPoint(e.clientX, e.clientY)
    if (!el) return
    if (arrastre.tipo === 'item') {
      const it = el.closest('[data-menu-item]')
      if (it) {
        if (it.dataset.menuItem === arrastre.id) return
        const r = it.getBoundingClientRect()
        onCambio(moverItem(menu, arrastre.id, it.dataset.grupo, it.dataset.menuItem, e.clientY > r.top + r.height / 2))
        return
      }
      const zona = el.closest('[data-menu-grupo]')
      if (zona) {
        const g = menu.grupos.find((x) => x.id === zona.dataset.menuGrupo)
        if (g && !g.items.includes(arrastre.id)) onCambio(moverItem(menu, arrastre.id, g.id, null, true))
      }
    } else {
      const zona = el.closest('[data-menu-grupo]')
      if (!zona || zona.dataset.menuGrupo === arrastre.id) return
      const r = zona.getBoundingClientRect()
      onCambio(moverGrupo(menu, arrastre.id, zona.dataset.menuGrupo, e.clientY > r.top + r.height / 2))
    }
  }
  const moverRef = useRef(mover)
  useEffect(() => { moverRef.current = mover })
  useEffect(() => {
    if (!arrastre) return
    const alMover = (e) => moverRef.current(e)
    const alSoltar = () => setArrastre(null)
    window.addEventListener('pointermove', alMover)
    window.addEventListener('pointerup', alSoltar)
    window.addEventListener('pointercancel', alSoltar)
    return () => {
      window.removeEventListener('pointermove', alMover)
      window.removeEventListener('pointerup', alSoltar)
      window.removeEventListener('pointercancel', alSoltar)
    }
  }, [arrastre])

  const agarre = (tipo, id, titulo) => (
    <span
      role="button"
      aria-label={titulo}
      title={titulo}
      onPointerDown={(e) => empezar(e, tipo, id)}
      style={{ ...botonChico, cursor: arrastre ? 'grabbing' : 'grab', touchAction: 'none', padding: 2 }}
    >
      <IconoMenu nombre="agarre" size={16} />
    </span>
  )

  const renombrar = (id, nombre) => {
    const m = clonar(menu)
    m.grupos.find((g) => g.id === id).nombre = nombre
    onCambio(m)
  }
  const borrarGrupo = (id) => {
    const m = clonar(menu)
    const g = m.grupos.find((x) => x.id === id)
    m.grupos[0].items.push(...g.items)
    m.grupos = m.grupos.filter((x) => x.id !== id)
    onCambio(m)
  }
  const nuevoGrupo = () => {
    const m = clonar(menu)
    m.grupos.push({ id: 'g-' + Date.now().toString(36), nombre: 'Nuevo grupo', items: [] })
    onCambio(m)
  }
  const alternarOculto = (ruta) => {
    const m = clonar(menu)
    m.ocultos = m.ocultos.includes(ruta) ? m.ocultos.filter((r) => r !== ruta) : [...m.ocultos, ruta]
    onCambio(m)
  }

  const fila = (item, grupoId) => {
    const oculto = menu.ocultos.includes(item.to)
    const insignia = insignias[item.to]
    if (editando) {
      return (
        <div key={item.to} data-menu-item={item.to} data-grupo={grupoId}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px', borderRadius: 8, fontSize: 14,
            color: 'var(--text-muted)', opacity: oculto ? 0.45 : 1,
            background: arrastre?.id === item.to ? 'var(--accent-tenue)' : 'transparent',
          }}>
          {agarre('item', item.to, 'Arrastrar ' + item.label)}
          <IconoMenu nombre={item.icono} />
          <span style={{ flex: 1, textDecoration: oculto ? 'line-through' : 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>
          <button type="button" onClick={() => alternarOculto(item.to)} style={botonChico}
            title={oculto ? 'Mostrar en el menú' : 'Ocultar del menú'} aria-label={oculto ? 'Mostrar ' + item.label : 'Ocultar ' + item.label}>
            <IconoMenu nombre={oculto ? 'ojoTachado' : 'ojo'} size={16} />
          </button>
        </div>
      )
    }
    return (
      <NavLink key={item.to} to={item.to} className="menu-item"
        style={({ isActive }) => ({
          display: 'flex', alignItems: 'center', gap: 12, padding: '8px 10px', borderRadius: 8, fontSize: 14,
          fontWeight: isActive ? 600 : 400,
          color: isActive ? 'var(--text)' : 'var(--text-muted)',
          background: isActive ? 'var(--accent-tenue)' : 'transparent',
          transition: 'background 0.12s, color 0.12s',
        })}>
        <IconoMenu nombre={item.icono} />
        {item.label}
        {insignia > 0 && (
          <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, color: 'var(--accent)' }}>{insignia}</span>
        )}
      </NavLink>
    )
  }

  return (
    <>
      <nav style={{ flex: 1, padding: '0 10px 12px', display: 'flex', flexDirection: 'column', overflowY: 'auto', userSelect: editando ? 'none' : undefined }}>
        {menu.grupos.map((g) => {
          const filas = g.items.map((r) => porRuta[r]).filter(Boolean).filter((i) => editando || !menu.ocultos.includes(i.to))
          const esSueltos = g.id === 'sueltos'
          if (!editando && !filas.length) return null
          return (
            <div key={g.id} data-menu-grupo={g.id}
              style={{
                marginBottom: 10, borderRadius: 8, flexShrink: 0,
                ...(editando ? { border: '1px dashed var(--border-strong)', padding: '4px 4px 8px', minHeight: 44, background: arrastre?.id === g.id ? 'var(--accent-tenue)' : 'transparent' } : {}),
              }}>
              {editando ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 2px 6px' }}>
                  {esSueltos ? (
                    <span style={{ padding: '2px 6px', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-light)' }}>Sin grupo</span>
                  ) : (
                    <>
                      {agarre('grupo', g.id, 'Arrastrar el grupo ' + g.nombre)}
                      <input value={g.nombre} onChange={(e) => renombrar(g.id, e.target.value)} aria-label="Nombre del grupo"
                        style={{ flex: 1, minWidth: 0, border: '1px solid var(--border)', borderRadius: 6, padding: '3px 6px', fontSize: 11, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', background: 'var(--bg-card)', fontFamily: 'inherit' }} />
                      <button type="button" onClick={() => borrarGrupo(g.id)} style={botonChico}
                        title="Borrar el grupo (sus opciones quedan sin grupo)" aria-label={'Borrar el grupo ' + g.nombre}>
                        <IconoMenu nombre="cerrar" size={15} />
                      </button>
                    </>
                  )}
                </div>
              ) : !esSueltos && g.nombre.trim() ? (
                <div style={{ padding: '10px 10px 6px', fontSize: 11, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-light)' }}>{g.nombre}</div>
              ) : null}
              {filas.map((i) => fila(i, g.id))}
              {editando && !filas.length && (
                <div style={{ padding: '6px 8px', fontSize: 12, color: 'var(--text-light)' }}>Arrastrá opciones acá</div>
              )}
            </div>
          )
        })}
        {editando && (
          <button type="button" onClick={nuevoGrupo}
            style={{ ...botonChico, gap: 6, padding: '8px 10px', fontSize: 13, color: 'var(--text-muted)', border: '1px dashed var(--border-strong)', justifyContent: 'center', borderRadius: 8, flexShrink: 0 }}>
            <IconoMenu nombre="mas" size={15} /> Nuevo grupo
          </button>
        )}
      </nav>

      <div style={{ padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 6, borderTop: '1px solid var(--border)' }}>
        {editando ? (
          <>
            <button type="button" onClick={onCerrar} disabled={guardando}
              style={{ ...botonChico, gap: 6, padding: '6px 8px', fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}
              title="Guardar el menú y bloquearlo">
              <IconoMenu nombre="candadoAbierto" size={16} /> {guardando ? 'Guardando…' : 'Guardar'}
            </button>
            <button type="button" onClick={onRestablecer} disabled={guardando}
              style={{ ...botonChico, marginLeft: 'auto', fontSize: 12, padding: '6px 4px' }}
              title="Volver al orden de fábrica">
              Restablecer
            </button>
          </>
        ) : (
          <button type="button" onClick={onAbrir}
            style={{ ...botonChico, gap: 6, padding: '6px 8px', fontSize: 12 }}
            title="Desbloquear para ordenar el menú">
            <IconoMenu nombre="candado" size={15} /> Ordenar menú
          </button>
        )}
      </div>
    </>
  )
}
