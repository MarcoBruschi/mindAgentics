use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::time::Duration;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCandidate {
    pub id: String,
    pub name: String,
    pub command: String,
    pub icon: String,
    pub installed: bool,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    pub id: String,
    pub title: String,
    pub label: String,
    pub used_fraction: Option<f64>,
    pub resets_at: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_minutes: Option<u32>,
    pub formatted_reset: String,
    pub reset_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportDetail {
    pub label: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentUsageReport {
    pub id: String,
    pub name: String,
    pub command: String,
    pub icon: String,
    pub installed: bool,
    pub path: Option<String>,
    pub status: String,
    pub color_hex: String,
    pub active_model: String,
    pub provider: String,
    pub plan_or_tier: String,
    pub primary_used_fraction: Option<f64>,
    pub secondary_used_fraction: Option<f64>,
    pub quota_percent: Option<u32>,
    pub secondary_percent: Option<u32>,
    pub primary_label: String,
    pub secondary_label: String,
    pub primary_reset_text: String,
    pub secondary_reset_text: String,
    pub windows: Vec<UsageWindow>,
    pub details: Vec<ReportDetail>,
}

struct LiveProbeResult {
    plan_or_tier: Option<String>,
    primary_used_fraction: Option<f64>,
    secondary_used_fraction: Option<f64>,
    primary_label: String,
    secondary_label: String,
    primary_reset_text: String,
    secondary_reset_text: String,
    windows: Vec<UsageWindow>,
}

pub fn which_binary(cmd: &str) -> Option<PathBuf> {
    if let Ok(path_var) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path_var) {
            let candidate = dir.join(cmd);
            if candidate.is_file() {
                return Some(candidate);
            }
            #[cfg(windows)]
            {
                let with_exe = dir.join(format!("{cmd}.exe"));
                if with_exe.is_file() {
                    return Some(with_exe);
                }
                let with_cmd = dir.join(format!("{cmd}.cmd"));
                if with_cmd.is_file() {
                    return Some(with_cmd);
                }
            }
        }
    }
    None
}

fn is_runnable_probe_binary(p: &Path) -> bool {
    if !p.is_file() {
        return false;
    }
    #[cfg(windows)]
    {
        let ext = p
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        return !matches!(ext.as_str(), "cmd" | "bat" | "ps1" | "vbs" | "js");
    }
    #[cfg(not(windows))]
    {
        true
    }
}

fn resolve_probe_binary(agent_path: Option<&str>, fallback_name: &str) -> Option<PathBuf> {
    let candidate = agent_path
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(fallback_name);

    if candidate.len() > 4096 || candidate.chars().any(|c| c.is_control()) {
        return None;
    }

    let cand_path = Path::new(candidate);
    if cand_path.is_absolute() {
        return if is_runnable_probe_binary(cand_path) {
            Some(cand_path.to_path_buf())
        } else {
            None
        };
    }

    if candidate.contains('\\') || candidate.contains('/') {
        return None;
    }

    if let Some(found) = which_binary(candidate) {
        if is_runnable_probe_binary(&found) {
            return Some(found);
        }
    }

    #[cfg(windows)]
    {
        if candidate.eq_ignore_ascii_case("agy") {
            if let Ok(local_app) = std::env::var("LOCALAPPDATA") {
                let fallback = PathBuf::from(local_app).join("agy").join("bin").join("agy.exe");
                if is_runnable_probe_binary(&fallback) {
                    return Some(fallback);
                }
            }
        }
    }

    None
}

fn configure_probe_command(cmd: &mut tokio::process::Command) {
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    for (k, _) in std::env::vars() {
        if k.starts_with("MINDAGENTICS_") {
            cmd.env_remove(&k);
        }
    }
}

