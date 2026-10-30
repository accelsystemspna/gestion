import { supabase } from './supabase.js'

/**
 * Guarda un PDF en los documentos del cliente, para que lo vea en su panel (bucket privado: se abre con link firmado).
 * Mejor esfuerzo: si falla, avisa por consola y no corta lo que se estaba haciendo (emitir la factura, crear el pedido).
 * @param {{ orgId: string, clienteId: string, pedidoId?: string|null, tipo: 'presupuesto'|'factura'|'recibo', titulo: string, total?: number, blob: Blob }} doc
 * @returns {Promise<boolean>} si quedó guardado
 */
export async function guardarDocumentoCliente({ orgId, clienteId, pedidoId = null, tipo, titulo, total = 0, blob }) {
  try {
    // El cliente ve esta ruta en el link firmado: no puede llevar ids. La carpeta coincide con la regla del bucket.
    const huella = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(orgId))
    const carpeta = [...new Uint8Array(huella)].map((b) => b.toString(16).padStart(2, '0')).join('')
    const ruta = `${carpeta}/${crypto.randomUUID()}.pdf`
    const { error: errorArchivo } = await supabase.storage.from('documentos-clientes').upload(ruta, blob, { contentType: 'application/pdf' })
    if (errorArchivo) throw errorArchivo
    const { error } = await supabase.from('cliente_documentos').insert({ org_id: orgId, cliente_id: clienteId, pedido_id: pedidoId, tipo, titulo, total: Number(total) || 0, ruta })
    if (error) {
      await supabase.storage.from('documentos-clientes').remove([ruta])
      throw error
    }
    return true
  } catch (err) {
    console.warn('[documentos] no se pudo guardar', titulo, err)
    return false
  }
}
