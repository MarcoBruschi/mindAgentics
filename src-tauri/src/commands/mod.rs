use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use regex::Regex;
use serde_json::{json, Value};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;

use crate::daemon::DaemonServer;
use crate::graphify::GraphifyRunner;
use crate::probes::{AgentCandidate, AgentUsageReport};
use crate::pty::{PtyManager, TerminalReconfigureOptions, TerminalSpawnOptions};
use crate::security::path_safety::{assert_safe_path_string, check_path_string, is_inside};
use crate::security::sanitizer::sanitize_label;
use crate::storage::{
    AppState, AwardXpResult, RoutineRunRecord, StorageEngine, UserPreferences, UserProfile,
};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PickRefOptions {
    pub target: Option<String>,
    pub title: Option<String>,
    pub path: Option<String>,
}

#[derive(serde::Serialize)]
pub struct PickRefResult {
    pub path: String,
    #[serde(rename = "isDirectory")]
    pub is_directory: bool,
    pub label: String,
}

fn build_pick_result(raw_path: &str) -> Result<PickRefResult, String> {
    let safe_path = assert_safe_path_string(raw_path)?;
    let meta = std::fs::metadata(&safe_path)
        .map_err(|e| format!("Caminho inválido ou inacessível: {e}"))?;
    let canonical_str = safe_path.to_string_lossy().to_string();
    let label = safe_path
        .file_name()
        .and_then(|n| n.to_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| canonical_str.clone());

    Ok(PickRefResult {
        path: canonical_str,
        is_directory: meta.is_dir(),
        label: sanitize_label(&label, 120),
    })
}

fn emit_window_state(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let is_maximized = win.is_maximized().unwrap_or(false);
        let is_full_screen = win.is_fullscreen().unwrap_or(false);
        let is_minimized = win.is_minimized().unwrap_or(false);
        let payload = json!({
            "isMaximized": is_maximized,
            "isFullScreen": is_full_screen,
            "isMinimized": is_minimized,
        });
        let _ = app.emit("mindagentics:window:state", payload.clone());
        let _ = app.emit("mindagentics:windowControls:onChanged", payload);
    }
}

fn detect_window_material() -> (Option<&'static str>, bool) {
    #[cfg(target_os = "macos")]
    {
        return (Some("vibrancy"), true);
    }
    #[cfg(windows)]
    {
        return (Some("acrylic"), true);
    }
    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        return (None, false);
    }
}

fn arg_opt(args: &[Value], idx: usize) -> Option<&Value> {
    args.get(idx).filter(|v| !v.is_null())
}

fn arg_str(args: &[Value], idx: usize) -> Option<String> {
    arg_opt(args, idx).and_then(|v| v.as_str()).map(|s| s.to_string())
}

fn arg_bool(args: &[Value], idx: usize) -> Option<bool> {
    arg_opt(args, idx).and_then(|v| v.as_bool())
}

fn arg_u16(args: &[Value], idx: usize) -> Option<u16> {
    arg_opt(args, idx)
        .and_then(|v| v.as_u64())
        .and_then(|n| u16::try_from(n).ok())
}

fn arg_u32(args: &[Value], idx: usize) -> Option<u32> {
    arg_opt(args, idx)
        .and_then(|v| v.as_u64())
        .and_then(|n| u32::try_from(n).ok())
}

fn arg_usize(args: &[Value], idx: usize) -> Option<usize> {
    arg_opt(args, idx)
        .and_then(|v| v.as_u64())
        .and_then(|n| usize::try_from(n).ok())
}

fn is_forbidden_executable(path: &Path) -> bool {
    if path.is_dir() {
        return false;
    }
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    matches!(
        ext.as_str(),
        "exe"
            | "bat"
            | "cmd"
            | "com"
            | "ps1"
            | "psm1"
            | "msi"
            | "msc"
            | "lnk"
            | "scr"
            | "vbs"
            | "vbe"
            | "wsf"
            | "js"
            | "jse"
            | "jar"
            | "reg"
            | "hta"
            | "cpl"
            | "dll"
            | "sh"
            | "command"
            | "app"
            | "desktop"
    )
}

fn build_app_info_value(storage: &StorageEngine, daemon: &DaemonServer) -> Value {
    let (material, see_through) = detect_window_material();
    let data_dir = storage.get_data_dir().to_string_lossy().to_string();
    json!({
        "name": "mindAgentics",
        "version": "0.26.0",
        "appVersion": "0.26.0",
        "platform": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "isPackaged": false,
        "windowMaterial": material,
        "windowSeeThrough": see_through,
        "pipeAddress": daemon.pipe_address(),
        "dataDir": data_dir,
        "appDataPath": data_dir,
    })
}

#[tauri::command]
pub fn app_get_info(
    storage: State<'_, Arc<StorageEngine>>,
    daemon: State<'_, Arc<DaemonServer>>,
) -> Value {
    build_app_info_value(&storage, &daemon)
}

#[tauri::command]
pub fn app_info(
    storage: State<'_, Arc<StorageEngine>>,
    daemon: State<'_, Arc<DaemonServer>>,
) -> Value {
    build_app_info_value(&storage, &daemon)
}

#[tauri::command]
pub async fn app_set_locale(
    app: AppHandle,
    storage: State<'_, Arc<StorageEngine>>,
    locale: String,
) -> Result<Value, String> {
    let updated = storage
        .set_preferences(json!({ "locale": locale, "language": locale }))
        .await
        .map_err(|e| e.to_string())?;
    let _ = app.emit("mindagentics:preferences:onChanged", &updated);
    Ok(json!({ "ok": true, "locale": locale }))
}

#[tauri::command]
pub async fn app_local_directory_suggestions(
    partial_path: Option<String>,
    limit: Option<usize>,
) -> Vec<String> {
    let safe_limit = limit.unwrap_or(10).clamp(1, 50);
    let base_dir = match partial_path.as_deref() {
        Some(raw) if !raw.trim().is_empty() && check_path_string(raw).ok => {
            let p = PathBuf::from(raw.trim());
            if p.is_dir() {
                p
            } else if let Some(parent) = p.parent() {
                if parent.is_dir() {
                    parent.to_path_buf()
                } else {
                    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
                }
            } else {
                dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
            }
        }
        _ => dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")),
    };

    let mut out = Vec::new();
    if let Ok(mut entries) = tokio::fs::read_dir(&base_dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            if out.len() >= safe_limit {
                break;
            }
            if let Ok(ft) = entry.file_type().await {
                if ft.is_dir() {
                    out.push(entry.path().to_string_lossy().to_string());
                }
            }
        }
    }
    out
}

#[tauri::command]
pub async fn app_directory_state(
    _workspace_id: Option<String>,
    _environment: Option<Value>,
    path: String,
) -> Result<Value, String> {
    let safe = assert_safe_path_string(&path)?;
    let exists = safe.exists();
    let is_directory = exists && safe.is_dir();
    Ok(json!({
        "exists": exists,
        "isDirectory": is_directory,
    }))
}

#[tauri::command]
pub async fn app_create_directory(
    _workspace_id: Option<String>,
    _environment: Option<Value>,
    path: String,
) -> Result<Value, String> {
    let safe = assert_safe_path_string(&path)?;
    tokio::fs::create_dir_all(&safe)
        .await
        .map_err(|e| format!("Falha ao criar diretório: {e}"))?;
    Ok(json!({ "ok": true, "path": safe.to_string_lossy().to_string() }))
}

#[tauri::command]
pub fn app_list_ides() -> Value {
    json!([
        { "id": "vscode", "name": "Visual Studio Code", "command": "code" },
        { "id": "cursor", "name": "Cursor", "command": "cursor" },
        { "id": "windsurf", "name": "Windsurf", "command": "windsurf" },
        { "id": "intellij", "name": "IntelliJ IDEA", "command": "idea" },
    ])
}

#[tauri::command]
pub async fn app_open_in_ide(
    storage: State<'_, Arc<StorageEngine>>,
    workspace_id: String,
    ide_id: String,
) -> Result<Value, String> {
    let ws = read_workspace_value(&storage, &workspace_id).await?;
    let dir = ws
        .as_ref()
        .and_then(|w| {
            w.get("workingDirectory")
                .or_else(|| w.get("rootPath"))
                .and_then(|v| v.as_str())
        })
        .unwrap_or("")
        .to_string();

    if dir.trim().is_empty() {
        return Ok(json!({ "ok": false, "error": "Workspace directory not set" }));
    }

    let safe_dir = assert_safe_path_string(&dir)?;
    let ide_cmd = match ide_id.as_str() {
        "cursor" => "cursor",
        "windsurf" => "windsurf",
        "intellij" | "idea" => "idea",
        _ => "code",
    };

    let mut cmd = tokio::process::Command::new(ide_cmd);
    cmd.arg(&safe_dir);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    match cmd.spawn() {
        Ok(_) => Ok(json!({ "ok": true })),
        Err(e) => {
            tracing::warn!("Failed to launch IDE {}: {}", ide_cmd, e);
            Ok(json!({ "ok": false, "error": e.to_string() }))
        }
    }
}

#[tauri::command]
pub async fn app_diagnostic_report(
    storage: State<'_, Arc<StorageEngine>>,
    daemon: State<'_, Arc<DaemonServer>>,
    pty: State<'_, Arc<PtyManager>>,
) -> Result<Value, String> {
    let sessions = pty.list_sessions_info().await;
    Ok(json!({
        "os": format!("{} {}", std::env::consts::OS, std::env::consts::ARCH),
        "version": "0.26.0",
        "dataDir": storage.get_data_dir().to_string_lossy().to_string(),
        "daemonReady": true,
        "pipeAddress": daemon.pipe_address(),
        "activeTerminals": sessions.len(),
    }))
}

#[tauri::command]
pub async fn app_save_diagnostic_report(
    storage: State<'_, Arc<StorageEngine>>,
    daemon: State<'_, Arc<DaemonServer>>,
) -> Result<Value, String> {
    let report_path = storage.get_data_dir().join("diagnostic-report.json");
    let report = json!({
        "date": chrono::Utc::now().to_rfc3339(),
        "platform": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "version": "0.26.0",
        "dataDir": storage.get_data_dir().to_string_lossy().to_string(),
        "pipeAddress": daemon.pipe_address(),
    });
    let bytes = serde_json::to_vec_pretty(&report).map_err(|e| e.to_string())?;
    storage
        .replace_file_atomically(&report_path, &bytes)
        .await
        .map_err(|e| e.to_string())?;
    Ok(json!({
        "ok": true,
        "path": report_path.to_string_lossy().to_string(),
    }))
}

#[tauri::command]
pub async fn app_quit(app: AppHandle) -> Result<(), String> {
    app.exit(0);
    Ok(())
}