fn format_reset_countdown(resets_at: Option<&Value>) -> String {
    let Some(val) = resets_at else {
        return "Janela contínua".to_string();
    };
    if val.is_null() {
        return "Janela contínua".to_string();
    }

    let target_ms: Option<i64> = if let Some(num) = val.as_f64() {
        if !num.is_finite() {
            None
        } else {
            let ms = if num < 10_000_000_000.0 {
                num * 1000.0
            } else {
                num
            };
            Some(ms as i64)
        }
    } else if let Some(s) = val.as_str() {
        chrono::DateTime::parse_from_rfc3339(s.trim())
            .ok()
            .map(|dt| dt.timestamp_millis())
    } else {
        None
    };

    let Some(target_ms) = target_ms else {
        return "Janela contínua".to_string();
    };

    let now_ms = chrono::Utc::now().timestamp_millis();
    let diff_ms = target_ms - now_ms;
    if diff_ms <= 0 {
        return "Redefinido recentemente".to_string();
    }

    let total_mins = diff_ms / 60_000;
    let hours = total_mins / 60;
    let mins = total_mins % 60;
    let days = hours / 24;

    if days > 1 {
        format!("Renova em {days} dias")
    } else if hours > 0 {
        format!("Redefine em {hours}h {mins}m")
    } else {
        format!("Redefine em {}m", mins.max(1))
    }
}

fn build_usage_windows(
    primary_fraction: Option<f64>,
    secondary_fraction: Option<f64>,
    primary_reset: Option<&str>,
    secondary_reset: Option<&str>,
) -> Vec<UsageWindow> {
    let p_reset = primary_reset
        .map(|s| s.to_string())
        .unwrap_or_else(|| {
            if primary_fraction.is_some() {
                "Janela contínua".to_string()
            } else {
                "Sem dados de cota".to_string()
            }
        });
    let s_reset = secondary_reset
        .map(|s| s.to_string())
        .unwrap_or_else(|| {
            if secondary_fraction.is_some() {
                "Renovação semanal".to_string()
            } else {
                "Sem dados de cota".to_string()
            }
        });

    vec![
        UsageWindow {
            id: "session".to_string(),
            title: "Sessão / Diário".to_string(),
            label: "Sessão / Diário".to_string(),
            used_fraction: primary_fraction,
            resets_at: None,
            duration_minutes: None,
            formatted_reset: p_reset.clone(),
            reset_text: p_reset,
        },
        UsageWindow {
            id: "weekly".to_string(),
            title: "Semanal (7d)".to_string(),
            label: "Semanal (7d)".to_string(),
            used_fraction: secondary_fraction,
            resets_at: None,
            duration_minutes: None,
            formatted_reset: s_reset.clone(),
            reset_text: s_reset,
        },
    ]
}

async fn probe_antigravity(agent_path: Option<&str>) -> Option<LiveProbeResult> {
    let agy_bin = resolve_probe_binary(agent_path, "agy")?;
    let mut cmd = tokio::process::Command::new(&agy_bin);
    cmd.args(["-p", "/usage", "--output-format", "json"]);
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::null());
    cmd.stdin(std::process::Stdio::null());
    configure_probe_command(&mut cmd);

    let output = tokio::time::timeout(Duration::from_secs(8), cmd.output())
        .await
        .ok()?
        .ok()?;
    if !output.status.success() || output.stdout.is_empty() || output.stdout.len() > 256 * 1024 {
        return None;
    }

    let json: Value = serde_json::from_slice(&output.stdout).ok()?;
    let groups = json
        .get("command")
        .and_then(|c| c.get("data"))
        .and_then(|d| d.get("groups"))
        .and_then(|g| g.as_array())?;

    let gemini_group = groups
        .iter()
        .find(|g| {
            g.get("name")
                .and_then(|n| n.as_str())
                .map(|n| n.contains("Gemini"))
                .unwrap_or(false)
        })
        .or_else(|| groups.first())?;

    let buckets = gemini_group.get("buckets").and_then(|b| b.as_array())?;
    let b5h = buckets.iter().find(|b| {
        b.get("window").and_then(|w| w.as_str()) == Some("5h")
            || b.get("id")
                .and_then(|id| id.as_str())
                .map(|id| id.contains("5h"))
                .unwrap_or(false)
    });
    let b_weekly = buckets.iter().find(|b| {
        b.get("window").and_then(|w| w.as_str()) == Some("weekly")
            || b.get("id")
                .and_then(|id| id.as_str())
                .map(|id| id.contains("weekly"))
                .unwrap_or(false)
    });

    let primary_fraction = b5h
        .and_then(|b| b.get("remaining_fraction"))
        .and_then(|v| v.as_f64())
        .map(|rem| (1.0 - rem).clamp(0.0, 1.0));
    let secondary_fraction = b_weekly
        .and_then(|b| b.get("remaining_fraction"))
        .and_then(|v| v.as_f64())
        .map(|rem| (1.0 - rem).clamp(0.0, 1.0));

    let primary_reset = match b5h {
        Some(b) => format_reset_countdown(b.get("reset_time")),
        None if primary_fraction.is_some() => "Janela contínua".to_string(),
        None => "Sem dados de cota".to_string(),
    };
    let secondary_reset = match b_weekly {
        Some(b) => format_reset_countdown(b.get("reset_time")),
        None if secondary_fraction.is_some() => "Renovação semanal".to_string(),
        None => "Sem dados de cota".to_string(),
    };

    let mut windows = build_usage_windows(
        primary_fraction,
        secondary_fraction,
        Some(&primary_reset),
        Some(&secondary_reset),
    );
    if let (Some(b), Some(w0)) = (b5h, windows.get_mut(0)) {
        w0.resets_at = b.get("reset_time").cloned();
        w0.duration_minutes = Some(300);
    }
    if let (Some(b), Some(w1)) = (b_weekly, windows.get_mut(1)) {
        w1.resets_at = b.get("reset_time").cloned();
        w1.duration_minutes = Some(10080);
    }

    Some(LiveProbeResult {
        plan_or_tier: None,
        primary_used_fraction: primary_fraction,
        secondary_used_fraction: secondary_fraction,
        primary_label: "Sessão (5h)".to_string(),
        secondary_label: "Semanal (7d)".to_string(),
        primary_reset_text: primary_reset,
        secondary_reset_text: secondary_reset,
        windows,
    })
}

