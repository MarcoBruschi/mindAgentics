pub mod commands;
pub mod daemon;
pub mod git;
pub mod graphify;
pub mod memory;
pub mod probes;
pub mod pty;
pub mod security;
pub mod storage;

use std::sync::Arc;
use tauri::{Emitter, Manager, WindowEvent};

#[cfg(windows)]
fn apply_windows_dwm_acrylic(hwnd: isize) {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::Graphics::Dwm::DwmSetWindowAttribute;

    #[repr(C)]
    struct Margins {
        cx_left_width: i32,
        cx_right_width: i32,
        cy_top_height: i32,
        cy_bottom_height: i32,
    }

    #[repr(C)]
    struct AccentPolicy {
        accent_state: u32,
        accent_flags: u32,
        gradient_color: u32,
        animation_id: u32,
    }

    #[repr(C)]
    struct WindowCompositionAttribData {
        attrib: u32,
        pv_data: *mut AccentPolicy,
        cb_data: usize,
    }

    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmExtendFrameIntoClientArea(hwnd: HWND, p_mar_inset: *const Margins) -> i32;
    }

    #[link(name = "user32")]
    extern "system" {
        fn SetWindowCompositionAttribute(hwnd: HWND, p_attr_data: *mut WindowCompositionAttribData) -> i32;
    }

    let raw_hwnd = hwnd as HWND;
    unsafe {
        let dark_mode: u32 = 1; // DWMWA_USE_IMMERSIVE_DARK_MODE
        DwmSetWindowAttribute(
            raw_hwnd,
            20,
            &dark_mode as *const _ as *const std::ffi::c_void,
            std::mem::size_of::<u32>() as u32,
        );

        let corner_pref: u32 = 2; // DWMWCP_ROUND (rounded 4 corners)
        DwmSetWindowAttribute(
            raw_hwnd,
            33, // DWMWA_WINDOW_CORNER_PREFERENCE
            &corner_pref as *const _ as *const std::ffi::c_void,
            std::mem::size_of::<u32>() as u32,
        );

        let margins = Margins {
            cx_left_width: -1,
            cx_right_width: -1,
            cy_top_height: -1,
            cy_bottom_height: -1,
        };
        let _ = DwmExtendFrameIntoClientArea(raw_hwnd, &margins);

        let backdrop_type: u32 = 3; // DWMSBT_TRANSIENTWINDOW (Acrylic)
        DwmSetWindowAttribute(
            raw_hwnd,
            38, // DWMWA_SYSTEMBACKDROP_TYPE
            &backdrop_type as *const _ as *const std::ffi::c_void,
            std::mem::size_of::<u32>() as u32,
        );

        // Dark acrylic tint matching canvas (#0E0F12) in ABGR byte order: 0xCC120F0E
        let mut policy = AccentPolicy {
            accent_state: 4, // ACCENT_ENABLE_ACRYLICBLURBEHIND
            accent_flags: 2,
            gradient_color: 0xCC120F0E,
            animation_id: 0,
        };
        let mut data = WindowCompositionAttribData {
            attrib: 19, // WCA_ACCENT_POLICY
            pv_data: &mut policy,
            cb_data: std::mem::size_of::<AccentPolicy>(),
        };
        let _ = SetWindowCompositionAttribute(raw_hwnd, &mut data);
    }
}

