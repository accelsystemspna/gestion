export const CONDICIONES_IVA = ['Consumidor Final', 'Responsable Inscripto', 'Responsable Monotributo', 'IVA Exento']

// Código de documento que usa ARCA
export const DOC_CONSUMIDOR = 99
export const DOC_CUIT = 80
export const DOC_CUIL = 86
export const NOMBRE_DOC = { [DOC_CUIT]: 'CUIT', [DOC_CUIL]: 'CUIL' }

export const soloDigitos = (t) => String(t ?? '').replace(/\D/g, '')

export const fmtCuit = (t) => soloDigitos(t).replace(/^(\d{2})(\d{8})(\d)$/, '$1-$2-$3')

/** CUIT o CUIL con 11 números y el último (verificador) correcto. */
export function cuitValido(t) {
  const d = soloDigitos(t)
  if (d.length !== 11) return false
  const suma = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2].reduce((s, p, i) => s + p * Number(d[i]), 0)
  const resto = 11 - (suma % 11)
  return (resto === 11 ? 0 : resto) === Number(d[10]) && resto !== 10
}

/** Receptor de la factura según la ficha del cliente. Sin CUIT o CUIL válido, consumidor final. */
export function receptorDeCliente(c) {
  if (!cuitValido(c?.cuit)) return { docTipo: DOC_CONSUMIDOR, docNro: '', condIva: 'Consumidor Final' }
  return {
    docTipo: c.cuit_tipo === 'CUIL' ? DOC_CUIL : DOC_CUIT,
    docNro: soloDigitos(c.cuit),
    condIva: c.condicion_iva || 'Consumidor Final',
  }
}