async fn probe_codex(agent_path: Option<&str>) -> Option<LiveProbeResult> {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

    let codex_bin = resolve_probe_binary(agent_path, "codex")?;
    let mut cmd = tokio::process::Command::new(&codex_bin);
    cmd.args(["app-server", "--stdio"]);
    cmd.stdin(std::process::Stdio::piped());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::null());
    configure_probe_command(&mut cmd);

    let mut child = cmd.spawn().ok()?;
    let mut stdin = child.stdin.take()?;
    let stdout = child.stdout.take()?;

    let init_req = serde_json::json!({
        "id": 1,
        "method": "initialize",
        "params": { "clientInfo": { "name": "mindagentics", "title": "mindAgentics", "version": "1" } }
    })
    .to_string();
    if stdin
        .write_all(format!("{init_req}\n").as_bytes())
        .await
        .is_err()
    {
        let _ = child.kill().await;
        return None;
    }

    let mut reader = BufReader::new(stdout).lines();
    let result = tokio::time::timeout(Duration::from_millis(4500), async {
        while let Ok(Some(line)) = reader.next_line().await {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let Ok(msg) = serde_json::from_str::<Value>(trimmed) else {
                continue;
            };
            let msg_id = msg.get("id").and_then(|v| v.as_i64());
            if msg_id == Some(1) {
                let initialized = serde_json::json!({ "method": "initialized" }).to_string();
                let read_limits = serde_json::json!({
                    "id": 2,
                    "method": "account/rateLimits/read",
                    "params": { "excludeResetCreditDetails": true }
                })
                .to_string();
                let _ = stdin
                    .write_all(format!("{initialized}\n{read_limits}\n").as_bytes())
                    .await;
            } else if msg_id == Some(2) {
                if let Some(res) = msg.get("result") {
                    let rate_limits = res.get("rateLimits").unwrap_or(&Value::Null);
                    let primary = rate_limits.get("primary");
                    let secondary = rate_limits.get("secondary");
                    let plan_type = rate_limits
                        .get("planType")
                        .and_then(|v| v.as_str())
                        .unwrap_or("plus")
                        .chars()
                        .filter(|c| !c.is_control())
                        .take(20)
                        .collect::<String>()
                        .to_ascii_uppercase();

                    let primary_frac = primary
                        .and_then(|p| p.get("usedPercent"))
                        .and_then(|v| v.as_f64())
                        .map(|pct| (pct / 100.0).clamp(0.0, 1.0));
                    let secondary_frac = secondary
                        .and_then(|s| s.get("usedPercent"))
                        .and_then(|v| v.as_f64())
                        .map(|pct| (pct / 100.0).clamp(0.0, 1.0));

                    let primary_reset = match primary {
                        Some(p) => format_reset_countdown(p.get("resetsAt")),
                        None if primary_frac.is_some() => "Janela de 5h".to_string(),
                        None => "Sem dados de cota".to_string(),
                    };
                    let secondary_reset = match secondary {
                        Some(s) => format_reset_countdown(s.get("resetsAt")),
                        None if secondary_frac.is_some() => "Janela de 7d".to_string(),
                        None => "Sem dados de cota".to_string(),
                    };

                    let mut windows = build_usage_windows(
                        primary_frac,
                        secondary_frac,
                        Some(&primary_reset),
                        Some(&secondary_reset),
                    );
                    if let (Some(p), Some(w0)) = (primary, windows.get_mut(0)) {
                        w0.resets_at = p.get("resetsAt").cloned();
                        w0.duration_minutes = p
                            .get("windowDurationMins")
                            .and_then(|v| v.as_u64())
                            .map(|v| v as u32)
                            .or(Some(300));
                    }
                    if let (Some(s), Some(w1)) = (secondary, windows.get_mut(1)) {
                        w1.resets_at = s.get("resetsAt").cloned();
                        w1.duration_minutes = s
                            .get("windowDurationMins")
                            .and_then(|v| v.as_u64())
                            .map(|v| v as u32)
                            .or(Some(10080));
                    }

                    return Some(LiveProbeResult {
                        plan_or_tier: Some(format!("ChatGPT {plan_type}")),
                        primary_used_fraction: primary_frac,
                        secondary_used_fraction: secondary_frac,
                        primary_label: "Sessão (5h)".to_string(),
                        secondary_label: "Semanal (7d)".to_string(),
                        primary_reset_text: primary_reset,
                        secondary_reset_text: secondary_reset,
                        windows,
                    });
                }
                return None;
            }
        }
        None
    })
    .await
    .ok()
    .flatten();

    let _ = child.kill().await;
    result
}