pub fn run() {
    let memory = memory::MemoryService::new();
    let storage_arc = Arc::new(storage::StorageEngine::new());
    let pty_arc = Arc::new(pty::PtyManager::new(memory.clone()));
    let git_engine = git::GitEngine::new();
    let graphify_runner = graphify::GraphifyRunner::new();

    // Generate random IPC token for this session
    let token = uuid::Uuid::new_v4().to_string();
    let daemon_arc = Arc::new(daemon::DaemonServer::new(
        token,
        (*storage_arc).clone(),
        (*pty_arc).clone(),
        memory.clone(),
    ));

    let pty_setup = pty_arc.clone();
    let storage_setup = storage_arc.clone();
    let daemon_setup = daemon_arc.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(storage_arc)
        .manage(pty_arc)
        .manage(daemon_arc)
        .manage(git_engine)
        .manage(graphify_runner)
        .manage(memory)
        .invoke_handler(tauri::generate_handler![
            commands::app_get_info,
            commands::app_info,
            commands::app_set_locale,
            commands::app_local_directory_suggestions,
            commands::app_directory_state,
            commands::app_create_directory,
            commands::app_pick_reference,
            commands::pick_reference,
            commands::pick_directory,
            commands::app_list_ides,
            commands::app_open_in_ide,
            commands::app_diagnostic_report,
            commands::app_save_diagnostic_report,
            commands::app_quit,
            commands::app_hide_to_tray,
            commands::open_path,
            commands::open_external,
            commands::terminal_detect_agents,
            commands::detect_agents,
            commands::terminal_get_agent_limits,
            commands::get_agent_limits,
            commands::terminal_spawn,
            commands::terminal_write,
            commands::terminal_write_binary,
            commands::terminal_resize,
            commands::terminal_kill,
            commands::terminal_restart,
            commands::terminal_reconfigure,
            commands::terminal_get_scrollback,
            commands::terminal_set_orchestrator_mode,
            commands::terminal_set_maestro_mode,
            commands::window_minimize,
            commands::window_maximize,
            commands::window_toggle_maximize,
            commands::window_close,
            commands::window_state,
            commands::workspace_list,
            commands::workspace_get_active_id,
            commands::workspace_create,
            commands::workspace_patch,
            commands::workspace_delete,
            commands::workspace_switch,
            commands::canvas_sync,
            commands::note_read,
            commands::note_write,
            commands::app_state_get,
            commands::preferences_get,
            commands::profile_get,
            commands::profile_load,
            commands::profile_award_xp,
            commands::portal_open_window,
            commands::graphify_build,
            commands::graphify_check,
            commands::ipc_dispatch,
        ])
        .setup(move |app| {
            let app_handle = app.handle().clone();

            // Wire AppHandle, StorageEngine, PtyManager, and Named Pipe address
            pty_setup.set_app_handle(app_handle.clone());
            pty_setup.set_pipe_address(daemon_setup.pipe_name());
            pty_setup.set_data_dir(storage_setup.data_dir().clone());

            daemon_setup.set_app_handle(app_handle.clone());
            daemon_setup.set_storage(storage_setup.clone());
            daemon_setup.set_pty_manager(pty_setup.clone());

            // Spawn Named Pipe server in background Tauri Tokio runtime
            let daemon_bg = daemon_setup.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = daemon_bg.start().await {
                    tracing::error!("Named pipe daemon server error: {}", e);
                }
            });

            if let Some(window) = app.get_webview_window("main") {
                // Setup frameless DWM dark acrylic blur + rounded corners on Windows
                #[cfg(windows)]
                {
                    if let Ok(hwnd) = window.hwnd() {
                        apply_windows_dwm_acrylic(hwnd.0 as isize);
                    }
                }

                // Emit window state changes on resize/maximize/fullscreen and re-apply acrylic
                let win_clone = window.clone();
                let handle_clone = app_handle.clone();
                window.on_window_event(move |event| {
                    if matches!(event, WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. }) {
                        #[cfg(windows)]
                        if let Ok(hwnd) = win_clone.hwnd() {
                            apply_windows_dwm_acrylic(hwnd.0 as isize);
                        }
                        let is_maximized = win_clone.is_maximized().unwrap_or(false);
                        let is_full_screen = win_clone.is_fullscreen().unwrap_or(false);
                        let is_minimized = win_clone.is_minimized().unwrap_or(false);
                        let payload = serde_json::json!({
                            "isMaximized": is_maximized,
                            "isFullScreen": is_full_screen,
                            "isMinimized": is_minimized,
                        });
                        let _ = handle_clone.emit("mindagentics:window:state", payload.clone());
                        let _ = handle_clone.emit("mindagentics:windowControls:onChanged", payload);
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running mindAgentics tauri application");
}
