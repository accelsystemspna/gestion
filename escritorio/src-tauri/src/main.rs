// Gestión CC Design — programa de escritorio para Windows.
// Abre el sistema publicado (gestion.ccdesign.com.ar) en su propia ventana, sin Chrome
// ni extensiones. Cada cambio que se publica en la web se ve acá sin reinstalar.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{WebviewUrl, WebviewWindowBuilder};

const SITIO: &str = "https://gestion.ccdesign.com.ar/";
const HOST: &str = "gestion.ccdesign.com.ar";

// Se ejecuta en cada página antes que el sistema: avisa que corre en el programa de escritorio
// y adapta los enlaces y ventanas emergentes (ver escritorio.js).
const SCRIPT: &str = include_str!("escritorio.js");

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let url = SITIO.parse().expect("dirección inválida");
            WebviewWindowBuilder::new(app, "principal", WebviewUrl::External(url))
                .title("Gestión CC Design")
                .inner_size(1366.0, 820.0)
                .min_inner_size(900.0, 600.0)
                .maximized(true)
                .initialization_script(SCRIPT)
                .on_navigation(|destino| {
                    let interno = match destino.scheme() {
                        "http" | "https" => destino.host_str() == Some(HOST),
                        "about" | "blob" | "data" => true,
                        _ => false,
                    };
                    // Todo lo que no es el sistema (WhatsApp, Mercado Libre, PDFs, la tienda…)
                    // se abre en el navegador predeterminado y la ventana queda donde estaba.
                    if !interno {
                        let _ = open::that_detached(destino.as_str());
                    }
                    interno
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("no se pudo iniciar Gestión CC Design");
}
