use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use tauri::Emitter;
use tokio::sync::{Mutex, RwLock};

use crate::memory::MemoryService;
use crate::pty::job_object::ProcessJobObject;
use crate::security::sanitizer::*;

const MAX_SCROLLBACK_LINES: usize = 10_000;
const MAX_BRIEFING_CHARS: usize = 580 * 4;
const IDLE_DEBOUNCE_MS: u64 = 1200;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionInfo {
    pub id: String,
    pub workspace_id: String,
    pub floor_id: String,
    pub title: String,
    pub preset_id: Option<String>,
    pub agent_role: String,
    pub command: Option<String>,
    pub orchestrator_mode: bool,
    pub maestro_mode: bool,
    pub cwd: String,
    pub status: String,
    pub is_alive: bool,
    pub cols: u16,
    pub rows: u16,
}

pub struct TerminalSession {
    pub id: String,
    pub workspace_id: String,
    pub floor_id: String,
    pub cwd: PathBuf,
    pub title: String,
    pub agent_role: String,
    pub instructions: String,
    pub command: Option<String>,
    pub preset_id: Option<String>,
    pub is_autonomous: bool,
    pub orchestrator_mode: bool,
    pub initial_prompt: Option<String>,
    pub cols: u16,
    pub rows: u16,
    pub status: Arc<std::sync::RwLock<String>>,
    pub is_alive: Arc<AtomicBool>,
    pub master: Box<dyn portable_pty::MasterPty + Send>,
    pub writer: Box<dyn std::io::Write + Send>,
    pub job_object: Arc<ProcessJobObject>,
    pub scrollback: Arc<std::sync::Mutex<Vec<String>>>,
    pub output_tx: Arc<std::sync::Mutex<tokio::sync::mpsc::UnboundedSender<(String, Vec<u8>)>>>,
    pub last_output_ms: Arc<AtomicU64>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSpawnOptions {
    pub id: Option<String>,
    #[serde(alias = "terminal_id")]
    pub terminal_id: Option<String>,
    #[serde(alias = "workspace_id")]
    pub workspace_id: Option<String>,
    #[serde(alias = "floor_id")]
    pub floor_id: Option<String>,
    pub cwd: Option<String>,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub env: Option<HashMap<String, String>>,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
    pub title: Option<String>,
    #[serde(alias = "preset_id")]
    pub preset_id: Option<String>,
    #[serde(alias = "agent_role")]
    pub agent_role: Option<String>,
    pub instructions: Option<String>,
    #[serde(alias = "initial_prompt")]
    pub initial_prompt: Option<String>,
    #[serde(alias = "is_autonomous")]
    pub is_autonomous: Option<bool>,
    #[serde(alias = "orchestrator_mode")]
    pub orchestrator_mode: Option<bool>,
    #[serde(alias = "maestro_mode")]
    pub maestro_mode: Option<bool>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TerminalReconfigureOptions {
    #[serde(alias = "terminal_id", default)]
    pub terminal_id: Option<String>,
    pub title: Option<String>,
    #[serde(alias = "preset_id")]
    pub preset_id: Option<String>,
    pub command: Option<String>,
    #[serde(alias = "agent_role")]
    pub agent_role: Option<String>,
    #[serde(alias = "is_autonomous")]
    pub is_autonomous: Option<bool>,
    #[serde(alias = "orchestrator_mode")]
    pub orchestrator_mode: Option<bool>,
    #[serde(alias = "maestro_mode")]
    pub maestro_mode: Option<bool>,
    pub instructions: Option<String>,
    pub restart: Option<bool>,
}

#[derive(Clone)]
pub struct PtyManager {
    sessions: Arc<RwLock<HashMap<String, Arc<Mutex<TerminalSession>>>>>,
    memory: MemoryService,
    pty_system: Arc<NativePtySystem>,
    app_handle: Arc<std::sync::RwLock<Option<tauri::AppHandle>>>,
    pipe_address: Arc<std::sync::RwLock<String>>,
    data_dir: Arc<std::sync::RwLock<PathBuf>>,
}

impl PtyManager {
    pub fn new(memory: MemoryService) -> Self {
        let default_data_dir = dirs::home_dir()
            .unwrap_or_default()
            .join(".mindagentics");
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            memory,
            pty_system: Arc::new(NativePtySystem::default()),
            app_handle: Arc::new(std::sync::RwLock::new(None)),
            pipe_address: Arc::new(std::sync::RwLock::new(String::new())),
            data_dir: Arc::new(std::sync::RwLock::new(default_data_dir)),
        }
    }

    pub fn set_app_handle(&self, handle: tauri::AppHandle) {
        if let Ok(mut guard) = self.app_handle.write() {
            *guard = Some(handle);
        }
    }

    pub fn set_pipe_address(&self, addr: String) {
        if let Ok(mut guard) = self.pipe_address.write() {
            *guard = addr;
        }
    }

    pub fn get_pipe_address(&self) -> String {
        self.pipe_address
            .read()
            .map(|g| g.clone())
            .unwrap_or_default()
    }

    pub fn set_data_dir(&self, dir: PathBuf) {
        if let Ok(mut guard) = self.data_dir.write() {
            *guard = dir;
        }
    }

    pub fn get_data_dir(&self) -> PathBuf {
        self.data_dir
            .read()
            .map(|g| g.clone())
            .unwrap_or_else(|_| dirs::home_dir().unwrap_or_default().join(".mindagentics"))
    }

    fn emit_event<S: serde::Serialize + Clone>(&self, event: &str, payload: S) {
        if let Ok(guard) = self.app_handle.read() {
            if let Some(ref handle) = *guard {
                let _ = handle.emit(event, payload);
            }
        }
    }

    fn log_file_path(&self, terminal_id: &str) -> PathBuf {
        let safe_id: String = terminal_id
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                    c
                } else {
                    '_'
                }
            })
            .collect();
        self.get_data_dir()
            .join("terminals")
            .join(format!("{safe_id}.log"))
    }

    fn read_persisted_scrollback_sync(path: &Path) -> String {
        if !path.exists() {
            return String::new();
        }
        match std::fs::read_to_string(path) {
            Ok(raw) => {
                let lines: Vec<&str> = raw.split('\n').collect();
                if lines.len() > MAX_SCROLLBACK_LINES {
                    lines[lines.len() - MAX_SCROLLBACK_LINES..].join("\n")
                } else {
                    raw
                }
            }
            Err(_) => String::new(),
        }
    }

    fn persist_scrollback_sync(path: &Path, scrollback: &Arc<std::sync::Mutex<Vec<String>>>) {
        let joined = match scrollback.lock() {
            Ok(mut sb) => {
                let text = sb.concat();
                let lines: Vec<&str> = text.split('\n').collect();
                if lines.len() > MAX_SCROLLBACK_LINES {
                    let capped = lines[lines.len() - MAX_SCROLLBACK_LINES..].join("\n");
                    *sb = vec![capped.clone()];
                    capped
                } else {
                    text
                }
            }
            Err(_) => return,
        };

        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let redacted = redact_secrets(&joined);
        let _ = std::fs::write(path, redacted.as_bytes());
    }

    pub async fn list_sessions_info(&self) -> Vec<TerminalSessionInfo> {
        let session_arcs: Vec<Arc<Mutex<TerminalSession>>> = {
            let sessions = self.sessions.read().await;
            sessions.values().cloned().collect()
        };

        let mut out = Vec::with_capacity(session_arcs.len());
        for arc in session_arcs {
            let s = arc.lock().await;
            let status = s
                .status
                .read()
                .map(|g| g.clone())
                .unwrap_or_else(|_| "idle".to_string());
            out.push(TerminalSessionInfo {
                id: s.id.clone(),
                workspace_id: s.workspace_id.clone(),
                floor_id: s.floor_id.clone(),
                title: s.title.clone(),
                preset_id: s.preset_id.clone(),
                agent_role: s.agent_role.clone(),
                command: s.command.clone(),
                orchestrator_mode: s.orchestrator_mode,
                maestro_mode: s.orchestrator_mode,
                cwd: s.cwd.to_string_lossy().to_string(),
                status,
                is_alive: s.is_alive.load(Ordering::SeqCst),
                cols: s.cols,
                rows: s.rows,
            });
        }
        out
    }

    pub async fn get_session_info(&self, terminal_id: &str) -> Option<TerminalSessionInfo> {
        let arc = {
            let sessions = self.sessions.read().await;
            sessions.get(terminal_id).cloned()
        }?;
        let s = arc.lock().await;
        let status = s
            .status
            .read()
            .map(|g| g.clone())
            .unwrap_or_else(|_| "idle".to_string());
        Some(TerminalSessionInfo {
            id: s.id.clone(),
            workspace_id: s.workspace_id.clone(),
            floor_id: s.floor_id.clone(),
            title: s.title.clone(),
            preset_id: s.preset_id.clone(),
            agent_role: s.agent_role.clone(),
            command: s.command.clone(),
            orchestrator_mode: s.orchestrator_mode,
            maestro_mode: s.orchestrator_mode,
            cwd: s.cwd.to_string_lossy().to_string(),
            status,
            is_alive: s.is_alive.load(Ordering::SeqCst),
            cols: s.cols,
            rows: s.rows,
        })
    }

    pub async fn get_session_cwd(&self, terminal_id: &str) -> Option<PathBuf> {
        let arc = {
            let sessions = self.sessions.read().await;
            sessions.get(terminal_id).cloned()
        }?;
        let s = arc.lock().await;
        Some(s.cwd.clone())
    }

    pub async fn find_session_id_by_name_or_id(
        &self,
        name_or_id: &str,
        workspace_id: Option<&str>,
    ) -> Option<String> {
        let norm = name_or_id.trim().to_lowercase();
        if norm.is_empty() {
            return None;
        }
        let infos = self.list_sessions_info().await;

        let matches_ws = |info: &TerminalSessionInfo| -> bool {
            match workspace_id {
                Some(ws) if !ws.is_empty() => info.workspace_id == ws,
                _ => true,
            }
        };

        // 1. Exact ID or title within workspace
        for info in infos.iter().filter(|i| matches_ws(i)) {
            if info.id.to_lowercase() == norm || info.title.to_lowercase() == norm {
                return Some(info.id.clone());
            }
        }
        // 2. Exact ID or title globally
        for info in &infos {
            if info.id.to_lowercase() == norm || info.title.to_lowercase() == norm {
                return Some(info.id.clone());
            }
        }
        // 3. Prefix / substring match within workspace
        for info in infos.iter().filter(|i| matches_ws(i)) {
            let t = info.title.to_lowercase();
            let id = info.id.to_lowercase();
            if id.starts_with(&norm) || t.contains(&norm) || norm.contains(&t) {
                return Some(info.id.clone());
            }
        }
        // 4. Prefix / substring match globally
        for info in &infos {
            let t = info.title.to_lowercase();
            let id = info.id.to_lowercase();
            if id.starts_with(&norm) || t.contains(&norm) || norm.contains(&t) {
                return Some(info.id.clone());
            }
        }
        None
    }

    pub async fn spawn(
        &self,
        options: TerminalSpawnOptions,
        output_tx: tokio::sync::mpsc::UnboundedSender<(String, Vec<u8>)>,
    ) -> Result<String> {
        let terminal_id = options
            .id
            .clone()
            .or_else(|| options.terminal_id.clone())
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

        // Double-spawn fix: if session already exists and is alive, re-attach the new Channel sender!
        let existing_arc = {
            let sessions = self.sessions.read().await;
            sessions.get(&terminal_id).cloned()
        };

        if let Some(session_arc) = existing_arc {
            let mut session = session_arc.lock().await;
            if session.is_alive.load(Ordering::SeqCst) {
                let command_changed = options.command.as_ref() != session.command.as_ref();
                let preset_changed = options.preset_id.as_ref() != session.preset_id.as_ref();

                if !command_changed && !preset_changed {
                    if let Ok(mut tx_guard) = session.output_tx.lock() {
                        *tx_guard = output_tx.clone();
                    }
                    if let Ok(sb) = session.scrollback.lock() {
                        let existing_output = sb.concat();
                        if !existing_output.is_empty() {
                            let _ = output_tx.send((terminal_id.clone(), existing_output.into_bytes()));
                        }
                    }
                    if options.cols.is_some() || options.rows.is_some() {
                        let cols = options.cols.unwrap_or(session.cols);
                        let rows = options.rows.unwrap_or(session.rows);
                        session.cols = cols;
                        session.rows = rows;
                        let _ = session.master.resize(PtySize {
                            rows,
                            cols,
                            pixel_width: 0,
                            pixel_height: 0,
                        });
                    }
                    return Ok(terminal_id);
                }
            }
            drop(session);
            self.kill(&terminal_id).await.ok();
        }

        let cwd = match options.cwd {
            Some(ref c) if Path::new(c).exists() => PathBuf::from(c),
            _ => dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")),
        };

        let raw_title = options.title.unwrap_or_else(|| "Agent".to_string());
        let title = {
            let s = sanitize_label(&raw_title, 80);
            if s.is_empty() {
                "Agent".to_string()
            } else {
                s
            }
        };
        let agent_role = sanitize_label(&options.agent_role.unwrap_or_default(), 200);
        let instructions = sanitize_markdown_block(&options.instructions.unwrap_or_default(), 4000);
        let is_orchestrator =
            options.orchestrator_mode.unwrap_or(false) || options.maestro_mode.unwrap_or(false);
        let is_autonomous = options.is_autonomous.unwrap_or(true);
        let workspace_id = options
            .workspace_id
            .filter(|w| !w.trim().is_empty())
            .unwrap_or_else(|| "default".to_string());
        let floor_id = options
            .floor_id
            .filter(|f| !f.trim().is_empty())
            .unwrap_or_else(|| "ground".to_string());

        let cols = options.cols.unwrap_or(120);
        let rows = options.rows.unwrap_or(32);
        let size = PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        };

        // Preload persisted scrollback if exists
        let log_path = self.log_file_path(&terminal_id);
        let disk_history = Self::read_persisted_scrollback_sync(&log_path);
        let initial_scrollback = if disk_history.is_empty() {
            Vec::new()
        } else {
            let _ = output_tx.send((terminal_id.clone(), disk_history.as_bytes().to_vec()));
            vec![disk_history]
        };

        // Ensure skills & AGENTS.md are written before resolving MINDAGENTICS_AGENT_INSTRUCTIONS
        self.ensure_skills(
            &cwd,
            &title,
            &agent_role,
            &instructions,
            &terminal_id,
            is_orchestrator,
        )
        .await;

        let pair = self.pty_system.openpty(size)?;
        let job = Arc::new(ProcessJobObject::new());

        #[cfg(windows)]
        let (shell_cmd, default_args) = (
            std::env::var("COMSPEC")
                .ok()
                .filter(|s| s.to_lowercase().contains("powershell") || s.to_lowercase().contains("pwsh"))
                .unwrap_or_else(|| "powershell.exe".to_string()),
            vec!["-NoLogo".to_string(), "-NoExit".to_string()],
        );
        #[cfg(not(windows))]
        let (shell_cmd, default_args) = (
            std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string()),
            vec!["-l".to_string()],
        );

        let mut cmd = CommandBuilder::new(&shell_cmd);
        cmd.cwd(&cwd);

        for arg in default_args {
            cmd.arg(arg);
        }

        // Inject mindAgentics environment variables
        let pipe_addr = self.get_pipe_address();
        let data_dir = self.get_data_dir();

        cmd.env("MINDAGENTICS_TERMINAL_ID", &terminal_id);
        if !pipe_addr.is_empty() {
            cmd.env("MINDAGENTICS_PIPE", &pipe_addr);
            cmd.env("MINDAGENTICS_SOCKET", &pipe_addr);
        }
        cmd.env("MINDAGENTICS_CLI", "1");
        cmd.env("MINDAGENTICS_WORKSPACE_ID", &workspace_id);
        cmd.env("MINDAGENTICS_FLOOR_ID", &floor_id);
        cmd.env("MINDAGENTICS_AGENT_NAME", &title);
        if !agent_role.is_empty() {
            cmd.env("MINDAGENTICS_AGENT_ROLE", &agent_role);
        }
        if is_orchestrator {
            cmd.env("MINDAGENTICS_ORCHESTRATOR_MODE", "1");
            cmd.env("MINDAGENTICS_MAESTRO_MODE", "1");
        }

        let data_agents_md = data_dir.join("AGENTS.md");
        let cwd_agents_md = cwd.join("AGENTS.md");
        if data_agents_md.exists() {
            cmd.env(
                "MINDAGENTICS_AGENT_INSTRUCTIONS",
                data_agents_md.to_string_lossy().as_ref(),
            );
        } else if cwd_agents_md.exists() {
            cmd.env(
                "MINDAGENTICS_AGENT_INSTRUCTIONS",
                cwd_agents_md.to_string_lossy().as_ref(),
            );
        }

        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("TERM_PROGRAM", "mindAgentics");

        // Prepend <repoRoot>/packages/core-daemon/bin to PATH
        if let Some(cli_bin_dir) = Self::resolve_cli_bin_dir() {
            let existing_path = std::env::var_os("PATH").unwrap_or_default();
            let mut paths = vec![cli_bin_dir];
            paths.extend(std::env::split_paths(&existing_path));
            if let Ok(joined_path) = std::env::join_paths(paths) {
                cmd.env("PATH", joined_path);
            }
        }

        if let Some(custom_env) = options.env {
            for (k, v) in custom_env {
                cmd.env(k, v);
            }
        }

        let mut child = pair.slave.spawn_command(cmd)?;
        drop(pair.slave);

        let child_pid = child.process_id();
        if let Some(pid) = child_pid {
            job.assign_process(pid);
        }

        let mut reader = pair.master.try_clone_reader()?;
        let writer = pair.master.take_writer()?;

        let scrollback_buf = Arc::new(std::sync::Mutex::new(initial_scrollback));
        let output_tx_arc = Arc::new(std::sync::Mutex::new(output_tx));
        let is_alive_arc = Arc::new(AtomicBool::new(true));
        let status_arc = Arc::new(std::sync::RwLock::new("idle".to_string()));
        let last_output_ms = Arc::new(AtomicU64::new(now_ms()));

        let session = Arc::new(Mutex::new(TerminalSession {
            id: terminal_id.clone(),
            workspace_id: workspace_id.clone(),
            floor_id: floor_id.clone(),
            cwd: cwd.clone(),
            title: title.clone(),
            agent_role: agent_role.clone(),
            instructions: instructions.clone(),
            command: options.command.clone(),
            preset_id: options.preset_id.clone(),
            is_autonomous,
            orchestrator_mode: is_orchestrator,
            initial_prompt: options.initial_prompt.clone(),
            cols,
            rows,
            status: status_arc.clone(),
            is_alive: is_alive_arc.clone(),
            master: pair.master,
            writer,
            job_object: job,
            scrollback: scrollback_buf.clone(),
            output_tx: output_tx_arc.clone(),
            last_output_ms: last_output_ms.clone(),
        }));

        self.sessions
            .write()
            .await
            .insert(terminal_id.clone(), session);

        self.emit_event(
            "mindagentics:terminal:status",
            serde_json::json!({
                "terminalId": terminal_id,
                "status": "idle",
            }),
        );

        // Idle debounce monitor task
        let mgr_idle = self.clone();
        let tid_idle = terminal_id.clone();
        let is_alive_idle = is_alive_arc.clone();
        let status_idle = status_arc.clone();
        let last_out_idle = last_output_ms.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_millis(350)).await;
                if !is_alive_idle.load(Ordering::SeqCst) {
                    break;
                }
                let is_working = status_idle
                    .read()
                    .map(|g| *g == "working")
                    .unwrap_or(false);
                if is_working {
                    let elapsed = now_ms().saturating_sub(last_out_idle.load(Ordering::SeqCst));
                    if elapsed >= IDLE_DEBOUNCE_MS {
                        if let Ok(mut g) = status_idle.write() {
                            *g = "idle".to_string();
                        }
                        mgr_idle.emit_event(
                            "mindagentics:terminal:status",
                            serde_json::json!({
                                "terminalId": tid_idle,
                                "status": "idle",
                            }),
                        );
                    }
                }
            }
        });

        // Spawn blocking reader loop for PTY streaming, scrollback persistence, memory capture & exit handling
        let mgr_reader = self.clone();
        let term_id_clone = terminal_id.clone();
        let memory_clone = self.memory.clone();
        let agent_name = title.clone();
        let cwd_clone = cwd.clone();
        let scrollback_clone = scrollback_buf;
        let log_path_clone = log_path;

        tokio::task::spawn_blocking(move || {
            let mut buf = [0u8; 8192];
            use std::io::Read;
            let mut last_persist = now_ms();

            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let bytes = buf[..n].to_vec();
                        let sender_opt = output_tx_arc.lock().ok().map(|g| g.clone());
                        if let Some(sender) = sender_opt {
                            let _ = sender.send((term_id_clone.clone(), bytes.clone()));
                        }

                        let text_lossy = String::from_utf8_lossy(&bytes).to_string();
                        if let Ok(mut sb) = scrollback_clone.lock() {
                            sb.push(text_lossy.clone());
                            if sb.len() > MAX_SCROLLBACK_LINES {
                                let excess = sb.len() - MAX_SCROLLBACK_LINES;
                                sb.drain(0..excess);
                            }
                        }

                        let ts = now_ms();
                        last_output_ms.store(ts, Ordering::SeqCst);

                        let was_working = status_arc
                            .read()
                            .map(|g| *g == "working")
                            .unwrap_or(false);
                        if !was_working {
                            if let Ok(mut g) = status_arc.write() {
                                *g = "working".to_string();
                            }
                            mgr_reader.emit_event(
                                "mindagentics:terminal:status",
                                serde_json::json!({
                                    "terminalId": term_id_clone,
                                    "status": "working",
                                }),
                            );
                        }

                        if ts.saturating_sub(last_persist) >= 500 {
                            Self::persist_scrollback_sync(&log_path_clone, &scrollback_clone);
                            last_persist = ts;
                        }

                        // Capture memory stream turn in background
                        let mem = memory_clone.clone();
                        let cwd_c = cwd_clone.clone();
                        let name_c = agent_name.clone();
                        let txt_c = redact_secrets(&text_lossy);
                        tokio::spawn(async move {
                            let _ = mem.append_turn(&cwd_c, &name_c, "agent", &txt_c).await;
                        });
                    }
                }
            }

            let exit_code = child
                .wait()
                .map(|s| s.exit_code() as i32)
                .unwrap_or(0);

            is_alive_arc.store(false, Ordering::SeqCst);
            let final_status = if exit_code == 0 { "idle" } else { "error" };
            if let Ok(mut g) = status_arc.write() {
                *g = final_status.to_string();
            }

            Self::persist_scrollback_sync(&log_path_clone, &scrollback_clone);

            mgr_reader.emit_event(
                "mindagentics:terminal:status",
                serde_json::json!({
                    "terminalId": term_id_clone,
                    "status": final_status,
                }),
            );
            mgr_reader.emit_event(
                "mindagentics:terminal:exit",
                serde_json::json!({
                    "terminalId": term_id_clone,
                    "exitCode": exit_code,
                }),
            );
        });

        // 350ms delayed command / autonomous flags / briefing / banner injection
        let mgr_cmd = self.clone();
        let tid_cmd = terminal_id.clone();
        let cmd_opt = options.command.clone();
        let init_prompt_opt = options.initial_prompt.clone();
        let shell_name_for_banner = Path::new(&shell_cmd)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("powershell.exe")
            .to_lowercase();

        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(350)).await;

            // Verify session still alive
            let alive = match mgr_cmd.sessions.read().await.get(&tid_cmd).cloned() {
                Some(arc) => arc.lock().await.is_alive.load(Ordering::SeqCst),
                None => false,
            };
            if !alive {
                return;
            }

            let memory_line = if mgr_cmd.memory.has_summary(&cwd, &title) {
                format!("Memória: leia {}", MemoryService::summary_rel_path(&title))
            } else {
                String::new()
            };
            let resuming = mgr_cmd.memory.has_memory(&cwd, &title);

            let briefing = if let Some(ref p) = init_prompt_opt {
                if !p.trim().is_empty() {
                    p.trim().to_string()
                } else {
                    Self::build_identity_briefing(
                        &title,
                        &agent_role,
                        &instructions,
                        is_orchestrator,
                        &memory_line,
                    )
                }
            } else {
                Self::build_identity_briefing(
                    &title,
                    &agent_role,
                    &instructions,
                    is_orchestrator,
                    &memory_line,
                )
            };

            if let Some(raw_cmd) = cmd_opt {
                let mut cmd_to_run = sanitize_for_pty_line(&raw_cmd, 1000);
                if !cmd_to_run.is_empty() {
                    // Resume previous session if memory exists
                    if resuming {
                        if starts_with_word(&cmd_to_run, "claude")
                            && !has_any_flag(&cmd_to_run, &["--continue", "-c", "--resume", "-r"])
                            && Self::claude_has_session(&cwd)
                        {
                            cmd_to_run = replace_leading_word(&cmd_to_run, "claude", "claude --continue");
                        } else if starts_with_word(&cmd_to_run, "codex")
                            && !has_subcommand(&cmd_to_run, "codex", &["resume", "exec", "login", "logout", "mcp", "app-server"])
                            && Self::codex_has_session()
                        {
                            cmd_to_run = replace_leading_word(&cmd_to_run, "codex", "codex resume --last");
                        }
                    }

                    // Autonomous CLI flags
                    if is_autonomous {
                        if cmd_to_run.starts_with("agy") && !cmd_to_run.contains("--dangerously-skip-permissions") {
                            cmd_to_run.push_str(" --dangerously-skip-permissions --mode auto");
                        } else if cmd_to_run.starts_with("codex") {
                            cmd_to_run = strip_flag_with_value(&cmd_to_run, "--ask-for-approval");
                            if !cmd_to_run.contains("--dangerously-bypass-approvals-and-sandbox") {
                                cmd_to_run.push_str(" --dangerously-bypass-approvals-and-sandbox");
                            }
                        } else if cmd_to_run.starts_with("claude") && !cmd_to_run.contains("--dangerously-skip-permissions") {
                            cmd_to_run.push_str(" --dangerously-skip-permissions");
                        } else if cmd_to_run.starts_with("opencode") && !cmd_to_run.contains("--auto") {
                            cmd_to_run.push_str(" --auto");
                        }
                    }

                    // Inject initial briefing / prompt safely
                    if !briefing.is_empty() {
                        let sanitized_prompt = sanitize_for_pty_line(&briefing, 4000)
                            .replace('"', "'")
                            .replace(['`', '$', '%', '\\'], "");
                        let sanitized_prompt = sanitized_prompt.trim();
                        if !sanitized_prompt.is_empty() {
                            if cmd_to_run.starts_with("agy")
                                && !cmd_to_run.contains("-i ")
                                && !cmd_to_run.contains("--prompt-interactive")
                            {
                                cmd_to_run.push_str(&format!(" -i \"{sanitized_prompt}\""));
                            } else if cmd_to_run.starts_with("codex") && !cmd_to_run.contains('"') {
                                cmd_to_run.push_str(&format!(" \"{sanitized_prompt}\""));
                            } else if cmd_to_run.starts_with("claude") && !cmd_to_run.contains('"') {
                                cmd_to_run.push_str(&format!(" \"{sanitized_prompt}\""));
                            } else if cmd_to_run.starts_with("opencode") && !cmd_to_run.contains("--prompt") {
                                cmd_to_run.push_str(&format!(" --prompt \"{sanitized_prompt}\""));
                            }
                        }
                    }

                    let line = format!("{cmd_to_run}\r");
                    let _ = mgr_cmd.write(&tid_cmd, &line).await;
                }
            } else if !title.is_empty() || !agent_role.is_empty() {
                let role_display = if agent_role.is_empty() {
                    "Developer"
                } else {
                    agent_role.as_str()
                };
                let banner_text = format!("[mindAgentics] Agente: {title} | Papel: {role_display}");
                let line = if shell_name_for_banner.starts_with("powershell")
                    || shell_name_for_banner.starts_with("pwsh")
                {
                    format!("Write-Host {} -ForegroundColor Cyan\r", quote_powershell(&banner_text, 300))
                } else if shell_name_for_banner.starts_with("cmd") {
                    let safe_cmd: String = banner_text
                        .chars()
                        .map(|c| if "%^&|<>\"!()".contains(c) { '_' } else { c })
                        .collect();
                    format!("echo {safe_cmd}\r")
                } else {
                    format!("printf '%s\\n' {}\r", quote_posix(&banner_text, 300))
                };
                let _ = mgr_cmd.write(&tid_cmd, &line).await;
            }
        });

        Ok(terminal_id)
    }

    pub async fn write(&self, terminal_id: &str, data: &str) -> Result<()> {
        self.write_bytes(terminal_id, data.as_bytes()).await
    }

    pub async fn write_bytes(&self, terminal_id: &str, data: &[u8]) -> Result<()> {
        let session_arc = {
            let sessions = self.sessions.read().await;
            sessions.get(terminal_id).cloned()
        };
        if let Some(session_arc) = session_arc {
            let mut session = session_arc.lock().await;
            session.writer.write_all(data)?;
            session.writer.flush()?;
            session.last_output_ms.store(now_ms(), Ordering::SeqCst);
            if let Ok(mut g) = session.status.write() {
                *g = "working".to_string();
            }
            self.emit_event(
                "mindagentics:terminal:status",
                serde_json::json!({
                    "terminalId": terminal_id,
                    "status": "working",
                }),
            );
            Ok(())
        } else {
            anyhow::bail!("Session not found")
        }
    }

    pub async fn get_scrollback(&self, terminal_id: &str) -> Result<String> {
        let session_arc = {
            let sessions = self.sessions.read().await;
            sessions.get(terminal_id).cloned()
        };

        if let Some(session_arc) = session_arc {
            let session = session_arc.lock().await;
            let mem_sb = {
                let sb = session
                    .scrollback
                    .lock()
                    .map_err(|_| anyhow::anyhow!("Scrollback lock poisoned"))?;
                sb.concat()
            };
            if !mem_sb.is_empty() {
                return Ok(mem_sb);
            }
        }

        let log_path = self.log_file_path(terminal_id);
        let disk = Self::read_persisted_scrollback_sync(&log_path);
        if !disk.is_empty() || session_arc_exists(&self.sessions, terminal_id).await {
            return Ok(disk);
        }

        anyhow::bail!("Session not found")
    }

    pub async fn set_orchestrator_mode(&self, terminal_id: &str, enabled: bool) -> Result<()> {
        let (cwd, title, role, instructions) = {
            let sessions = self.sessions.read().await;
            let session_arc = sessions.get(terminal_id).context("Session not found")?;
            let mut session = session_arc.lock().await;
            session.orchestrator_mode = enabled;
            (
                session.cwd.clone(),
                session.title.clone(),
                session.agent_role.clone(),
                session.instructions.clone(),
            )
        };
        self.ensure_skills(&cwd, &title, &role, &instructions, terminal_id, enabled)
            .await;
        Ok(())
    }

    pub async fn restart(&self, terminal_id: &str) -> Result<()> {
        self.reconfigure(
            Some(terminal_id),
            TerminalReconfigureOptions {
                terminal_id: Some(terminal_id.to_string()),
                restart: Some(true),
                ..Default::default()
            },
        )
        .await
    }

    pub async fn reconfigure_json(
        &self,
        terminal_id: &str,
        config: serde_json::Value,
    ) -> std::result::Result<(), String> {
        let opts: TerminalReconfigureOptions =
            serde_json::from_value(config).map_err(|e| format!("Invalid reconfigure config: {e}"))?;
        self.reconfigure(Some(terminal_id), opts)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn resize(&self, terminal_id: &str, cols: u16, rows: u16) -> Result<()> {
        let sessions = self.sessions.read().await;
        if let Some(session_arc) = sessions.get(terminal_id) {
            let mut session = session_arc.lock().await;
            session.cols = cols;
            session.rows = rows;
            session.master.resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })?;
            Ok(())
        } else {
            anyhow::bail!("Session not found")
        }
    }

    pub async fn kill(&self, terminal_id: &str) -> Result<()> {
        let mut sessions = self.sessions.write().await;
        if let Some(session_arc) = sessions.remove(terminal_id) {
            let session = session_arc.lock().await;
            session.is_alive.store(false, Ordering::SeqCst);
            let log_path = self.log_file_path(terminal_id);
            Self::persist_scrollback_sync(&log_path, &session.scrollback);
            drop(session);
        }
        Ok(())
    }

    pub async fn reconfigure(
        &self,
        terminal_id_override: Option<&str>,
        options: TerminalReconfigureOptions,
    ) -> Result<()> {
        let terminal_id = terminal_id_override
            .map(|s| s.to_string())
            .or_else(|| options.terminal_id.clone())
            .context("Missing terminal_id")?;

        let (
            needs_restart,
            cwd,
            ws_id,
            floor_id,
            cols,
            rows,
            title,
            role,
            instructions,
            orch,
            is_auto,
            cmd,
            preset,
            init_prompt,
            output_tx,
        ) = {
            let sessions = self.sessions.read().await;
            let session_arc = sessions.get(&terminal_id).context("Session not found")?;
            let mut session = session_arc.lock().await;

            let command_changed =
                options.command.is_some() && options.command != session.command;
            let preset_changed =
                options.preset_id.is_some() && options.preset_id != session.preset_id;
            let restart = options.restart.unwrap_or(false) || command_changed || preset_changed;

            if let Some(t) = options.title {
                let clean = sanitize_label(&t, 80);
                if !clean.is_empty() {
                    session.title = clean;
                }
            }
            if let Some(r) = options.agent_role {
                session.agent_role = sanitize_label(&r, 200);
            }
            if let Some(i) = options.instructions {
                session.instructions = sanitize_markdown_block(&i, 4000);
            }
            if let Some(o) = options.orchestrator_mode.or(options.maestro_mode) {
                session.orchestrator_mode = o;
            }
            if let Some(auto) = options.is_autonomous {
                session.is_autonomous = auto;
            }
            if let Some(c) = options.command {
                session.command = Some(c);
            }
            if let Some(p) = options.preset_id {
                session.preset_id = Some(p);
            }

            let tx = session
                .output_tx
                .lock()
                .map(|g| g.clone())
                .map_err(|_| anyhow::anyhow!("output_tx lock poisoned"))?;

            (
                restart,
                session.cwd.clone(),
                session.workspace_id.clone(),
                session.floor_id.clone(),
                session.cols,
                session.rows,
                session.title.clone(),
                session.agent_role.clone(),
                session.instructions.clone(),
                session.orchestrator_mode,
                session.is_autonomous,
                session.command.clone(),
                session.preset_id.clone(),
                session.initial_prompt.clone(),
                tx,
            )
        };

        if needs_restart {
            self.kill(&terminal_id).await.ok();
            let log_path = self.log_file_path(&terminal_id);
            let _ = tokio::fs::remove_file(&log_path).await;
            let _ = output_tx.send((terminal_id.clone(), b"\x1b[2J\x1b[H".to_vec()));

            self.spawn(
                TerminalSpawnOptions {
                    id: Some(terminal_id.clone()),
                    terminal_id: None,
                    workspace_id: Some(ws_id),
                    floor_id: Some(floor_id),
                    cwd: Some(cwd.to_string_lossy().to_string()),
                    command: cmd,
                    args: None,
                    env: None,
                    cols: Some(cols),
                    rows: Some(rows),
                    title: Some(title.clone()),
                    preset_id: preset.clone(),
                    agent_role: Some(role.clone()),
                    instructions: Some(instructions.clone()),
                    initial_prompt: init_prompt,
                    is_autonomous: Some(is_auto),
                    orchestrator_mode: Some(orch),
                    maestro_mode: Some(orch),
                },
                output_tx,
            )
            .await?;
        } else {
            self.ensure_skills(&cwd, &title, &role, &instructions, &terminal_id, orch)
                .await;
        }

        self.emit_event(
            "mindagentics:terminal:reconfigured",
            serde_json::json!({
                "terminalId": terminal_id,
                "title": title,
                "agentRole": role,
                "presetId": preset,
                "orchestratorMode": orch,
            }),
        );

        Ok(())
    }

    fn resolve_cli_bin_dir() -> Option<PathBuf> {
        let mut roots = Vec::new();
        if let Ok(cwd) = std::env::current_dir() {
            roots.push(cwd);
        }
        if let Ok(exe) = std::env::current_exe() {
            if let Some(parent) = exe.parent() {
                roots.push(parent.to_path_buf());
            }
        }

        for root in roots {
            for ancestor in root.ancestors() {
                let candidate = ancestor.join("packages").join("core-daemon").join("bin");
                if candidate.join("mindagentics.js").exists()
                    || candidate.join("mindagentics.cmd").exists()
                {
                    return Some(candidate);
                }
            }
        }
        None
    }

    fn claude_has_session(cwd: &Path) -> bool {
        if cwd.join(".claude").exists() {
            return true;
        }
        if let Some(home) = dirs::home_dir() {
            let hist = home.join(".claude").join("history.jsonl");
            if let Ok(meta) = std::fs::metadata(hist) {
                return meta.len() > 0;
            }
        }
        false
    }

    fn codex_has_session() -> bool {
        if let Some(home) = dirs::home_dir() {
            let sfile = home.join(".codex").join("session_index.jsonl");
            if let Ok(meta) = std::fs::metadata(sfile) {
                return meta.len() > 0;
            }
        }
        false
    }

    fn build_identity_briefing(
        agent_name: &str,
        agent_role: &str,
        instructions: &str,
        orchestrator_mode: bool,
        memory_line: &str,
    ) -> String {
        let cheatsheet_header = [
            "[mindAgentics Cheatsheet - Prefixo Estático Imutável]",
            "DIRETRIZ ZERO-READ: NUNCA execute read_file/cat em AGENTS.md, CLAUDE.md ou SKILL.md.",
            "DIRETRIZ DE TRANSCRIÇÃO (FIDELIDADE 100%): Ao criar ou atualizar notas adesivas (mindagentics note write/create), você deve transcrever o conteúdo na íntegra (100% verbatim).",
            "1. Ver equipe:        mindagentics list",
            "2. Delegar tarefa:    mindagentics ask \"<Nome>\" \"<Instrução>\"",
            "3. Criar/Ler nota:    mindagentics note create|write|read \"<Nome>\" [--file <caminho>]",
            "4. Consultar código:  mindagentics graphify query \"<termo>\"",
            "5. Abrir referência:  mindagentics portal open \"<url>\" --name \"<Título>\"",
            "6. Referência de arquivo/pasta: mindagentics ref add|list|remove <caminho> (só caminho, nunca conteúdo)",
            "7. Lembrar contexto:  mindagentics recall \"<termo>\"",
        ]
        .join("\n");

        let mut parts = Vec::new();
        if !agent_name.is_empty()
            && agent_name != "Terminal"
            && agent_name != "Antigravity"
            && agent_name != "Codex"
            && agent_name != "Claude Code"
        {
            parts.push(format!("Agente: \"{agent_name}\""));
        }
        if !agent_role.is_empty() {
            parts.push(format!("Papel: {agent_role}"));
        }
        if orchestrator_mode {
            parts.push("Modo: Orquestrador Central".to_string());
        }
        if !instructions.trim().is_empty() {
            parts.push(format!("Diretrizes: {}", instructions.trim()));
        }
        if !memory_line.is_empty() {
            parts.push(memory_line.to_string());
        }

        let mut result = if parts.is_empty() {
            cheatsheet_header
        } else {
            format!("{}\n[{}]", cheatsheet_header, parts.join(" | "))
        };

        if result.len() > MAX_BRIEFING_CHARS {
            let compact_header = [
                "[mindAgentics Cheatsheet]",
                "1. Equipe: mindagentics list | 2. Delegar: mindagentics ask \"<Nome>\" \"<Instrução>\"",
                "3. Nota: mindagentics note create|write|read \"<Nome>\"",
                "4. Referência: mindagentics ref add|list|remove <caminho> | 5. Memória: mindagentics recall \"<termo>\"",
            ]
            .join("\n");
            result = if parts.is_empty() {
                compact_header
            } else {
                format!("{}\n[{}]", compact_header, parts.join(" | "))
            };
        }

        while result.len() > MAX_BRIEFING_CHARS && parts.len() > 1 {
            parts.pop();
            result = format!("[mindAgentics Cheatsheet]\n[{}]", parts.join(" | "));
        }
        result
    }

    async fn ensure_skills(
        &self,
        cwd: &Path,
        title: &str,
        role: &str,
        instructions: &str,
        terminal_id: &str,
        orchestrator: bool,
    ) {
        let memory_line = if self.memory.has_summary(cwd, title) {
            format!("Memória: leia {}", MemoryService::summary_rel_path(title))
        } else {
            String::new()
        };

        let agents_md = cwd.join("AGENTS.md");
        let static_header = concat!(
            "# mindAgentics Canvas - Instruções para Agentes de IA\n\n",
            "> [!IMPORTANT]\n",
            "> **DIRETRIZ ZERO-READ (NÃO RE-LEIA ESTE MANUAL):**\n",
            "> Você já possui todas as instruções do mindAgentics e o Knowledge Graph do projeto pré-carregados no seu contexto nativo.\n",
            "> NUNCA execute ferramentas de leitura (`read_file`, `cat`, `Get-Content`, etc.) para ler `AGENTS.md`, `CLAUDE.md` ou `SKILL.md` do disco. Inicie diretamente a ação necessária ou responda ao colega de equipe.\n\n",
            "> [!IMPORTANT]\n",
            "> **DIRETRIZ DE TRANSCRIÇÃO (FIDELIDADE 100%):**\n",
            "> Ao criar ou atualizar notas adesivas (mindagentics note write/create), você deve transcrever o conteúdo na íntegra (100% verbatim). É expressamente proibido resumir, omitir detalhes técnicos, sintetizar tópicos ou parafrasear, a menos que o usuário utilize explicitamente palavras como \"resuma\" ou \"faça um resumo\".\n\n",
            "> [!NOTE]\n",
            "> **ARQUITETURA DE IMUTABILIDADE E PROMPT CACHING (ESTABILIDADE DE CACHE):**\n",
            "> Este cabeçalho e bloco estático inicial (> 1.024 tokens) são estritamente imutáveis e livres de timestamps, horários variáveis ou GUIDs aleatórios para garantir 100% de eficiência no Prompt Caching automático.\n"
        );

        let safe_title = sanitize_markdown_inline(title, 80);
        let safe_role = sanitize_markdown_inline(
            if role.is_empty() { "Developer" } else { role },
            200,
        );
        let safe_inst = sanitize_markdown_block(instructions, 4000);

        let agent_block = format!(
            "\n<!-- AGENT_BLOCK_START -->\n### Agente: {}\n- Papel: {}\n- Modo Orquestrador: {}\n- Diretrizes: {}\n- Terminal ID: {}\n{}\n<!-- AGENT_BLOCK_END -->\n",
            safe_title, safe_role, orchestrator, safe_inst, terminal_id, memory_line
        );

        if agents_md.exists() {
            if let Ok(existing) = tokio::fs::read_to_string(&agents_md).await {
                let clean = if let Some(idx) = existing.find("<!-- AGENT_BLOCK_START -->") {
                    &existing[..idx]
                } else {
                    &existing
                };
                let updated = format!("{}{}", clean.trim_end(), agent_block);
                let _ = tokio::fs::write(&agents_md, updated).await;
                return;
            }
        }

        let full = format!("{}{}", static_header, agent_block);
        let _ = tokio::fs::write(&agents_md, full).await;
    }
}