pub fn detect_installed_agents() -> Vec<AgentCandidate> {
    let candidates = [
        ("antigravity", "Antigravity", "agy", "sparkle"),
        ("codex", "Codex", "codex", "brain"),
        ("opencode", "OpenCode", "opencode", "rectangle.portrait"),
        ("claude", "Claude Code", "claude", "seal"),
        ("github-copilot", "GitHub Copilot", "copilot", "terminal"),
        ("ollama", "Ollama", "ollama", "cpu"),
    ];

    candidates
        .into_iter()
        .map(|(id, name, cmd, icon)| {
            let mut found_path = which_binary(cmd);

            if found_path.is_none() {
                if id == "claude" {
                    if let Some(home) = dirs::home_dir() {
                        let claude_json = home.join(".claude.json");
                        let claude_dir = home.join(".claude");
                        if claude_json.exists() {
                            found_path = Some(claude_json);
                        } else if claude_dir.exists() {
                            found_path = Some(claude_dir);
                        }
                    }
                } else if id == "github-copilot" {
                    found_path = which_binary("gh");
                } else if id == "ollama" {
                    #[cfg(windows)]
                    if let Ok(local_app) = std::env::var("LOCALAPPDATA") {
                        let default_ollama =
                            PathBuf::from(local_app).join("Programs").join("Ollama").join("ollama.exe");
                        if default_ollama.is_file() {
                            found_path = Some(default_ollama);
                        }
                    }
                }
            }

            let installed = found_path.is_some();
            AgentCandidate {
                id: id.to_string(),
                name: name.to_string(),
                command: cmd.to_string(),
                icon: icon.to_string(),
                installed,
                path: found_path.map(|p| p.to_string_lossy().to_string()),
            }
        })
        .collect()
}

