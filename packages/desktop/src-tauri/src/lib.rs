// Tauri entry point. Phase 3 polish layered onto the Phase 0 shell:
//
//   1. Single-instance — a second launch re-focuses the existing
//      window instead of spawning a new one. Matches standard macOS
//      and Windows desktop-app UX.
//
//   2. External-link interception — any navigation attempt targeting
//      a host that isn't ours gets kicked out to the system browser
//      (Safari / Chrome / Firefox). Clicking out to the blog, a
//      support link, or a Stripe checkout stays a browser experience
//      so the webview doesn't get hijacked by an unrelated page.
//
// Drag-drop uploads and file downloads are left to the webview —
// both work natively out of the box since the Tauri webview honors
// the same HTML5 APIs the web app already uses.

use tauri::Manager;
use tauri_plugin_opener::OpenerExt;
use url::Url;

// Hosts the webview is allowed to navigate to IN-PLACE. Anything
// else gets bounced to the user's system browser.
const ALLOWED_HOSTS: &[&str] = &["securewarp.com", "www.securewarp.com", "pdf.securewarp.com"];

fn is_internal_host(url_str: &str) -> bool {
    match Url::parse(url_str) {
        Ok(parsed) => match parsed.host_str() {
            Some(host) => ALLOWED_HOSTS.iter().any(|h| *h == host),
            None => true, // e.g. tauri://, data:, about: — let the webview handle it
        },
        Err(_) => true, // Malformed — let the webview fail naturally
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // Single-instance guard. If the user double-clicks the dock icon
    // while the app is already running, bring the existing window to
    // the front instead of starting a new process.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(
            |app, _args, _cwd| {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            },
        ));
    }

    // Opener plugin — used to launch external URLs in the system
    // browser when we intercept a non-allowed navigation below.
    builder = builder.plugin(tauri_plugin_opener::init());

    builder
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let handle = app.handle().clone();
                window.on_navigation(move |url| {
                    let url_str = url.as_str();
                    if is_internal_host(url_str) {
                        return true;
                    }
                    // External — kick to system browser and block
                    // the in-webview navigation.
                    let _ = handle.opener().open_url(url_str, None::<&str>);
                    false
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