async fn session_arc_exists(
    sessions: &Arc<RwLock<HashMap<String, Arc<Mutex<TerminalSession>>>>>,
    terminal_id: &str,
) -> bool {
    sessions.read().await.contains_key(terminal_id)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn quote_powershell(value: &str, max_len: usize) -> String {
    let clean = sanitize_label(value, max_len);
    format!("'{}'", clean.replace('\'', "''"))
}

fn quote_posix(value: &str, max_len: usize) -> String {
    let clean = sanitize_label(value, max_len);
    format!("'{}'", clean.replace('\'', "'\\''"))
}

fn starts_with_word(cmd: &str, word: &str) -> bool {
    cmd == word || cmd.starts_with(&format!("{word} "))
}

fn replace_leading_word(cmd: &str, word: &str, replacement: &str) -> String {
    if cmd == word {
        replacement.to_string()
    } else if let Some(rest) = cmd.strip_prefix(&format!("{word} ")) {
        format!("{replacement} {rest}")
    } else {
        cmd.to_string()
    }
}

fn has_any_flag(cmd: &str, flags: &[&str]) -> bool {
    cmd.split_whitespace().any(|tok| flags.contains(&tok))
}

fn has_subcommand(cmd: &str, binary: &str, subs: &[&str]) -> bool {
    let mut parts = cmd.split_whitespace();
    match (parts.next(), parts.next()) {
        (Some(b), Some(sub)) if b == binary => subs.contains(&sub),
        _ => false,
    }
}

fn strip_flag_with_value(cmd: &str, flag: &str) -> String {
    let tokens: Vec<&str> = cmd.split_whitespace().collect();
    let mut out = Vec::with_capacity(tokens.len());
    let mut skip_next = false;
    for tok in tokens {
        if skip_next {
            skip_next = false;
            continue;
        }
        if tok == flag {
            skip_next = true;
            continue;
        }
        if tok.starts_with(&format!("{flag}=")) {
            continue;
        }
        out.push(tok);
    }
    out.join(" ")
}