pub async fn get_agent_limits() -> Vec<AgentUsageReport> {
    let installed: Vec<AgentCandidate> = detect_installed_agents()
        .into_iter()
        .filter(|a| a.installed)
        .collect();

    let agy_path = installed
        .iter()
        .find(|a| a.id == "antigravity")
        .and_then(|a| a.path.clone());
    let codex_path = installed
        .iter()
        .find(|a| a.id == "codex")
        .and_then(|a| a.path.clone());

    let (agy_probe, codex_probe) = tokio::join!(
        async {
            if installed.iter().any(|a| a.id == "antigravity") {
                probe_antigravity(agy_path.as_deref()).await
            } else {
                None
            }
        },
        async {
            if installed.iter().any(|a| a.id == "codex") {
                probe_codex(codex_path.as_deref()).await
            } else {
                None
            }
        }
    );

    let mut reports = Vec::new();

    for agent in installed {
        match agent.id.as_str() {
            "antigravity" => {
                let primary_frac = agy_probe.as_ref().and_then(|p| p.primary_used_fraction);
                let secondary_frac = agy_probe.as_ref().and_then(|p| p.secondary_used_fraction);
                let quota_percent = primary_frac.map(|f| (f * 100.0).round() as u32);
                let secondary_percent = secondary_frac.map(|f| (f * 100.0).round() as u32);
                let primary_reset = agy_probe
                    .as_ref()
                    .map(|p| p.primary_reset_text.clone())
                    .unwrap_or_else(|| "Sem dados de cota".to_string());
                let secondary_reset = agy_probe
                    .as_ref()
                    .map(|p| p.secondary_reset_text.clone())
                    .unwrap_or_else(|| "Sem dados de cota".to_string());
                let windows = agy_probe
                    .as_ref()
                    .map(|p| p.windows.clone())
                    .unwrap_or_else(|| build_usage_windows(None, None, None, None));

                reports.push(AgentUsageReport {
                    id: agent.id,
                    name: "Antigravity".to_string(),
                    command: agent.command,
                    icon: agent.icon,
                    installed: true,
                    path: agent.path,
                    status: "active".to_string(),
                    color_hex: "#3B82F6".to_string(),
                    active_model: "Gemini 2.5 Pro (Adaptive)".to_string(),
                    provider: "Google DeepMind".to_string(),
                    plan_or_tier: "Google AI Pro Workspace".to_string(),
                    primary_used_fraction: primary_frac,
                    secondary_used_fraction: secondary_frac,
                    quota_percent,
                    secondary_percent,
                    primary_label: agy_probe
                        .as_ref()
                        .map(|p| p.primary_label.clone())
                        .unwrap_or_else(|| "Sessão (5h)".to_string()),
                    secondary_label: agy_probe
                        .as_ref()
                        .map(|p| p.secondary_label.clone())
                        .unwrap_or_else(|| "Semanal (7d)".to_string()),
                    primary_reset_text: primary_reset,
                    secondary_reset_text: secondary_reset,
                    windows,
                    details: vec![
                        ReportDetail {
                            label: "Janela de Contexto".into(),
                            value: "1.048.576 tokens (1M)".into(),
                        },
                        ReportDetail {
                            label: "Uso Sessão (5h)".into(),
                            value: quota_percent
                                .map(|q| format!("{q}% utilizado"))
                                .unwrap_or_else(|| "Sem dados de cota".to_string()),
                        },
                        ReportDetail {
                            label: "Uso Semanal (7d)".into(),
                            value: secondary_percent
                                .map(|q| format!("{q}% utilizado"))
                                .unwrap_or_else(|| "Sem dados de cota".to_string()),
                        },
                    ],
                });
            }
            "codex" => {
                let primary_frac = codex_probe.as_ref().and_then(|p| p.primary_used_fraction);
                let secondary_frac = codex_probe.as_ref().and_then(|p| p.secondary_used_fraction);
                let quota_percent = primary_frac.map(|f| (f * 100.0).round() as u32);
                let secondary_percent = secondary_frac.map(|f| (f * 100.0).round() as u32);
                let primary_reset = codex_probe
                    .as_ref()
                    .map(|p| p.primary_reset_text.clone())
                    .unwrap_or_else(|| "Sem dados de cota".to_string());
                let secondary_reset = codex_probe
                    .as_ref()
                    .map(|p| p.secondary_reset_text.clone())
                    .unwrap_or_else(|| "Sem dados de cota".to_string());
                let windows = codex_probe
                    .as_ref()
                    .map(|p| p.windows.clone())
                    .unwrap_or_else(|| build_usage_windows(None, None, None, None));

                reports.push(AgentUsageReport {
                    id: agent.id,
                    name: "Codex".to_string(),
                    command: agent.command,
                    icon: agent.icon,
                    installed: true,
                    path: agent.path,
                    status: "active".to_string(),
                    color_hex: "#10B981".to_string(),
                    active_model: "gpt-5-turbo".to_string(),
                    provider: "OpenAI".to_string(),
                    plan_or_tier: codex_probe
                        .as_ref()
                        .and_then(|p| p.plan_or_tier.clone())
                        .unwrap_or_else(|| "ChatGPT Plus Subscription".to_string()),
                    primary_used_fraction: primary_frac,
                    secondary_used_fraction: secondary_frac,
                    quota_percent,
                    secondary_percent,
                    primary_label: codex_probe
                        .as_ref()
                        .map(|p| p.primary_label.clone())
                        .unwrap_or_else(|| "Sessão (5h)".to_string()),
                    secondary_label: codex_probe
                        .as_ref()
                        .map(|p| p.secondary_label.clone())
                        .unwrap_or_else(|| "Semanal (7d)".to_string()),
                    primary_reset_text: primary_reset,
                    secondary_reset_text: secondary_reset,
                    windows,
                    details: vec![
                        ReportDetail {
                            label: "Janela de Contexto".into(),
                            value: "128.000 tokens (128k)".into(),
                        },
                        ReportDetail {
                            label: "Uso Sessão (5h)".into(),
                            value: quota_percent
                                .map(|q| format!("{q}% utilizado"))
                                .unwrap_or_else(|| "Sem dados de cota".to_string()),
                        },
                        ReportDetail {
                            label: "Uso Semanal (7d)".into(),
                            value: secondary_percent
                                .map(|q| format!("{q}% utilizado"))
                                .unwrap_or_else(|| "Sem dados de cota".to_string()),
                        },
                    ],
                });
            }
            "opencode" => {
                reports.push(AgentUsageReport {
                    id: agent.id,
                    name: "OpenCode".to_string(),
                    command: agent.command,
                    icon: agent.icon,
                    installed: true,
                    path: agent.path,
                    status: "ready".to_string(),
                    color_hex: "#06B6D4".to_string(),
                    active_model: "Multi-Provider (Claude / GPT)".to_string(),
                    provider: "OpenCode AI".to_string(),
                    plan_or_tier: "Developer Edition".to_string(),
                    primary_used_fraction: None,
                    secondary_used_fraction: None,
                    quota_percent: None,
                    secondary_percent: None,
                    primary_label: "Sessão / Diário".to_string(),
                    secondary_label: "Semanal (7d)".to_string(),
                    primary_reset_text: "Sem dados de cota".to_string(),
                    secondary_reset_text: "Sem dados de cota".to_string(),
                    windows: build_usage_windows(None, None, None, None),
                    details: vec![ReportDetail {
                        label: "Janela de Contexto".into(),
                        value: "200.000 tokens (200k)".into(),
                    }],
                });
            }
            "claude" => {
                reports.push(AgentUsageReport {
                    id: agent.id,
                    name: "Claude Code".to_string(),
                    command: agent.command,
                    icon: agent.icon,
                    installed: true,
                    path: agent.path,
                    status: "ready".to_string(),
                    color_hex: "#A855F7".to_string(),
                    active_model: "Claude 3.7 Sonnet".to_string(),
                    provider: "Anthropic".to_string(),
                    plan_or_tier: "Anthropic Claude Code".to_string(),
                    primary_used_fraction: None,
                    secondary_used_fraction: None,
                    quota_percent: None,
                    secondary_percent: None,
                    primary_label: "Sessão / Diário".to_string(),
                    secondary_label: "Semanal (7d)".to_string(),
                    primary_reset_text: "Sem dados de cota".to_string(),
                    secondary_reset_text: "Sem dados de cota".to_string(),
                    windows: build_usage_windows(None, None, None, None),
                    details: vec![ReportDetail {
                        label: "Janela de Contexto".into(),
                        value: "200.000 tokens (200k)".into(),
                    }],
                });
            }
            "github-copilot" => {
                reports.push(AgentUsageReport {
                    id: agent.id,
                    name: "GitHub Copilot".to_string(),
                    command: agent.command,
                    icon: agent.icon,
                    installed: true,
                    path: agent.path,
                    status: "active".to_string(),
                    color_hex: "#6366F1".to_string(),
                    active_model: "GPT-4o Engine".to_string(),
                    provider: "GitHub / Azure".to_string(),
                    plan_or_tier: "Copilot Pro / Business".to_string(),
                    primary_used_fraction: None,
                    secondary_used_fraction: None,
                    quota_percent: None,
                    secondary_percent: None,
                    primary_label: "Sessão / Diário".to_string(),
                    secondary_label: "Semanal (7d)".to_string(),
                    primary_reset_text: "Sem dados de cota".to_string(),
                    secondary_reset_text: "Sem dados de cota".to_string(),
                    windows: build_usage_windows(None, None, None, None),
                    details: vec![ReportDetail {
                        label: "Janela de Contexto".into(),
                        value: "128.000 tokens".into(),
                    }],
                });
            }
            "ollama" => {
                reports.push(AgentUsageReport {
                    id: agent.id,
                    name: "Ollama".to_string(),
                    command: agent.command,
                    icon: agent.icon,
                    installed: true,
                    path: agent.path,
                    status: "ready".to_string(),
                    color_hex: "#F59E0B".to_string(),
                    active_model: "Modelos Locais (Llama 3, Mistral, Qwen)".to_string(),
                    provider: "Ollama Local Runtime".to_string(),
                    plan_or_tier: "Hardware Local (100% Offline)".to_string(),
                    primary_used_fraction: None,
                    secondary_used_fraction: None,
                    quota_percent: None,
                    secondary_percent: None,
                    primary_label: "Sessão / Diário".to_string(),
                    secondary_label: "Semanal (7d)".to_string(),
                    primary_reset_text: "Sem limites de taxa".to_string(),
                    secondary_reset_text: "100% Offline".to_string(),
                    windows: build_usage_windows(
                        None,
                        None,
                        Some("Sem limites de taxa"),
                        Some("100% Offline"),
                    ),
                    details: vec![
                        ReportDetail {
                            label: "Janela de Contexto".into(),
                            value: "8.192 a 32.768 tokens (VRAM GPU)".into(),
                        },
                        ReportDetail {
                            label: "Uso Sessão (Diário)".into(),
                            value: "Sem limites (Local)".into(),
                        },
                        ReportDetail {
                            label: "Uso Semanal (7d)".into(),
                            value: "Sem limites (Local)".into(),
                        },
                    ],
                });
            }
            _ => {}
        }
    }

    reports
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentModelOption {
    pub id: String,
    pub label: String,
}

pub fn fallback_models_for(preset: &str) -> Vec<AgentModelOption> {
    match preset {
        "antigravity" | "agy" => vec![
            AgentModelOption { id: "gemini-4-argon-high".into(), label: "Gemini 4 Argon (High)".into() },
            AgentModelOption { id: "gemini-4-argon-medium".into(), label: "Gemini 4 Argon (Medium)".into() },
            AgentModelOption { id: "gemini-4-hydrogen-high".into(), label: "Gemini 4 Hydrogen (High)".into() },
            AgentModelOption { id: "gemini-4-hydrogen-xhigh".into(), label: "Gemini 4 Hydrogen (XHigh)".into() },
            AgentModelOption { id: "gemini-3.8-flash-high".into(), label: "Gemini 3.8 Flash (High)".into() },
            AgentModelOption { id: "claude-opus-5-5-high".into(), label: "Claude Opus 5.5 (High)".into() },
            AgentModelOption { id: "claude-sonnet-5-5-high".into(), label: "Claude Sonnet 5.5 (High)".into() },
            AgentModelOption { id: "claude-sonnet-5-5-medium".into(), label: "Claude Sonnet 5.5 (Medium)".into() },
            AgentModelOption { id: "gpt-oss-120b-medium".into(), label: "GPT-OSS 120B (Medium)".into() },
        ],
        "claude" | "claude-code" => vec![
            AgentModelOption { id: "sonnet".into(), label: "Claude Sonnet".into() },
            AgentModelOption { id: "opus".into(), label: "Claude Opus".into() },
            AgentModelOption { id: "haiku".into(), label: "Claude Haiku".into() },
        ],
        "codex" => vec![
            AgentModelOption { id: "gpt-5-codex".into(), label: "GPT-5 Codex".into() },
            AgentModelOption { id: "gpt-5".into(), label: "GPT-5".into() },
            AgentModelOption { id: "o3".into(), label: "o3".into() },
            AgentModelOption { id: "o4-mini".into(), label: "o4-mini".into() },
        ],
        "opencode" => vec![
            AgentModelOption { id: "anthropic/claude-sonnet-4-5".into(), label: "anthropic/claude-sonnet-4-5".into() },
            AgentModelOption { id: "anthropic/claude-opus-4-5".into(), label: "anthropic/claude-opus-4-5".into() },
            AgentModelOption { id: "openai/gpt-5".into(), label: "openai/gpt-5".into() },
            AgentModelOption { id: "google/gemini-2.5-pro".into(), label: "google/gemini-2.5-pro".into() },
        ],
        "ollama" => vec![
            AgentModelOption { id: "llama3".into(), label: "Llama 3".into() },
            AgentModelOption { id: "qwen2.5-coder".into(), label: "Qwen 2.5 Coder".into() },
            AgentModelOption { id: "deepseek-r1".into(), label: "DeepSeek R1".into() },
        ],
        _ => Vec::new(),
    }
}

pub async fn query_antigravity_models() -> Vec<AgentModelOption> {
    if let Some(agy_bin) = which_binary("agy") {
        let mut cmd = tokio::process::Command::new(agy_bin);
        cmd.arg("models");
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);

        if let Ok(Ok(output)) = tokio::time::timeout(Duration::from_millis(4000), cmd.output()).await {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let mut models = Vec::new();
                for line in stdout.lines() {
                    let trimmed = line.trim();
                    if trimmed.is_empty() || trimmed.starts_with("Fetching") {
                        continue;
                    }
                    if let Some((id, label)) = trimmed.split_once('\t') {
                        let id_clean = id.trim().to_string();
                        let label_clean = label.trim().to_string();
                        if !id_clean.is_empty() {
                            models.push(AgentModelOption {
                                id: id_clean,
                                label: if label_clean.is_empty() { id.trim().to_string() } else { label_clean },
                            });
                        }
                    }
                }
                if !models.is_empty() {
                    return models;
                }
            }
        }
    }
    fallback_models_for("antigravity")
}

