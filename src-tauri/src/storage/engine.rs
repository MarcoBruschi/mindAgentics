use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use anyhow::{anyhow, bail, Context, Result};
use tokio::sync::Mutex;

use crate::security::path_safety::{check_path_string, is_inside};
use crate::storage::models::*;

#[derive(Clone)]
pub struct StorageEngine {
    data_dir: PathBuf,
    manifest_lock: Arc<Mutex<()>>,
    file_lock: Arc<Mutex<()>>,
    profile_lock: Arc<Mutex<()>>,
    workspace_lock: Arc<Mutex<()>>,
    routines_lock: Arc<Mutex<()>>,
}

impl Default for StorageEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl StorageEngine {
    pub fn new() -> Self {
        let data_dir = Self::resolve_data_dir();
        for sub in [
            "",
            "workspaces",
            "backups",
            "accounts",
            "git-hosts",
            "usage",
            "partituras",
        ] {
            let dir = if sub.is_empty() {
                data_dir.clone()
            } else {
                data_dir.join(sub)
            };
            if !dir.exists() {
                let _ = fs::create_dir_all(&dir);
            }
        }

        Self {
            data_dir,
            manifest_lock: Arc::new(Mutex::new(())),
            file_lock: Arc::new(Mutex::new(())),
            profile_lock: Arc::new(Mutex::new(())),
            workspace_lock: Arc::new(Mutex::new(())),
            routines_lock: Arc::new(Mutex::new(())),
        }
    }

    pub fn data_dir(&self) -> &PathBuf {
        &self.data_dir
    }

    pub fn get_data_dir(&self) -> PathBuf {
        self.data_dir.clone()
    }

    /// Resolve storage directory hierarchy identically to Electron's `DataService::resolveDataDir()`:
    /// 1. `MINDAGENTICS_DATA_DIR` env variable (if non-empty)
    /// 2. Pointer file (`%APPDATA%/mindAgentics/storage-location.json` on Windows, or OS equivalent)
    ///    checking `customDataDir` (or `path`)
    /// 3. `~/.mindagentics`
    fn resolve_data_dir() -> PathBuf {
        // 1. MINDAGENTICS_DATA_DIR env variable
        if let Ok(env_dir) = std::env::var("MINDAGENTICS_DATA_DIR") {
            let trimmed = env_dir.trim();
            if !trimmed.is_empty() {
                return PathBuf::from(trimmed);
            }
        }

        // 2. Pointer file (%APPDATA%/mindAgentics/storage-location.json or OS equivalent)
        #[cfg(windows)]
        let pointer_path = std::env::var("APPDATA")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .map(PathBuf::from)
            .or_else(dirs::config_dir)
            .map(|p| p.join("mindAgentics").join("storage-location.json"));

        #[cfg(target_os = "macos")]
        let pointer_path = dirs::data_dir()
            .map(|p| p.join("mindAgentics").join("storage-location.json"));

        #[cfg(all(not(windows), not(target_os = "macos")))]
        let pointer_path = dirs::config_dir()
            .map(|p| p.join("mindAgentics").join("storage-location.json"));

        if let Some(ref p) = pointer_path {
            if p.exists() {
                if let Ok(content) = fs::read_to_string(p) {
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) {
                        let target = parsed
                            .get("customDataDir")
                            .or_else(|| parsed.get("path"))
                            .and_then(|v| v.as_str());
                        if let Some(target_str) = target {
                            let trimmed = target_str.trim();
                            if !trimmed.is_empty() {
                                return PathBuf::from(trimmed);
                            }
                        }
                    }
                }
            }
        }

        // 3. ~/.mindagentics fallback
        if let Some(home) = dirs::home_dir() {
            return home.join(".mindagentics");
        }

