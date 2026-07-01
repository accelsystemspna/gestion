export const fmtMoney = (n) =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
  }).format(Number(n) || 0)

export const fmtNum = (n, dec = 2) =>
  new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  }).format(Number(n) || 0)

export const padId = (id) => `#${String(id).padStart(3, '0')}`
