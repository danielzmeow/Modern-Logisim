use tauri::menu::{Menu, MenuBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::webview::DownloadEvent;
use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};

/// Native menu bar. Undo/Redo/Select All are deliberately absent: their key
/// equivalents (⌘Z, ⇧⌘Z, ⌘A) are handled by the editor itself, and a menu item
/// would swallow them before the page sees the keydown.
fn menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let app_menu = SubmenuBuilder::new(app, "Logisim Studio")
        .item(&PredefinedMenuItem::about(
            app,
            Some("About Logisim Studio"),
            None,
        )?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()?;

    let edit = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .build()?;

    let view = SubmenuBuilder::new(app, "View")
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()?;

    let window = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()?;

    MenuBuilder::new(app)
        .items(&[&app_menu, &edit, &view, &window])
        .build()
}

pub fn run() {
    tauri::Builder::default()
        .menu(menu)
        .setup(|app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Logisim Studio")
                .inner_size(1360.0, 880.0)
                .min_inner_size(960.0, 640.0)
                .on_download(|_webview, event| {
                    // "Export .circ" uses an <a download> blob; WebKit asks us first.
                    // Accept it so the file lands in the suggested download location.
                    if let DownloadEvent::Finished { success, .. } = event {
                        let _ = success;
                    }
                    true
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Logisim Studio");
}
