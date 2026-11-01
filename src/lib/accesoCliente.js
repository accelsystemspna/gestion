import { supabase } from './supabase.js'
import { urlAccesoCliente } from './pedidos.js'

/** Una sola forma para el celular, igual que celular_normalizado en la base. Ej: "+54 9 343 15 610-8660" → 3436108660 */
export function celularNormalizado(t) {
  let d = String(t ?? '').replace(/\D/g, '').replace(/^00/, '')
  if (d.startsWith('54') && d.length >= 12) d = d.slice(2)
  if (d.startsWith('9') && (d.length === 11 || d.length === 13)) d = d.slice(1)
  if (d.startsWith('0')) d = d.slice(1)
  if (d.length === 12) {
    if (d.startsWith('11') && d.slice(2, 4) === '15') d = d.slice(0, 2) + d.slice(4)
    else if (d.slice(3, 5) === '15') d = d.slice(0, 3) + d.slice(5)
    else if (d.slice(4, 6) === '15') d = d.slice(0, 4) + d.slice(6)
  }
  return d
}

/** El panel del cliente y el PIN del pedido necesitan un celular completo (con característica). */
export const celularValido = (t) => celularNormalizado(t).length >= 10

/** Clientes que coinciden con lo escrito: por nombre o, si son números, por celular (en cualquier formato). */
export function filtrarClientes(clientes, texto) {
  const q = String(texto ?? '').trim().toLowerCase()
  if (!q) return clientes
  const digitos = q.replace(/\D/g, '')
  const buscaCelular = digitos.length >= 3 && !/\p{L}/u.test(q)
  const normalizado = celularNormalizado(q)
  const sin15 = digitos.replace(/^(\d{2,4})15/, '$1')   // número a medio escribir con el 15: "343 15 610"
  return clientes.filter((c) => {
    if ((c.nombre || '').toLowerCase().includes(q)) return true
    if (!buscaCelular) return false
    const tel = celularNormalizado(c.telefono)
    return tel.includes(digitos) || tel.includes(normalizado) || tel.includes(sin15)
  })
}

/** Estado del acceso de los clientes del negocio: Map cliente_id → { tiene_pin, link_vigente }. */
export async function cargarEstadosAcceso() {
  const { data, error } = await supabase.rpc('estado_acceso_clientes')
  if (error) throw new Error(error.message)
  return new Map((data || []).map((e) => [e.cliente_id, e]))
}

/** Clientes del negocio con ese celular (para un pedido que no tiene cliente vinculado). */
export async function buscarClientesPorCelular(telefono) {
  const { data, error } = await supabase.rpc('buscar_clientes_por_celular', { p_telefono: telefono })
  if (error) throw new Error(error.message)
  return data || []
}

/** Ficha de una venta: la vinculada o, si no tiene, la única con ese celular (las ventas web suelen venir sin ficha). */
export async function clienteDeVenta(venta) {
  if (venta.cliente_id) return venta.cliente_id
  if (!venta.cliente_telefono) return null
  const encontrados = await buscarClientesPorCelular(venta.cliente_telefono)
  return encontrados.length === 1 ? encontrados[0].id : null
}

/**
 * Genera el link del panel y abre el mensaje de WhatsApp. Cada link nuevo invalida el anterior.
 * Hay que llamarla desde un clic: la ventana se abre antes de esperar al servidor para que el navegador no la bloquee.
 */
export async function mandarAccesoCliente(cliente, orgId, tienePin) {
  const ventana = window.open('', '_blank')
  try {
    const [{ data: marca }, { data: celular }] = await Promise.all([
      supabase.from('branding').select('nombre, url_seguimiento').eq('user_id', orgId).maybeSingle(),
      supabase.rpc('celular_normalizado', { t: cliente.telefono }),
    ])
    if (!marca?.url_seguimiento) throw new Error('Cargá la dirección del sitio en Configuración → Marca.')
    const { data: token, error } = await supabase.rpc('generar_acceso_cliente', { p_cliente: cliente.id })
    if (error) throw new Error(error.message)
    const nombre = (cliente.nombre || '').trim().split(/\s+/)[0]
    const texto = [
      tienePin
        ? `Hola ${nombre}! Desde este link podés cambiar tu PIN de ${marca.nombre || 'nuestro sitio'}:`
        : `Hola ${nombre}! Desde este link podés crear tu PIN y ver tus pedidos en ${marca.nombre || 'nuestro sitio'}:`,
      urlAccesoCliente(token, marca),
      'El link vence en 7 días y sirve una sola vez. Después entrás con tu celular y tu PIN.',
    ].join('\n')
    ventana.location.href = `https://wa.me/549${celular}?text=${encodeURIComponent(texto)}`
  } catch (err) {
    ventana?.close()
    throw err
  }
}
