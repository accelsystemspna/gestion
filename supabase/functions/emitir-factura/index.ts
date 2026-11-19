// Supabase Edge Function — emitir-factura
// Autentica con WSAA de ARCA y emite Factura C via WSFE
import { serve }        from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { URLS, getToken, ultimoNro, emitirFactura, fechaHoyARCCYYMMDD, accesoArca, fechaISO } from '../_shared/arca.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

    // Identificar el negocio del que llama (cada uno factura con SU propio CUIT/certificado).
    const authHeader = req.headers.get('Authorization') ?? ''
    const { data: { user } } = await supabaseClient.auth.getUser(authHeader.replace(/^Bearer /i, ''))
    if (!user) {
      return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401,
      })
    }
    const { data: perfil } = await supabaseClient.from('profiles').select('org_id').eq('id', user.id).maybeSingle()
    const orgId = perfil?.org_id ?? user.id

    // Cargar config ARCA (la de esta organización, no la de otra)
    const { data: cfg, error: cfgErr } = await supabaseClient
      .from('arca_config').select('*').eq('user_id', orgId).maybeSingle()

    if (cfgErr || !cfg) {
      return new Response(JSON.stringify({ ok: false, error: 'ARCA no configurado' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const homo    = cfg.modo !== 'produccion'
    const wsfeUrl = homo ? URLS.wsfe.homo : URLS.wsfe.prod

    // ── Obtener token (cache) ────────────────────────────────────────────────
    // Uno por modo: ARCA no da un acceso nuevo mientras el anterior sigue vigente, así que pasar a
    // homologación para probar no puede pisar el de producción.
    let token: string, sign: string
    const sufijo = homo ? '_homo' : ''
    // En homologación se usa su propio certificado, si está cargado
    const certPem = homo ? (cfg.cert_pem_homo || cfg.cert_pem) : cfg.cert_pem
    const keyPem  = homo ? (cfg.key_pem_homo || cfg.key_pem) : cfg.key_pem

    const { data: cached } = await supabaseClient
      .from('arca_token').select('*').eq('user_id', orgId).maybeSingle()

    const ahora = new Date()
    if (cached?.['token' + sufijo] && cached?.['expiracion' + sufijo] && new Date(cached['expiracion' + sufijo]) > ahora) {
      token = cached['token' + sufijo]
      sign  = cached['sign' + sufijo]
    } else {
      const ta = await getToken(certPem, keyPem, homo)
      token = ta.token
      sign  = ta.sign
      await supabaseClient.from('arca_token').upsert({
        user_id: orgId, ['token' + sufijo]: token, ['sign' + sufijo]: sign, ['expiracion' + sufijo]: ta.expiracion, updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })
    }

    // ── Acción ───────────────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}))

    // Test de conexión — solo verificar que el token funcione
    if (body.accion === 'test') {
      return new Response(JSON.stringify({ ok: true, modo: cfg.modo }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Factura de una parte: seña o saldo (también sirve por el total) ────────
    // El importe se reserva en la base antes de pedir el CAE, así nunca se factura más que el total.
    if (body.accion === 'emitir_parcial') {
      const responder = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status,
      })
      const ventaId  = body.venta_id ? Number(body.venta_id) : null
      const pedidoId = typeof body.pedido_id === 'string' ? body.pedido_id : null
      const concepto = String(body.concepto ?? '')
      const monto    = Math.round(Number(body.importe) * 100) / 100
      const detalle  = String(body.detalle ?? '').trim().slice(0, 200)
      const docTipo  = Number(body.doc_tipo ?? 99)
      const docNro   = docTipo === 99 ? '0' : String(body.doc_nro ?? '').replace(/\D/g, '')
      if (!['sena', 'saldo', 'total'].includes(concepto)) return responder({ ok: false, error: 'Concepto inválido.' }, 400)
      if (!Number.isFinite(monto) || monto <= 0) return responder({ ok: false, error: 'El importe tiene que ser mayor a cero.' }, 400)
      if (!detalle) return responder({ ok: false, error: 'Falta el detalle de la factura.' }, 400)
      if (!/^[0-9a-f-]{36}$/i.test(String(body.solicitud_id ?? ''))) return responder({ ok: false, error: 'Solicitud inválida.' }, 400)
      if (![80, 86, 99].includes(docTipo) || (docTipo !== 99 && docNro.length !== 11)) return responder({ ok: false, error: 'Documento del cliente inválido.' }, 400)

      const { data: reserva, error: errReserva } = await supabaseClient.rpc('reservar_factura', {
        p_org: orgId, p_venta: ventaId, p_pedido: pedidoId, p_concepto: concepto, p_importe: monto,
        p_solicitud: body.solicitud_id, p_modo: homo ? 'homologacion' : 'produccion', p_detalle: detalle,
        p_doc_tipo: docTipo, p_doc_nro: docTipo === 99 ? null : docNro, p_cond_iva: body.cond_iva ?? null,
      })
      if (errReserva) return responder({ ok: false, error: errReserva.message }, 400)
      if (!reserva.nueva) {
        const { data: previa } = await supabaseClient.from('facturas').select('*').eq('id', reserva.id).single()
        if (previa?.estado === 'emitida') return responder({ ok: true, factura: previa })
        return responder({ ok: false, error: previa?.estado === 'fallida' ? (previa.error || 'ARCA no la autorizó.') : 'Esa factura se está emitiendo. Esperá un momento y actualizá.' }, 409)
      }

      try {
        const ptoVtaP = Number(cfg.punto_venta)
        const nro = (await ultimoNro(wsfeUrl, token, sign, cfg.cuit.replace(/-/g, ''), ptoVtaP, 11)) + 1
        const fechaArca = fechaHoyARCCYYMMDD()
        const r = await emitirFactura({
          url: wsfeUrl, token, sign, cuit: cfg.cuit.replace(/-/g, ''), ptoVta: ptoVtaP,
          cbteTipo: 11, concepto: cfg.concepto ?? 1, docTipo, docNro,
          importe: monto, fecha: fechaArca, nroFactura: nro,
        })
        const { data: factura, error: errGuardar } = await supabaseClient.from('facturas').update({
          estado: 'emitida', cae: r.cae, cae_vto: r.caeVto, nro_factura: r.nroFactura, punto_venta: ptoVtaP,
          fecha: `${fechaArca.slice(0, 4)}-${fechaArca.slice(4, 6)}-${fechaArca.slice(6, 8)}`,
        }).eq('id', reserva.id).select('*').single()
        // ARCA ya la autorizó: aunque no se pueda guardar, se devuelve el CAE para no perderlo.
        if (errGuardar) console.error('[emitir-factura] CAE sin guardar', reserva.id, r, errGuardar)
        return responder({ ok: true, factura: factura ?? { id: reserva.id, ...r } })
      } catch (err) {
        await supabaseClient.from('facturas').update({ estado: 'fallida', error: String(err?.message ?? err).slice(0, 500) }).eq('id', reserva.id)
        return responder({ ok: false, error: err?.message ?? String(err) })
      }
    }

    // ── Nota de crédito C: anula total o parcialmente una factura emitida ──────
    // Se asocia a la factura de la venta (ventas.nro_factura) o a una factura por partes (factura_id).
    if (body.accion === 'nota_credito') {
      const responder = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status,
      })
      const ventaId = Number(body.venta_id)
      const facturaId = typeof body.factura_id === 'string' && body.factura_id ? body.factura_id : null
      const monto = Math.round(Number(body.importe) * 100) / 100
      const motivo = String(body.motivo ?? '').trim().slice(0, 200)
      if (!ventaId) return responder({ ok: false, error: 'Falta la venta.' }, 400)
      if (!Number.isFinite(monto) || monto <= 0) return responder({ ok: false, error: 'El importe tiene que ser mayor a cero.' }, 400)
      if (!motivo) return responder({ ok: false, error: 'Contá el motivo (ej: devolución).' }, 400)
      if (!/^[0-9a-f-]{36}$/i.test(String(body.solicitud_id ?? ''))) return responder({ ok: false, error: 'Solicitud inválida.' }, 400)

      const { data: venta } = await supabaseClient.from('ventas')
        .select('id, total, fecha, factura_emitida, nro_factura, factura_fecha, factura_doc_tipo, factura_doc_nro, factura_cond_iva')
        .eq('id', ventaId).eq('org_id', orgId).maybeSingle()
      if (!venta) return responder({ ok: false, error: 'No se encontró la venta.' }, 404)

      const modoAhora = homo ? 'homologacion' : 'produccion'
      let asoc: { pto: number, nro: number, fecha: string, docTipo: number, docNro: string, condIva: string | null, tope: number }
      if (facturaId) {
        const { data: fa } = await supabaseClient.from('facturas').select('*').eq('id', facturaId).eq('venta_id', ventaId).maybeSingle()
        if (!fa || fa.estado !== 'emitida') return responder({ ok: false, error: 'Esa factura no está emitida.' }, 400)
        if (fa.modo !== modoAhora) return responder({ ok: false, error: 'Esa factura es de otro modo de ARCA (prueba / producción).' }, 400)
        asoc = { pto: Number(fa.punto_venta), nro: Number(fa.nro_factura), fecha: String(fa.fecha), docTipo: Number(fa.doc_tipo ?? 99), docNro: fa.doc_nro ?? '0', condIva: fa.cond_iva ?? null, tope: Number(fa.importe) }
      } else {
        if (!venta.factura_emitida || !venta.nro_factura) return responder({ ok: false, error: 'La venta no tiene factura emitida.' }, 400)
        asoc = {
          pto: Number(cfg.punto_venta), nro: Number(venta.nro_factura), fecha: String(venta.factura_fecha || venta.fecha).slice(0, 10),
          docTipo: Number(venta.factura_doc_tipo ?? 99), docNro: venta.factura_doc_nro || '0', condIva: venta.factura_cond_iva ?? null, tope: Number(venta.total),
        }
      }
      if (asoc.docTipo === 99) asoc.docNro = '0'

      const { data: reserva, error: errReserva } = await supabaseClient.rpc('reservar_nota_credito', {
        p_org: orgId, p_venta: ventaId, p_factura: facturaId, p_importe: monto, p_motivo: motivo, p_solicitud: body.solicitud_id,
        p_modo: modoAhora, p_doc_tipo: asoc.docTipo, p_doc_nro: asoc.docTipo === 99 ? null : asoc.docNro, p_cond_iva: asoc.condIva,
        p_asoc_pto: asoc.pto, p_asoc_nro: asoc.nro, p_asoc_fecha: asoc.fecha, p_tope: asoc.tope,
      })
      if (errReserva) return responder({ ok: false, error: errReserva.message }, 400)
      if (!reserva.nueva) {
        const { data: previa } = await supabaseClient.from('notas_credito').select('*').eq('id', reserva.id).single()
        if (previa?.estado === 'emitida') return responder({ ok: true, nota: previa })
        return responder({ ok: false, error: previa?.estado === 'fallida' ? (previa.error || 'ARCA no la autorizó.') : 'Esa nota de crédito se está emitiendo. Esperá un momento y actualizá.' }, 409)
      }

      try {
        const cuitE = cfg.cuit.replace(/-/g, '')
        const pto = Number(cfg.punto_venta)
        const nro = (await ultimoNro(wsfeUrl, token, sign, cuitE, pto, 13)) + 1
        const fechaArca = fechaHoyARCCYYMMDD()
        const r = await emitirFactura({
          url: wsfeUrl, token, sign, cuit: cuitE, ptoVta: pto, cbteTipo: 13, concepto: cfg.concepto ?? 1,
          docTipo: asoc.docTipo, docNro: asoc.docNro, importe: monto, fecha: fechaArca, nroFactura: nro,
          asociado: { tipo: 11, ptoVta: asoc.pto, nro: asoc.nro, cuit: cuitE, fecha: asoc.fecha.replace(/-/g, '') },
        })
        const { data: nota, error: errG } = await supabaseClient.from('notas_credito').update({
          estado: 'emitida', cae: r.cae, cae_vto: r.caeVto, nro: r.nroFactura, punto_venta: pto, fecha: fechaISO(fechaArca),
        }).eq('id', reserva.id).select('*').single()
        if (errG) console.error('[emitir-factura] NC sin guardar', reserva.id, r, errG)
        return responder({ ok: true, nota: nota ?? { id: reserva.id, ...r } })
      } catch (err) {
        await supabaseClient.from('notas_credito').update({ estado: 'fallida', error: String(err?.message ?? err).slice(0, 500) }).eq('id', reserva.id)
        return responder({ ok: false, error: err?.message ?? String(err) })
      }
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

    // La venta tiene que ser de este negocio, y sin facturas por partes (seña o saldo)
    const { data: ventaPropia } = await supabaseClient.from('ventas').select('id').eq('id', venta_id).eq('org_id', orgId).maybeSingle()
    if (!ventaPropia) {
      return new Response(JSON.stringify({ ok: false, error: 'No se encontró la venta.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404,
      })
    }
    const { data: partes, error: errPartes } = await supabaseClient.from('facturas').select('id')
      .eq('venta_id', venta_id).eq('modo', homo ? 'homologacion' : 'produccion').in('estado', ['pendiente', 'emitida']).limit(1)
    if (!errPartes && partes?.length) {
      return new Response(JSON.stringify({ ok: false, error: 'Esta venta ya tiene facturas de seña o saldo: facturá lo que falta desde ahí.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
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
