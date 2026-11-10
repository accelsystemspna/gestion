// Corre dentro del programa de escritorio, antes que el sistema, en cada página.
(function () {
  if (window.top !== window) return
  window.__GESTION_ESCRITORIO__ = true

  // Lo que no es el sistema se manda al navegador predeterminado: el programa intercepta
  // la navegación (on_navigation en main.rs), la cancela y la abre afuera.
  function abrirAfuera(url) {
    try { window.location.assign(url) } catch (e) { /* noop */ }
  }
  function esDelSistema(url) {
    try { return new URL(url, location.href).origin === location.origin } catch (e) { return false }
  }

  // Ventanas en blanco que el sistema arma para imprimir (etiquetas, códigos de barra, avisos):
  // se muestran como una ventana dentro del programa, con su botón Cerrar.
  function ventanaInterna() {
    var capa = document.createElement('div')
    capa.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center'
    var caja = document.createElement('div')
    caja.style.cssText = 'width:min(1000px,94vw);height:90vh;background:#fff;border-radius:10px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 12px 40px rgba(0,0,0,.35)'
    var barra = document.createElement('div')
    barra.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;padding:8px 10px;border-bottom:1px solid #e5e5e5;background:#fafafa'
    var marco = document.createElement('iframe')
    marco.style.cssText = 'flex:1;border:0;width:100%;background:#fff'
    function boton(texto, accion) {
      var b = document.createElement('button')
      b.textContent = texto
      b.style.cssText = 'font:500 13px "IBM Plex Sans",Segoe UI,Arial,sans-serif;padding:6px 14px;border:1px solid #cfcfcf;border-radius:6px;background:#fff;cursor:pointer'
      b.onclick = accion
      return b
    }
    function cerrar() { if (capa.isConnected) capa.remove() }
    function imprimir() { try { marco.contentWindow.focus(); marco.contentWindow.print() } catch (e) { /* noop */ } }
    barra.append(boton('Imprimir', imprimir), boton('Cerrar', cerrar))
    caja.append(barra, marco)
    capa.append(caja)
    capa.addEventListener('click', function (e) { if (e.target === capa) cerrar() })
    document.body.append(capa)

    // window.close() desde adentro de la ventana la cierra.
    function preparar() { try { marco.contentWindow.close = cerrar } catch (e) { /* noop */ } }
    preparar()
    marco.addEventListener('load', preparar)

    var irA = function (url) { cerrar(); abrirAfuera(url) }
    return {
      get document() { preparar(); return marco.contentDocument },
      get closed() { return !capa.isConnected },
      print: imprimir,
      close: cerrar,
      focus: function () {},
      location: {
        get href() { return 'about:blank' },
        set href(url) { irA(url) },
        assign: irA,
        replace: irA,
      },
    }
  }

  var abrirOriginal = window.open
  window.open = function (url, destino, opciones) {
    if (!url || url === 'about:blank') return ventanaInterna()
    if (esDelSistema(url)) { window.location.assign(url); return null }
    abrirAfuera(url)
    // El sistema a veces revisa que la ventana se haya abierto: se devuelve algo válido.
    return { closed: true, close: function () {}, focus: function () {}, document: null }
  }
  window.open.original = abrirOriginal

  // Enlaces "abrir en pestaña nueva": afuera si son de otro sitio, en la misma ventana si son del sistema.
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0) return
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null
    if (!a || a.hasAttribute('download')) return
    var href = a.href
    if (!/^https?:/i.test(href)) return
    if (!esDelSistema(href)) { e.preventDefault(); abrirAfuera(href); return }
    if (a.target === '_blank') { e.preventDefault(); window.location.assign(href) }
  }, true)
})()
