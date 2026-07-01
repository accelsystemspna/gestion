// Supabase Edge Function — emitir-factura
// Autentica con WSAA de ARCA y emite Factura C via WSFE
import { serve }        from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// @ts-ignore
import forge            from 'npm:node-forge@1.3.1'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── URLs ARCA ─────────────────────────────────────────────────────────────────
const URLS = {
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
function fechaAR(offsetMs = 0): string {
  const d = new Date(Date.now() + offsetMs)
  const ar = new Date(d.getTime() - 3 * 3600 * 1000)
  return ar.toISOString().replace(/\.\d+Z$/, '-03:00')
}

function fechaHoyARCCYYMMDD(): string {
  const d = new Date()
  const ar = new Date(d.getTime() - 3 * 3600 * 1000)
  return ar.toISOString().slice(0, 10).replace(/-/g, '')
}

// ── Firma PKCS7 para WSAA ─────────────────────────────────────────────────────
function firmarTRA(traXml: string, certPem: string, keyPem: string): string {
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
async function getToken(
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
async function soapWSFE(url: string, action: string, body: string): Promise<string> {
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
async function ultimoNro(
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
async function emitirFactura(params: {
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
            <ar:MonCotiz>1</ar:MonCotiz>
          </ar:FECAEDetRequest>
        </ar:FeDetReq>
      </ar:FeCAEReq>
    </ar:FECAESolicitar>
  </soap:Body>
</soap:Envelope>`)

  const resultado = xml.match(/<Resultado>(.*?)<\/Resultado>/)?.[1]
  if (resultado !== 'A') {
    const obs = [...xml.matchAll(/<Msg>(.*?)<\/Msg>/g)].map(m => m[1]).join(' | ')
    throw new Error('ARCA rechazó la factura: ' + (obs || xml.slice(0, 500)))
  }

  const cae    = xml.match(/<CAE>(.*?)<\/CAE>/)?.[1] ?? ''
  const caeVto = xml.match(/<CAEFchVto>(.*?)<\/CAEFchVto>/)?.[1] ?? ''

  // Formatear fecha vto YYYYMMDD → YYYY-MM-DD
  const vtoFmt = caeVto.length === 8
    ? `${caeVto.slice(0,4)}-${caeVto.slice(4,6)}-${caeVto.slice(6,8)}`
    : caeVto

  return { cae, caeVto: vtoFmt, nroFactura: params.nroFactura }
}

// ── Handler principal ─────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Cargar config ARCA
    const { data: cfg, error: cfgErr } = await supabaseClient
      .from('arca_config').select('*').eq('id', 1).single()

    if (cfgErr || !cfg) {
      return new Response(JSON.stringify({ ok: false, error: 'ARCA no configurado' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const homo    = cfg.modo !== 'produccion'
    const wsfeUrl = homo ? URLS.wsfe.homo : URLS.wsfe.prod

    // ── Obtener token (cache) ────────────────────────────────────────────────
    let token: string, sign: string

    const { data: cached } = await supabaseClient
      .from('arca_token').select('*').eq('id', 1).maybeSingle()

    const ahora = new Date()
    if (cached?.token && cached?.expiracion && new Date(cached.expiracion) > ahora) {
      token = cached.token
      sign  = cached.sign
    } else {
      const ta = await getToken(cfg.cert_pem, cfg.key_pem, homo)
      token = ta.token
      sign  = ta.sign
      await supabaseClient.from('arca_token').upsert({
        id: 1, token, sign, expiracion: ta.expiracion, updated_at: new Date().toISOString(),
      })
    }

    // ── Acción ───────────────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}))

    // Test de conexión — solo verificar que el token funcione
    if (body.accion === 'test') {
      return new Response(JSON.stringify({ ok: true, modo: cfg.modo }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Emitir factura
    const {
      venta_id,
      importe,
      concepto  = cfg.concepto ?? 1,
      doc_tipo  = 99,
      doc_nro   = '0',
    } = body

    if (!venta_id || !importe) {
      return new Response(JSON.stringify({ ok: false, error: 'Faltan parámetros: venta_id, importe' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      })
    }

    const cuit     = cfg.cuit.replace(/-/g, '')
    const ptoVta   = Number(cfg.punto_venta)
    const cbteTipo = 11  // Factura C

    // Último número autorizado → siguiente
    const ultimo     = await ultimoNro(wsfeUrl, token, sign, cuit, ptoVta, cbteTipo)
    const nroFactura = ultimo + 1

    // Emitir
    const resultado = await emitirFactura({
      url: wsfeUrl, token, sign, cuit, ptoVta,
      cbteTipo, concepto, docTipo: doc_tipo, docNro: doc_nro,
      importe: Number(importe),
      fecha: fechaHoyARCCYYMMDD(),
      nroFactura,
    })

    // Guardar en DB
    await supabaseClient.from('ventas').update({
      cae:             resultado.cae,
      cae_vto:         resultado.caeVto,
      nro_factura:     resultado.nroFactura,
      factura_emitida: true,
    }).eq('id', venta_id)

    return new Response(JSON.stringify({ ok: true, ...resultado }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error('[emitir-factura]', err)
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
