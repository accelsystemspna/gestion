import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { urlLiviana } from '../lib/imagenes'

// `src` = foto ORIGINAL (es la que se ve al ampliar). Si se pasa `sku`, la miniatura usa la versión liviana de esa foto
// (mucho más chica: ahorra ancho de banda) y, si todavía no existe o falla, cae a la original.
export default function ImageThumb({ src, sku, size = 36, radius = 4, alt = '' }) {
  const [open, setOpen] = useState(false)
  const [sinLiviana, setSinLiviana] = useState(false)

  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open])

  if (!src) return null

  // Miniatura: la liviana (si hay código y no falló) o, si no, la original.
  const mini = (sku && !sinLiviana && urlLiviana(sku, src)) || src

  const overlay = open && createPortal(
    <div
      // Los eventos de React suben por el portal hasta el componente padre aunque el DOM esté en <body>:
      // sin frenarlos, cerrar la foto también disparaba el clic de la fila del producto (ej. agregar al carrito).
      onClick={(e) => { e.stopPropagation(); setOpen(false) }}
      style={{
        position: 'fixed', inset: 0, zIndex: 99999,
        background: 'rgba(0,0,0,0.82)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'zoom-out',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#ffffff',
          borderRadius: 14,
          padding: 16,
          boxShadow: '0 0 0 1px rgba(255,255,255,0.15), 0 8px 32px rgba(0,0,0,0.5), 0 32px 80px rgba(0,0,0,0.4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <img
          src={src}
          alt={alt}
          style={{
            maxWidth: 'min(80vw, 720px)',
            maxHeight: '78vh',
            objectFit: 'contain',
            borderRadius: 6,
            display: 'block',
          }}
        />
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(false) }}
        style={{
          position: 'absolute', top: 18, right: 22,
          background: 'rgba(255,255,255,0.15)',
          border: '1px solid rgba(255,255,255,0.3)',
          color: 'white', borderRadius: '50%',
          width: 36, height: 36, fontSize: 18,
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        ✕
      </button>
    </div>,
    document.body
  )

  return (
    <>
      <img
        src={mini}
        alt={alt}
        loading="lazy"
        decoding="async"
        onError={() => setSinLiviana(true)}
        onClick={(e) => { e.stopPropagation(); setOpen(true) }}
        style={{
          width: size, height: size,
          objectFit: 'contain',
          borderRadius: radius,
          border: '1px solid var(--border)',
          background: '#ffffff',
          display: 'block',
          cursor: 'zoom-in',
          flexShrink: 0,
        }}
      />
      {overlay}
    </>
  )
}
