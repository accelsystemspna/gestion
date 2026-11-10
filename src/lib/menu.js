// Menú lateral personalizable: orden de fábrica y normalización de lo que guarda cada usuario.
// Se guarda en profiles.menu_config (null = orden de fábrica). El grupo "sueltos" (sin título)
// va siempre primero: ahí caen las opciones de un grupo borrado y las que se agreguen al programa.

export const MENU_FABRICA = {
  grupos: [
    { id: 'sueltos', nombre: '', items: [] },
    { id: 'g-ventas', nombre: 'Ventas', items: ['/ventas', '/pedidos', '/presupuesto', '/tiendas'] },
    { id: 'g-clientes', nombre: 'Clientes', items: ['/clientes', '/facturas'] },
    { id: 'g-catalogo', nombre: 'Catálogo', items: ['/productos', '/materiales'] },
    { id: 'g-admin', nombre: 'Administración', items: ['/configuracion', '/dashboard'] },
  ],
  ocultos: [],
}

// Deja la configuración guardada en una forma válida para las rutas que existen hoy.
export function normalizarMenu(cfg, rutas) {
  const fuente = cfg && Array.isArray(cfg.grupos) ? cfg : MENU_FABRICA
  const vistos = new Set()
  let grupos = fuente.grupos
    .filter((g) => g && g.id)
    .map((g) => ({
      id: String(g.id),
      nombre: String(g.nombre ?? ''),
      items: (Array.isArray(g.items) ? g.items : []).filter((r) => rutas.includes(r) && !vistos.has(r) && vistos.add(r)),
    }))
  const sueltos = grupos.find((g) => g.id === 'sueltos') || { id: 'sueltos', nombre: '', items: [] }
  grupos = [sueltos, ...grupos.filter((g) => g.id !== 'sueltos')]
  sueltos.items.push(...rutas.filter((r) => !vistos.has(r)))
  const ocultos = (Array.isArray(fuente.ocultos) ? fuente.ocultos : []).filter((r) => rutas.includes(r))
  return { grupos, ocultos }
}