#[tauri::command]
pub async fn app_hide_to_tray(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        win.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn app_pick_reference(
    app: AppHandle,
    options: Option<PickRefOptions>,
) -> Result<Option<PickRefResult>, String> {
    let opts = options.unwrap_or_default();

    if let Some(raw_path) = opts.path.as_deref() {
        if !raw_path.trim().is_empty() {
            return build_pick_result(raw_path.trim()).map(Some);
        }
    }

    let target = opts.target.unwrap_or_else(|| "all".to_string());
    let title = opts
        .title
        .unwrap_or_else(|| "Selecionar referência".to_string());

    let chosen = tokio::task::spawn_blocking(move || -> Option<String> {
        let picked = match target.as_str() {
            "directory" | "folder" => app.dialog().file().set_title(&title).blocking_pick_folder(),
            "file" => app.dialog().file().set_title(&title).blocking_pick_file(),
            _ => {
                let pick_file = app
                    .dialog()
                    .message("Deseja selecionar um Arquivo (Sim) ou uma Pasta (Não)?")
                    .title(&title)
                    .kind(MessageDialogKind::Info)
                    .buttons(MessageDialogButtons::YesNo)
                    .blocking_show();
                if pick_file {
                    app.dialog().file().set_title(&title).blocking_pick_file()
                } else {
                    app.dialog().file().set_title(&title).blocking_pick_folder()
                }
            }
        };
        picked.map(|fp| fp.to_string())
    })
    .await
    .map_err(|e| format!("Dialog task failed: {e}"))?;

    match chosen {
        Some(path_str) => build_pick_result(&path_str).map(Some),
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn pick_reference(
    app: AppHandle,
    options: Option<PickRefOptions>,
) -> Result<Option<PickRefResult>, String> {
    app_pick_reference(app, options).await
}

#[tauri::command]
pub async fn pick_directory(app: AppHandle) -> Result<Option<String>, String> {
    let res = app_pick_reference(
        app,
        Some(PickRefOptions {
            target: Some("directory".to_string()),
            title: Some("Selecionar pasta".to_string()),
            path: None,
        }),
    )
    .await?;
    Ok(res.map(|r| r.path))
}

#[tauri::command]
pub async fn open_path(app: AppHandle, path: String) -> Result<bool, String> {
    let safe_path = assert_safe_path_string(&path)?;
    if is_forbidden_executable(&safe_path) {
        return Err("Recusando abrir arquivo executável ou script diretamente".to_string());
    }
    app.opener()
        .open_path(safe_path.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("Falha ao abrir caminho: {e}"))?;
    Ok(true)
}

#[tauri::command]
pub async fn open_external(app: AppHandle, url: String) -> Result<bool, String> {
    let trimmed = url.trim();
    if trimmed.len() > 4096 {
        return Err("URL excede o tamanho máximo permitido".to_string());
    }
    if !(trimmed.starts_with("https://")
        || trimmed.starts_with("http://")
        || trimmed.starts_with("mailto:"))
    {
        return Err("URL externa deve usar http://, https:// ou mailto:".to_string());
    }
    app.opener()
        .open_url(trimmed, None::<&str>)
        .map_err(|e| format!("Falha ao abrir URL externa: {e}"))?;
    Ok(true)
}

#[tauri::command]
pub async fn terminal_detect_agents() -> Vec<AgentCandidate> {
    crate::probes::detect_installed_agents()
}

#[tauri::command]
pub async fn detect_agents() -> Vec<AgentCandidate> {
    terminal_detect_agents().await
}

#[tauri::command]
pub async fn terminal_get_agent_limits() -> Vec<AgentUsageReport> {
    crate::probes::get_agent_limits().await
}

#[tauri::command]
pub async fn get_agent_limits() -> Vec<AgentUsageReport> {
    terminal_get_agent_limits().await
}

#[tauri::command]
pub async fn terminal_spawn(
    pty: State<'_, Arc<PtyManager>>,
    options: TerminalSpawnOptions,
    on_data: Channel<InvokeResponseBody>,
) -> Result<Value, String> {
    let (output_tx, mut output_rx) = tokio::sync::mpsc::unbounded_channel::<(String, Vec<u8>)>();

    let terminal_id = pty
        .spawn(options, output_tx)
        .await
        .map_err(|e| e.to_string())?;

    tokio::spawn(async move {
        while let Some((_tid, bytes)) = output_rx.recv().await {
            if on_data.send(InvokeResponseBody::Raw(bytes)).is_err() {
                break;
            }
        }
    });

    Ok(json!({
        "terminalId": terminal_id,
        "attached": true,
    }))
}

#[tauri::command]
pub async fn terminal_write(
    pty: State<'_, Arc<PtyManager>>,
    terminal_id: String,
    data: String,
) -> Result<(), String> {
    pty.write(&terminal_id, &data).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terminal_write_binary(
    pty: State<'_, Arc<PtyManager>>,
    terminal_id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    pty.write_bytes(&terminal_id, &data)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terminal_resize(
    pty: State<'_, Arc<PtyManager>>,
    terminal_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    pty.resize(&terminal_id, cols, rows)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terminal_kill(
    pty: State<'_, Arc<PtyManager>>,
    terminal_id: String,
) -> Result<(), String> {
    pty.kill(&terminal_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terminal_restart(
    pty: State<'_, Arc<PtyManager>>,
    terminal_id: String,
) -> Result<(), String> {
    pty.restart(&terminal_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terminal_reconfigure(
    pty: State<'_, Arc<PtyManager>>,
    terminal_id: Option<String>,
    config: TerminalReconfigureOptions,
) -> Result<(), String> {
    pty.reconfigure(terminal_id.as_deref(), config)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terminal_get_scrollback(
    pty: State<'_, Arc<PtyManager>>,
    terminal_id: String,
) -> Result<String, String> {
    pty.get_scrollback(&terminal_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terminal_set_orchestrator_mode(
    pty: State<'_, Arc<PtyManager>>,
    terminal_id: String,
    enabled: bool,
) -> Result<(), String> {
    pty.set_orchestrator_mode(&terminal_id, enabled)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terminal_set_maestro_mode(
    pty: State<'_, Arc<PtyManager>>,
    terminal_id: String,
    enabled: bool,
) -> Result<(), String> {
    terminal_set_orchestrator_mode(pty, terminal_id, enabled).await
}

#[tauri::command]
pub async fn window_minimize(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        win.minimize().map_err(|e| e.to_string())?;
        emit_window_state(&app);
    }
    Ok(())
}

#[tauri::command]
pub async fn window_maximize(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        win.maximize().map_err(|e| e.to_string())?;
        emit_window_state(&app);
    }
    Ok(())
}

#[tauri::command]
pub async fn window_toggle_maximize(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        let is_max = win.is_maximized().unwrap_or(false);
        if is_max {
            win.unmaximize().map_err(|e| e.to_string())?;
        } else {
            win.maximize().map_err(|e| e.to_string())?;
        }
        emit_window_state(&app);
    }
    Ok(())
}

#[tauri::command]
pub async fn window_close(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        win.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn window_state(app: AppHandle) -> Result<Value, String> {
    if let Some(win) = app.get_webview_window("main") {
        let is_maximized = win.is_maximized().unwrap_or(false);
        let is_full_screen = win.is_fullscreen().unwrap_or(false);
        let is_minimized = win.is_minimized().unwrap_or(false);
        return Ok(json!({
            "isMaximized": is_maximized,
            "isFullScreen": is_full_screen,
            "isMinimized": is_minimized,
        }));
    }
    Ok(json!({
        "isMaximized": false,
        "isFullScreen": false,
        "isMinimized": false,
    }))
}

fn enrich_workspace_json(mut val: Value) -> Value {
    if let Some(obj) = val.as_object_mut() {
        let wd = obj
            .get("workingDirectory")
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .map(|s| s.to_string())
            .or_else(|| {
                obj.get("rootPath")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.trim().is_empty())
                    .map(|s| s.to_string())
            });
        if let Some(dir) = wd {
            obj.entry("workingDirectory")
                .or_insert_with(|| Value::String(dir.clone()));
            obj.entry("rootPath").or_insert_with(|| Value::String(dir));
        }
    }
    val
}

async fn read_workspace_value(storage: &StorageEngine, id: &str) -> Result<Option<Value>, String> {
    if let Some(ws) = storage.get_workspace(id).await.map_err(|e| e.to_string())? {
        let val = serde_json::to_value(ws).map_err(|e| e.to_string())?;
        return Ok(Some(enrich_workspace_json(val)));
    }
    Ok(None)
}

#[tauri::command]
pub async fn workspace_list(
    storage: State<'_, Arc<StorageEngine>>,
) -> Result<Vec<Value>, String> {
    let list = storage.list_workspaces().await.map_err(|e| e.to_string())?;
    let mut enriched = Vec::with_capacity(list.len());
    for ws in list {
        let val = serde_json::to_value(&ws).map_err(|e| e.to_string())?;
        enriched.push(enrich_workspace_json(val));
    }
    Ok(enriched)
}

#[tauri::command]
pub async fn workspace_get_active_id(
    storage: State<'_, Arc<StorageEngine>>,
) -> Result<Option<String>, String> {
    storage
        .get_active_workspace_id()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn workspace_create(
    storage: State<'_, Arc<StorageEngine>>,
    data: Option<Value>,
    name: Option<String>,
    root_path: Option<String>,
) -> Result<Value, String> {
    let mut payload = match data {
        Some(Value::Object(m)) => m,
        _ => serde_json::Map::new(),
    };
    if let Some(n) = name.filter(|s| !s.trim().is_empty()) {
        payload.insert("name".to_string(), Value::String(n));
    }
    if let Some(rp) = root_path.filter(|s| !s.trim().is_empty()) {
        payload
            .entry("workingDirectory".to_string())
            .or_insert_with(|| Value::String(rp.clone()));
        payload
            .entry("rootPath".to_string())
            .or_insert(Value::String(rp));
    }
    let ws = storage
        .create_workspace(Value::Object(payload))
        .await
        .map_err(|e| e.to_string())?;
    let val = serde_json::to_value(ws).map_err(|e| e.to_string())?;
    Ok(enrich_workspace_json(val))
}

#[tauri::command]
pub async fn workspace_patch(
    storage: State<'_, Arc<StorageEngine>>,
    id: String,
    data: Option<Value>,
    patch: Option<Value>,
) -> Result<Value, String> {
    let merged_patch = data.or(patch).unwrap_or(Value::Null);
    let updated = storage
        .patch_workspace(&id, merged_patch)
        .await
        .map_err(|e| e.to_string())?;
    let val = serde_json::to_value(updated).map_err(|e| e.to_string())?;
    Ok(enrich_workspace_json(val))
}

#[tauri::command]
pub async fn workspace_delete(
    app: AppHandle,
    storage: State<'_, Arc<StorageEngine>>,
    id: String,
    _delete_dir: Option<bool>,
) -> Result<Value, String> {
    storage
        .delete_workspace(&id)
        .await
        .map_err(|e| e.to_string())?;
    let _ = app.emit("mindagentics:workspace:onDeleted", &id);
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub async fn workspace_switch(
    storage: State<'_, Arc<StorageEngine>>,
    id: String,
) -> Result<Option<Value>, String> {
    let ws = storage
        .switch_workspace(&id)
        .await
        .map_err(|e| e.to_string())?;
    match ws {
        Some(w) => {
            let val = serde_json::to_value(w).map_err(|e| e.to_string())?;
            Ok(Some(enrich_workspace_json(val)))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn canvas_sync(
    storage: State<'_, Arc<StorageEngine>>,
    payload: Value,
) -> Result<Option<Value>, String> {
    let ws_id = payload
        .get("workspaceId")
        .or_else(|| payload.get("workspace_id"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let target_id = match ws_id {
        Some(id) => Some(id),
        None => storage
            .get_active_workspace_id()
            .await
            .map_err(|e| e.to_string())?,
    };

    if let Some(id) = target_id {
        let updated = storage
            .patch_workspace(&id, payload)
            .await
            .map_err(|e| e.to_string())?;
        let val = serde_json::to_value(updated).map_err(|e| e.to_string())?;
        return Ok(Some(enrich_workspace_json(val)));
    }

    Ok(None)
}

#[tauri::command]
pub async fn note_read(
    storage: State<'_, Arc<StorageEngine>>,
    workspace_id: String,
    note_id: String,
) -> Result<String, String> {
    storage
        .read_note(&workspace_id, &note_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn note_write(
    app: AppHandle,
    storage: State<'_, Arc<StorageEngine>>,
    workspace_id: String,
    note_id: String,
    content: String,
) -> Result<(), String> {
    storage
        .write_note(&workspace_id, &note_id, &content)
        .await
        .map_err(|e| e.to_string())?;
    let _ = app.emit(
        "mindagentics:note:onChange",
        json!({ "workspaceId": workspace_id, "noteId": note_id, "content": content }),
    );
    Ok(())
}

#[tauri::command]
pub async fn app_state_get(
    storage: State<'_, Arc<StorageEngine>>,
) -> Result<AppState, String> {
    storage.get_app_state().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn preferences_get(
    storage: State<'_, Arc<StorageEngine>>,
) -> Result<UserPreferences, String> {
    storage.get_preferences().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn profile_get(
    storage: State<'_, Arc<StorageEngine>>,
) -> Result<UserProfile, String> {
    storage.get_profile().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn profile_load(
    storage: State<'_, Arc<StorageEngine>>,
) -> Result<UserProfile, String> {
    profile_get(storage).await
}

#[tauri::command]
pub async fn profile_award_xp(
    storage: State<'_, Arc<StorageEngine>>,
    xp: u64,
    reason: Option<String>,
    stat_key: Option<String>,
) -> Result<AwardXpResult, String> {
    let key = stat_key.or(reason);
    storage
        .award_xp(xp, key.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn portal_open_window(
    app: AppHandle,
    url: String,
    title: Option<String>,
) -> Result<String, String> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("https://") || trimmed.starts_with("http://")) {
        return Err("Portal URL deve usar http:// ou https://".to_string());
    }
    let parsed: tauri::Url = trimmed
        .parse()
        .map_err(|e| format!("URL inválida para portal: {e}"))?;

    let label = format!("portal-{}", uuid::Uuid::new_v4().simple());
    let safe_title = sanitize_label(&title.unwrap_or_else(|| trimmed.to_string()), 80);

    WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(parsed))
        .title(&safe_title)
        .inner_size(1100.0, 760.0)
        .build()
        .map_err(|e| format!("Falha ao abrir janela do portal: {e}"))?;

    Ok(label)
}

// ============================================================================
// Graphify Native & CLI Pipeline
// ============================================================================

fn emit_graphify_progress(app: &AppHandle, message: &str) {
    let _ = app.emit("mindagentics:graphify:progress", json!({ "message": message }));
}

async fn run_git_args(args: &[&str], cwd: &Path) -> Result<String, String> {
    let mut cmd = tokio::process::Command::new("git");
    cmd.current_dir(cwd);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.args(args);

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Falha ao executar git {}: {e}", args.join(" ")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!("git {} falhou: {}", args.join(" "), stderr));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

async fn clone_graphify_repo(
    app: &AppHandle,
    url: &str,
    branch: Option<&str>,
) -> Result<PathBuf, String> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("https://") || trimmed.starts_with("http://")) {
        return Err("URL do repositório Git deve usar http:// ou https://".to_string());
    }
    if trimmed.chars().any(|c| c.is_control() || c == '\0') {
        return Err("URL do repositório contém caracteres inválidos".to_string());
    }

    emit_graphify_progress(app, &format!("Clonando repositório {trimmed}..."));

    let cleaned = trimmed.trim_end_matches('/');
    let parts: Vec<&str> = cleaned.split('/').collect();
    let repo_name = parts
        .last()
        .copied()
        .unwrap_or("repo")
        .trim_end_matches(".git");
    let owner_name = if parts.len() >= 2 {
        parts[parts.len() - 2]
    } else {
        "external"
    };

    let home = dirs::home_dir().ok_or_else(|| "Diretório home não encontrado".to_string())?;
    let dest_dir = home
        .join(".graphify")
        .join("repos")
        .join(sanitize_label(owner_name, 80))
        .join(sanitize_label(repo_name, 80));

    if dest_dir.exists() {
        emit_graphify_progress(
            app,
            &format!(
                "Repositório existente detectado em {}, atualizando...",
                dest_dir.display()
            ),
        );
        let _ = run_git_args(&["pull"], &dest_dir).await;
        if let Some(br) = branch.filter(|b| !b.trim().is_empty()) {
            let _ = run_git_args(&["checkout", br.trim()], &dest_dir).await;
        }
        return Ok(dest_dir);
    }

    if let Some(parent) = dest_dir.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }

    let dest_str = dest_dir.to_string_lossy().to_string();
    let mut clone_args = vec!["clone", "--depth", "1"];
    if let Some(br) = branch.filter(|b| !b.trim().is_empty()) {
        clone_args.push("-b");
        clone_args.push(br.trim());
    }
    clone_args.push("--");
    clone_args.push(trimmed);
    clone_args.push(&dest_str);

    let mut cmd = tokio::process::Command::new("git");
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.args(&clone_args);

    let out = cmd.output().await.map_err(|e| format!("git clone falhou: {e}"))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(format!("Falha ao clonar repositório: {stderr}"));
    }

    Ok(dest_dir)
}

async fn try_python_graphify(project_dir: &Path, directed: bool) -> bool {
    let dir_str = project_dir.to_string_lossy().to_string();
    let candidates: &[(&str, &[&str])] = &[
        ("graphify", &[]),
        ("python", &["-m", "graphify"]),
        ("python3", &["-m", "graphify"]),
        ("py", &["-3", "-m", "graphify"]),
    ];

    for (bin, prefix) in candidates {
        let mut cmd = tokio::process::Command::new(bin);
        cmd.current_dir(project_dir);
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);
        for p in *prefix {
            cmd.arg(p);
        }
        cmd.arg(&dir_str);
        if directed {
            cmd.arg("--directed");
        }
        cmd.arg("--code-only");

        if let Ok(out) = cmd.output().await {
            if out.status.success() {
                let html_path = project_dir.join("graphify-out").join("graph.html");
                let json_path = project_dir.join("graphify-out").join("graph.json");
                if json_path.exists() && html_path.exists() {
                    return true;
                }
            }
        }
    }
    false
}

fn should_skip_graph_dir(name: &str) -> bool {
    matches!(
        name,
        "node_modules"
            | ".git"
            | "target"
            | "dist"
            | "build"
            | ".next"
            | ".nuxt"
            | ".venv"
            | "venv"
            | "__pycache__"
            | "graphify-out"
            | ".graphify"
            | ".mindagentics"
            | ".turbo"
            | "coverage"
    )
}

fn is_source_extension(ext: &str) -> bool {
    matches!(
        ext,
        "ts" | "tsx"
            | "js"
            | "jsx"
            | "mjs"
            | "cjs"
            | "rs"
            | "py"
            | "go"
            | "java"
            | "kt"
            | "cs"
            | "cpp"
            | "c"
            | "h"
            | "hpp"
            | "vue"
            | "svelte"
            | "json"
            | "toml"
            | "md"
    )
}

fn generate_native_graph_html(project_name: &str, graph_json_str: &str) -> String {
    let safe_title = project_name
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");
    let escaped_json = graph_json_str.replace("</", "<\\/");

    format!(
        r#"<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Knowledge Graph — {safe_title}</title>
<style>
  * {{ box-sizing: border-box; }}
  html, body {{ margin: 0; padding: 0; width: 100%; height: 100%; background: #0B0D11; color: #E7E8EA; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; overflow: hidden; }}
  .layout {{ display: flex; width: 100%; height: 100%; }}
  .canvas-wrap {{ position: relative; flex: 1; height: 100%; overflow: hidden; }}
  canvas {{ display: block; width: 100%; height: 100%; cursor: grab; }}
  canvas:active {{ cursor: grabbing; }}
  .hud {{ position: absolute; top: 14px; left: 14px; display: flex; gap: 8px; align-items: center; background: rgba(20,22,26,0.92); border: 1px solid #23262C; border-radius: 12px; padding: 8px 12px; backdrop-filter: blur(8px); }}
  .hud input {{ background: #0E1014; border: 1px solid #2A2E37; border-radius: 8px; padding: 6px 10px; color: #E7E8EA; font-size: 12px; width: 210px; outline: none; }}
  .hud input:focus {{ border-color: #6366F1; }}
  .pill {{ font-size: 11px; color: #A1A7B3; background: #181B20; border: 1px solid #23262C; border-radius: 8px; padding: 5px 9px; }}
  .sidebar {{ width: 300px; border-left: 1px solid #23262C; background: #111318; padding: 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; }}
  h1 {{ font-size: 14px; margin: 0; color: #F4F5F7; }}
  h2 {{ font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #8A8F98; margin: 0 0 6px 0; }}
  .item {{ font-size: 12px; padding: 6px 8px; border-radius: 8px; background: #171A21; border: 1px solid #23262C; margin-bottom: 6px; word-break: break-all; cursor: pointer; }}
  .item:hover {{ border-color: #6366F1; }}
  .muted {{ color: #8A8F98; font-size: 12px; line-height: 1.45; }}
  .tag {{ display: inline-block; font-size: 10px; padding: 2px 6px; border-radius: 999px; background: #1F2430; color: #A5B4FC; margin: 2px 4px 2px 0; }}
</style>
</head>
<body>
<div class="layout">
  <div class="canvas-wrap">
    <canvas id="graph"></canvas>
    <div class="hud">
      <strong style="font-size:12px;color:#A5B4FC;">{safe_title}</strong>
      <input id="search" type="text" placeholder="Filtrar arquivo ou símbolo..." />
      <span id="stats" class="pill"></span>
    </div>
  </div>
  <aside class="sidebar">
    <div>
      <h1>Inspetor Arquitetural</h1>
      <p class="muted" id="subtitle">Clique em um nó para inspecionar dependências, símbolos e comunidade.</p>
    </div>
    <div id="details"></div>
    <div>
      <h2>Principais Hubs</h2>
      <div id="hubs"></div>
    </div>
  </aside>
</div>
<script>
const GRAPH = {escaped_json};
const nodes = (GRAPH.nodes || []).map((n, i) => ({{
  ...n,
  x: (Math.cos(i * 2.39996) * 28 * Math.sqrt(i + 1)),
  y: (Math.sin(i * 2.39996) * 28 * Math.sqrt(i + 1)),
  vx: 0, vy: 0
}}));
const nodeById = new Map(nodes.map(n => [n.id, n]));
const links = (GRAPH.links || GRAPH.edges || []).map(e => ({{
  source: nodeById.get(e.source),
  target: nodeById.get(e.target),
  relation: e.relation || 'imports'
}})).filter(e => e.source && e.target);

const palette = ['#818CF8','#34D399','#F472B6','#FBBF24','#38BDF8','#A78BFA','#FB7185','#2DD4BF'];
const communities = [...new Set(nodes.map(n => n.community || 'root'))];
const commColor = c => palette[Math.max(0, communities.indexOf(c)) % palette.length];

document.getElementById('stats').textContent = `${{nodes.length}} nós · ${{links.length}} arestas`;

const canvas = document.getElementById('graph');
const ctx = canvas.getContext('2d');
let width = 0, height = 0, dpr = window.devicePixelRatio || 1;
let cam = {{ x: 0, y: 0, zoom: 1 }};
let selected = null, filter = '', dragging = false, lastX = 0, lastY = 0;

function resize() {{
  const rect = canvas.parentElement.getBoundingClientRect();
  width = rect.width; height = rect.height;
  canvas.width = width * dpr; canvas.height = height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}}
window.addEventListener('resize', resize);
resize();

// Light deterministic layout relaxation
for (let step = 0; step < 90; step++) {{
  for (let i = 0; i < nodes.length; i++) {{
    const a = nodes[i];
    a.vx *= 0.85; a.vy *= 0.85;
    a.vx += -a.x * 0.004; a.vy += -a.y * 0.004;
    for (let j = i + 1; j < Math.min(nodes.length, i + 40); j++) {{
      const b = nodes[j];
      const dx = a.x - b.x || 0.1, dy = a.y - b.y || 0.1;
      const dist2 = dx*dx + dy*dy + 80;
      const f = 900 / dist2;
      a.vx += dx * f; a.vy += dy * f;
      b.vx -= dx * f; b.vy -= dy * f;
    }}
  }}
  for (const e of links) {{
    const dx = e.target.x - e.source.x, dy = e.target.y - e.source.y;
    e.source.vx += dx * 0.015; e.source.vy += dy * 0.015;
    e.target.vx -= dx * 0.015; e.target.vy -= dy * 0.015;
  }}
  for (const n of nodes) {{ n.x += n.vx; n.y += n.vy; }}
}}

function draw() {{
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate(width / 2 + cam.x, height / 2 + cam.y);
  ctx.scale(cam.zoom, cam.zoom);

  const q = filter.trim().toLowerCase();
  const matches = n => !q || (n.label || '').toLowerCase().includes(q) || (n.path || '').toLowerCase().includes(q);

  ctx.lineWidth = 1 / cam.zoom;
  for (const e of links) {{
    const hi = selected && (e.source === selected || e.target === selected);
    ctx.strokeStyle = hi ? 'rgba(129,140,248,0.85)' : 'rgba(148,163,184,0.16)';
    ctx.beginPath();
    ctx.moveTo(e.source.x, e.source.y);
    ctx.lineTo(e.target.x, e.target.y);
    ctx.stroke();
  }}

  for (const n of nodes) {{
    const m = matches(n);
    const r = Math.min(16, 4 + Math.sqrt(n.degree || 1) * 1.8);
    ctx.globalAlpha = m ? 1 : 0.15;
    ctx.fillStyle = commColor(n.community || 'root');
    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
    ctx.fill();
    if (n === selected) {{
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2 / cam.zoom;
      ctx.stroke();
    }}
    if (cam.zoom > 0.7 || (n.degree || 0) >= 4 || n === selected || (q && m)) {{
      ctx.fillStyle = '#E7E8EA';
      ctx.font = `${{Math.max(9, 11 / Math.sqrt(cam.zoom))}}px sans-serif`;
      ctx.fillText(n.label, n.x + r + 4, n.y + 3);
    }}
  }}
  ctx.restore();
  requestAnimationFrame(draw);
}}
requestAnimationFrame(draw);

function screenToWorld(sx, sy) {{
  return {{ x: (sx - width / 2 - cam.x) / cam.zoom, y: (sy - height / 2 - cam.y) / cam.zoom }};
}}

function selectNode(n) {{
  selected = n;
  const det = document.getElementById('details');
  if (!n) {{ det.innerHTML = ''; return; }}
  const outgoing = links.filter(e => e.source === n).map(e => e.target.label);
  const incoming = links.filter(e => e.target === n).map(e => e.source.label);
  det.innerHTML = `
    <div class="item" style="border-color:#6366F1">
      <div><strong>${{n.label}}</strong></div>
      <div class="muted">${{n.path || n.id}}</div>
      <div style="margin-top:6px"><span class="tag">${{n.community || 'root'}}</span><span class="tag">grau ${{n.degree || 0}}</span></div>
    </div>
    ${{(n.symbols && n.symbols.length) ? `<div><h2>Símbolos</h2>${{n.symbols.slice(0, 12).map(s => `<span class="tag">${{s}}</span>`).join('')}}</div>` : ''}}
    ${{outgoing.length ? `<div><h2>Importa (${{outgoing.length}})</h2>${{outgoing.slice(0, 10).map(l => `<div class="item">${{l}}</div>`).join('')}}</div>` : ''}}
    ${{incoming.length ? `<div><h2>Referenciado por (${{incoming.length}})</h2>${{incoming.slice(0, 10).map(l => `<div class="item">${{l}}</div>`).join('')}}</div>` : ''}}
  `;
}}

const hubsEl = document.getElementById('hubs');
[...nodes].sort((a, b) => (b.degree || 0) - (a.degree || 0)).slice(0, 10).forEach(n => {{
  const el = document.createElement('div');
  el.className = 'item';
  el.textContent = `${{n.label}} (${{n.degree || 0}})`;
  el.onclick = () => {{ cam.x = -n.x * cam.zoom; cam.y = -n.y * cam.zoom; selectNode(n); }};
  hubsEl.appendChild(el);
}});

document.getElementById('search').addEventListener('input', e => {{ filter = e.target.value; }});
canvas.addEventListener('mousedown', e => {{ dragging = true; lastX = e.clientX; lastY = e.clientY; }});
window.addEventListener('mouseup', () => {{ dragging = false; }});
window.addEventListener('mousemove', e => {{
  if (!dragging) return;
  cam.x += e.clientX - lastX; cam.y += e.clientY - lastY;
  lastX = e.clientX; lastY = e.clientY;
}});
canvas.addEventListener('click', e => {{
  const rect = canvas.getBoundingClientRect();
  const w = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
  let hit = null, best = 20 / cam.zoom;
  for (const n of nodes) {{
    const d = Math.hypot(n.x - w.x, n.y - w.y);
    if (d < best) {{ best = d; hit = n; }}
  }}
  selectNode(hit);
}});
canvas.addEventListener('wheel', e => {{
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.12 : 0.89;
  cam.zoom = Math.max(0.15, Math.min(4, cam.zoom * factor));
}}, {{ passive: false }});
</script>
</body>
</html>"#
    )
}

async fn build_native_rust_graph(
    app: &AppHandle,
    project_dir: &Path,
    directed: bool,
) -> Result<(usize, usize, String), String> {
    emit_graphify_progress(
        app,
        "Analisando AST/dependências determinísticas localmente via motor Rust...",
    );

    let dir_owned = project_dir.to_path_buf();
    let project_name = project_dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("project")
        .to_string();
    let project_name_for_task = project_name.clone();

    let (graph_json_val, report_md, nodes_count, edges_count) = tokio::task::spawn_blocking(
        move || -> Result<(Value, String, usize, usize), String> {
            let mut files: Vec<PathBuf> = Vec::new();
            let mut stack: Vec<PathBuf> = vec![dir_owned.clone()];

            while let Some(curr) = stack.pop() {
                if files.len() >= 1500 {
                    break;
                }
                let Ok(entries) = std::fs::read_dir(&curr) else {
                    continue;
                };
                for entry in entries.flatten() {
                    let path = entry.path();
                    let name = entry.file_name().to_string_lossy().to_string();
                    if path.is_dir() {
                        if !should_skip_graph_dir(&name) {
                            stack.push(path);
                        }
                    } else if path.is_file() {
                        let ext = path
                            .extension()
                            .and_then(|e| e.to_str())
                            .unwrap_or("")
                            .to_ascii_lowercase();
                        if is_source_extension(&ext) {
                            files.push(path);
                        }
                    }
                }
            }

            let import_re = Regex::new(
                r#"(?:import\s+.*?\s+from\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|from\s+([a-zA-Z0-9_\.]+)\s+import|use\s+(crate::[a-zA-Z0-9_:]+))"#,
            )
            .unwrap();
            let symbol_re = Regex::new(
                r"(?m)^(?:export\s+(?:async\s+)?(?:function|class|const|interface|type)|pub\s+(?:async\s+)?(?:fn|struct|enum|trait)|def|class)\s+([a-zA-Z_][a-zA-Z0-9_]*)",
            )
            .unwrap();

            let mut rel_paths: Vec<String> = Vec::new();
            let mut path_lookup: HashMap<String, String> = HashMap::new();
            let mut stem_lookup: HashMap<String, String> = HashMap::new();

            for f in &files {
                let rel = f
                    .strip_prefix(&dir_owned)
                    .unwrap_or(f)
                    .to_string_lossy()
                    .replace('\\', "/");
                let no_ext = rel
                    .rsplit_once('.')
                    .map(|(a, _)| a.to_string())
                    .unwrap_or_else(|| rel.clone());
                path_lookup.insert(rel.clone(), rel.clone());
                path_lookup.insert(no_ext.clone(), rel.clone());
                if let Some(stem) = f.file_stem().and_then(|s| s.to_str()) {
                    stem_lookup.entry(stem.to_string()).or_insert_with(|| rel.clone());
                }
                rel_paths.push(rel);
            }

            let mut node_symbols: HashMap<String, Vec<String>> = HashMap::new();
            let mut edges_set: HashSet<(String, String, &'static str)> = HashSet::new();
            let mut degree: HashMap<String, usize> = HashMap::new();

            for (idx, f) in files.iter().enumerate() {
                let src_rel = &rel_paths[idx];
                let Ok(content) = std::fs::read_to_string(f) else {
                    continue;
                };
                let capped = if content.len() > 256 * 1024 {
                    &content[..256 * 1024]
                } else {
                    &content
                };

                let mut syms = Vec::new();
                for cap in symbol_re.captures_iter(capped) {
                    if let Some(m) = cap.get(1) {
                        let s = m.as_str().to_string();
                        if !syms.contains(&s) {
                            syms.push(s);
                        }
                        if syms.len() >= 25 {
                            break;
                        }
                    }
                }
                node_symbols.insert(src_rel.clone(), syms);

                let src_parent = Path::new(src_rel)
                    .parent()
                    .map(|p| p.to_string_lossy().replace('\\', "/"))
                    .unwrap_or_default();

                for cap in import_re.captures_iter(capped) {
                    let raw_target = cap
                        .get(1)
                        .or_else(|| cap.get(2))
                        .or_else(|| cap.get(3))
                        .or_else(|| cap.get(4))
                        .map(|m| m.as_str())
                        .unwrap_or("");
                    if raw_target.is_empty() {
                        continue;
                    }

                    let resolved = if raw_target.starts_with('.') {
                        let joined = if src_parent.is_empty() {
                            PathBuf::from(raw_target)
                        } else {
                            PathBuf::from(&src_parent).join(raw_target)
                        };
                        let mut norm_parts: Vec<String> = Vec::new();
                        for comp in joined.components() {
                            match comp {
                                std::path::Component::Normal(s) => {
                                    norm_parts.push(s.to_string_lossy().to_string())
                                }
                                std::path::Component::ParentDir => {
                                    norm_parts.pop();
                                }
                                _ => {}
                            }
                        }
                        let norm_str = norm_parts.join("/");
                        path_lookup
                            .get(&norm_str)
                            .or_else(|| path_lookup.get(&format!("{norm_str}/index")))
                            .cloned()
                    } else if let Some(rust_path) = raw_target.strip_prefix("crate::") {
                        let seg = rust_path.split("::").next().unwrap_or("");
                        stem_lookup.get(seg).cloned()
                    } else {
                        let last_seg = raw_target
                            .split(['/', '.'])
                            .last()
                            .unwrap_or(raw_target);
                        stem_lookup.get(last_seg).cloned()
                    };

                    if let Some(target_rel) = resolved {
                        if &target_rel != src_rel {
                            edges_set.insert((src_rel.clone(), target_rel, "imports"));
                        }
                    }
                }
            }

            for (src, dst, _) in &edges_set {
                *degree.entry(src.clone()).or_insert(0) += 1;
                *degree.entry(dst.clone()).or_insert(0) += 1;
            }

            let mut communities: HashMap<String, usize> = HashMap::new();
            let mut nodes = Vec::with_capacity(rel_paths.len());
            for rel in &rel_paths {
                let community = rel
                    .split('/')
                    .next()
                    .filter(|_| rel.contains('/'))
                    .unwrap_or("root")
                    .to_string();
                *communities.entry(community.clone()).or_insert(0) += 1;
                let label = Path::new(rel)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or(rel)
                    .to_string();
                nodes.push(json!({
                    "id": rel,
                    "label": label,
                    "path": rel,
                    "type": "file",
                    "community": community,
                    "degree": degree.get(rel).copied().unwrap_or(0),
                    "symbols": node_symbols.get(rel).cloned().unwrap_or_default(),
                }));
            }

            let edges: Vec<Value> = edges_set
                .iter()
                .map(|(s, t, r)| {
                    json!({
                        "source": s,
                        "target": t,
                        "relation": r,
                    })
                })
                .collect();

            let nodes_count = nodes.len();
            let edges_count = edges.len();

            let mut top_hubs: Vec<(&String, usize)> =
                rel_paths.iter().map(|r| (r, degree.get(r).copied().unwrap_or(0))).collect();
            top_hubs.sort_by(|a, b| b.1.cmp(&a.1));

            let mut report = format!(
                "# Knowledge Graph Report — {project_name_for_task}\n\n- **Nós:** {nodes_count}\n- **Arestas:** {edges_count}\n- **Direcionado:** {directed}\n- **Comunidades:** {}\n\n## Principais Hubs Arquiteturais\n",
                communities.len()
            );
            for (path, deg) in top_hubs.iter().take(15) {
                report.push_str(&format!("- `{path}` (grau {deg})\n"));
            }
            report.push_str("\n## Comunidades\n");
            let mut comm_vec: Vec<(&String, &usize)> = communities.iter().collect();
            comm_vec.sort_by(|a, b| b.1.cmp(a.1));
            for (comm, count) in comm_vec.iter().take(20) {
                report.push_str(&format!("- **{comm}**: {count} arquivos\n"));
            }

            let graph_json = json!({
                "version": 1,
                "directed": directed,
                "projectName": project_name_for_task,
                "timestamp": chrono::Utc::now().to_rfc3339(),
                "nodes": nodes,
                "links": edges,
            });

            Ok((graph_json, report, nodes_count, edges_count))
        },
    )
    .await
    .map_err(|e| format!("Graphify task panicked: {e}"))??;

    let out_dir = project_dir.join("graphify-out");
    tokio::fs::create_dir_all(&out_dir)
        .await
        .map_err(|e| e.to_string())?;

    let json_bytes = serde_json::to_vec_pretty(&graph_json_val).map_err(|e| e.to_string())?;
    let json_str = String::from_utf8_lossy(&json_bytes).to_string();
    let html_str = generate_native_graph_html(&project_name, &json_str);

    tokio::fs::write(out_dir.join("graph.json"), &json_bytes)
        .await
        .map_err(|e| e.to_string())?;
    tokio::fs::write(out_dir.join("GRAPH_REPORT.md"), report_md.as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    tokio::fs::write(out_dir.join("graph.html"), html_str.as_bytes())
        .await
        .map_err(|e| e.to_string())?;

    Ok((nodes_count, edges_count, report_md))
}

async fn execute_graphify_build(app: &AppHandle, params: Value) -> Result<Value, String> {
    let target = params
        .get("target")
        .or_else(|| params.get("path"))
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| ".".to_string());

    let is_git_url = params
        .get("isGitUrl")
        .or_else(|| params.get("is_git_url"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
        || target.starts_with("http://")
        || target.starts_with("https://");

    let branch = params
        .get("branch")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let directed = params
        .get("directed")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    emit_graphify_progress(app, "Verificando motor Graphify integrado...");

    let project_dir = if is_git_url {
        clone_graphify_repo(app, &target, branch.as_deref()).await?
    } else {
        let safe = assert_safe_path_string(&target)?;
        dunce::canonicalize(&safe).unwrap_or(safe)
    };

    if !project_dir.exists() {
        return Err(format!(
            "Diretório do projeto não encontrado: {}",
            project_dir.display()
        ));
    }

    emit_graphify_progress(app, "Extraindo AST e relações de dependências determinísticas...");

    let used_python = try_python_graphify(&project_dir, directed).await;
    let out_dir = project_dir.join("graphify-out");
    let graph_html = out_dir.join("graph.html");
    let graph_json = out_dir.join("graph.json");
    let graph_report = out_dir.join("GRAPH_REPORT.md");

    let (nodes_count, edges_count, report_content) = if used_python && graph_html.exists() {
        let rep = tokio::fs::read_to_string(&graph_report)
            .await
            .unwrap_or_default();
        let (nc, ec) = if let Ok(bytes) = tokio::fs::read(&graph_json).await {
            if let Ok(v) = serde_json::from_slice::<Value>(&bytes) {
                let n = v.get("nodes").and_then(|a| a.as_array()).map(|a| a.len()).unwrap_or(0);
                let e = v
                    .get("links")
                    .or_else(|| v.get("edges"))
                    .and_then(|a| a.as_array())
                    .map(|a| a.len())
                    .unwrap_or(0);
                (n, e)
            } else {
                (0, 0)
            }
        } else {
            (0, 0)
        };
        (nc, ec, rep)
    } else {
        build_native_rust_graph(app, &project_dir, directed).await?
    };

    let project_name = project_dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("project")
        .to_string();
    let html_url = format!(
        "file:///{}",
        graph_html
            .to_string_lossy()
            .replace('\\', "/")
            .trim_start_matches('/')
    );

    emit_graphify_progress(
        app,
        &format!("Grafo concluído com sucesso: {nodes_count} nós, {edges_count} arestas."),
    );

    Ok(json!({
        "ok": true,
        "projectName": project_name,
        "projectDir": project_dir.to_string_lossy().to_string(),
        "htmlUrl": html_url,
        "graphHtmlPath": graph_html.to_string_lossy().to_string(),
        "graphReportPath": graph_report.to_string_lossy().to_string(),
        "reportContent": report_content,
        "nodesCount": nodes_count,
        "edgesCount": edges_count,
    }))
}

fn execute_graphify_check(dir: &str) -> Value {
    let base = if dir.trim().is_empty() {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    } else {
        match assert_safe_path_string(dir.trim()) {
            Ok(p) => dunce::canonicalize(&p).unwrap_or(p),
            Err(_) => return json!({ "hasGraph": false, "exists": false }),
        }
    };

    let mut curr = base.as_path();
    for _ in 0..4 {
        let out_dir = curr.join("graphify-out");
        let rep = out_dir.join("GRAPH_REPORT.md");
        let html = out_dir.join("graph.html");
        let json_path = out_dir.join("graph.json");

        if json_path.exists() && (rep.exists() || html.exists()) {
            let report_content = std::fs::read_to_string(&rep).unwrap_or_default();
            let project_name = curr
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("project")
                .to_string();
            let html_url = format!(
                "file:///{}",
                html.to_string_lossy()
                    .replace('\\', "/")
                    .trim_start_matches('/')
            );
            return json!({
                "hasGraph": true,
                "exists": true,
                "projectName": project_name,
                "projectDir": curr.to_string_lossy().to_string(),
                "reportContent": report_content,
                "htmlUrl": html_url,
                "graphHtmlPath": html.to_string_lossy().to_string(),
                "graphJsonPath": json_path.to_string_lossy().to_string(),
            });
        }

        match curr.parent() {
            Some(parent) if parent != curr => curr = parent,
            _ => break,
        }
    }

    json!({
        "hasGraph": false,
        "exists": false,
    })
}

async fn execute_graphify_query(dir: &str, question: &str, dfs: bool) -> Result<String, String> {
    let check = execute_graphify_check(dir);
    let Some(json_path) = check.get("graphJsonPath").and_then(|v| v.as_str()) else {
        return Ok("Nenhum Knowledge Graph encontrado neste diretório.".to_string());
    };
    let project_dir = check
        .get("projectDir")
        .and_then(|v| v.as_str())
        .unwrap_or(dir);

    let mut args = vec!["-m", "graphify", "query", question];
    if dfs {
        args.push("--dfs");
    }
    let mut cmd = tokio::process::Command::new("python");
    cmd.current_dir(project_dir);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.args(&args);
    if let Ok(out) = cmd.output().await {
        if out.status.success() {
            let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !text.is_empty() {
                return Ok(text);
            }
        }
    }

    // Native JSON fallback query
    let bytes = tokio::fs::read(json_path).await.map_err(|e| e.to_string())?;
    let g: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    let q_lower = question.to_lowercase();
    let terms: Vec<&str> = q_lower.split_whitespace().collect();
    let nodes = g.get("nodes").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let mut hits = Vec::new();
    for n in &nodes {
        let label = n.get("label").and_then(|v| v.as_str()).unwrap_or("");
        let path = n.get("path").and_then(|v| v.as_str()).unwrap_or("");
        let hay = format!("{} {}", label.to_lowercase(), path.to_lowercase());
        if terms.iter().any(|t| hay.contains(t)) {
            hits.push(format!("- {} ({})", label, path));
        }
    }
    if hits.is_empty() {
        Ok(format!("Nenhum nó correspondente a '{question}'."))
    } else {
        hits.truncate(20);
        Ok(format!("Resultados para '{question}':\n{}", hits.join("\n")))
    }
}

async fn execute_graphify_explain(dir: &str, symbol: &str) -> Result<String, String> {
    let check = execute_graphify_check(dir);
    let Some(json_path) = check.get("graphJsonPath").and_then(|v| v.as_str()) else {
        return Ok("Nenhum Knowledge Graph encontrado neste diretório.".to_string());
    };
    let bytes = tokio::fs::read(json_path).await.map_err(|e| e.to_string())?;
    let g: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    let sym_lower = symbol.to_lowercase();
    let nodes = g.get("nodes").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let links = g
        .get("links")
        .or_else(|| g.get("edges"))
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let found = nodes.iter().find(|n| {
        n.get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_lowercase()
            .contains(&sym_lower)
            || n.get("label")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_lowercase()
                .contains(&sym_lower)
    });

    let Some(node) = found else {
        return Ok(format!("Símbolo ou módulo '{symbol}' não encontrado no grafo."));
    };
    let id = node.get("id").and_then(|v| v.as_str()).unwrap_or("");
    let neighbors: Vec<String> = links
        .iter()
        .filter_map(|e| {
            let s = e.get("source").and_then(|v| v.as_str()).unwrap_or("");
            let t = e.get("target").and_then(|v| v.as_str()).unwrap_or("");
            if s == id {
                Some(format!("-> {t}"))
            } else if t == id {
                Some(format!("<- {s}"))
            } else {
                None
            }
        })
        .take(20)
        .collect();

    Ok(format!(
        "Nó: {id}\nConexões:\n{}",
        if neighbors.is_empty() {
            "  (nenhuma aresta)".to_string()
        } else {
            neighbors.join("\n")
        }
    ))
}

async fn execute_graphify_path(dir: &str, from: &str, to: &str) -> Result<String, String> {
    let check = execute_graphify_check(dir);
    let Some(json_path) = check.get("graphJsonPath").and_then(|v| v.as_str()) else {
        return Ok("Nenhum Knowledge Graph encontrado neste diretório.".to_string());
    };
    let bytes = tokio::fs::read(json_path).await.map_err(|e| e.to_string())?;
    let g: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    let links = g
        .get("links")
        .or_else(|| g.get("edges"))
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let mut adj: HashMap<String, Vec<String>> = HashMap::new();
    for e in &links {
        if let (Some(s), Some(t)) = (
            e.get("source").and_then(|v| v.as_str()),
            e.get("target").and_then(|v| v.as_str()),
        ) {
            adj.entry(s.to_string()).or_default().push(t.to_string());
            adj.entry(t.to_string()).or_default().push(s.to_string());
        }
    }

    let mut q = VecDeque::new();
    let mut parent: HashMap<String, String> = HashMap::new();
    let mut visited = HashSet::new();
    q.push_back(from.to_string());
    visited.insert(from.to_string());

    while let Some(curr) = q.pop_front() {
        if curr == to {
            let mut path = vec![curr.clone()];
            let mut cur = curr;
            while let Some(p) = parent.get(&cur) {
                path.push(p.clone());
                cur = p.clone();
            }
            path.reverse();
            return Ok(path.join(" -> "));
        }
        if let Some(nexts) = adj.get(&curr) {
            for n in nexts {
                if visited.insert(n.clone()) {
                    parent.insert(n.clone(), curr.clone());
                    q.push_back(n.clone());
                }
            }
        }
    }

    Ok(format!("Nenhum caminho encontrado entre '{from}' e '{to}'."))
}

#[tauri::command]
pub async fn graphify_build(
    app: AppHandle,
    _runner: State<'_, GraphifyRunner>,
    params: Value,
) -> Result<Value, String> {
    execute_graphify_build(&app, params).await
}

#[tauri::command]
pub async fn graphify_check(
    _runner: State<'_, GraphifyRunner>,
    dir: String,
) -> Result<Value, String> {
    Ok(execute_graphify_check(&dir))
}

// ============================================================================
// Git & Floor Worktree Helpers
// ============================================================================

async fn resolve_workspace_dir(storage: &StorageEngine, ws_id: Option<&str>) -> Option<PathBuf> {
    let target_id = match ws_id {
        Some(id) if !id.is_empty() => Some(id.to_string()),
        _ => storage.get_active_workspace_id().await.ok().flatten(),
    }?;
    let ws = read_workspace_value(storage, &target_id).await.ok().flatten()?;
    let dir = ws
        .get("workingDirectory")
        .or_else(|| ws.get("rootPath"))
        .and_then(|v| v.as_str())?;
    assert_safe_path_string(dir).ok()
}

async fn resolve_git_dir(
    storage: &StorageEngine,
    ws_id: Option<&str>,
    explicit_dir: Option<&str>,
) -> Result<PathBuf, String> {
    if let Some(d) = explicit_dir.filter(|s| !s.trim().is_empty()) {
        return assert_safe_path_string(d.trim());
    }
    resolve_workspace_dir(storage, ws_id)
        .await
        .ok_or_else(|| "Diretório Git do workspace não encontrado".to_string())
}

// ============================================================================
// Routines, License, Data Backup & File Helpers (Atomic via StorageEngine)
// ============================================================================

async fn read_json_array_file(path: &Path) -> Vec<Value> {
    if !path.exists() {
        return Vec::new();
    }
    if let Ok(bytes) = tokio::fs::read(path).await {
        if let Ok(val) = serde_json::from_slice::<Value>(&bytes) {
            if let Some(arr) = val.as_array() {
                return arr.clone();
            }
            if let Some(arr) = val
                .get("routines")
                .or_else(|| val.get("history"))
                .and_then(|v| v.as_array())
            {
                return arr.clone();
            }
        }
    }
    Vec::new()
}

async fn write_json_value(storage: &StorageEngine, path: &Path, val: &Value) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(val).map_err(|e| e.to_string())?;
    storage
        .replace_file_atomically(path, &bytes)
        .await
        .map_err(|e| e.to_string())
}

async fn create_zip_backup(storage: &StorageEngine, dest: Option<&str>) -> Result<Value, String> {
    let data_dir = storage.get_data_dir();
    let backups_dir = data_dir.join("backups");
    tokio::fs::create_dir_all(&backups_dir)
        .await
        .map_err(|e| e.to_string())?;

    let target_path = match dest.filter(|s| !s.trim().is_empty()) {
        Some(raw) => assert_safe_path_string(raw)?,
        None => {
            let ts = chrono::Utc::now().format("%Y%m%d-%H%M%S");
            backups_dir.join(format!("mindagentics-backup-{ts}.zip"))
        }
    };

    if let Some(parent) = target_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }

    let data_dir_clone = data_dir.clone();
    let target_clone = target_path.clone();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let file = std::fs::File::create(&target_clone).map_err(|e| e.to_string())?;
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);

        let mut stack = vec![data_dir_clone.clone()];
        while let Some(dir) = stack.pop() {
            let Ok(entries) = std::fs::read_dir(&dir) else {
                continue;
            };
            for entry in entries.flatten() {
                let p = entry.path();
                if p.starts_with(data_dir_clone.join("backups")) {
                    continue;
                }
                if p.is_dir() {
                    stack.push(p);
                } else if p.is_file() {
                    if let Ok(rel) = p.strip_prefix(&data_dir_clone) {
                        let name = rel.to_string_lossy().replace('\\', "/");
                        if let Ok(bytes) = std::fs::read(&p) {
                            let _ = zip.start_file(name, options);
                            use std::io::Write;
                            let _ = zip.write_all(&bytes);
                        }
                    }
                }
            }
        }
        zip.finish().map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(json!({
        "ok": true,
        "path": target_path.to_string_lossy().to_string(),
    }))
}

async fn import_zip_backup(storage: &StorageEngine, zip_path: &str) -> Result<Value, String> {
    let safe_zip = assert_safe_path_string(zip_path)?;
    if !safe_zip.exists() {
        return Err("Arquivo de backup não encontrado".to_string());
    }
    let data_dir = storage.get_data_dir();

    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let file = std::fs::File::open(&safe_zip).map_err(|e| e.to_string())?;
        let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
        for i in 0..archive.len() {
            let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
            if entry.is_dir() {
                continue;
            }
            let Some(rel_path) = entry.enclosed_name().map(|p| p.to_path_buf()) else {
                continue;
            };
            let dest = data_dir.join(&rel_path);
            if let Some(parent) = dest.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let mut out = std::fs::File::create(&dest).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(json!({ "ok": true }))
}

// ============================================================================
// Universal IPC Dispatcher (Electron parity for mindagentics:* channels)
// ============================================================================

#[tauri::command]
pub async fn ipc_dispatch(
    app: AppHandle,
    storage: State<'_, Arc<StorageEngine>>,
    pty: State<'_, Arc<PtyManager>>,
    daemon: State<'_, Arc<DaemonServer>>,
    channel: String,
    args: Vec<Value>,
) -> Result<Value, String> {
    match channel.as_str() {
        // --------------------------------------------------------------------
        // App
        // --------------------------------------------------------------------
        "mindagentics:app:info" => Ok(build_app_info_value(&storage, &daemon)),
        "mindagentics:app:setLocale" => {
            let locale = arg_str(&args, 0).unwrap_or_else(|| "pt-BR".to_string());
            app_set_locale(app, storage, locale).await
        }
        "mindagentics:app:localDirectorySuggestions" => {
            let partial = arg_str(&args, 0);
            let limit = arg_usize(&args, 1);
            let list = app_local_directory_suggestions(partial, limit).await;
            Ok(Value::Array(list.into_iter().map(Value::String).collect()))
        }
        "mindagentics:app:directoryState" => {
            let ws_id = arg_str(&args, 0);
            let env = arg_opt(&args, 1).cloned();
            let path = arg_str(&args, 2)
                .or_else(|| arg_str(&args, 0))
                .unwrap_or_default();
            app_directory_state(ws_id, env, path).await
        }
        "mindagentics:app:createDirectory" => {
            let ws_id = arg_str(&args, 0);
            let env = arg_opt(&args, 1).cloned();
            let path = arg_str(&args, 2)
                .or_else(|| arg_str(&args, 0))
                .unwrap_or_default();
            app_create_directory(ws_id, env, path).await
        }
        "mindagentics:app:pickDirectory" => {
            let res = pick_directory(app).await?;
            Ok(res.map(Value::String).unwrap_or(Value::Null))
        }
        "mindagentics:app:pickReference" => {
            let opts: Option<PickRefOptions> = arg_opt(&args, 0)
                .cloned()
                .and_then(|v| serde_json::from_value(v).ok());
            let res = app_pick_reference(app, opts).await?;
            serde_json::to_value(res).map_err(|e| e.to_string())
        }
        "mindagentics:app:quit" => {
            app_quit(app).await?;
            Ok(json!({ "ok": true }))
        }
        "mindagentics:app:hideToTray" => {
            app_hide_to_tray(app).await?;
            Ok(json!({ "ok": true }))
        }
        "mindagentics:app:listIdes" => Ok(app_list_ides()),
        "mindagentics:app:openInIde" => {
            let ws_id = arg_str(&args, 0).unwrap_or_default();
            let ide_id = arg_str(&args, 1).unwrap_or_else(|| "vscode".to_string());
            app_open_in_ide(storage, ws_id, ide_id).await
        }
        "mindagentics:app:openExternal" => {
            let url = arg_str(&args, 0).unwrap_or_default();
            let ok = open_external(app, url).await?;
            Ok(Value::Bool(ok))
        }
        "mindagentics:app:openPath" => {
            let path = arg_str(&args, 0).unwrap_or_default();
            let ok = open_path(app, path).await?;
            Ok(Value::Bool(ok))
        }
        "mindagentics:app:diagnosticReport" => app_diagnostic_report(storage, daemon, pty).await,
        "mindagentics:app:saveDiagnosticReport" => app_save_diagnostic_report(storage, daemon).await,
        "mindagentics:app:rendererBooted" => {
            tracing::info!("[Renderer] Booted");
            Ok(json!({ "ok": true }))
        }
        "mindagentics:app:reportRendererFault" | "mindagentics:app:rendererFault" => {
            tracing::error!("[Renderer Fault] {:?}", args.first());
            Ok(json!({ "ok": true }))
        }
        "mindagentics:app:shutdownPainted" | "mindagentics:app:showEmojiPanel" => {
            Ok(json!({ "ok": true }))
        }

        // --------------------------------------------------------------------
        // Window Controls
        // --------------------------------------------------------------------
        "mindagentics:window:state" | "mindagentics:windowControls:state" => window_state(app).await,
        "mindagentics:window:minimize" | "mindagentics:windowControls:minimize" => {
            window_minimize(app).await?;
            Ok(json!({ "ok": true }))
        }
        "mindagentics:window:maximize" | "mindagentics:windowControls:maximize" => {
            window_maximize(app).await?;
            Ok(json!({ "ok": true }))
        }
        "mindagentics:window:toggleMaximize" | "mindagentics:windowControls:toggleMaximize" => {
            window_toggle_maximize(app).await?;
            Ok(json!({ "ok": true }))
        }
        "mindagentics:window:close" | "mindagentics:windowControls:close" => {
            window_close(app).await?;
            Ok(json!({ "ok": true }))
        }

        // --------------------------------------------------------------------
        // AppState
        // --------------------------------------------------------------------
        "mindagentics:appState:get" => {
            let state = storage.get_app_state().await.map_err(|e| e.to_string())?;
            let mut val = serde_json::to_value(&state).map_err(|e| e.to_string())?;
            if let Some(obj) = val.as_object_mut() {
                if let Some(v) = obj.get("hasCompletedOnboarding").cloned() {
                    obj.entry("completedOnboarding").or_insert(v);
                }
            }
            Ok(val)
        }
        "mindagentics:appState:setOnboardingCompleted" => {
            let completed = arg_bool(&args, 0).unwrap_or(true);
            storage
                .set_onboarding_completed(completed)
                .await
                .map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true }))
        }
        "mindagentics:appState:setHasSeenFloorOnboarding" => {
            let seen = arg_bool(&args, 0).unwrap_or(true);
            storage
                .set_has_seen_floor_onboarding(seen)
                .await
                .map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true }))
        }

        // --------------------------------------------------------------------
        // Preferences
        // --------------------------------------------------------------------
        "mindagentics:preferences:get" => {
            let prefs = storage.get_preferences().await.map_err(|e| e.to_string())?;
            serde_json::to_value(&prefs).map_err(|e| e.to_string())
        }
        "mindagentics:preferences:set" => {
            let patch = arg_opt(&args, 0).cloned().unwrap_or(json!({}));
            let updated = storage
                .set_preferences(patch)
                .await
                .map_err(|e| e.to_string())?;
            let _ = app.emit("mindagentics:preferences:onChanged", &updated);
            Ok(json!({ "ok": true, "preferences": updated }))
        }
        "mindagentics:preferences:subscribe" | "mindagentics:preferences:unsubscribe" => {
            Ok(json!({ "ok": true }))
        }

        // --------------------------------------------------------------------
        // Workspaces
        // --------------------------------------------------------------------
        "mindagentics:workspace:list" => {
            let list = workspace_list(storage).await?;
            Ok(Value::Array(list))
        }
        "mindagentics:workspace:getActiveId" => {
            let active = workspace_get_active_id(storage).await?;
            Ok(active.map(Value::String).unwrap_or(Value::Null))
        }
        "mindagentics:workspace:create" => {
            let data = arg_opt(&args, 0).cloned();
            workspace_create(storage, data, None, None).await
        }
        "mindagentics:workspace:patch" => {
            let id = arg_str(&args, 0).unwrap_or_default();
            let patch = arg_opt(&args, 1).cloned();
            workspace_patch(storage, id, patch, None).await
        }
        "mindagentics:workspace:delete" => {
            let id = arg_str(&args, 0).unwrap_or_default();
            let delete_dir = arg_bool(&args, 1);
            workspace_delete(app, storage, id, delete_dir).await
        }
        "mindagentics:workspace:switch" => {
            let id = arg_str(&args, 0).unwrap_or_default();
            let ws = workspace_switch(storage, id).await?;
            Ok(json!({ "ok": true, "workspace": ws }))
        }
        "mindagentics:workspace:duplicate" => {
            let id = arg_str(&args, 0).unwrap_or_default();
            let copy = storage
                .duplicate_workspace(&id)
                .await
                .map_err(|e| e.to_string())?;
            let val = serde_json::to_value(copy).map_err(|e| e.to_string())?;
            Ok(enrich_workspace_json(val))
        }
        "mindagentics:workspace:export" => {
            let id = arg_str(&args, 0).unwrap_or_default();
            let dest = arg_str(&args, 1);
            let res = storage
                .export_workspace(&id, dest.as_deref())
                .await
                .map_err(|e| e.to_string())?;
            if dest.is_none() {
                if let Some(json_str) = res.get("json").cloned() {
                    return Ok(json_str);
                }
            }
            Ok(res)
        }
        "mindagentics:workspace:import" => {
            let src = match arg_opt(&args, 0) {
                Some(Value::String(s)) => Some(s.clone()),
                Some(Value::Array(arr)) => arr.first().and_then(|v| v.as_str()).map(|s| s.to_string()),
                _ => None,
            };
            let ws = storage
                .import_workspace(src.as_deref())
                .await
                .map_err(|e| e.to_string())?;
            let val = serde_json::to_value(ws).map_err(|e| e.to_string())?;
            Ok(enrich_workspace_json(val))
        }
        "mindagentics:workspace:reveal" => {
            let target = arg_str(&args, 0).unwrap_or_default();
            let dir = if let Some(ws) = read_workspace_value(&storage, &target).await? {
                ws.get("workingDirectory")
                    .or_else(|| ws.get("rootPath"))
                    .and_then(|v| v.as_str())
                    .unwrap_or(&target)
                    .to_string()
            } else {
                target
            };
            let safe = assert_safe_path_string(&dir)?;
            app.opener()
                .open_path(safe.to_string_lossy().to_string(), None::<&str>)
                .map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true }))
        }
        "mindagentics:workspace:setPreferredIde" => {
            let id = arg_str(&args, 0).unwrap_or_default();
            let ide = arg_str(&args, 1).unwrap_or_else(|| "vscode".to_string());
            storage
                .patch_workspace(&id, json!({ "preferredIde": ide }))
                .await
                .map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true }))
        }

        // --------------------------------------------------------------------
        // Floor & Git Worktrees
        // --------------------------------------------------------------------
        "mindagentics:floor:isolationAvailable" => {
            let ws_id = arg_str(&args, 0);
            let dir_arg = arg_str(&args, 1);
            let Ok(dir) = resolve_git_dir(&storage, ws_id.as_deref(), dir_arg.as_deref()).await
            else {
                return Ok(Value::Bool(false));
            };
            let ok = run_git_args(&["rev-parse", "--is-inside-work-tree"], &dir)
                .await
                .map(|s| s == "true")
                .unwrap_or(false);
            Ok(Value::Bool(ok))
        }
        "mindagentics:floor:canCopy" => Ok(json!({ "canCopy": true })),
        "mindagentics:floor:createKind" => {
            let ws_id = arg_str(&args, 0);
            let dir_arg = match arg_opt(&args, 1) {
                Some(Value::String(s)) => Some(s.clone()),
                Some(Value::Object(o)) => o
                    .get("workingDirectory")
                    .or_else(|| o.get("repoDir"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                _ => None,
            };
            let is_git = match resolve_git_dir(&storage, ws_id.as_deref(), dir_arg.as_deref()).await
            {
                Ok(dir) => run_git_args(&["rev-parse", "--is-inside-work-tree"], &dir)
                    .await
                    .map(|s| s == "true")
                    .unwrap_or(false),
                Err(_) => false,
            };
            Ok(Value::String(if is_git {
                "worktree".to_string()
            } else {
                "copy".to_string()
            }))
        }
        "mindagentics:floor:listBranches" => {
            let ws_id = arg_str(&args, 0);
            let dir_arg = arg_str(&args, 1);
            let Ok(dir) = resolve_git_dir(&storage, ws_id.as_deref(), dir_arg.as_deref()).await
            else {
                return Ok(Value::Array(Vec::new()));
            };
            let out = run_git_args(&["branch", "-a", "--format=%(refname:short)"], &dir)
                .await
                .unwrap_or_default();
            let branches: Vec<Value> = out
                .lines()
                .map(|l| l.trim())
                .filter(|l| !l.is_empty())
                .map(|l| Value::String(l.to_string()))
                .collect();
            Ok(Value::Array(branches))
        }
        "mindagentics:floor:createIsolated" => {
            // Supports both (optionsObj) and (workspaceId, inputObj, requestId)
            let (ws_id, input_obj) = if args.len() >= 2 && args[0].is_string() {
                (
                    arg_str(&args, 0),
                    arg_opt(&args, 1).cloned().unwrap_or(json!({})),
                )
            } else {
                let obj = arg_opt(&args, 0).cloned().unwrap_or(json!({}));
                let ws = obj
                    .get("workspaceId")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                (ws, obj)
            };

            let repo_dir_arg = input_obj
                .get("repoDir")
                .or_else(|| input_obj.get("workingDirectory"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let dir = resolve_git_dir(&storage, ws_id.as_deref(), repo_dir_arg.as_deref()).await?;

            let repo_root_str = run_git_args(&["rev-parse", "--show-toplevel"], &dir).await?;
            let repo_root = PathBuf::from(&repo_root_str);
            let common_dir_raw = run_git_args(&["rev-parse", "--git-common-dir"], &dir).await?;
            let common_dir = dunce::canonicalize(dir.join(common_dir_raw))
                .unwrap_or_else(|_| dir.join(".git"));

            let floor_id = input_obj
                .get("floorId")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| format!("floor-{}", uuid::Uuid::new_v4().simple()));
            let branch = input_obj
                .get("branch")
                .or_else(|| input_obj.get("name"))
                .and_then(|v| v.as_str())
                .map(|s| sanitize_label(s, 80))
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| format!("floor/{floor_id}"));
            let base_branch = input_obj
                .get("baseBranch")
                .and_then(|v| v.as_str())
                .unwrap_or("HEAD");

            let worktree_path = repo_root
                .join(".mindagentics")
                .join("floors")
                .join(&floor_id);
            if let Some(parent) = worktree_path.parent() {
                tokio::fs::create_dir_all(parent)
                    .await
                    .map_err(|e| e.to_string())?;
            }

            let branches_out = run_git_args(&["branch", "-a", "--format=%(refname:short)"], &repo_root)
                .await
                .unwrap_or_default();
            let branch_exists = branches_out.lines().any(|b| b.trim() == branch);
            let wt_str = worktree_path.to_string_lossy().to_string();

            if branch_exists {
                run_git_args(&["worktree", "add", &wt_str, &branch], &repo_root).await?;
            } else {
                run_git_args(
                    &["worktree", "add", "-b", &branch, &wt_str, base_branch],
                    &repo_root,
                )
                .await?;
            }

            let descriptor = json!({
                "version": 1,
                "workspaceId": ws_id.unwrap_or_else(|| "default".to_string()),
                "floorId": floor_id,
                "commonDir": common_dir.to_string_lossy().to_string(),
                "repoRoot": repo_root.to_string_lossy().to_string(),
                "worktreePath": wt_str,
                "branch": branch,
                "branchCreatedByMindAgentics": !branch_exists,
                "createdAt": chrono::Utc::now().to_rfc3339(),
                "state": "ready",
            });
            let desc_path = worktree_path.join(".mindagentics-floor.json");
            let desc_bytes = serde_json::to_vec_pretty(&descriptor).map_err(|e| e.to_string())?;
            tokio::fs::write(&desc_path, &desc_bytes)
                .await
                .map_err(|e| e.to_string())?;

            Ok(descriptor)
        }
        "mindagentics:floor:landingPreflight" => {
            let input = arg_opt(&args, 0).cloned().unwrap_or(json!({}));
            let worktree_path = input
                .get("worktreePath")
                .and_then(|v| v.as_str())
                .or_else(|| args.get(1).and_then(|v| v.as_str()))
                .unwrap_or(".");
            let target_branch = input
                .get("targetBranch")
                .and_then(|v| v.as_str())
                .unwrap_or("main");
            let wt = assert_safe_path_string(worktree_path)?;
            let diff_stat = run_git_args(&["diff", "--stat", target_branch], &wt)
                .await
                .unwrap_or_default();
            let range = format!("{target_branch}..HEAD");
            let commits_raw = run_git_args(&["log", &range, "--oneline"], &wt)
                .await
                .unwrap_or_default();
            let status_raw = run_git_args(&["status", "--porcelain"], &wt)
                .await
                .unwrap_or_default();
            let dirty_files: Vec<Value> = status_raw
                .lines()
                .filter(|l| l.len() > 3)
                .map(|l| Value::String(l[3..].trim().to_string()))
                .collect();
            let commits: Vec<Value> = commits_raw
                .lines()
                .filter(|l| !l.trim().is_empty())
                .map(|l| Value::String(l.to_string()))
                .collect();

            Ok(json!({
                "canLand": dirty_files.is_empty(),
                "diffStat": diff_stat,
                "commits": commits,
                "dirtyFiles": dirty_files,
            }))
        }
        "mindagentics:floor:land" => {
            let input = arg_opt(&args, 0).cloned().unwrap_or(json!({}));
            let repo_dir = input
                .get("repoDir")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let dir = resolve_git_dir(&storage, arg_str(&args, 0).as_deref(), repo_dir.as_deref()).await?;
            let source_branch = input
                .get("sourceBranch")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "sourceBranch ausente".to_string())?;
            let target_branch = input
                .get("targetBranch")
                .and_then(|v| v.as_str())
                .or_else(|| args.get(2).and_then(|v| v.as_str()))
                .unwrap_or("main");
            let worktree_path = input.get("worktreePath").and_then(|v| v.as_str());
            let delete_branch = input
                .get("deleteBranch")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            run_git_args(&["checkout", target_branch], &dir).await?;
            run_git_args(&["merge", source_branch], &dir).await?;

            if delete_branch {
                if let Some(wt) = worktree_path {
                    let safe_wt = assert_safe_path_string(wt)?;
                    if is_inside(&dir, &safe_wt) {
                        let _ = run_git_args(&["worktree", "remove", "--force", wt], &dir).await;
                    }
                }
                let _ = run_git_args(&["branch", "-D", source_branch], &dir).await;
            }

            Ok(json!({ "ok": true }))
        }
        "mindagentics:floor:delete" => {
            let first = arg_opt(&args, 0).cloned().unwrap_or(json!({}));
            let delete_branch = arg_bool(&args, 1)
                .or_else(|| arg_bool(&args, 2))
                .unwrap_or(false);
            if let (Some(wt), Some(repo_root)) = (
                first.get("worktreePath").and_then(|v| v.as_str()),
                first.get("repoRoot").and_then(|v| v.as_str()),
            ) {
                let safe_wt = assert_safe_path_string(wt)?;
                let safe_root = assert_safe_path_string(repo_root)?;
                if !is_inside(&safe_root, &safe_wt) {
                    return Err("Worktree path está fora do diretório raiz do repositório".to_string());
                }
                let _ = run_git_args(&["worktree", "remove", "--force", wt], &safe_root).await;
                if delete_branch {
                    if let Some(br) = first.get("branch").and_then(|v| v.as_str()) {
                        let _ = run_git_args(&["branch", "-D", br], &safe_root).await;
                    }
                }
            }
            Ok(json!({ "ok": true }))
        }
        "mindagentics:floor:switch"
        | "mindagentics:floor:create"
        | "mindagentics:floor:rename"
        | "mindagentics:floor:removeBranch" => {
            if channel == "mindagentics:floor:switch" {
                if let (Some(ws_id), Some(floor_id)) = (arg_str(&args, 0), arg_str(&args, 1)) {
                    let _ = storage
                        .patch_workspace(&ws_id, json!({ "activeFloorId": floor_id }))
                        .await;
                }
            }
            Ok(json!({ "ok": true }))
        }

        // --------------------------------------------------------------------
        // Git direct routes
        // --------------------------------------------------------------------
        "mindagentics:git:status" => {
            let dir = resolve_git_dir(&storage, None, arg_str(&args, 0).as_deref()).await?;
            let out = run_git_args(&["status", "--porcelain"], &dir).await?;
            Ok(json!({ "ok": true, "status": out }))
        }
        "mindagentics:git:branches" => {
            let dir = resolve_git_dir(&storage, None, arg_str(&args, 0).as_deref()).await?;
            let out = run_git_args(&["branch", "-a", "--format=%(refname:short)"], &dir).await?;
            let list: Vec<Value> = out
                .lines()
                .map(|l| l.trim())
                .filter(|l| !l.is_empty())
                .map(|l| Value::String(l.to_string()))
                .collect();
            Ok(Value::Array(list))
        }
        "mindagentics:git:currentBranch" => {
            let dir = resolve_git_dir(&storage, None, arg_str(&args, 0).as_deref()).await?;
            let branch = run_git_args(&["rev-parse", "--abbrev-ref", "HEAD"], &dir)
                .await
                .unwrap_or_else(|_| "main".to_string());
            Ok(Value::String(branch))
        }
        "mindagentics:git:diff" => {
            let dir = resolve_git_dir(&storage, None, arg_str(&args, 0).as_deref()).await?;
            let out = run_git_args(&["diff"], &dir).await?;
            Ok(Value::String(out))
        }
        "mindagentics:git:commit" => {
            let dir = resolve_git_dir(&storage, None, arg_str(&args, 0).as_deref()).await?;
            let msg = arg_str(&args, 1).unwrap_or_else(|| "chore: commit from mindAgentics".to_string());
            let out = run_git_args(&["commit", "-m", &msg], &dir).await?;
            Ok(json!({ "ok": true, "output": out }))
        }

        // --------------------------------------------------------------------
        // Terminals
        // --------------------------------------------------------------------
        "mindagentics:terminal:write" => {
            let tid = arg_str(&args, 0).unwrap_or_default();
            let data = arg_str(&args, 1).unwrap_or_default();
            pty.write(&tid, &data).await.map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true }))
        }
        "mindagentics:terminal:deliverPrompt" => {
            let tid = arg_str(&args, 0).unwrap_or_default();
            let prompt = arg_str(&args, 1).unwrap_or_default();
            let line = format!("{}\r\n", prompt.trim_end_matches(['\r', '\n']));
            pty.write(&tid, &line).await.map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true }))
        }
        "mindagentics:terminal:resize" => {
            let tid = arg_str(&args, 0).unwrap_or_default();
            let cols = arg_u16(&args, 1).unwrap_or(120);
            let rows = arg_u16(&args, 2).unwrap_or(32);
            pty.resize(&tid, cols, rows).await.map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true }))
        }
        "mindagentics:terminal:kill" => {
            let tid = arg_str(&args, 0).unwrap_or_default();
            pty.kill(&tid).await.map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true }))
        }
        "mindagentics:terminal:restart" => {
            let tid = arg_str(&args, 0).unwrap_or_default();
            pty.restart(&tid).await.map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true }))
        }
        "mindagentics:terminal:reconfigure" => {
            if args.len() >= 2 && args[0].is_string() {
                let tid = arg_str(&args, 0);
                let cfg_val = arg_opt(&args, 1).cloned().unwrap_or(json!({}));
                let cfg: TerminalReconfigureOptions =
                    serde_json::from_value(cfg_val).map_err(|e| e.to_string())?;
                pty.reconfigure(tid.as_deref(), cfg)
                    .await
                    .map_err(|e| e.to_string())?;
            } else {
                let cfg_val = arg_opt(&args, 0).cloned().unwrap_or(json!({}));
                let cfg: TerminalReconfigureOptions =
                    serde_json::from_value(cfg_val).map_err(|e| e.to_string())?;
                pty.reconfigure(None, cfg).await.map_err(|e| e.to_string())?;
            }
            Ok(json!({ "ok": true }))
        }
        "mindagentics:terminal:getScrollback" => {
            let tid = arg_str(&args, 0).unwrap_or_default();
            let sb = pty
                .get_scrollback(&tid)
                .await
                .unwrap_or_default();
            Ok(Value::String(sb))
        }
        "mindagentics:terminal:getAgentLimits" => {
            let limits = crate::probes::get_agent_limits().await;
            serde_json::to_value(limits).map_err(|e| e.to_string())
        }
        "mindagentics:terminal:detectAgents" => {
            let agents = crate::probes::detect_installed_agents();
            serde_json::to_value(agents).map_err(|e| e.to_string())
        }
        "mindagentics:terminal:setOrchestratorMode" | "mindagentics:terminal:setMaestroMode" => {
            let tid = arg_str(&args, 0).unwrap_or_default();
            let enabled = arg_bool(&args, 1).unwrap_or(false);
            pty.set_orchestrator_mode(&tid, enabled)
                .await
                .map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true }))
        }
        "mindagentics:terminal:dims" => Ok(json!({ "cols": 120, "rows": 32 })),
        "mindagentics:terminal:markSeen" | "mindagentics:terminal:setFocused" => {
            Ok(json!({ "ok": true }))
        }

        // --------------------------------------------------------------------
        // Notes (100% Verbatim)
        // --------------------------------------------------------------------
        "mindagentics:note:read" => {
            let ws_id = arg_str(&args, 0).unwrap_or_else(|| "default".to_string());
            let note_id = arg_str(&args, 1).unwrap_or_default();
            let content = storage
                .read_note(&ws_id, &note_id)
                .await
                .map_err(|e| e.to_string())?;
            Ok(Value::String(content))
        }
        "mindagentics:note:write" => {
            let ws_id = arg_str(&args, 0).unwrap_or_else(|| "default".to_string());
            let note_id = arg_str(&args, 1).unwrap_or_default();
            let content = arg_str(&args, 2).unwrap_or_default();
            note_write(app, storage, ws_id, note_id, content).await?;
            Ok(json!({ "ok": true }))
        }
        "mindagentics:note:edit" => {
            let ws_id = arg_str(&args, 0).unwrap_or_else(|| "default".to_string());
            let note_id = arg_str(&args, 1).unwrap_or_default();
            let old_text = arg_str(&args, 2).unwrap_or_default();
            let new_text = arg_str(&args, 3).unwrap_or_default();
            let current = storage
                .read_note(&ws_id, &note_id)
                .await
                .map_err(|e| e.to_string())?;
            let updated = current.replacen(&old_text, &new_text, 1);
            note_write(app, storage, ws_id, note_id, updated).await?;
            Ok(json!({ "ok": true }))
        }
        "mindagentics:note:list" => {
            let ws_id = arg_str(&args, 0).unwrap_or_else(|| "default".to_string());
            let notes_dir = storage.get_data_dir().join("notes").join(&ws_id);
            let mut items = Vec::new();
            if let Ok(mut entries) = tokio::fs::read_dir(&notes_dir).await {
                while let Ok(Some(entry)) = entries.next_entry().await {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if let Some(stem) = name.strip_suffix(".md") {
                        items.push(Value::String(stem.to_string()));
                    }
                }
            }
            Ok(Value::Array(items))
        }
        "mindagentics:note:notesDir" => {
            let ws_id = arg_str(&args, 0).unwrap_or_else(|| "default".to_string());
            Ok(Value::String(
                storage
                    .get_data_dir()
                    .join("notes")
                    .join(ws_id)
                    .to_string_lossy()
                    .to_string(),
            ))
        }
        "mindagentics:note:mediaDir" => {
            let ws_id = arg_str(&args, 0).unwrap_or_else(|| "default".to_string());
            Ok(Value::String(
                storage
                    .get_data_dir()
                    .join("notes")
                    .join(ws_id)
                    .join("media")
                    .to_string_lossy()
                    .to_string(),
            ))
        }
        "mindagentics:note:reveal" => {
            let ws_id = arg_str(&args, 0).unwrap_or_else(|| "default".to_string());
            let note_id = arg_str(&args, 1).unwrap_or_default();
            let note_path = storage
                .get_data_dir()
                .join("notes")
                .join(&ws_id)
                .join(format!("{note_id}.md"));
            let target = if note_path.exists() {
                note_path
            } else {
                storage.get_data_dir().join("notes").join(&ws_id)
            };
            let _ = app
                .opener()
                .open_path(target.to_string_lossy().to_string(), None::<&str>);
            Ok(json!({ "ok": true }))
        }

        // --------------------------------------------------------------------
        // Routines
        // --------------------------------------------------------------------
        "mindagentics:routine:list" => {
            let list = storage.list_routines().await.map_err(|e| e.to_string())?;
            serde_json::to_value(list).map_err(|e| e.to_string())
        }
        "mindagentics:routine:create" => {
            let data = arg_opt(&args, 0).cloned().unwrap_or(json!({}));
            let created = storage
                .create_routine(data)
                .await
                .map_err(|e| e.to_string())?;
            let all = storage.list_routines().await.unwrap_or_default();
            let _ = app.emit("mindagentics:routine:onChanged", &all);
            Ok(json!({ "ok": true, "routine": created }))
        }
        "mindagentics:routine:update" => {
            if args.len() >= 2 && args[0].is_string() {
                let id = arg_str(&args, 0).unwrap_or_default();
                let patch = arg_opt(&args, 1).cloned().unwrap_or(json!({}));
                storage
                    .update_routine(&id, patch)
                    .await
                    .map_err(|e| e.to_string())?;
            } else if let Some(updated) = arg_opt(&args, 0).cloned() {
                let id = updated
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                storage
                    .update_routine(&id, updated)
                    .await
                    .map_err(|e| e.to_string())?;
            }
            let all = storage.list_routines().await.unwrap_or_default();
            let _ = app.emit("mindagentics:routine:onChanged", &all);
            Ok(json!({ "ok": true }))
        }
        "mindagentics:routine:setEnabled" => {
            let id = arg_str(&args, 0).unwrap_or_default();
            let enabled = arg_bool(&args, 1).unwrap_or(true);
            storage
                .update_routine(&id, json!({ "enabled": enabled }))
                .await
                .map_err(|e| e.to_string())?;
            let all = storage.list_routines().await.unwrap_or_default();
            let _ = app.emit("mindagentics:routine:onChanged", &all);
            Ok(json!({ "ok": true }))
        }
        "mindagentics:routine:delete" => {
            let id = arg_str(&args, 0).unwrap_or_default();
            storage
                .delete_routine(&id)
                .await
                .map_err(|e| e.to_string())?;
            let all = storage.list_routines().await.unwrap_or_default();
            let _ = app.emit("mindagentics:routine:onChanged", &all);
            Ok(json!({ "ok": true }))
        }
        "mindagentics:routine:runNow" => {
            let id = arg_str(&args, 0).unwrap_or_default();
            let routines = storage.list_routines().await.map_err(|e| e.to_string())?;
            let Some(routine) = routines.into_iter().find(|r| r.id == id) else {
                return Ok(json!({ "ok": false, "error": "Routine not found" }));
            };
            let routine_val = serde_json::to_value(&routine).unwrap_or(json!({}));
            let prompt = routine_val
                .get("action")
                .and_then(|a| a.get("command"))
                .or_else(|| routine_val.get("command"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if let Some(tid) = routine.target_terminal_id.as_deref() {
                let line = format!("{}\r\n", prompt.trim_end_matches(['\r', '\n']));
                let _ = pty.write(tid, &line).await;
            }
            let record = RoutineRunRecord {
                id: uuid::Uuid::new_v4().to_string(),
                routine_id: id,
                fired_at: chrono::Utc::now().to_rfc3339(),
                status: "success".to_string(),
                ..Default::default()
            };
            let _ = storage.append_routine_run(record).await;
            let history = storage.get_routine_history(None).await.unwrap_or_default();
            let _ = app.emit("mindagentics:routine:onHistoryChanged", &history);
            Ok(json!({ "ok": true }))
        }
        "mindagentics:routine:history" => {
            let rid = arg_str(&args, 0);
            let history = storage
                .get_routine_history(rid.as_deref())
                .await
                .map_err(|e| e.to_string())?;
            serde_json::to_value(history).map_err(|e| e.to_string())
        }
        "mindagentics:routine:historyRemove" => {
            let id = arg_str(&args, 0).unwrap_or_default();
            let hist_path = storage.data_dir().join("routine_history.json");
            let mut history = read_json_array_file(&hist_path).await;
            history.retain(|h| h.get("id").and_then(|v| v.as_str()) != Some(id.as_str()));
            write_json_value(
                &storage,
                &hist_path,
                &json!({ "schemaVersion": 1, "type": "routineHistory", "payload": history }),
            )
            .await?;
            let _ = app.emit("mindagentics:routine:onHistoryChanged", &history);
            Ok(json!({ "ok": true }))
        }
        "mindagentics:routine:historyClear" => {
            let hist_path = storage.data_dir().join("routine_history.json");
            let empty = Vec::<Value>::new();
            write_json_value(
                &storage,
                &hist_path,
                &json!({ "schemaVersion": 1, "type": "routineHistory", "payload": empty }),
            )
            .await?;
            let _ = app.emit("mindagentics:routine:onHistoryChanged", &empty);
            Ok(json!({ "ok": true }))
        }

        // --------------------------------------------------------------------
        // Profile
        // --------------------------------------------------------------------
        "mindagentics:profile:get" | "mindagentics:profile:load" => {
            let prof = storage.get_profile().await.map_err(|e| e.to_string())?;
            serde_json::to_value(prof).map_err(|e| e.to_string())
        }
        "mindagentics:profile:update" => {
            let patch = arg_opt(&args, 0).cloned().unwrap_or(json!({}));
            let updated = storage
                .update_profile(patch)
                .await
                .map_err(|e| e.to_string())?;
            serde_json::to_value(updated).map_err(|e| e.to_string())
        }
        "mindagentics:profile:awardXp" => {
            let xp = arg_u32(&args, 0).unwrap_or(0) as u64;
            let stat_key = arg_str(&args, 1);
            let res = storage
                .award_xp(xp, stat_key.as_deref())
                .await
                .map_err(|e| e.to_string())?;
            serde_json::to_value(res).map_err(|e| e.to_string())
        }

        // --------------------------------------------------------------------
        // License
        // --------------------------------------------------------------------
        "mindagentics:license:get" => {
            let lic = storage.get_license().await.map_err(|e| e.to_string())?;
            serde_json::to_value(lic).map_err(|e| e.to_string())
        }
        "mindagentics:license:activate" => {
            let key = arg_str(&args, 0).unwrap_or_default();
            let lic = storage
                .activate_license(&key)
                .await
                .map_err(|e| e.to_string())?;
            let _ = app.emit("mindagentics:license:onChanged", &lic);
            Ok(json!({ "ok": true, "license": lic }))
        }
        "mindagentics:license:deactivate" => {
            let lic = storage
                .deactivate_license()
                .await
                .map_err(|e| e.to_string())?;
            let _ = app.emit("mindagentics:license:onChanged", &lic);
            Ok(json!({ "ok": true, "license": lic }))
        }

        // --------------------------------------------------------------------
        // Data & Backups
        // --------------------------------------------------------------------
        "mindagentics:data:storageLocation" => Ok(Value::String(
            storage.get_data_dir().to_string_lossy().to_string(),
        )),
        "mindagentics:data:revealStorageLocation" | "mindagentics:data:revealDataDir" => {
            let _ = app.opener().open_path(
                storage.get_data_dir().to_string_lossy().to_string(),
                None::<&str>,
            );
            Ok(json!({ "ok": true }))
        }
        "mindagentics:data:revealBackupsLocation" => {
            let bdir = storage.get_data_dir().join("backups");
            let _ = tokio::fs::create_dir_all(&bdir).await;
            let _ = app
                .opener()
                .open_path(bdir.to_string_lossy().to_string(), None::<&str>);
            Ok(json!({ "ok": true }))
        }
        "mindagentics:data:exportBackup" | "mindagentics:data:backupNow" => {
            let dest = arg_str(&args, 0);
            create_zip_backup(&storage, dest.as_deref()).await
        }
        "mindagentics:data:importBackup" => {
            let zip_path = arg_str(&args, 0).unwrap_or_default();
            let res = import_zip_backup(&storage, &zip_path).await?;
            let _ = app.emit("mindagentics:data:onStoreReloaded", json!({ "ok": true }));
            Ok(res)
        }
        "mindagentics:data:listBackups" => {
            let bdir = storage.get_data_dir().join("backups");
            let mut items = Vec::new();
            if let Ok(mut entries) = tokio::fs::read_dir(&bdir).await {
                while let Ok(Some(entry)) = entries.next_entry().await {
                    let path = entry.path();
                    if path.extension().and_then(|e| e.to_str()) == Some("zip") {
                        items.push(json!({
                            "name": entry.file_name().to_string_lossy().to_string(),
                            "path": path.to_string_lossy().to_string(),
                        }));
                    }
                }
            }
            Ok(Value::Array(items))
        }
        "mindagentics:data:usage" => {
            let data_dir = storage.get_data_dir();
            let total_bytes = tokio::task::spawn_blocking(move || -> u64 {
                let mut total = 0u64;
                let mut stack = vec![data_dir];
                while let Some(d) = stack.pop() {
                    if let Ok(entries) = std::fs::read_dir(&d) {
                        for entry in entries.flatten() {
                            let p = entry.path();
                            if p.is_dir() {
                                stack.push(p);
                            } else if let Ok(m) = entry.metadata() {
                                total += m.len();
                            }
                        }
                    }
                }
                total
            })
            .await
            .unwrap_or(0);
            Ok(json!({ "totalBytes": total_bytes }))
        }

        // --------------------------------------------------------------------
        // Graphify
        // --------------------------------------------------------------------
        "mindagentics:graphify:build" => {
            let params = arg_opt(&args, 0).cloned().unwrap_or(json!({}));
            execute_graphify_build(&app, params).await
        }
        "mindagentics:graphify:check" => {
            let dir = arg_str(&args, 0).unwrap_or_else(|| ".".to_string());
            Ok(execute_graphify_check(&dir))
        }
        "mindagentics:graphify:query" => {
            let dir = arg_str(&args, 0).unwrap_or_else(|| ".".to_string());
            let q = arg_str(&args, 1).unwrap_or_default();
            let dfs = arg_bool(&args, 2).unwrap_or(false);
            let out = execute_graphify_query(&dir, &q, dfs).await?;
            Ok(Value::String(out))
        }
        "mindagentics:graphify:explain" => {
            let dir = arg_str(&args, 0).unwrap_or_else(|| ".".to_string());
            let sym = arg_str(&args, 1).unwrap_or_default();
            let out = execute_graphify_explain(&dir, &sym).await?;
            Ok(Value::String(out))
        }
        "mindagentics:graphify:path" => {
            let dir = arg_str(&args, 0).unwrap_or_else(|| ".".to_string());
            let from = arg_str(&args, 1).unwrap_or_default();
            let to = arg_str(&args, 2).unwrap_or_default();
            let out = execute_graphify_path(&dir, &from, &to).await?;
            Ok(Value::String(out))
        }
        "mindagentics:graphify:status" => Ok(json!({
            "ok": true,
            "hasGraphify": true,
            "nativeFallback": true,
        })),
        "mindagentics:graphify:install" => {
            emit_graphify_progress(&app, "Motor Graphify nativo integrado pronto.");
            Ok(json!({ "ok": true }))
        }

        // --------------------------------------------------------------------
        // Portal
        // --------------------------------------------------------------------
        "mindagentics:portal:openWindow" => {
            let url = arg_str(&args, 0).unwrap_or_default();
            let title = arg_str(&args, 1);
            let label = portal_open_window(app, url, title).await?;
            Ok(Value::String(label))
        }
        "mindagentics:portal:directoryIndex" => {
            let dir = arg_str(&args, 0).unwrap_or_else(|| ".".to_string());
            let safe = assert_safe_path_string(&dir)?;
            let mut items = Vec::new();
            if let Ok(mut entries) = tokio::fs::read_dir(&safe).await {
                while let Ok(Some(entry)) = entries.next_entry().await {
                    let is_dir = entry.file_type().await.map(|t| t.is_dir()).unwrap_or(false);
                    items.push(json!({
                        "name": entry.file_name().to_string_lossy().to_string(),
                        "path": entry.path().to_string_lossy().to_string(),
                        "isDirectory": is_dir,
                    }));
                }
            }
            Ok(Value::Array(items))
        }
        "mindagentics:portal:resolveSource" => {
            let raw = arg_str(&args, 0).unwrap_or_default();
            if raw.starts_with("http://") || raw.starts_with("https://") {
                return Ok(json!({ "url": raw, "kind": "url" }));
            }
            let safe = assert_safe_path_string(&raw)?;
            Ok(json!({
                "path": safe.to_string_lossy().to_string(),
                "url": format!("file:///{}", safe.to_string_lossy().replace('\\', "/").trim_start_matches('/')),
                "kind": "file",
            }))
        }
        "mindagentics:portal:register"
        | "mindagentics:portal:unregister"
        | "mindagentics:portal:wake"
        | "mindagentics:portal:watchFile"
        | "mindagentics:portal:unwatchFile" => Ok(json!({ "ok": true })),

        // --------------------------------------------------------------------
        // Clipboard
        // --------------------------------------------------------------------
        "mindagentics:clipboard:writeText" => {
            let text = arg_str(&args, 0).unwrap_or_default();
            app.clipboard()
                .write_text(text)
                .map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true }))
        }
        "mindagentics:clipboard:writeImage" => Ok(json!({ "ok": true })),

        // --------------------------------------------------------------------
        // Canvas / Spatial
        // --------------------------------------------------------------------
        "mindagentics:canvas:sync" => {
            let payload = arg_opt(&args, 0).cloned().unwrap_or(json!({}));
            let res = canvas_sync(storage, payload).await?;
            Ok(res.unwrap_or(json!({ "ok": true })))
        }
        "mindagentics:snapNode" | "mindagentics:canvas:snapNode" => {
            let ctx = arg_opt(&args, 0).cloned().unwrap_or(json!({}));
            let x = ctx.get("x").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let y = ctx.get("y").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let grid = ctx.get("grid").and_then(|v| v.as_f64()).unwrap_or(16.0).max(1.0);
            Ok(json!({
                "ok": true,
                "x": (x / grid).round() * grid,
                "y": (y / grid).round() * grid,
            }))
        }
        "mindagentics:tidyNode" | "mindagentics:canvas:tidyNode" => {
            let req = arg_opt(&args, 0).cloned().unwrap_or(json!({}));
            Ok(json!({ "ok": true, "request": req }))
        }

        // --------------------------------------------------------------------
        // FileTree helpers
        // --------------------------------------------------------------------
        "mindagentics:fileTree:list" => {
            let dir = arg_str(&args, 1)
                .or_else(|| arg_str(&args, 0))
                .unwrap_or_else(|| ".".to_string());
            let safe = assert_safe_path_string(&dir)?;
            let mut items = Vec::new();
            if let Ok(mut entries) = tokio::fs::read_dir(&safe).await {
                while let Ok(Some(entry)) = entries.next_entry().await {
                    let is_dir = entry.file_type().await.map(|t| t.is_dir()).unwrap_or(false);
                    items.push(json!({
                        "name": entry.file_name().to_string_lossy().to_string(),
                        "path": entry.path().to_string_lossy().to_string(),
                        "isDirectory": is_dir,
                    }));
                }
            }
            Ok(Value::Array(items))
        }
        "mindagentics:fileTree:readFile" => {
            let path = arg_str(&args, 1)
                .or_else(|| arg_str(&args, 0))
                .unwrap_or_default();
            let safe = assert_safe_path_string(&path)?;
            let text = tokio::fs::read_to_string(&safe)
                .await
                .map_err(|e| e.to_string())?;
            Ok(Value::String(text))
        }
        "mindagentics:fileTree:writeFile" => {
            let path = arg_str(&args, 1).unwrap_or_default();
            let text = arg_str(&args, 2).unwrap_or_default();
            let safe = assert_safe_path_string(&path)?;
            storage
                .replace_file_atomically(&safe, text.as_bytes())
                .await
                .map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true }))
        }

        // --------------------------------------------------------------------
        // Inter-agent peers & Updates
        // --------------------------------------------------------------------
        "mindagentics:interAgent:listPeers" => {
            let sessions = pty.list_sessions_info().await;
            serde_json::to_value(sessions).map_err(|e| e.to_string())
        }
        "mindagentics:updates:state" => Ok(json!({
            "status": "idle",
            "version": "0.26.0",
        })),
        "mindagentics:updates:check" => Ok(json!({
            "status": "idle",
            "version": "0.26.0",
            "updateAvailable": false,
        })),

        // --------------------------------------------------------------------
        // Fallback for remaining Electron channels
        // --------------------------------------------------------------------
        _ => Ok(json!({ "ok": true })),
    }
}
