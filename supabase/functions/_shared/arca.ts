// ARCA (ex AFIP): acceso WSAA y emisión de comprobantes C por WSFE.
// Lo usan emitir-factura (desde el programa) y la facturación automática de Mercado Libre.
// @ts-ignore
import forge from 'npm:node-forge@1.3.1'

// ── URLs ARCA ─────────────────────────────────────────────────────────────────
export const URLS = {
  wsaa: {
    homo: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
    prod: 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
  },
  wsfe: {
    homo: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
    prod: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
  },
}

// ── Fecha Argentina (UTC-3) ────────────────────────────────────────────────────
export function fechaAR(offsetMs = 0): string {
  const d = new Date(Date.now() + offsetMs)
  const ar = new Date(d.getTime() - 3 * 3600 * 1000)
  return ar.toISOString().replace(/\.\d+Z$/, '-03:00')
}

export function fechaHoyARCCYYMMDD(): string {
  const d = new Date()
  const ar = new Date(d.getTime() - 3 * 3600 * 1000)
  return ar.toISOString().slice(0, 10).replace(/-/g, '')
}

// ── Firma PKCS7 para WSAA ─────────────────────────────────────────────────────
export function firmarTRA(traXml: string, certPem: string, keyPem: string): string {
  const p7 = forge.pkcs7.createSignedData()
  p7.content = forge.util.createBuffer(traXml, 'utf8')
  p7.addCertificate(certPem)
  p7.addSigner({
    key:         forge.pki.privateKeyFromPem(keyPem),
    certificate: forge.pki.certificateFromPem(certPem),
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [],
  })
  p7.sign({ detached: false })
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes()
  return forge.util.encode64(der)
}

// ── Obtener token WSAA ────────────────────────────────────────────────────────
export async function getToken(
  certPem: string,
  keyPem: string,
  homo: boolean,
): Promise<{ token: string; sign: string; expiracion: string }> {

  const tra = `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${Math.floor(Date.now() / 1000)}</uniqueId>
    <generationTime>${fechaAR(-60_000)}</generationTime>
    <expirationTime>${fechaAR(600_000)}</expirationTime>
  </header>
  <service>wsfe</service>
</loginTicketRequest>`

  const cms  = firmarTRA(tra, certPem, keyPem)
  const url  = homo ? URLS.wsaa.homo : URLS.wsaa.prod
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov.ar">
  <soapenv:Header/>
  <soapenv:Body>
    <wsaa:loginCms><wsaa:in0>${cms}</wsaa:in0></wsaa:loginCms>
  </soapenv:Body>
</soapenv:Envelope>`

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': '' },
    body,
  })
  const xml = await res.text()

  // ARCA devuelve el XML interno con entidades HTML — decodificar antes de parsear
  const decoded = xml
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&apos;/g, "'")

  const token = decoded.match(/<token>([\s\S]*?)<\/token>/)?.[1]?.trim()
  const sign  = decoded.match(/<sign>([\s\S]*?)<\/sign>/)?.[1]?.trim()

  if (!token || !sign) throw new Error('WSAA error: ' + xml.slice(0, 2000))

  const expiracion = new Date(Date.now() + 11 * 3600 * 1000).toISOString()
  return { token, sign, expiracion }
}

// ── SOAP helper WSFE ──────────────────────────────────────────────────────────
export async function soapWSFE(url: string, action: string, body: string): Promise<string> {
  const res = await fetch(url, {
    method:  'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': `http://ar.gov.afip.dif.FEV1/${action}`,
    },
    body,
  })
  return res.text()
}

// ── Último número autorizado ──────────────────────────────────────────────────
export async function ultimoNro(
  url: string, token: string, sign: string,
  cuit: string, ptoVta: number, cbteTipo: number,
): Promise<number> {
  const xml = await soapWSFE(url, 'FECompUltimoAutorizado', `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soap:Body>
    <ar:FECompUltimoAutorizado>
      <ar:Auth>
        <ar:Token>${token}</ar:Token>
        <ar:Sign>${sign}</ar:Sign>
        <ar:Cuit>${cuit}</ar:Cuit>
      </ar:Auth>
      <ar:PtoVta>${ptoVta}</ar:PtoVta>
      <ar:CbteTipo>${cbteTipo}</ar:CbteTipo>
    </ar:FECompUltimoAutorizado>
  </soap:Body>
</soap:Envelope>`)
  const match = xml.match(/<CbteNro>(\d+)<\/CbteNro>/)
  return match ? parseInt(match[1]) : 0
}

