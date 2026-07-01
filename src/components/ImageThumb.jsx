import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

export default function ImageThumb({ src, size = 36, radius = 4, alt = '' }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open])

  if (!src) return null

  const overlay = open && createPortal(
    <div
      onClick={() => setOpen(false)}
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
        onClick={() => setOpen(false)}
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
        src={src}
        alt={alt}
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