pub async fn query_ollama_models() -> Vec<AgentModelOption> {
    if let Some(ollama_bin) = which_binary("ollama") {
        let mut cmd = tokio::process::Command::new(ollama_bin);
        cmd.arg("list");
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);

        if let Ok(Ok(output)) = tokio::time::timeout(Duration::from_millis(4000), cmd.output()).await {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let mut models = Vec::new();
                for (i, line) in stdout.lines().enumerate() {
                    if i == 0 {
                        continue; // Header: NAME ID SIZE MODIFIED
                    }
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if let Some(name) = parts.first() {
                        models.push(AgentModelOption {
                            id: name.to_string(),
                            label: name.to_string(),
                        });
                    }
                }
                if !models.is_empty() {
                    return models;
                }
            }
        }
    }
    fallback_models_for("ollama")
}

pub async fn get_agent_models(preset_id: Option<&str>) -> Value {
    let norm = preset_id.unwrap_or("").trim().to_lowercase();
    match norm.as_str() {
        "antigravity" | "agy" => serde_json::to_value(query_antigravity_models().await).unwrap_or(Value::Array(Vec::new())),
        "claude" | "claude-code" => serde_json::to_value(fallback_models_for("claude")).unwrap_or(Value::Array(Vec::new())),
        "codex" => serde_json::to_value(fallback_models_for("codex")).unwrap_or(Value::Array(Vec::new())),
        "opencode" => serde_json::to_value(fallback_models_for("opencode")).unwrap_or(Value::Array(Vec::new())),
        "ollama" => serde_json::to_value(query_ollama_models().await).unwrap_or(Value::Array(Vec::new())),
        _ => {
            let (agy, ollama) = tokio::join!(query_antigravity_models(), query_ollama_models());
            let mut map = serde_json::Map::new();
            map.insert("antigravity".into(), serde_json::to_value(agy).unwrap_or(Value::Array(Vec::new())));
            map.insert("claude".into(), serde_json::to_value(fallback_models_for("claude")).unwrap_or(Value::Array(Vec::new())));
            map.insert("codex".into(), serde_json::to_value(fallback_models_for("codex")).unwrap_or(Value::Array(Vec::new())));
            map.insert("opencode".into(), serde_json::to_value(fallback_models_for("opencode")).unwrap_or(Value::Array(Vec::new())));
            map.insert("ollama".into(), serde_json::to_value(ollama).unwrap_or(Value::Array(Vec::new())));
            Value::Object(map)
        }
    }
}
