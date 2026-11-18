use serde::{Deserialize, Serialize};

pub const CURRENT_SCHEMA_VERSION: u32 = 1;

fn default_schema_version() -> u32 {
    CURRENT_SCHEMA_VERSION
}

fn default_uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn default_today() -> String {
    chrono::Utc::now().format("%Y-%m-%d").to_string()
}

// ==========================================
// Generic mindAgentics Storage Envelope
// ==========================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageEnvelope<T> {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(rename = "type")]
    pub doc_type: String,
    pub payload: T,
}

impl<T> StorageEnvelope<T> {
    pub fn new(doc_type: impl Into<String>, payload: T) -> Self {
        Self {
            schema_version: CURRENT_SCHEMA_VERSION,
            doc_type: doc_type.into(),
            payload,
        }
    }
}

// ==========================================
// Manifest
// ==========================================

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ManifestWorkspaceEntry {
    pub id: String,
    pub name: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_opened_at: Option<String>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ManifestDocument {
    #[serde(default = "default_manifest_app")]
    pub app: String,
    #[serde(default = "default_app_version")]
    pub app_version: String,
    #[serde(default = "default_data_format")]
    pub data_format: String,
    #[serde(alias = "version", default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_workspace_id: Option<String>,
    #[serde(default)]
    pub workspaces: Vec<ManifestWorkspaceEntry>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

fn default_manifest_app() -> String {
    "mindAgentics".to_string()
}

fn default_app_version() -> String {
    "0.26.0".to_string()
}

fn default_data_format() -> String {
    "json".to_string()
}

impl Default for ManifestDocument {
    fn default() -> Self {
        Self {
            app: default_manifest_app(),
            app_version: default_app_version(),
            data_format: default_data_format(),
            schema_version: CURRENT_SCHEMA_VERSION,
            files: Some(serde_json::json!({
                "appState": "app-state.json",
                "preferences": "preferences.json",
                "sidebarLayout": "sidebar-layout.json"
            })),
            active_workspace_id: None,
            workspaces: Vec::new(),
            extra: serde_json::Map::new(),
        }
    }
}

// ==========================================
// App State
// ==========================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WindowBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub maximized: bool,
    pub full_screen: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_fake_maximized: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub restore_bounds: Option<serde_json::Value>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

impl Default for WindowBounds {
    fn default() -> Self {
        Self {
            x: 100,
            y: 100,
            width: 1280,
            height: 800,
            maximized: false,
            full_screen: false,
            is_fake_maximized: None,
            restore_bounds: None,
            extra: serde_json::Map::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppState {
    pub clean_shutdown: bool,
    #[serde(alias = "onboardingCompleted", alias = "completedOnboarding")]
    pub has_completed_onboarding: bool,
    pub has_seen_floor_onboarding: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_workspace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_opened_at: Option<String>,
    #[serde(default)]
    pub recent_workspace_ids: Vec<String>,
    #[serde(default, alias = "workspaces")]
    pub workspace_order: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window_bounds: Option<WindowBounds>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locale: Option<String>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            clean_shutdown: true,
            has_completed_onboarding: false,
            has_seen_floor_onboarding: false,
            active_workspace_id: None,
            last_opened_at: Some(chrono::Utc::now().to_rfc3339()),
            recent_workspace_ids: Vec::new(),
            workspace_order: Vec::new(),
            window_bounds: Some(WindowBounds::default()),
            locale: None,
            extra: serde_json::Map::new(),
        }
    }
}

pub type AppStateDocument = StorageEnvelope<AppState>;

// ==========================================
// User Preferences
// ==========================================

pub fn default_agent_presets() -> Vec<serde_json::Value> {
    vec![
        serde_json::json!({
            "id": "C1A0DE00-0000-4000-8000-000000000001",
            "name": "Claude Code",
            "agentType": "claude_code",
            "command": "claude",
            "icon": "seal",
            "isActive": true,
            "orchestratorMode": false,
            "maestroMode": false,
            "startInChatMode": false,
            "codexDaemonMigration": "untouched"
        }),
        serde_json::json!({
            "id": "C1A0DE00-0000-4000-8000-000000000002",
            "name": "Codex",
            "agentType": "codex",
            "command": "codex --no-daemon",
            "icon": "brain",
            "isActive": true,
            "orchestratorMode": false,
            "maestroMode": false,
            "startInChatMode": false,
            "codexDaemonMigration": "added"
        }),
        serde_json::json!({
            "id": "C1A0DE00-0000-4000-8000-000000000003",
            "name": "Antigravity",
            "agentType": "antigravity_cli",
            "command": "agy",
            "icon": "zap",
            "isActive": true,
            "orchestratorMode": false,
            "maestroMode": false,
            "startInChatMode": false,
            "codexDaemonMigration": "untouched"
        }),
    ]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UserPreferences {
    pub autosave_interval_seconds: u32,
    pub default_sticky_note_color: String,
    pub default_terminal_font_family: String,
    #[serde(alias = "fontSize")]
    pub default_terminal_font_size: u32,
    #[serde(alias = "presets")]
    pub agent_presets: Vec<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub roles: Vec<serde_json::Value>,
    pub theme: String,
    #[serde(alias = "language")]
    pub locale: String,
    pub auto_save: bool,
    pub hardware_acceleration: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub telemetry_enabled: Option<bool>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

impl Default for UserPreferences {
    fn default() -> Self {
        Self {
            autosave_interval_seconds: 30,
            default_sticky_note_color: "yellow".to_string(),
            default_terminal_font_family: "Cascadia Mono, Consolas, 'DejaVu Sans Mono', monospace"
                .to_string(),
            default_terminal_font_size: 13,
            agent_presets: default_agent_presets(),
            roles: Vec::new(),
            theme: "dark".to_string(),
            locale: "pt-BR".to_string(),
            auto_save: true,
            hardware_acceleration: true,
            telemetry_enabled: None,
            extra: serde_json::Map::new(),
        }
    }
}

pub type PreferencesDocument = StorageEnvelope<UserPreferences>;

// ==========================================
// Workspace, CanvasNode, CableTie
// ==========================================

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct CanvasNode {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub node_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub x: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub y: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub z_index: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub floor_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<serde_json::Value>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct CableTie {
    pub id: String,
    #[serde(alias = "terminalIdA", skip_serializing_if = "Option::is_none")]
    pub from_node_id: Option<String>,
    #[serde(alias = "terminalIdB", skip_serializing_if = "Option::is_none")]
    pub to_node_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub floor_id: Option<String>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

pub fn default_ground_floor(working_directory: Option<&str>) -> serde_json::Value {
    let mut floor = serde_json::json!({
        "id": "ground",
        "name": "Ground Floor",
        "isGround": true,
        "gitBranch": "main",
        "status": null,
        "nodes": [],
        "cableTies": [],
        "bands": [],
        "drawings": []
    });
    if let Some(dir) = working_directory {
        if let Some(obj) = floor.as_object_mut() {
            obj.insert(
                "workingDirectory".to_string(),
                serde_json::Value::String(dir.to_string()),
            );
        }
    }
    floor
}

fn default_floors() -> Vec<serde_json::Value> {
    vec![default_ground_floor(None)]
}

fn default_workspace_name() -> String {
    "Main Workspace".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Workspace {
    #[serde(default = "default_uuid")]
    pub id: String,
    #[serde(default = "default_workspace_name")]
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub working_directory: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preferred_ide: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub root_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    #[serde(default = "default_floors")]
    pub floors: Vec<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub canvas_offset: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub nodes: Vec<CanvasNode>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cable_ties: Vec<CableTie>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

impl Default for Workspace {
    fn default() -> Self {
        let now = chrono::Utc::now().to_rfc3339();
        Self {
            id: default_uuid(),
            name: default_workspace_name(),
            working_directory: None,
            preferred_ide: Some("vscode".to_string()),
            root_path: None,
            created_at: Some(now.clone()),
            updated_at: Some(now),
            floors: default_floors(),
            canvas_offset: None,
            nodes: Vec::new(),
            cable_ties: Vec::new(),
            extra: serde_json::Map::new(),
        }
    }
}

impl Workspace {
    /// Synchronizes `workingDirectory` <-> `rootPath` and guarantees valid ID, name, and floor fallback.
    pub fn normalize(&mut self) {
        if self.id.trim().is_empty() {
            self.id = default_uuid();
        }
        if self.name.trim().is_empty() {
            self.name = default_workspace_name();
        }

        let wd = self
            .working_directory
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        let rp = self
            .root_path
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);

        match (wd, rp) {
            (Some(w), None) => {
                self.working_directory = Some(w.clone());
                self.root_path = Some(w);
            }
            (None, Some(r)) => {
                self.working_directory = Some(r.clone());
                self.root_path = Some(r);
            }
            (Some(w), Some(r)) => {
                self.working_directory = Some(w);
                self.root_path = Some(r);
            }
            (None, None) => {}
        }

        if self.preferred_ide.is_none() {
            self.preferred_ide = Some("vscode".to_string());
        }
        if self.floors.is_empty() {
            self.floors = vec![default_ground_floor(self.working_directory.as_deref())];
        }
    }
}

pub type WorkspaceDocument = StorageEnvelope<Workspace>;

// ==========================================
// Routines & History
// ==========================================

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct RoutineConfig {
    #[serde(default = "default_uuid")]
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schedule: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cron: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_terminal_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_terminal_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_reminder: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pre_run_script: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skip_if_busy: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notify: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub until: Option<String>,
    pub fire_count: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(alias = "lastRun", skip_serializing_if = "Option::is_none")]
    pub last_fired_at: Option<String>,
    #[serde(alias = "nextRun", skip_serializing_if = "Option::is_none")]
    pub next_fire_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_run_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

pub type Routine = RoutineConfig;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct RoutineRunRecord {
    #[serde(default = "default_uuid")]
    pub id: String,
    pub routine_id: String,
    #[serde(alias = "timestamp")]
    pub fired_at: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pre_run_output: Option<String>,
    #[serde(alias = "output", skip_serializing_if = "Option::is_none")]
    pub terminal_output: Option<String>,
    #[serde(alias = "lastError", skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(alias = "duration_ms", skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

pub type RoutineHistoryRecord = RoutineRunRecord;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RoutinesDocument {
    pub schema_version: u32,
    pub routines: Vec<RoutineConfig>,
}

impl Default for RoutinesDocument {
    fn default() -> Self {
        Self {
            schema_version: CURRENT_SCHEMA_VERSION,
            routines: Vec::new(),
        }
    }
}

// ==========================================
// User Profile & Gamification
// ==========================================

fn default_badge_tier() -> String {
    "bronze".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UserBadge {
    pub id: String,
    pub name: String,
    pub description: String,
    pub icon: String,
    #[serde(default = "default_badge_tier")]
    pub tier: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unlocked_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_progress: Option<u64>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

impl Default for UserBadge {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            description: String::new(),
            icon: "sparkles".to_string(),
            tier: default_badge_tier(),
            unlocked_at: None,
            progress: None,
            max_progress: None,
            extra: serde_json::Map::new(),
        }
    }
}

pub fn initial_badges() -> Vec<UserBadge> {
    Vec::new()
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct OrchestratorStats {
    #[serde(alias = "terminals_spawned")]
    pub terminals_spawned: u64,
    #[serde(alias = "agents_recruited")]
    pub agents_recruited: u64,
    #[serde(alias = "asks_sent")]
    pub asks_sent: u64,
    #[serde(alias = "notes_created")]
    pub notes_created: u64,
    #[serde(alias = "cable_ties_connected")]
    pub cable_ties_connected: u64,
    #[serde(alias = "bands_formed")]
    pub bands_formed: u64,
    #[serde(alias = "floors_created")]
    pub floors_created: u64,
    #[serde(alias = "routines_executed")]
    pub routines_executed: u64,
    #[serde(alias = "knowledge_graphs_built")]
    pub knowledge_graphs_built: u64,
    #[serde(alias = "messages_routed")]
    pub messages_routed: u64,
    // Shared profile model fields (shared/models/profile.ts)
    #[serde(alias = "recruits_count")]
    pub recruits_count: u64,
    #[serde(alias = "tasks_delegated")]
    pub tasks_delegated: u64,
    #[serde(alias = "portals_opened")]
    pub portals_opened: u64,
    #[serde(alias = "total_canvas_time_minutes")]
    pub total_canvas_time_minutes: u64,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

impl OrchestratorStats {
    pub fn increment_stat(&mut self, key: &str) {
        match key {
            "terminalsSpawned" | "terminals_spawned" => self.terminals_spawned += 1,
            "agentsRecruited" | "agents_recruited" => self.agents_recruited += 1,
            "asksSent" | "asks_sent" => self.asks_sent += 1,
            "notesCreated" | "notes_created" => self.notes_created += 1,
            "cableTiesConnected" | "cable_ties_connected" => self.cable_ties_connected += 1,
            "bandsFormed" | "bands_formed" => self.bands_formed += 1,
            "floorsCreated" | "floors_created" => self.floors_created += 1,
            "routinesExecuted" | "routines_executed" => self.routines_executed += 1,
            "knowledgeGraphsBuilt" | "knowledge_graphs_built" => self.knowledge_graphs_built += 1,
            "messagesRouted" | "messages_routed" => self.messages_routed += 1,
            "recruitsCount" | "recruits_count" => self.recruits_count += 1,
            "tasksDelegated" | "tasks_delegated" => self.tasks_delegated += 1,
            "portalsOpened" | "portals_opened" => self.portals_opened += 1,
            "totalCanvasTimeMinutes" | "total_canvas_time_minutes" => {
                self.total_canvas_time_minutes += 1
            }
            other => {
                let current = self
                    .extra
                    .get(other)
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                self.extra
                    .insert(other.to_string(), serde_json::Value::from(current + 1));
            }
        }
    }
}

pub fn get_title_for_level(level: u32) -> String {
    match level {
        0 | 1 => "Aprendiz de Orquestrador",
        2 => "Compositor de Agentes",
        3 => "Condutor de Enxame",
        4 => "Arquiteto de Inteligência",
        5 => "Orquestrador Cibernético",
        6 => "Mestre Orquestrador",
        7 => "Grande Regente Autônomo",
        8 => "Virtuoso Cognitivo",
        9 => "Lorde de Sistemas",
        _ => "Soberano do Canvas",
    }
    .to_string()
}

pub fn calculate_level_and_xp(total_xp: u64) -> (u32, u64, u64, String) {
    let mut lvl: u32 = 1;
    let mut accumulated: u64 = 0;

    loop {
        let required = 100u64 * (lvl as u64);
        if total_xp < accumulated + required {
            let current_xp = total_xp - accumulated;
            let xp_to_next_level = required - current_xp;
            return (lvl, current_xp, xp_to_next_level, get_title_for_level(lvl));
        }
        accumulated += required;
        lvl += 1;
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UserProfile {
    pub id: String,
    pub name: String,
    pub callsign: String,
    pub avatar_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    pub title: String,
    pub level: u32,
    pub current_xp: u64,
    pub xp_to_next_level: u64,
    pub total_xp: u64,
    pub streak_days: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub longest_streak_days: Option<u32>,
    pub last_active_date: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub activity_history: Option<std::collections::HashMap<String, u32>>,
    pub has_completed_onboarding: bool,
    pub badges: Vec<UserBadge>,
    pub stats: OrchestratorStats,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

impl Default for UserProfile {
    fn default() -> Self {
        let (level, current_xp, xp_to_next_level, title) = calculate_level_and_xp(0);
        let mut history = std::collections::HashMap::new();
        let today = default_today();
        history.insert(today.clone(), 1);
        Self {
            id: "user-default".to_string(),
            name: "Orchestrator".to_string(),
            callsign: "ARCHITECT-01".to_string(),
            avatar_id: "avatar-conductor".to_string(),
            avatar_url: Some(String::new()),
            title,
            level,
            current_xp,
            xp_to_next_level,
            total_xp: 0,
            streak_days: 1,
            longest_streak_days: Some(1),
            last_active_date: today,
            activity_history: Some(history),
            has_completed_onboarding: false,
            badges: Vec::new(),
            stats: OrchestratorStats::default(),
            extra: serde_json::Map::new(),
        }
    }
}

impl UserProfile {
    /// Migrates legacy fields (`xp`, `unlockedBadges`) if loaded from an older `profile.json`.
    pub fn migrate_legacy(&mut self) {
        if self.total_xp == 0 {
            if let Some(legacy_xp) = self.extra.remove("xp").and_then(|v| v.as_u64()) {
                self.total_xp = legacy_xp;
                let (lvl, curr, next, title) = calculate_level_and_xp(self.total_xp);
                self.level = lvl;
                self.current_xp = curr;
                self.xp_to_next_level = next;
                self.title = title;
            } else if self.current_xp > 0 || self.level > 1 {
                let mut accumulated = 0u64;
                for l in 1..self.level {
                    accumulated += 100u64 * (l as u64);
                }
                self.total_xp = accumulated + self.current_xp;
            }
        }

        self.badges.clear();
        self.extra.remove("unlockedBadges");
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AwardXpResult {
    pub profile: UserProfile,
    pub leveled_up: bool,
    pub unlocked_badges: Vec<UserBadge>,
}
