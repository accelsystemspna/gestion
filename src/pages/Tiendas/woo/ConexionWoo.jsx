// Estado de la conexión con la tienda: claves de API, aviso de pedidos (webhook) y pedidos que faltan.
import { useEffect, useState } from 'react'
import { invocarWoo, sincronizarPedidos, esLocalUrl, hace } from '../../../lib/wooPanel'
import { Aviso, Tarjeta } from './ui'

const icono = (ok) => (ok === true ? '✅' : ok === false ? '❌' : '⚠️')

export default function ConexionWoo({ tienda, onCambio }) {
  const local = esLocalUrl(tienda.url)
  const [res, setRes] = useState(null)
  const [trabajando, setTrabajando] = useState('')
  const [msg, setMsg] = useState(null)

  const probar = async (opciones) => {
    setTrabajando('probar')
    if (opciones?.conservarMensaje !== true) setMsg(null)
    const r = await invocarWoo('probar', tienda.id)
    setTrabajando('')
    if (!r.checks) setMsg({ tipo: 'error', texto: r.error || 'No se pudo comprobar la conexión.' })
    setRes(r.checks ? r : null)
  }
  // Al abrir la pestaña se comprueba solo la conexión (si la tienda es accesible)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!local) probar() }, [tienda.id])

  const arreglar = async () => {
    if (!window.confirm(`Esto modifica la configuración de WooCommerce de ${tienda.nombre}:\n\n• Activa el webhook "Pedido actualizado" y lo apunta a esta tienda del programa.\n• Crea (o activa) el webhook "Pedido eliminado".\n\n¿Continuar?`)) return
    setTrabajando('arreglar'); setMsg(null)
    const r = await invocarWoo('arreglar_webhook', tienda.id)
    setTrabajando('')
    setMsg({ tipo: r.ok ? 'ok' : 'error', texto: r.ok ? (r.acciones || []).join(' ') : (r.error || (r.acciones || []).join(' ')) })
    probar({ conservarMensaje: true })
  }

  const sincronizar = async () => {
    setTrabajando('sync'); setMsg({ tipo: 'info', texto: 'Importando pedidos de WooCommerce…' })
    const r = await sincronizarPedidos(tienda.id, { onProgreso: ({ pagina, paginas }) => setMsg({ tipo: 'info', texto: `Importando… página ${pagina} de ${paginas}` }) })
    setTrabajando('')
    setMsg(r.ok
      ? { tipo: 'ok', texto: `Listo: ${r.procesados} pedidos revisados · ${r.nuevas_ventas} ventas nuevas · ${r.actualizados} actualizados${r.errores ? ` · ${r.errores} con error` : ''}.` }
      : { tipo: 'error', texto: r.error })
    onCambio?.(); probar({ conservarMensaje: true })
  }

  const wh = res?.webhook
  const hayProblemaWebhook = res?.checks?.some(c => c.id === 'webhook' && c.ok === false)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 820 }}>
      {msg && <Aviso tipo={msg.tipo} onClose={() => setMsg(null)}>{msg.texto}</Aviso>}

      <Tarjeta titulo="Estado de la conexión">
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 10 }}>
          <strong style={{ color: 'var(--text)' }}>{tienda.nombre}</strong> · {tienda.url}
        </div>
        {local ? (
          <Aviso tipo="info">
            Esta tienda es local. Los pedidos llegan por el aviso (webhook) cuando el sitio está en marcha, pero desde internet no se puede consultar ni cambiar nada en ella.
            Para el resto de las funciones usá la tienda real (HTTPS).
          </Aviso>
        ) : !res ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{trabajando === 'probar' ? 'Comprobando…' : 'Sin comprobar todavía.'}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {res.checks.map(c => (
              <div key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13 }}>
                <span style={{ fontSize: 16, lineHeight: '20px' }}>{icono(c.ok)}</span>
                <div><strong>{c.titulo}</strong><div style={{ color: 'var(--text-muted)' }}>{c.detalle}</div></div>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
          <button className="btn btn-sm" onClick={() => probar()} disabled={local || !!trabajando}>{trabajando === 'probar' ? 'Comprobando…' : 'Probar conexión'}</button>
          <button className="btn btn-sm btn-primary" onClick={sincronizar} disabled={local || !!trabajando}>{trabajando === 'sync' ? 'Sincronizando…' : 'Sincronizar pedidos'}</button>
          {hayProblemaWebhook && (
            <button className="btn btn-sm" style={{ borderColor: '#b45309', color: '#b45309' }} onClick={arreglar} disabled={!!trabajando}>
              {trabajando === 'arreglar' ? 'Reparando…' : 'Reparar el aviso de pedidos'}
            </button>
          )}
        </div>
      </Tarjeta>

      <Tarjeta titulo="Actividad">
        <div style={{ fontSize: 13, display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 14px' }}>
          <span style={{ color: 'var(--text-muted)' }}>Último aviso de WooCommerce</span><strong>{hace(res?.ultimo_webhook_en ?? tienda.ultimo_webhook_en)}</strong>
          <span style={{ color: 'var(--text-muted)' }}>Última sincronización manual</span><strong>{hace(res?.ultima_sync_en ?? tienda.ultima_sync_en)}</strong>
          {res?.pedidos_woo != null && <><span style={{ color: 'var(--text-muted)' }}>Pedidos en WooCommerce</span><strong>{res.pedidos_woo}</strong></>}
          {res?.pedidos_programa != null && <><span style={{ color: 'var(--text-muted)' }}>Pedidos en el programa</span><strong>{res.pedidos_programa}</strong></>}
        </div>
      </Tarjeta>

      {wh?.webhooks?.length > 0 && (
        <Tarjeta titulo="Webhooks de WooCommerce que apuntan al programa">
          {wh.webhooks.map(w => (
            <div key={w.id} style={{ fontSize: 13, padding: '4px 0', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <strong>#{w.id}</strong><span>{w.nombre}</span>
              <span style={{ color: w.estado === 'active' ? '#15803d' : '#b91c1c', fontWeight: 700 }}>{w.estado === 'active' ? 'Activo' : w.estado === 'disabled' ? 'Deshabilitado' : w.estado}</span>
              <span style={{ color: 'var(--text-muted)' }}>{w.tema} · tienda {w.tienda_param ?? '?'}{w.fallos ? ` · ${w.fallos} fallos` : ''}</span>
            </div>
          ))}
        </Tarjeta>
      )}

      <Tarjeta titulo="Configuración manual del webhook (si hiciera falta)">
        <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          En WooCommerce → Ajustes → Avanzado → Webhooks: tema <strong>Pedido actualizado</strong> (y otro para <strong>Pedido eliminado</strong>), estado <strong>Activo</strong>,
          secret igual al "Webhook Secret" de la tienda en Configuración → Integraciones, y URL de entrega:
          <code style={{ display: 'block', margin: '6px 0', padding: '6px 8px', background: 'var(--bg-muted)', borderRadius: 6, wordBreak: 'break-all', color: 'var(--text)' }}>
            {(res?.url_webhook) || `https://<proyecto>.functions.supabase.co/woo-order-webhook?tienda=${tienda.id}`}
          </code>
        </div>
      </Tarjeta>
    </div>
  )
}