// ── Emitir factura ────────────────────────────────────────────────────────────
export async function emitirFactura(params: {
  url:         string
  token:       string
  sign:        string
  cuit:        string
  ptoVta:      number
  cbteTipo:    number  // 11 = Factura C
  concepto:    number  // 1=Productos 2=Servicios 3=Ambos
  docTipo:     number  // 99=Consumidor Final 80=CUIT
  docNro:      string
  importe:     number
  fecha:       string  // YYYYMMDD
  nroFactura:  number
  // Nota de crédito: la factura que anula (Tipo 11 = Factura C)
  asociado?:   { tipo: number; ptoVta: number; nro: number; cuit: string; fecha: string }
}): Promise<{ cae: string; caeVto: string; nroFactura: number }> {

  const xml = await soapWSFE(params.url, 'FECAESolicitar', `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soap:Body>
    <ar:FECAESolicitar>
      <ar:Auth>
        <ar:Token>${params.token}</ar:Token>
        <ar:Sign>${params.sign}</ar:Sign>
        <ar:Cuit>${params.cuit}</ar:Cuit>
      </ar:Auth>
      <ar:FeCAEReq>
        <ar:FeCabReq>
          <ar:CantReg>1</ar:CantReg>
          <ar:PtoVta>${params.ptoVta}</ar:PtoVta>
          <ar:CbteTipo>${params.cbteTipo}</ar:CbteTipo>
        </ar:FeCabReq>
        <ar:FeDetReq>
          <ar:FECAEDetRequest>
            <ar:Concepto>${params.concepto}</ar:Concepto>
            <ar:DocTipo>${params.docTipo}</ar:DocTipo>
            <ar:DocNro>${params.docNro}</ar:DocNro>
            <ar:CbteDesde>${params.nroFactura}</ar:CbteDesde>
            <ar:CbteHasta>${params.nroFactura}</ar:CbteHasta>
            <ar:CbteFch>${params.fecha}</ar:CbteFch>
            <ar:ImpTotal>${params.importe.toFixed(2)}</ar:ImpTotal>
            <ar:ImpTotConc>0.00</ar:ImpTotConc>
            <ar:ImpNeto>${params.importe.toFixed(2)}</ar:ImpNeto>
            <ar:ImpOpEx>0.00</ar:ImpOpEx>
            <ar:ImpIVA>0.00</ar:ImpIVA>
            <ar:ImpTrib>0.00</ar:ImpTrib>
            <ar:MonId>PES</ar:MonId>
            <ar:MonCotiz>1</ar:MonCotiz>${params.asociado ? `
            <ar:CbtesAsoc>
              <ar:CbteAsoc>
                <ar:Tipo>${params.asociado.tipo}</ar:Tipo>
                <ar:PtoVta>${params.asociado.ptoVta}</ar:PtoVta>
                <ar:Nro>${params.asociado.nro}</ar:Nro>
                <ar:Cuit>${params.asociado.cuit}</ar:Cuit>
                <ar:CbteFch>${params.asociado.fecha}</ar:CbteFch>
              </ar:CbteAsoc>
            </ar:CbtesAsoc>` : ''}
          </ar:FECAEDetRequest>
        </ar:FeDetReq>
      </ar:FeCAEReq>
    </ar:FECAESolicitar>
  </soap:Body>
</soap:Envelope>`)

  const resultado = xml.match(/<Resultado>(.*?)<\/Resultado>/)?.[1]
  if (resultado !== 'A') {
    const obs = [...xml.matchAll(/<Msg>(.*?)<\/Msg>/g)].map(m => m[1]).join(' | ')
    throw new Error('ARCA rechazó el comprobante: ' + (obs || xml.slice(0, 500)))
  }

  const cae    = xml.match(/<CAE>(.*?)<\/CAE>/)?.[1] ?? ''
  const caeVto = xml.match(/<CAEFchVto>(.*?)<\/CAEFchVto>/)?.[1] ?? ''

  // Formatear fecha vto YYYYMMDD → YYYY-MM-DD
  const vtoFmt = caeVto.length === 8
    ? `${caeVto.slice(0,4)}-${caeVto.slice(4,6)}-${caeVto.slice(6,8)}`
    : caeVto

  return { cae, caeVto: vtoFmt, nroFactura: params.nroFactura }
}


/**
 * Config de ARCA del negocio y un acceso (token) vigente para el modo en uso.
 * Uno por modo: ARCA no da un acceso nuevo mientras el anterior sigue vigente.
 */
export async function accesoArca(admin: any, orgId: string) {
  const { data: cfg, error } = await admin.from('arca_config').select('*').eq('user_id', orgId).maybeSingle()
  if (error || !cfg) throw new Error('ARCA no configurado')
  const homo = cfg.modo !== 'produccion'
  const wsfeUrl = homo ? URLS.wsfe.homo : URLS.wsfe.prod
  const sufijo = homo ? '_homo' : ''
  const certPem = homo ? (cfg.cert_pem_homo || cfg.cert_pem) : cfg.cert_pem
  const keyPem = homo ? (cfg.key_pem_homo || cfg.key_pem) : cfg.key_pem
  const { data: cached } = await admin.from('arca_token').select('*').eq('user_id', orgId).maybeSingle()
  let token: string, sign: string
  if (cached?.['token' + sufijo] && cached?.['expiracion' + sufijo] && new Date(cached['expiracion' + sufijo]) > new Date()) {
    token = cached['token' + sufijo]
    sign = cached['sign' + sufijo]
  } else {
    const ta = await getToken(certPem, keyPem, homo)
    token = ta.token
    sign = ta.sign
    await admin.from('arca_token').upsert({
      user_id: orgId, ['token' + sufijo]: token, ['sign' + sufijo]: sign, ['expiracion' + sufijo]: ta.expiracion, updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
  }
  return { cfg, homo, modo: homo ? 'homologacion' : 'produccion', wsfeUrl, token, sign, cuit: String(cfg.cuit).replace(/-/g, ''), ptoVta: Number(cfg.punto_venta) }
}

/** YYYYMMDD → YYYY-MM-DD */
export const fechaISO = (f: string) => `${f.slice(0, 4)}-${f.slice(4, 6)}-${f.slice(6, 8)}`