        PathBuf::from(".mindagentics")
    }

    // ==========================================
    // Security & Path Validation Helpers
    // ==========================================

    pub fn validate_id<'a>(id: &'a str, label: &str) -> Result<&'a str> {
        let trimmed = id.trim();
        if trimmed.is_empty() {
            bail!("Access denied: Invalid {label} provided (empty)");
        }
        if trimmed.len() > 128 {
            bail!("Access denied: Invalid {label} provided (too long)");
        }
        if trimmed == "."
            || trimmed == ".."
            || trimmed.contains("..")
            || trimmed.contains('/')
            || trimmed.contains('\\')
            || trimmed.contains('\0')
            || trimmed.contains(':')
            || trimmed.chars().any(|c| c.is_control())
        {
            bail!("Access denied: Path traversal or unsafe characters detected in {label}");
        }
        if !trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
        {
            bail!("Access denied: {label} contains disallowed characters");
        }
        let safety = check_path_string(trimmed);
        if !safety.ok {
            bail!(
                "Access denied: Unsafe {label}: {}",
                safety.message.unwrap_or_default()
            );
        }
        Ok(trimmed)
    }

    fn normalize_with_existing_ancestor(path: &Path) -> PathBuf {
        if let Ok(c) = dunce::canonicalize(path) {
            return c;
        }
        let mut missing_tail: Vec<std::ffi::OsString> = Vec::new();
        let mut cur = path;
        while !cur.exists() {
            if let Some(name) = cur.file_name() {
                missing_tail.push(name.to_os_string());
            } else {
                break;
            }
            match cur.parent() {
                Some(p) => cur = p,
                None => break,
            }
        }
        let mut base = dunce::canonicalize(cur).unwrap_or_else(|_| cur.to_path_buf());
        for seg in missing_tail.into_iter().rev() {
            base.push(seg);
        }
        base
    }

    fn assert_target_safe(target_path: &Path, allowed_root: &Path) -> Result<()> {
        let raw = target_path.to_string_lossy();
        if raw.trim().is_empty() || raw.contains('\0') {
            bail!("Invalid file path provided for atomic write");
        }
        if target_path
            .components()
            .any(|c| matches!(c, Component::ParentDir))
        {
            bail!("Access denied: Path traversal detected in path '{}'", raw);
        }

        let parent = target_path.parent().context("Invalid target path parent")?;
        if parent.as_os_str().is_empty() {
            bail!("Unsafe target directory for atomic write");
        }

        // Confine within allowed_root (canonicalizing nearest existing ancestor)
        let abs_root = if allowed_root.is_absolute() {
            allowed_root.to_path_buf()
        } else {
            std::env::current_dir()?.join(allowed_root)
        };
        let abs_target = if target_path.is_absolute() {
            target_path.to_path_buf()
        } else {
            std::env::current_dir()?.join(target_path)
        };

        let norm_root = Self::normalize_with_existing_ancestor(&abs_root);
        let norm_target = Self::normalize_with_existing_ancestor(&abs_target);

        if !is_inside(&norm_root, &norm_target) {
            bail!(
                "Access denied: Path '{}' escapes base directory '{}'",
                abs_target.display(),
                abs_root.display()
            );
        }

        Ok(())
    }

    /// Atomic file replacement via temporary file write + flush + sync + atomic rename
    /// with Windows lock retries, orphan cleanup, and `.bak` backup for critical files.
    pub async fn replace_file_atomically(&self, target_path: &Path, content: &[u8]) -> Result<()> {
        self.replace_file_atomically_in_root(target_path, content, &self.data_dir)
            .await
    }

    async fn replace_file_atomically_in_root(
        &self,
        target_path: &Path,
        content: &[u8],
        allowed_root: &Path,
    ) -> Result<()> {
        Self::assert_target_safe(target_path, allowed_root)?;

        let _guard = self.file_lock.lock().await;

        let parent = target_path.parent().context("Invalid target path parent")?;
        if !parent.exists() {
            tokio::fs::create_dir_all(parent).await?;
        } else {
            let meta = tokio::fs::metadata(parent).await?;
            if !meta.is_dir() {
                bail!(
                    "Target parent exists but is not a directory: {}",
                    parent.display()
                );
            }
        }

        // Maintain .bak backup for critical files prior to replacing
        let file_name = target_path
            .file_name()
            .context("No file name")?
            .to_string_lossy();
        let lower_name = file_name.to_lowercase();
        if matches!(
            lower_name.as_str(),
            "manifest.json" | "app-state.json" | "workspace.json"
        ) && target_path.exists()
        {
            if let Ok(meta) = tokio::fs::metadata(target_path).await {
                if meta.len() > 0 {
                    let bak_path = PathBuf::from(format!("{}.bak", target_path.display()));
                    let _ = tokio::fs::copy(target_path, bak_path).await;
                }
            }
        }

        let tmp_file_name = format!("{}.{}.tmp", file_name, uuid::Uuid::new_v4());
        let tmp_path = parent.join(tmp_file_name);

        use tokio::io::AsyncWriteExt;
        let write_res: Result<()> = async {
            let mut file = tokio::fs::File::create(&tmp_path).await?;
            file.write_all(content).await?;
            file.flush().await?;
            file.sync_all().await?;
            drop(file);

            let retry_delays_ms = [50u64, 150, 300];
            let mut last_err: Option<std::io::Error> = None;

            for attempt in 0..=retry_delays_ms.len() {
                match tokio::fs::rename(&tmp_path, target_path).await {
                    Ok(()) => {
                        last_err = None;
                        break;
                    }
                    Err(e) => {
                        let is_lock_err = matches!(
                            e.kind(),
                            std::io::ErrorKind::PermissionDenied
                                | std::io::ErrorKind::WouldBlock
                        ) || matches!(e.raw_os_error(), Some(5) | Some(32) | Some(33));
                        last_err = Some(e);
                        if is_lock_err && attempt < retry_delays_ms.len() {
                            tokio::time::sleep(std::time::Duration::from_millis(
                                retry_delays_ms[attempt],
                            ))
                            .await;
                        } else {
                            break;
                        }
                    }
                }
            }

            if let Some(e) = last_err {
                return Err(e.into());
            }
            Ok(())
        }
        .await;

        if write_res.is_err() && tmp_path.exists() {
            let _ = tokio::fs::remove_file(&tmp_path).await;
        }

        write_res
    }

    /// Reads a JSON file with transient Windows lock retries, corruption quarantine, and `.bak` recovery.
    async fn read_json_value_with_fallback(&self, path: &Path) -> Result<Option<serde_json::Value>> {
        if !path.exists() {
            return Ok(None);
        }

        let mut raw_bytes: Option<Vec<u8>> = None;
        for attempt in 0..3u64 {
            match tokio::fs::read(path).await {
                Ok(b) => {
                    raw_bytes = Some(b);
                    break;
                }
                Err(e) => {
                    let is_lock = matches!(
                        e.kind(),
                        std::io::ErrorKind::PermissionDenied | std::io::ErrorKind::WouldBlock
                    ) || matches!(e.raw_os_error(), Some(5) | Some(32) | Some(33));
                    if is_lock && attempt < 2 {
                        tokio::time::sleep(std::time::Duration::from_millis(50 * (attempt + 1)))
                            .await;
                    } else {
                        break;
                    }
                }
            }
        }

        if let Some(bytes) = raw_bytes {
            let trimmed = String::from_utf8_lossy(&bytes);
            if !trimmed.trim().is_empty() {
                if let Ok(val) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                    return Ok(Some(val));
                }
            }
        }

        // Quarantine damaged file
        let quarantine_path = PathBuf::from(format!(
            "{}.corrupted.{}",
            path.display(),
            chrono::Utc::now().timestamp_millis()
        ));
        let _ = tokio::fs::copy(path, &quarantine_path).await;

        // Try reading .bak backup
        let bak_path = PathBuf::from(format!("{}.bak", path.display()));
        if bak_path.exists() {
            if let Ok(bak_bytes) = tokio::fs::read(&bak_path).await {
                if let Ok(val) = serde_json::from_slice::<serde_json::Value>(&bak_bytes) {
                    return Ok(Some(val));
                }
            }
        }

        Ok(None)
    }

    fn unwrap_envelope(val: serde_json::Value) -> serde_json::Value {
        if let Some(obj) = val.as_object() {
            if let Some(payload) = obj.get("payload") {
                if !payload.is_null() {
                    return payload.clone();
                }
            }
        }
        val
    }

    fn merge_json_top_level(target: &mut serde_json::Value, patch: &serde_json::Value) {
        if let (Some(obj), Some(patch_obj)) = (target.as_object_mut(), patch.as_object()) {
            for (k, v) in patch_obj {
                obj.insert(k.clone(), v.clone());
            }
        }
    }

    // ==========================================
    // AppState
    // ==========================================

    pub async fn get_app_state(&self) -> Result<AppState> {
        let p = self.data_dir.join("app-state.json");
        if let Some(val) = self.read_json_value_with_fallback(&p).await? {
            let payload = Self::unwrap_envelope(val);
            if let Ok(state) = serde_json::from_value::<AppState>(payload) {
                return Ok(state);
            }
        }
        Ok(AppState::default())
    }

    pub async fn save_app_state(&self, patch: serde_json::Value) -> Result<AppState> {
        let current = self.get_app_state().await?;
        let mut val = serde_json::to_value(current)?;
        Self::merge_json_top_level(&mut val, &patch);
        if let Some(obj) = val.as_object_mut() {
            obj.insert(
                "lastOpenedAt".to_string(),
                serde_json::Value::String(chrono::Utc::now().to_rfc3339()),
            );
        }
        let updated: AppState = serde_json::from_value(val)?;
        let envelope = StorageEnvelope::new("appState", &updated);
        let json = serde_json::to_vec_pretty(&envelope)?;
        self.replace_file_atomically(&self.data_dir.join("app-state.json"), &json)
            .await?;
        Ok(updated)
    }

    pub async fn set_onboarding_completed(&self, completed: bool) -> Result<AppState> {
        self.save_app_state(serde_json::json!({
            "hasCompletedOnboarding": completed
        }))
        .await
    }

    pub async fn set_has_seen_floor_onboarding(&self, seen: bool) -> Result<AppState> {
        self.save_app_state(serde_json::json!({
            "hasSeenFloorOnboarding": seen
        }))
        .await
    }

    pub async fn set_seen_floor_onboarding(&self, seen: bool) -> Result<AppState> {
        self.set_has_seen_floor_onboarding(seen).await
    }

    // ==========================================
    // Preferences
    // ==========================================

    pub async fn get_preferences(&self) -> Result<UserPreferences> {
        let p = self.data_dir.join("preferences.json");
        if let Some(val) = self.read_json_value_with_fallback(&p).await? {
            let payload = Self::unwrap_envelope(val);
            if let Ok(prefs) = serde_json::from_value::<UserPreferences>(payload) {
                return Ok(prefs);
            }
        }
        Ok(UserPreferences::default())
    }

    pub async fn set_preferences(&self, patch: serde_json::Value) -> Result<UserPreferences> {
        let current = self.get_preferences().await?;
        let mut val = serde_json::to_value(current)?;
        Self::merge_json_top_level(&mut val, &patch);
        let updated: UserPreferences = serde_json::from_value(val)?;
        let envelope = StorageEnvelope::new("preferences", &updated);
        let json = serde_json::to_vec_pretty(&envelope)?;
        self.replace_file_atomically(&self.data_dir.join("preferences.json"), &json)
            .await?;
        Ok(updated)
    }

    // ==========================================
    // Manifest & Workspaces
    // ==========================================

    pub async fn get_manifest(&self) -> Result<ManifestDocument> {
        let _guard = self.manifest_lock.lock().await;
        let p = self.data_dir.join("manifest.json");
        if let Some(val) = self.read_json_value_with_fallback(&p).await? {
            if let Ok(doc) = serde_json::from_value::<ManifestDocument>(val) {
                return Ok(doc);
            }
        }
        Ok(ManifestDocument::default())
    }

    async fn upsert_manifest_workspace(&self, ws: &Workspace, set_active: bool) -> Result<()> {
        let _guard = self.manifest_lock.lock().await;
        let p = self.data_dir.join("manifest.json");
        let mut manifest = if let Some(val) = self.read_json_value_with_fallback(&p).await? {
            serde_json::from_value::<ManifestDocument>(val).unwrap_or_default()
        } else {
            ManifestDocument::default()
        };

        let rel_path = format!("workspaces/{}/workspace.json", ws.id);
        let now = chrono::Utc::now().to_rfc3339();
        if let Some(entry) = manifest.workspaces.iter_mut().find(|e| e.id == ws.id) {
            entry.name = ws.name.clone();
            entry.path = rel_path;
            if set_active {
                entry.last_opened_at = Some(now);
            }
        } else {
            manifest.workspaces.push(ManifestWorkspaceEntry {
                id: ws.id.clone(),
                name: ws.name.clone(),
                path: rel_path,
                created_at: ws.created_at.clone().or_else(|| Some(now.clone())),
                last_opened_at: Some(now),
                extra: serde_json::Map::new(),
            });
        }

        if set_active {
            manifest.active_workspace_id = Some(ws.id.clone());
        }

        let bytes = serde_json::to_vec_pretty(&manifest)?;
        self.replace_file_atomically(&p, &bytes).await
    }

    fn workspace_json_path(&self, id: &str) -> PathBuf {
        self.data_dir
            .join("workspaces")
            .join(id)
            .join("workspace.json")
    }

    fn legacy_workspace_json_path(&self, id: &str) -> PathBuf {
        self.data_dir.join("workspaces").join(format!("{id}.json"))
    }

    pub async fn get_workspace(&self, id: &str) -> Result<Option<Workspace>> {
        let safe_id = Self::validate_id(id, "workspaceId")?;
        let primary = self.workspace_json_path(safe_id);
        let legacy = self.legacy_workspace_json_path(safe_id);

        let val_opt = if primary.exists() {
            self.read_json_value_with_fallback(&primary).await?
        } else if legacy.exists() {
            self.read_json_value_with_fallback(&legacy).await?
        } else {
            None
        };

        let Some(val) = val_opt else {
            return Ok(None);
        };

        let payload = Self::unwrap_envelope(val);
        let mut ws: Workspace = serde_json::from_value(payload)
            .with_context(|| format!("Failed to deserialize workspace '{safe_id}'"))?;
        ws.id = safe_id.to_string();
        ws.normalize();
        Ok(Some(ws))
    }

    pub async fn list_workspaces(&self) -> Result<Vec<Workspace>> {
        let ws_root = self.data_dir.join("workspaces");
        let mut discovered: Vec<Workspace> = Vec::new();
        let mut seen_ids: HashSet<String> = HashSet::new();

        if ws_root.exists() {
            if let Ok(mut entries) = tokio::fs::read_dir(&ws_root).await {
                while let Ok(Some(entry)) = entries.next_entry().await {
                    let file_type = match entry.file_type().await {
                        Ok(ft) => ft,
                        Err(_) => continue,
                    };
                    let name = entry.file_name().to_string_lossy().to_string();

                    if file_type.is_dir() {
                        if Self::validate_id(&name, "workspaceId").is_err() {
                            continue;
                        }
                        if entry.path().join("workspace.json").exists() {
                            if let Ok(Some(ws)) = self.get_workspace(&name).await {
                                seen_ids.insert(ws.id.clone());
                                discovered.push(ws);
                            }
                        }
                    } else if file_type.is_file() && name.ends_with(".json") {
                        let id = name.trim_end_matches(".json").to_string();
                        if seen_ids.contains(&id) || Self::validate_id(&id, "workspaceId").is_err()
                        {
                            continue;
                        }
                        if let Ok(Some(ws)) = self.get_workspace(&id).await {
                            seen_ids.insert(ws.id.clone());
                            discovered.push(ws);
                        }
                    }
                }
            }
        }

        // If none exist on disk, create and persist default 'Main Workspace' (with ground floor)
        if discovered.is_empty() {
            let default_dir = dirs::home_dir()
                .map(|h| h.to_string_lossy().to_string())
                .unwrap_or_else(|| ".".to_string());
            let default_ws = self
                .create_workspace(serde_json::json!({
                    "name": "Main Workspace",
                    "workingDirectory": default_dir,
                    "preferredIde": "vscode"
                }))
                .await?;
            return Ok(vec![default_ws]);
        }

        // Order according to app-state.json (workspaceOrder / recentWorkspaceIds), then manifest.json
        let app_state = self.get_app_state().await.unwrap_or_default();
        let manifest = self.get_manifest().await.unwrap_or_default();

        let mut order: Vec<String> = Vec::new();
        for id in app_state
            .workspace_order
            .iter()
            .chain(manifest.workspaces.iter().map(|w| &w.id))
            .chain(app_state.recent_workspace_ids.iter())
        {
            if !order.contains(id) {
                order.push(id.clone());
            }
        }

        discovered.sort_by(|a, b| {
            let pos_a = order.iter().position(|id| id == &a.id);
            let pos_b = order.iter().position(|id| id == &b.id);
            match (pos_a, pos_b) {
                (Some(ia), Some(ib)) => ia.cmp(&ib),
                (Some(_), None) => std::cmp::Ordering::Less,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (None, None) => a.created_at.cmp(&b.created_at).then_with(|| a.id.cmp(&b.id)),
            }
        });

        Ok(discovered)
    }

    async fn save_workspace_internal(&self, ws: &mut Workspace, set_active: bool) -> Result<()> {
        let safe_id = Self::validate_id(&ws.id, "workspaceId")?.to_string();
        ws.id = safe_id.clone();
        ws.normalize();

        let ws_file = self.workspace_json_path(&safe_id);
        let envelope = StorageEnvelope::new("workspace", &*ws);
        let json = serde_json::to_vec_pretty(&envelope)?;
        self.replace_file_atomically(&ws_file, &json).await?;

        // Sync markdown notes to <data_dir>/workspaces/<id>/notes/<noteId>.md
        if let Err(err) = self.sync_workspace_notes(&safe_id, ws).await {
            tracing::warn!("Error synchronizing notes for workspace {}: {}", safe_id, err);
        }

        // Keep manifest.json up to date
        self.upsert_manifest_workspace(ws, set_active).await?;

        if set_active {
            let state = self.get_app_state().await.unwrap_or_default();
            let mut recents = state.recent_workspace_ids;
            recents.retain(|wid| wid != &safe_id);
            recents.insert(0, safe_id.clone());

            let mut order = state.workspace_order;
            if !order.contains(&safe_id) {
                order.push(safe_id.clone());
            }

            let _ = self
                .save_app_state(serde_json::json!({
                    "activeWorkspaceId": safe_id,
                    "recentWorkspaceIds": recents,
                    "workspaceOrder": order
                }))
                .await;
        }

        Ok(())
    }

    pub async fn create_workspace(&self, data: serde_json::Value) -> Result<Workspace> {
        let _guard = self.workspace_lock.lock().await;
        let now = chrono::Utc::now().to_rfc3339();
        let default_home = dirs::home_dir()
            .map(|h| h.to_string_lossy().to_string())
            .unwrap_or_else(|| ".".to_string());

        let mut base = serde_json::Map::new();
        if let Some(obj) = data.as_object() {
            for (k, v) in obj {
                base.insert(k.clone(), v.clone());
            }
        }

        let id = base
            .get("id")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty() && Self::validate_id(s, "workspaceId").is_ok())
            .map(str::to_string)
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

        let name = base
            .get("name")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| "Main Workspace".to_string());

        let dir = base
            .get("workingDirectory")
            .or_else(|| base.get("rootPath"))
            .or_else(|| base.get("path"))
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or(default_home);

        let ide = base
            .get("preferredIde")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| "vscode".to_string());

        base.insert("id".to_string(), serde_json::Value::String(id));
        base.insert("name".to_string(), serde_json::Value::String(name));
        base.insert(
            "workingDirectory".to_string(),
            serde_json::Value::String(dir.clone()),
        );
        base.insert("rootPath".to_string(), serde_json::Value::String(dir.clone()));
        base.insert("preferredIde".to_string(), serde_json::Value::String(ide));
        base.entry("createdAt".to_string())
            .or_insert_with(|| serde_json::Value::String(now.clone()));
        base.insert("updatedAt".to_string(), serde_json::Value::String(now));

        let has_floors = base
            .get("floors")
            .and_then(|v| v.as_array())
            .map(|a| !a.is_empty())
            .unwrap_or(false);
        if !has_floors {
            base.insert(
                "floors".to_string(),
                serde_json::Value::Array(vec![default_ground_floor(Some(&dir))]),
            );
        }

        let mut ws: Workspace = serde_json::from_value(serde_json::Value::Object(base))?;
        self.save_workspace_internal(&mut ws, true).await?;
        Ok(ws)
    }

    pub async fn patch_workspace(&self, id: &str, data: serde_json::Value) -> Result<Workspace> {
        let safe_id = Self::validate_id(id, "workspaceId")?;
        let _guard = self.workspace_lock.lock().await;

        let current = self.get_workspace(safe_id).await?.unwrap_or_else(|| {
            let mut ws = Workspace::default();
            ws.id = safe_id.to_string();
            ws
        });

        let mut val = serde_json::to_value(current)?;
        if let Some(patch_obj) = data.as_object() {
            // If patch updates only workingDirectory or only rootPath, keep them synced
            let patched_wd = patch_obj.get("workingDirectory").and_then(|v| v.as_str());
            let patched_rp = patch_obj.get("rootPath").and_then(|v| v.as_str());

            Self::merge_json_top_level(&mut val, &data);

            if let Some(obj) = val.as_object_mut() {
                if let (Some(wd), None) = (patched_wd, patched_rp) {
                    obj.insert(
                        "rootPath".to_string(),
                        serde_json::Value::String(wd.to_string()),
                    );
                } else if let (None, Some(rp)) = (patched_wd, patched_rp) {
                    obj.insert(
                        "workingDirectory".to_string(),
                        serde_json::Value::String(rp.to_string()),
                    );
                }
            }
        }

        if let Some(obj) = val.as_object_mut() {
            obj.insert(
                "id".to_string(),
                serde_json::Value::String(safe_id.to_string()),
            );
            obj.insert(
                "updatedAt".to_string(),
                serde_json::Value::String(chrono::Utc::now().to_rfc3339()),
            );
        }

        let mut updated: Workspace = serde_json::from_value(val)?;
        self.save_workspace_internal(&mut updated, false).await?;
        Ok(updated)
    }

    pub async fn delete_workspace(&self, id: &str) -> Result<()> {
        let safe_id = Self::validate_id(id, "workspaceId")?.to_string();
        let _guard = self.workspace_lock.lock().await;

        // 1. Remove from manifest.json
        {
            let _m_guard = self.manifest_lock.lock().await;
            let p = self.data_dir.join("manifest.json");
            if let Some(val) = self.read_json_value_with_fallback(&p).await? {
                if let Ok(mut manifest) = serde_json::from_value::<ManifestDocument>(val) {
                    manifest.workspaces.retain(|w| w.id != safe_id);
                    if manifest.active_workspace_id.as_deref() == Some(safe_id.as_str()) {
                        manifest.active_workspace_id =
                            manifest.workspaces.first().map(|w| w.id.clone());
                    }
                    let bytes = serde_json::to_vec_pretty(&manifest)?;
                    self.replace_file_atomically(&p, &bytes).await?;
                }
            }
        }

        // 2. Remove workspace directory, legacy flat file, and legacy notes dir
        let ws_dir = self.data_dir.join("workspaces").join(&safe_id);
        if ws_dir.exists() {
            let _ = tokio::fs::remove_dir_all(&ws_dir).await;
        }
        let legacy_file = self.legacy_workspace_json_path(&safe_id);
        if legacy_file.exists() {
            let _ = tokio::fs::remove_file(&legacy_file).await;
        }
        let legacy_notes = self.data_dir.join("notes").join(&safe_id);
        if legacy_notes.exists() {
            let _ = tokio::fs::remove_dir_all(&legacy_notes).await;
        }

        // 3. Clean up app-state.json & reset activeWorkspaceId cleanly
        let state = self.get_app_state().await.unwrap_or_default();
        let mut recents = state.recent_workspace_ids;
        recents.retain(|wid| wid != &safe_id);
        let mut order = state.workspace_order;
        order.retain(|wid| wid != &safe_id);

        let mut active_id = state.active_workspace_id;
        if active_id.as_deref() == Some(safe_id.as_str()) {
            // Find any remaining workspace on disk
            let mut fallback = recents.first().cloned().or_else(|| order.first().cloned());
            if fallback.is_none() {
                let ws_root = self.data_dir.join("workspaces");
                if ws_root.exists() {
                    if let Ok(mut rd) = tokio::fs::read_dir(&ws_root).await {
                        while let Ok(Some(entry)) = rd.next_entry().await {
                            let name = entry.file_name().to_string_lossy().to_string();
                            if entry.path().join("workspace.json").exists() {
                                fallback = Some(name);
                                break;
                            }
                            if name.ends_with(".json") {
                                fallback = Some(name.trim_end_matches(".json").to_string());
                                break;
                            }
                        }
                    }
                }
            }
            active_id = fallback;
        }

        let _ = self
            .save_app_state(serde_json::json!({
                "recentWorkspaceIds": recents,
                "workspaceOrder": order,
                "activeWorkspaceId": active_id
            }))
            .await;

        Ok(())
    }

    pub async fn duplicate_workspace(&self, id: &str) -> Result<Workspace> {
        let safe_id = Self::validate_id(id, "workspaceId")?;
        let _guard = self.workspace_lock.lock().await;

        let source = self
            .get_workspace(safe_id)
            .await?
            .ok_or_else(|| anyhow!("Workspace '{}' not found", safe_id))?;

        let now = chrono::Utc::now().to_rfc3339();
        let mut copy = source.clone();
        copy.id = uuid::Uuid::new_v4().to_string();
        copy.name = format!("{} Copy", source.name);
        copy.created_at = Some(now.clone());
        copy.updated_at = Some(now);

        self.save_workspace_internal(&mut copy, false).await?;
        Ok(copy)
    }

    pub async fn export_workspace(
        &self,
        id: &str,
        dest_path: Option<&str>,
    ) -> Result<serde_json::Value> {
        let safe_id = Self::validate_id(id, "workspaceId")?;
        let ws = self
            .get_workspace(safe_id)
            .await?
            .ok_or_else(|| anyhow!("Workspace '{}' not found", safe_id))?;

        let json_string = serde_json::to_string_pretty(&ws)?;

        if let Some(dest) = dest_path {
            let trimmed = dest.trim();
            if !trimmed.is_empty() {
                let safety = check_path_string(trimmed);
                if !safety.ok {
                    bail!(
                        "Invalid export destination path: {}",
                        safety.message.unwrap_or_default()
                    );
                }
                let target = PathBuf::from(trimmed);
                let allowed_root = target
                    .parent()
                    .ok_or_else(|| anyhow!("Invalid export destination parent"))?;
                self.replace_file_atomically_in_root(
                    &target,
                    json_string.as_bytes(),
                    allowed_root,
                )
                .await?;

                return Ok(serde_json::json!({
                    "ok": true,
                    "path": trimmed,
                    "workspace": ws,
                    "json": json_string
                }));
            }
        }

        Ok(serde_json::json!({
            "ok": true,
            "workspace": ws,
            "json": json_string
        }))
    }

    pub async fn import_workspace(&self, source: Option<&str>) -> Result<Workspace> {
        let raw_source = source
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| anyhow!("No workspace file path or JSON content provided"))?;

        let raw_json = if raw_source.starts_with('{') {
            raw_source.to_string()
        } else {
            let safety = check_path_string(raw_source);
            if !safety.ok {
                bail!(
                    "Invalid import source path: {}",
                    safety.message.unwrap_or_default()
                );
            }
            tokio::fs::read_to_string(raw_source)
                .await
                .with_context(|| format!("Failed to read workspace import file '{raw_source}'"))?
        };

        let val: serde_json::Value =
            serde_json::from_str(&raw_json).context("Invalid JSON in workspace import")?;
        let payload = Self::unwrap_envelope(val);
        let mut ws: Workspace =
            serde_json::from_value(payload).context("Invalid workspace schema")?;

        if ws.id.trim().is_empty() || Self::validate_id(&ws.id, "workspaceId").is_err() {
            ws.id = uuid::Uuid::new_v4().to_string();
        }
        let now = chrono::Utc::now().to_rfc3339();
        if ws.created_at.is_none() {
            ws.created_at = Some(now.clone());
        }
        ws.updated_at = Some(now);
        ws.normalize();

        let _guard = self.workspace_lock.lock().await;
        self.save_workspace_internal(&mut ws, false).await?;
        Ok(ws)
    }

    pub async fn get_active_workspace_id(&self) -> Result<Option<String>> {
        let state = self.get_app_state().await?;
        if let Some(id) = state.active_workspace_id.filter(|s| !s.trim().is_empty()) {
            return Ok(Some(id));
        }
        if let Some(id) = state.recent_workspace_ids.into_iter().next() {
            if !id.trim().is_empty() {
                return Ok(Some(id));
            }
        }
        let manifest = self.get_manifest().await?;
        if let Some(id) = manifest.active_workspace_id.filter(|s| !s.trim().is_empty()) {
            return Ok(Some(id));
        }
        Ok(manifest.workspaces.into_iter().next().map(|w| w.id))
    }

    pub async fn set_active_workspace_id(&self, id: Option<&str>) -> Result<()> {
        if let Some(ws_id) = id {
            let safe_id = Self::validate_id(ws_id, "workspaceId")?;
            let state = self.get_app_state().await.unwrap_or_default();
            let mut recents = state.recent_workspace_ids;
            recents.retain(|wid| wid != safe_id);
            recents.insert(0, safe_id.to_string());

            self.save_app_state(serde_json::json!({
                "activeWorkspaceId": safe_id,
                "recentWorkspaceIds": recents
            }))
            .await?;

            let _m_guard = self.manifest_lock.lock().await;
            let p = self.data_dir.join("manifest.json");
            if let Some(val) = self.read_json_value_with_fallback(&p).await? {
                if let Ok(mut manifest) = serde_json::from_value::<ManifestDocument>(val) {
                    manifest.active_workspace_id = Some(safe_id.to_string());
                    let bytes = serde_json::to_vec_pretty(&manifest)?;
                    self.replace_file_atomically(&p, &bytes).await?;
                }
            }
        } else {
            self.save_app_state(serde_json::json!({
                "activeWorkspaceId": serde_json::Value::Null
            }))
            .await?;
        }
        Ok(())
    }

    pub async fn switch_workspace(&self, id: &str) -> Result<Option<Workspace>> {
        let safe_id = Self::validate_id(id, "workspaceId")?;
        self.set_active_workspace_id(Some(safe_id)).await?;

        {
            let _m_guard = self.manifest_lock.lock().await;
            let p = self.data_dir.join("manifest.json");
            if let Some(val) = self.read_json_value_with_fallback(&p).await? {
                if let Ok(mut manifest) = serde_json::from_value::<ManifestDocument>(val) {
                    let now = chrono::Utc::now().to_rfc3339();
                    manifest.active_workspace_id = Some(safe_id.to_string());
                    for entry in &mut manifest.workspaces {
                        if entry.id == safe_id {
                            entry.last_opened_at = Some(now.clone());
                        }
                    }
                    let bytes = serde_json::to_vec_pretty(&manifest)?;
                    self.replace_file_atomically(&p, &bytes).await?;
                }
            }
        }

        self.get_workspace(safe_id).await
    }

    // ==========================================
    // Notes (100% Verbatim / Zero-Truncation Protocol)
    // ==========================================

    fn extract_note_markdown(node: &CanvasNode) -> String {
        let Some(content) = node.content.as_ref() else {
            return String::new();
        };
        if let Some(s) = content.as_str() {
            return s.to_string();
        }
        if let Some(obj) = content.as_object() {
            for key in ["body", "text", "content", "title"] {
                if let Some(s) = obj.get(key).and_then(|v| v.as_str()) {
                    return s.to_string();
                }
            }
        }
        String::new()
    }

    fn is_note_node(node: &CanvasNode) -> bool {
        node.kind.as_deref() == Some("note") || node.node_type.as_deref() == Some("note")
    }

    fn note_id_for_node(node: &CanvasNode) -> Option<String> {
        let candidate = node
            .content
            .as_ref()
            .and_then(|c| c.get("noteId"))
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(&node.id);
        Self::validate_id(candidate, "noteId").ok().map(str::to_string)
    }

    /// Mirrors note nodes inside `<data_dir>/workspaces/<id>/notes/<noteId>.md` and cleans up removed notes.
    pub async fn sync_workspace_notes(&self, ws_id: &str, ws: &Workspace) -> Result<()> {
        let safe_ws_id = Self::validate_id(ws_id, "workspaceId")?;
        let notes_dir = self
            .data_dir
            .join("workspaces")
            .join(safe_ws_id)
            .join("notes");
        if !notes_dir.exists() {
            tokio::fs::create_dir_all(&notes_dir).await?;
        }

        let mut all_nodes: Vec<CanvasNode> = ws.nodes.clone();
        for floor in &ws.floors {
            if let Some(nodes_val) = floor.get("nodes").and_then(|v| v.as_array()) {
                for n_val in nodes_val {
                    if let Ok(node) = serde_json::from_value::<CanvasNode>(n_val.clone()) {
                        all_nodes.push(node);
                    }
                }
            }
        }

        let mut active_files: HashSet<String> = HashSet::new();
        for node in &all_nodes {
            if !Self::is_note_node(node) {
                continue;
            }
            let Some(note_id) = Self::note_id_for_node(node) else {
                continue;
            };
            let file_name = format!("{note_id}.md");
            active_files.insert(file_name.clone());

            let markdown = Self::extract_note_markdown(node);
            let note_path = notes_dir.join(&file_name);

            let needs_write = if note_path.exists() {
                match tokio::fs::read_to_string(&note_path).await {
                    Ok(existing) => existing != markdown,
                    Err(_) => true,
                }
            } else {
                true
            };

            if needs_write {
                self.replace_file_atomically_in_root(&note_path, markdown.as_bytes(), &notes_dir)
                    .await?;
            }
        }

        // Clean up removed notes from disk
        if let Ok(mut entries) = tokio::fs::read_dir(&notes_dir).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.ends_with(".md") && !active_files.contains(&name) {
                    let _ = tokio::fs::remove_file(entry.path()).await;
                }
            }
        }

        Ok(())
    }

    pub async fn read_note(&self, workspace_id: &str, note_id: &str) -> Result<String> {
        let safe_ws_id = Self::validate_id(workspace_id, "workspaceId")?;
        let safe_note_id = Self::validate_id(note_id, "noteId")?;

        let notes_dir = self
            .data_dir
            .join("workspaces")
            .join(safe_ws_id)
            .join("notes");
        let primary_path = notes_dir.join(format!("{safe_note_id}.md"));
        Self::assert_target_safe(&primary_path, &notes_dir)?;

        if primary_path.exists() {
            return Ok(tokio::fs::read_to_string(&primary_path).await?);
        }

        // Legacy fallback path (<data_dir>/notes/<ws_id>/<note_id>.md)
        let legacy_dir = self.data_dir.join("notes").join(safe_ws_id);
        let legacy_path = legacy_dir.join(format!("{safe_note_id}.md"));
        Self::assert_target_safe(&legacy_path, &legacy_dir)?;
        if legacy_path.exists() {
            return Ok(tokio::fs::read_to_string(&legacy_path).await?);
        }

        // Fallback to note body stored inside workspace.json if present
        if let Ok(Some(ws)) = self.get_workspace(safe_ws_id).await {
            for node in &ws.nodes {
                if Self::is_note_node(node)
                    && (node.id == safe_note_id
                        || Self::note_id_for_node(node).as_deref() == Some(safe_note_id))
                {
                    return Ok(Self::extract_note_markdown(node));
                }
            }
            for floor in &ws.floors {
                if let Some(nodes_val) = floor.get("nodes").and_then(|v| v.as_array()) {
                    for n_val in nodes_val {
                        if let Ok(node) = serde_json::from_value::<CanvasNode>(n_val.clone()) {
                            if Self::is_note_node(&node)
                                && (node.id == safe_note_id
                                    || Self::note_id_for_node(&node).as_deref()
                                        == Some(safe_note_id))
                            {
                                return Ok(Self::extract_note_markdown(&node));
                            }
                        }
                    }
                }
            }
        }

        Ok(String::new())
    }

    pub async fn write_note(
        &self,
        workspace_id: &str,
        note_id: &str,
        content: &str,
    ) -> Result<()> {
        let safe_ws_id = Self::validate_id(workspace_id, "workspaceId")?;
        let safe_note_id = Self::validate_id(note_id, "noteId")?;

        let notes_dir = self
            .data_dir
            .join("workspaces")
            .join(safe_ws_id)
            .join("notes");
        let note_path = notes_dir.join(format!("{safe_note_id}.md"));
        self.replace_file_atomically_in_root(&note_path, content.as_bytes(), &notes_dir)
            .await?;

        // Also update the note body inside workspace.json if a matching node exists
        let _guard = self.workspace_lock.lock().await;
        if let Ok(Some(mut ws)) = self.get_workspace(safe_ws_id).await {
            let mut modified = false;

            let update_node_json = |node_obj: &mut serde_json::Map<String, serde_json::Value>| -> bool {
                let id_matches = node_obj.get("id").and_then(|v| v.as_str()) == Some(safe_note_id);
                let note_id_matches = node_obj
                    .get("content")
                    .and_then(|c| c.get("noteId"))
                    .and_then(|v| v.as_str())
                    == Some(safe_note_id);
                if !(id_matches || note_id_matches) {
                    return false;
                }
                match node_obj.get_mut("content") {
                    Some(serde_json::Value::Object(c_obj)) => {
                        c_obj.insert(
                            "body".to_string(),
                            serde_json::Value::String(content.to_string()),
                        );
                        if c_obj.contains_key("text") {
                            c_obj.insert(
                                "text".to_string(),
                                serde_json::Value::String(content.to_string()),
                            );
                        }
                    }
                    _ => {
                        node_obj.insert(
                            "content".to_string(),
                            serde_json::json!({
                                "noteId": safe_note_id,
                                "body": content
                            }),
                        );
                    }
                }
                true
            };

            for node in &mut ws.nodes {
                let id_matches = node.id == safe_note_id;
                let note_id_matches = node
                    .content
                    .as_ref()
                    .and_then(|c| c.get("noteId"))
                    .and_then(|v| v.as_str())
                    == Some(safe_note_id);
                if id_matches || note_id_matches {
                    match node.content.as_mut() {
                        Some(serde_json::Value::Object(c_obj)) => {
                            c_obj.insert(
                                "body".to_string(),
                                serde_json::Value::String(content.to_string()),
                            );
                            if c_obj.contains_key("text") {
                                c_obj.insert(
                                    "text".to_string(),
                                    serde_json::Value::String(content.to_string()),
                                );
                            }
                        }
                        _ => {
                            node.content = Some(serde_json::json!({
                                "noteId": safe_note_id,
                                "body": content
                            }));
                        }
                    }
                    modified = true;
                }
            }

            for floor in &mut ws.floors {
                if let Some(nodes) = floor.get_mut("nodes").and_then(|v| v.as_array_mut()) {
                    for n in nodes {
                        if let Some(obj) = n.as_object_mut() {
                            if update_node_json(obj) {
                                modified = true;
                            }
                        }
                    }
                }
            }

            if modified {
                ws.updated_at = Some(chrono::Utc::now().to_rfc3339());
                let ws_file = self.workspace_json_path(safe_ws_id);
                let envelope = StorageEnvelope::new("workspace", &ws);
                let json = serde_json::to_vec_pretty(&envelope)?;
                self.replace_file_atomically(&ws_file, &json).await?;
            }
        }

        Ok(())
    }

    // ==========================================
    // Profile & Gamification
    // ==========================================

    async fn save_profile_internal(&self, profile: &UserProfile) -> Result<()> {
        let p = self.data_dir.join("profile.json");
        let envelope = StorageEnvelope::new("profile", profile);
        let json = serde_json::to_vec_pretty(&envelope)?;
        self.replace_file_atomically(&p, &json).await
    }

    async fn get_profile_internal(&self) -> Result<UserProfile> {
        let p = self.data_dir.join("profile.json");
        let mut profile = if let Some(val) = self.read_json_value_with_fallback(&p).await? {
            let payload = Self::unwrap_envelope(val);
            match serde_json::from_value::<UserProfile>(payload) {
                Ok(mut prof) => {
                    prof.migrate_legacy();
                    prof
                }
                Err(_) => UserProfile::default(),
            }
        } else {
            let def = UserProfile::default();
            self.save_profile_internal(&def).await?;
            return Ok(def);
        };

        // Check daily streak identically to Electron's DataService::getProfileInternal()
        let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
        if profile.last_active_date != today {
            if let (Ok(last_date), Ok(curr_date)) = (
                chrono::NaiveDate::parse_from_str(&profile.last_active_date, "%Y-%m-%d"),
                chrono::NaiveDate::parse_from_str(&today, "%Y-%m-%d"),
            ) {
                let diff_days = (curr_date - last_date).num_days();
                if diff_days == 1 {
                    profile.streak_days = profile.streak_days.saturating_add(1);
                } else if diff_days > 1 {
                    profile.streak_days = 1;
                }
            } else {
                profile.streak_days = 1;
            }
            profile.last_active_date = today;

            // Update "Em Chamas" badge progress
            if let Some(em_chamas) = profile
                .badges
                .iter_mut()
                .find(|b| b.id == "badge-em-chamas")
            {
                let progress = profile.streak_days as u64;
                em_chamas.progress = Some(progress);
                if em_chamas.unlocked_at.is_none()
                    && progress >= em_chamas.max_progress.unwrap_or(3)
                {
                    em_chamas.unlocked_at = Some(chrono::Utc::now().to_rfc3339());
                }
            }

            self.save_profile_internal(&profile).await?;
        }

        Ok(profile)
    }

    pub async fn get_profile(&self) -> Result<UserProfile> {
        let _guard = self.profile_lock.lock().await;
        self.get_profile_internal().await
    }

    pub async fn update_profile(&self, patch: serde_json::Value) -> Result<UserProfile> {
        let _guard = self.profile_lock.lock().await;
        let current = self.get_profile_internal().await?;
        let mut val = serde_json::to_value(&current)?;

        if let (Some(obj), Some(patch_obj)) = (val.as_object_mut(), patch.as_object()) {
            for (k, v) in patch_obj {
                if k == "stats" {
                    if let (Some(curr_stats), Some(patch_stats)) = (
                        obj.get_mut("stats").and_then(|s| s.as_object_mut()),
                        v.as_object(),
                    ) {
                        for (sk, sv) in patch_stats {
                            curr_stats.insert(sk.clone(), sv.clone());
                        }
                        continue;
                    }
                }
                obj.insert(k.clone(), v.clone());
            }
        }

        let mut updated: UserProfile = serde_json::from_value(val)?;
        updated.migrate_legacy();

        // Recalculate level & XP in case totalXp was patched
        if patch.get("totalXp").is_some() {
            let (lvl, curr, next, title) = calculate_level_and_xp(updated.total_xp);
            updated.level = lvl;
            updated.current_xp = curr;
            updated.xp_to_next_level = next;
            if patch.get("title").is_none() {
                updated.title = title;
            }
        }

        self.save_profile_internal(&updated).await?;
        Ok(updated)
    }

    pub async fn award_xp(&self, xp: u64, stat_key: Option<&str>) -> Result<AwardXpResult> {
        let _guard = self.profile_lock.lock().await;
        let mut profile = self.get_profile_internal().await?;
        let previous_level = profile.level;

        profile.total_xp = profile.total_xp.saturating_add(xp);
        let (lvl, curr_xp, next_xp, title) = calculate_level_and_xp(profile.total_xp);
        let leveled_up = lvl > previous_level;
        profile.level = lvl;
        profile.current_xp = curr_xp;
        profile.xp_to_next_level = next_xp;
        profile.title = title;

        if let Some(key) = stat_key.map(str::trim).filter(|s| !s.is_empty()) {
            profile.stats.increment_stat(key);
        }

        if profile.badges.is_empty() {
            profile.badges = initial_badges();
        }

        let mut unlocked_badges: Vec<UserBadge> = Vec::new();
        let now_iso = chrono::Utc::now().to_rfc3339();

        let recruits = profile
            .stats
            .recruits_count
            .max(profile.stats.agents_recruited)
            .max(profile.stats.terminals_spawned);
        let delegated = profile
            .stats
            .tasks_delegated
            .max(profile.stats.asks_sent);
        let graphs = profile.stats.knowledge_graphs_built;
        let portals = profile.stats.portals_opened;
        let routines = profile.stats.routines_executed;
        let streak = profile.streak_days as u64;

        for badge in &mut profile.badges {
            if badge.unlocked_at.is_some() {
                continue;
            }

            let mut should_unlock = false;
            match badge.id.as_str() {
                "badge-primeira-sinfonia" => {
                    if recruits >= 1 || delegated >= 1 {
                        badge.progress = Some(1);
                        should_unlock = true;
                    }
                }
                "badge-delegacao-cirurgica" => {
                    badge.progress = Some(delegated);
                    if delegated >= badge.max_progress.unwrap_or(10) {
                        should_unlock = true;
                    }
                }
                "badge-mapeador-neural" => {
                    badge.progress = Some(graphs);
                    if graphs >= badge.max_progress.unwrap_or(1) {
                        should_unlock = true;
                    }
                }
                "badge-ponte-conhecimento" => {
                    badge.progress = Some(portals);
                    if portals >= badge.max_progress.unwrap_or(5) {
                        should_unlock = true;
                    }
                }
                "badge-sentinela-autonomo" => {
                    badge.progress = Some(routines);
                    if routines >= badge.max_progress.unwrap_or(1) {
                        should_unlock = true;
                    }
                }
                "badge-em-chamas" => {
                    badge.progress = Some(streak);
                    if streak >= badge.max_progress.unwrap_or(3) {
                        should_unlock = true;
                    }
                }
                _ => {}
            }

            if should_unlock && badge.unlocked_at.is_none() {
                badge.unlocked_at = Some(now_iso.clone());
                unlocked_badges.push(badge.clone());
            }
        }

        self.save_profile_internal(&profile).await?;

        Ok(AwardXpResult {
            profile,
            leveled_up,
            unlocked_badges,
        })
    }

    // ==========================================
    // Routines & Automation
    // ==========================================

    async fn read_routines_internal(&self) -> Result<Vec<RoutineConfig>> {
        let p = self.data_dir.join("routines.json");
        let Some(val) = self.read_json_value_with_fallback(&p).await? else {
            return Ok(Vec::new());
        };
        let payload = Self::unwrap_envelope(val);
        if payload.is_array() {
            return Ok(serde_json::from_value(payload).unwrap_or_default());
        }
        if let Some(arr) = payload.get("routines") {
            return Ok(serde_json::from_value(arr.clone()).unwrap_or_default());
        }
        Ok(Vec::new())
    }

    async fn save_routines_internal(&self, routines: &[RoutineConfig]) -> Result<()> {
        let p = self.data_dir.join("routines.json");
        let envelope = StorageEnvelope::new("routines", routines);
        let json = serde_json::to_vec_pretty(&envelope)?;
        self.replace_file_atomically(&p, &json).await
    }

    pub async fn list_routines(&self) -> Result<Vec<RoutineConfig>> {
        let _guard = self.routines_lock.lock().await;
        self.read_routines_internal().await
    }

    pub async fn create_routine(&self, data: serde_json::Value) -> Result<RoutineConfig> {
        let _guard = self.routines_lock.lock().await;
        let mut routines = self.read_routines_internal().await?;

        let mut routine: RoutineConfig = serde_json::from_value(data)?;
        if routine.id.trim().is_empty() {
            routine.id = uuid::Uuid::new_v4().to_string();
        }
        if routine.created_at.is_none() {
            routine.created_at = Some(chrono::Utc::now().to_rfc3339());
        }

        if let Some(existing) = routines.iter_mut().find(|r| r.id == routine.id) {
            *existing = routine.clone();
        } else {
            routines.push(routine.clone());
        }

        self.save_routines_internal(&routines).await?;
        Ok(routine)
    }

    pub async fn update_routine(
        &self,
        id: &str,
        patch: serde_json::Value,
    ) -> Result<RoutineConfig> {
        let _guard = self.routines_lock.lock().await;
        let mut routines = self.read_routines_internal().await?;

        let idx = routines
            .iter()
            .position(|r| r.id == id)
            .ok_or_else(|| anyhow!("Routine '{}' not found", id))?;

        let mut val = serde_json::to_value(&routines[idx])?;
        Self::merge_json_top_level(&mut val, &patch);
        if let Some(obj) = val.as_object_mut() {
            obj.insert("id".to_string(), serde_json::Value::String(id.to_string()));
        }
        let updated: RoutineConfig = serde_json::from_value(val)?;
        routines[idx] = updated.clone();

        self.save_routines_internal(&routines).await?;
        Ok(updated)
    }

    pub async fn delete_routine(&self, id: &str) -> Result<()> {
        let _guard = self.routines_lock.lock().await;
        let mut routines = self.read_routines_internal().await?;
        routines.retain(|r| r.id != id);
        self.save_routines_internal(&routines).await
    }

    async fn read_routine_history_internal(&self) -> Result<Vec<RoutineRunRecord>> {
        let p = self.data_dir.join("routine_history.json");
        let Some(val) = self.read_json_value_with_fallback(&p).await? else {
            return Ok(Vec::new());
        };
        let payload = Self::unwrap_envelope(val);
        if payload.is_array() {
            return Ok(serde_json::from_value(payload).unwrap_or_default());
        }
        if let Some(arr) = payload.get("records") {
            return Ok(serde_json::from_value(arr.clone()).unwrap_or_default());
        }
        Ok(Vec::new())
    }

    pub async fn get_routine_history(
        &self,
        routine_id: Option<&str>,
    ) -> Result<Vec<RoutineRunRecord>> {
        let _guard = self.routines_lock.lock().await;
        let records = self.read_routine_history_internal().await?;
        if let Some(rid) = routine_id {
            Ok(records
                .into_iter()
                .filter(|r| r.routine_id == rid)
                .collect())
        } else {
            Ok(records)
        }
    }

    pub async fn append_routine_run(&self, mut record: RoutineRunRecord) -> Result<()> {
        let _guard = self.routines_lock.lock().await;
        if record.id.trim().is_empty() {
            record.id = uuid::Uuid::new_v4().to_string();
        }
        if record.fired_at.trim().is_empty() {
            record.fired_at = chrono::Utc::now().to_rfc3339();
        }

        let mut history = self.read_routine_history_internal().await?;
        history.insert(0, record);
        history.truncate(500);

        let p = self.data_dir.join("routine_history.json");
        let envelope = StorageEnvelope::new("routineHistory", &history);
        let json = serde_json::to_vec_pretty(&envelope)?;
        self.replace_file_atomically(&p, &json).await
    }

    // ==========================================
    // License
    // ==========================================

    pub async fn get_license(&self) -> Result<LicenseInfo> {
        let p = self.data_dir.join("license.json");
        if let Some(val) = self.read_json_value_with_fallback(&p).await? {
            let payload = Self::unwrap_envelope(val);
            if let Ok(license) = serde_json::from_value::<LicenseInfo>(payload) {
                return Ok(license);
            }
        }
        Ok(LicenseInfo::default())
    }

    pub async fn activate_license(&self, key: &str) -> Result<LicenseInfo> {
        let trimmed = key.trim();
        if trimmed.is_empty() {
            bail!("License key cannot be empty");
        }
        let license = LicenseInfo {
            license_type: "license".to_string(),
            is_trial: false,
            is_valid: true,
            days_remaining: None,
            key: Some(trimmed.to_string()),
            activated_at: Some(chrono::Utc::now().to_rfc3339()),
            state: Some("active".to_string()),
            license_key: Some(trimmed.to_string()),
            plan_type: Some("pro".to_string()),
            expires_at: None,
            extra: serde_json::Map::new(),
        };
        let p = self.data_dir.join("license.json");
        let envelope = StorageEnvelope::new("license", &license);
        let json = serde_json::to_vec_pretty(&envelope)?;
        self.replace_file_atomically(&p, &json).await?;
        Ok(license)
    }

    pub async fn deactivate_license(&self) -> Result<LicenseInfo> {
        let license = LicenseInfo::default();
        let p = self.data_dir.join("license.json");
        let envelope = StorageEnvelope::new("license", &license);
        let json = serde_json::to_vec_pretty(&envelope)?;
        self.replace_file_atomically(&p, &json).await?;
        Ok(license)
    }
}
