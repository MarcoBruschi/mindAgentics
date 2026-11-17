# mindAgentics — Matriz IPC Tauri & Contrato Tipado (Fase 0/1)

> **Documento de Arquitetura e Especificação de Interface (Fase de Migração para Tauri 2.x)**  
> **Status:** Ativo & Homologado  
> **Última Atualização:** 2026-11-13  
> **Escopo:** Mapeamento integral dos **89 handlers ativos** do `src-tauri/src/commands/mod.rs`, separação categórica dos ~380 canais legados/mortos do `packages/shared/src/ipc/channels.ts`, e definição dos schemas tipados para interoperabilidade Rust ↔ TypeScript.

---

## 1. Visão Geral da Arquitetura IPC no Tauri 2.x

A comunicação entre o Renderer e o backend nativo baseia-se em canais IPC com strings no formato `mindagentics:<categoria>:<ação>` e comandos tipados do Tauri v2 com verificação de payload (`assertPayloadWithinLimit`).

Na arquitetura Tauri 2.x:
1. **Comandos RPC Bidirecionais (`tauri::command`):** Invocados via `@tauri-apps/api/core::invoke('nome_do_comando', { ...args })`. Cada comando possui tipagem estrita de argumentos via structs Serde (`Deserialize`) e retorno serializado (`Serialize`).
2. **Streaming e Canais de Alta Frequência (`tauri::ipc::Channel` / `tauri::Emitter`):** O stream do terminal PTY (dados binários e ANSI), eventos de saída de processos e batimentos cardíacos do supervisor utilizam canais binários dedicados ou eventos fortemente tipados.
3. **Segurança e Confinamento de Caminhos:** Toda verificação de path safety (`assertSafePathString`, confinamento de workspace, bloqueio de `..` e links simbólicos fora do workspace) é executada em Rust nativo em tempo constante, sem custos de contexto V8.
4. **Isolamento de Processos no Windows:** No Windows, subprocessos criados pelo terminal são associados a um Windows Job Object (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`), impedindo processos órfãos (`agy`, `claude`, `codex`, `node`) caso a aplicação seja encerrada de forma abrupta.

---

## 2. Inventário: Ativos (89) vs. Legados/Mortos (~380)

| Categoria | Handlers Ativos | Canais Mortos / Deprecados | Destino na Migração Tauri |
|---|:---:|:---:|---|
| **App, Sistema & SO** | 15 | 8 | Mantidos como comandos Rust `app_*` |
| **Window Controls & DWM** | 4 | 2 | Substituídos por `tauri::window::Window` e APIs nativas Win32/DWM |
| **AppState & Preferências** | 5 | 6 | Mapeados no `StorageEngine` Rust |
| **Workspace Management** | 10 | 12 | Mapeados no `StorageEngine` Rust |
| **Floor & Worktrees Git** | 8 | 18 | Mapeados no `GitEngine` Rust |
| **Terminal / Agent Engine** | 18 | 24 | Mapeados no `PtyManager` + `portable-pty` |
| **Notas & Canvas Nodes** | 3 | 14 | Mapeados no `StorageEngine` |
| **Routines (Automação/Cron)** | 6 | 0 | Mapeados no módulo `routines` Rust |
| **Licenciamento & Spatial** | 5 | 0 | Mapeados no módulo `licensing` e `spatial` |
| **Data, Backup & Storage** | 4 | 0 | Mapeados no `StorageEngine` Rust |
| **Perfil & Gamificação** | 3 | 0 | Mapeados no `StorageEngine` Rust |
| **Knowledge Graph (Graphify)** | 4 | 0 | Mapeados no `GraphifyRunner` Rust |
| **Canais Mortos / Legados Não-Implementados** | 0 | 302 | **Expurgados / Descartados** (Partitura, Device, FileTree, etc.) |
| **TOTAL** | **85 comandos + 4 streams = 89** | **~386** | **89 Ativos Migrados para Tauri** |

---

## 3. Matriz Completa de Handlers Ativos (89)

### 3.1 App, Sistema & SO

| Canal IPC | Comando Tauri (`Rust / TS`) | Payload de Entrada (`Rust Struct`) | Retorno (`Rust Result<T>`) | Segurança / Confinamento |
|---|---|---|---|---|
| `mindagentics:app:info` | `app_get_info` | `()` | `AppInfoResponse` | Apenas metadados estáticos do build. |
| `mindagentics:app:diagnosticReport` | `app_get_diagnostic_report` | `()` | `DiagnosticReport` | Sanitizado; omite chaves ou segredos. |
| `mindagentics:app:saveDiagnosticReport` | `app_save_diagnostic_report` | `()` | `FileSaveResult` | Salva apenas dentro de `data_dir`. |
| `mindagentics:app:pickDirectory` | `app_pick_directory` | `()` | `Option<String>` | Diálogo nativo via `rfd` / Tauri dialog. |
| `mindagentics:app:pickReference` | `app_pick_reference` | `PickReferenceOptions { target?: String, title?: String }` | `Option<ReferenceItem>` | Valida `assert_safe_path`, `is_directory` e `label`. |
| `mindagentics:app:localDirectorySuggestions` | `app_get_directory_suggestions` | `SuggestionsQuery { partial: String, limit?: usize }` | `Vec<String>` | Valida se caminho é diretório válido; máx 50. |
| `mindagentics:app:directoryState` | `app_get_directory_state` | `DirectoryQuery { workspace_id: String, path: String }` | `DirectoryState` | Verifica existência sem travessia. |
| `mindagentics:app:createDirectory` | `app_create_directory` | `CreateDirPayload { workspace_id: String, path: String }` | `CreateDirResult` | Confinado; bloqueia travessia `..`. |
| `mindagentics:app:quit` | `app_quit` | `()` | `()` | Encerra com flush gracioso de buffers e PTYs. |
| `mindagentics:app:hideToTray` | `app_hide_to_tray` | `()` | `()` | Oculta janela e minimiza para bandeja do sistema. |
| `mindagentics:app:listIdes` | `app_list_ides` | `()` | `Vec<IdeDescriptor>` | Detecta VS Code, Cursor, Windsurf, IntelliJ etc. |
| `mindagentics:app:openInIde` | `app_open_in_ide` | `OpenInIdePayload { workspace_id: String, ide_id: String }` | `GenericResult` | Executa binário sem shell (`Command::new`). |
| `mindagentics:app:openExternal` | `app_open_external` | `UrlPayload { url: String }` | `GenericResult` | Valida esquemas `http:`, `https:` e `mailto:`. |
| `mindagentics:app:openPath` | `app_open_path` | `PathPayload { path: String }` | `GenericResult` | Confinado a caminhos válidos existentes. |
| `mindagentics:app:showEmojiPanel` | `app_show_emoji_panel` | `()` | `()` | No Windows: invoca `WinKey + .` via input simulado. |

### 3.2 Window Controls & DWM

| Canal IPC | Comando Tauri (`Rust / TS`) | Payload de Entrada | Retorno | Segurança / Confinamento |
|---|---|---|---|---|
| `mindagentics:windowControls:state` | `window_get_state` | `()` | `WindowState` | Retorna dimensões, maximizado e escala DPI. |
| `mindagentics:windowControls:minimize` | `window_minimize` | `()` | `()` | Minimiza a janela nativa. |
| `mindagentics:windowControls:toggleMaximize` | `window_toggle_maximize` | `()` | `WindowState` | Executa Fake-Maximize com WorkArea e cantos 4-DWM. |
| `mindagentics:windowControls:close` | `window_close` | `()` | `()` | Fecha janela ou esconde para tray conforme config. |

### 3.3 App State & Preferências

| Canal IPC | Comando Tauri (`Rust / TS`) | Payload de Entrada | Retorno | Segurança / Confinamento |
|---|---|---|---|---|
| `mindagentics:appState:get` | `app_state_get` | `()` | `AppStateDocument` | Lê atomicamente `app-state.json`. |
| `mindagentics:appState:setOnboardingCompleted` | `app_state_set_onboarding_completed` | `BoolPayload { value: bool }` | `AppStateDocument` | Grava atomicamente `completedOnboarding`. |
| `mindagentics:appState:setHasSeenFloorOnboarding` | `app_state_set_seen_floor_onboarding` | `BoolPayload { value: bool }` | `AppStateDocument` | Grava atomicamente `hasSeenFloorOnboarding`. |
| `mindagentics:preferences:get` | `preferences_get` | `()` | `PreferencesDocument` | Lê atomicamente `preferences.json`. |
| `mindagentics:preferences:set` | `preferences_set` | `PreferencesPatch` | `PreferencesDocument` | Atualiza chaves com merge idempotente. |

### 3.4 Gerenciamento de Workspaces

| Canal IPC | Comando Tauri (`Rust / TS`) | Payload de Entrada | Retorno | Segurança / Confinamento |
|---|---|---|---|---|
| `mindagentics:workspace:list` | `workspace_list` | `()` | `Vec<Workspace>` | Lê `manifest.json` com mutex assíncrono. |
| `mindagentics:workspace:create` | `workspace_create` | `CreateWorkspaceInput` | `Workspace` | Cria pasta, `workspace.json` e atualiza manifesto. |
| `mindagentics:workspace:patch` | `workspace_patch` | `PatchWorkspaceInput { id: String, patch: Value }` | `Workspace` | Atualiza propriedades com validação. |
| `mindagentics:workspace:delete` | `workspace_delete` | `DeleteWorkspaceInput { id: String, delete_dir: bool }` | `GenericResult` | Remove do manifesto e expurga worktrees/notas. |
| `mindagentics:workspace:duplicate` | `workspace_duplicate` | `IdPayload { id: String }` | `Workspace` | Clona estrutura de nós e metadados. |
| `mindagentics:workspace:export` | `workspace_export` | `IdPayload { id: String }` | `String` (JSON/ZIP) | Exporta workspace serializado. |
| `mindagentics:workspace:import` | `workspace_import` | `ContentPayload { content: String }` | `Workspace` | Valida schema do workspace importado. |
| `mindagentics:workspace:reveal` | `workspace_reveal` | `PathPayload { path: String }` | `GenericResult` | Abre gerenciador de arquivos nativo (`explorer`). |
| `mindagentics:workspace:getActiveId` | `workspace_get_active_id` | `()` | `Option<String>` | Retorna ID ativo persistido no manifesto. |
| `mindagentics:workspace:switch` | `workspace_switch` | `IdPayload { id: String }` | `GenericResult` | Alterna workspace e inicializa estado. |

### 3.5 Floors & Worktrees Git

| Canal IPC | Comando Tauri (`Rust / TS`) | Payload de Entrada | Retorno | Segurança / Confinamento |
|---|---|---|---|---|
| `mindagentics:floor:isolationAvailable` | `floor_isolation_available` | `DirPayload { dir: String }` | `bool` | Executa `git rev-parse --is-inside-work-tree`. |
| `mindagentics:floor:canCopy` | `floor_can_copy` | `()` | `CanCopyResult` | Retorna `{ can_copy: true }`. |
| `mindagentics:floor:createKind` | `floor_create_kind` | `DirPayload { dir: String }` | `FloorKind` | Detecta se diretório é Git limpo ou precisa init. |
| `mindagentics:floor:createIsolated` | `floor_create_isolated` | `CreateFloorOptions` | `FloorDescriptor` | Executa `git worktree add` em pasta isolada. |
| `mindagentics:floor:listBranches` | `floor_list_branches` | `DirPayload { dir: String }` | `Vec<BranchInfo>` | Executa `git branch --list`. |
| `mindagentics:floor:landingPreflight` | `floor_landing_preflight` | `PreflightOptions` | `PreflightVerdict` | Verifica dirty files e conflitos antes de merge. |
| `mindagentics:floor:land` | `floor_land` | `LandOptions` | `LandResult` | Merge gracioso do worktree na branch base. |
| `mindagentics:floor:delete` | `floor_delete` | `DeleteFloorOptions` | `GenericResult` | `git worktree remove` e limpeza de branch. |

### 3.6 Terminal, Agentes & PTY

| Canal IPC | Comando Tauri (`Rust / TS`) | Payload de Entrada | Retorno / Stream | Segurança / Confinamento |
|---|---|---|---|---|
| `mindagentics:terminal:detectAgents` | `terminal_detect_agents` | `()` | `Vec<AgentCandidate>` | Retorna nomes limpos (`Antigravity`, `Codex`, etc.). |
| `mindagentics:terminal:getAgentLimits` | `terminal_get_agent_limits` | `()` | `Vec<AgentUsageReport>` | Retorna quotas reais ou `null` se não suportado. |
| `mindagentics:terminal:spawn` | `terminal_spawn` | `TerminalSpawnOptions` | `SpawnResult { terminal_id: String }` | `portable-pty` + Job Object + sanitização de prompt. |
| `mindagentics:terminal:write` | `terminal_write` | `TerminalWritePayload { terminal_id: String, data: String }` | `()` | Escrita no stream stdin do PTY. |
| `mindagentics:terminal:dims` | `terminal_get_dims` | `IdPayload { id: String }` | `TerminalDims` | Retorna colunas e linhas atuais do PTY. |
| `mindagentics:terminal:resize` | `terminal_resize` | `ResizePayload { terminal_id: String, cols: u16, rows: u16 }` | `()` | Redimensiona o pseudo-terminal. |
| `mindagentics:terminal:kill` | `terminal_kill` | `IdPayload { id: String }` | `GenericResult` | Mata subprocessos do Job Object no Windows. |
| `mindagentics:terminal:restart` | `terminal_restart` | `IdPayload { id: String }` | `GenericResult` | Mata e recria no mesmo terminal_id e cwd. |
| `mindagentics:terminal:reconfigure` | `terminal_reconfigure` | `TerminalReconfigureOptions` | `GenericResult` | Se comando mudou: restart; se metadados: atualiza `AGENTS.md`. |
| `mindagentics:terminal:getScrollback` | `terminal_get_scrollback` | `IdPayload { id: String }` | `String` | Retorna histórico do terminal da memória ou disco. |
| `mindagentics:terminal:markSeen` | `terminal_mark_seen` | `IdPayload { id: String }` | `()` | Limpa flag `attention` do terminal. |
| `mindagentics:terminal:setFocused` | `terminal_set_focused` | `IdPayload { id: String }` | `()` | Atualiza estado de foco dos terminais. |
| `mindagentics:terminal:deliverPrompt` | `terminal_deliver_prompt` | `PromptDeliveryPayload { terminal_id: String, prompt: String }` | `GenericResult` | Injeta prompt com briefing delimitado e seguro. |
| `mindagentics:terminal:processList` | `terminal_process_list` | `IdPayload { id: String }` | `Vec<ProcessInfo>` | Lista árvore de processos filhos do PTY. |
| `mindagentics:terminal:processStop` | `terminal_process_stop` | `ProcessStopPayload { terminal_id: String, pid: u32 }` | `GenericResult` | Envia SIGTERM / `TerminateProcess`. |
| `mindagentics:terminal:setOrchestratorMode` | `terminal_set_orchestrator_mode` | `ModePayload { terminal_id: String, enabled: bool }` | `()` | Atualiza modo orquestrador na sessão e no `AGENTS.md`. |
| `mindagentics:terminal:setMaestroMode` | `terminal_set_maestro_mode` | `ModePayload { terminal_id: String, enabled: bool }` | `()` | Alias para modo orquestrador. |
| `mindagentics:canvas:sync` | `canvas_sync` | `CanvasSyncPayload` | `()` | Sincroniza nós e detecta links `fileRef` ↔ terminal. |

### 3.7 Notas & Canvas Nodes

| Canal IPC | Comando Tauri (`Rust / TS`) | Payload de Entrada | Retorno | Segurança / Confinamento |
|---|---|---|---|---|
| `mindagentics:note:read` | `note_read` | `NoteReadPayload { workspace_id: String, note_id: String }` | `String` | Confinado em `notes/<ws>/<id>.md`. |
| `mindagentics:note:write` | `note_write` | `NoteWritePayload { workspace_id: String, note_id: String, content: String }` | `GenericResult` | Escrita atômica verbatim (fidelidade total). |
| `mindagentics:node:delete` | `node_delete` | `NodeDeletePayload { node_id: String }` | `GenericResult` | Remove nó do canvas e notas associadas. |

### 3.8 Routines (Cron / Automação)

| Canal IPC | Comando Tauri (`Rust / TS`) | Payload de Entrada | Retorno | Segurança / Confinamento |
|---|---|---|---|---|
| `mindagentics:routine:list` | `routine_list` | `()` | `Vec<Routine>` | Lê `routines.json`. |
| `mindagentics:routine:create` | `routine_create` | `CreateRoutineInput` | `Routine` | Valida expressão cron e salva. |
| `mindagentics:routine:update` | `routine_update` | `UpdateRoutineInput` | `Routine` | Atualiza parâmetros da rotina. |
| `mindagentics:routine:delete` | `routine_delete` | `IdPayload { id: String }` | `GenericResult` | Exclui do agendador e do JSON. |
| `mindagentics:routine:runNow` | `routine_run_now` | `IdPayload { id: String }` | `RunNowResult` | Executa rotina imediatamente em background. |
| `mindagentics:routine:history` | `routine_history` | `()` | `Vec<RoutineHistoryRecord>` | Lê histórico de execuções. |

### 3.9 Licença & Spatial

| Canal IPC | Comando Tauri (`Rust / TS`) | Payload de Entrada | Retorno | Segurança / Confinamento |
|---|---|---|---|---|
| `mindagentics:license:get` | `license_get` | `()` | `LicenseInfo` | Retorna status da licença. |
| `mindagentics:license:activate` | `license_activate` | `KeyPayload { key: String }` | `LicenseInfo` | Validação offline de chave ed25519 / HMAC. |
| `mindagentics:license:deactivate` | `license_deactivate` | `()` | `LicenseInfo` | Limpa dados de ativação. |
| `mindagentics:snapNode` | `spatial_snap_node` | `SnapNodeContext` | `SnapNodeResult` | Calcula ancoragem espacial de nós. |
| `mindagentics:tidyNode` | `spatial_tidy_node` | `TidyNodeRequest` | `TidyNodeResult` | Alinha e descompacta nós sobrepostos. |

### 3.10 Armazenamento & Dados

| Canal IPC | Comando Tauri (`Rust / TS`) | Payload de Entrada | Retorno | Segurança / Confinamento |
|---|---|---|---|---|
| `mindagentics:clipboard:writeImage` | `clipboard_write_image` | `ImagePayload { data_url: String }` | `GenericResult` | Decodifica base64 e copia para clipboard nativo. |
| `mindagentics:data:exportBackup` | `data_export_backup` | `BackupExportOptions { dest?: String }` | `BackupResult` | Cria arquivo `.zip` com workspaces e notas. |
| `mindagentics:data:importBackup` | `data_import_backup` | `BackupImportOptions { zip_path: String }` | `BackupResult` | Descompacta e valida integridade. |
| `mindagentics:data:storageLocation` | `data_get_storage_location` | `()` | `String` | Retorna diretório de dados em uso. |

### 3.11 Perfil & Gamificação

| Canal IPC | Comando Tauri (`Rust / TS`) | Payload de Entrada | Retorno | Segurança / Confinamento |
|---|---|---|---|---|
| `mindagentics:profile:get` | `profile_get` | `()` | `UserProfile` | Lê `profile.json` com fallback para padrão. |
| `mindagentics:profile:update` | `profile_update` | `ProfilePatch` | `UserProfile` | Atualiza avatar, callsign e preferências. |
| `mindagentics:profile:awardXp` | `profile_award_xp` | `AwardXpPayload { xp: u32, stat_key?: String }` | `AwardXpResult` | Calcula progressão de nível e desbloqueio de badges. |

### 3.12 Knowledge Graph (Graphify)

| Canal IPC | Comando Tauri (`Rust / TS`) | Payload de Entrada | Retorno | Segurança / Confinamento |
|---|---|---|---|---|
| `mindagentics:graphify:build` | `graphify_build` | `GraphifyBuildParams` | `GraphifyBuildResult` | Constrói Knowledge Graph AST via subprocesso Rust/Python. |
| `mindagentics:graphify:check` | `graphify_check` | `DirPayload { dir: String }` | `GraphifyCheckResult` | Verifica se grafo já está construído no diretório. |
| `mindagentics:graphify:status` | `graphify_status` | `()` | `GraphifyStatusResult` | Retorna status de runtime e memória do grafo. |
| `mindagentics:graphify:install` | `graphify_install` | `()` | `GenericResult` | Instala dependências locais do graphify se necessário. |

---

## 4. Definições de Schema para Geração de Tipos (Rust & TypeScript)

Abaixo estão os contratos formais dos schemas Rust (Serde) correspondentes às chamadas IPC:

```rust
use serde::{Deserialize, Serialize};

// --- Tipos Comuns & Genéricos ---
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenericResult {
    pub ok: bool,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdPayload {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirPayload {
    pub dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PathPayload {
    pub path: String,
}

// --- App & Reference Picker (B1) ---
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PickReferenceOptions {
    pub target: Option<String>, // "file" | "folder" | "all"
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReferenceItem {
    pub path: String,
    pub is_directory: bool,
    pub label: String,
}

// --- Terminal & Reconfigure (B2) ---
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalSpawnOptions {
    pub id: Option<String>,
    pub terminal_id: Option<String>,
    pub workspace_id: Option<String>,
    pub cwd: Option<String>,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub env: Option<std::collections::HashMap<String, String>>,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
    pub title: Option<String>,
    pub preset_id: Option<String>,
    pub agent_role: Option<String>,
    pub instructions: Option<String>,
    pub is_autonomous: Option<bool>,
    pub orchestrator_mode: Option<bool>,
    pub maestro_mode: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalReconfigureOptions {
    pub terminal_id: String,
    pub title: Option<String>,
    pub preset_id: Option<String>,
    pub command: Option<String>,
    pub agent_role: Option<String>,
    pub is_autonomous: Option<bool>,
    pub orchestrator_mode: Option<bool>,
    pub maestro_mode: Option<bool>,
    pub instructions: Option<String>,
    pub restart: Option<bool>,
}

// --- Probes & Usage Limits (B4) ---
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentCandidate {
    pub id: String,
    pub name: String,
    pub command: String,
    pub icon: String,
    pub installed: bool,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageWindow {
    pub id: String,
    pub label: String,
    pub used_fraction: Option<f64>,
    pub reset_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReportDetail {
    pub label: String,
    pub value: String,
}

// --- Gamificação & Perfil ---
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserProfile {
    pub callsign: String,
    pub avatar_id: String,
    pub level: u32,
    pub current_xp: u32,
    pub xp_to_next_level: u32,
    pub streak_days: u32,
    pub unlocked_badges: Vec<String>,
    pub stats: std::collections::HashMap<String, u64>,
}
```

---

## 5. Catálogo dos ~380 Canais Mortos / Deprecados (Não Migrados)

Os seguintes grupos de canais definidos no catálogo antigo `packages/shared/src/ipc/channels.ts` foram analisados e classificados como **mortos** por não possuírem implementação ativa no `dispatcher.ts` nem referências de chamada no frontend ou core-daemon:

1. **Partitura (`partitura:*` ~45 canais):** `partituraList`, `partituraSave`, `partituraDelete`, `partituraExportOne`, `partituraExportAll`, `partituraPickFiles`, `partituraReadFiles`, `partituraReadOpenedFiles`, `partituraChanged`, `partituraOpenRequested` etc.
2. **FileTree Explorer (`fileTree:*` ~25 canais):** `fileTreeList`, `fileTreeWatch`, `fileTreeUnwatch`, `fileTreeAttachCheckout`, `fileTreeGitState`, `fileTreeGitAction`, `fileTreeGitChanges`, `fileTreeSearchContents`, `fileTreeSearchFilenames` etc.
3. **Device Emulation & Streaming (`device:*` ~40 canais):** `deviceStream`, `deviceInput`, `deviceConnect`, `deviceDisconnect`, `deviceBoot`, `deviceAdb`, `deviceSnapshot` etc.
4. **Accounts Provider Stubs (`accounts:*` ~25 canais):** `accountsWatchSignOut`, `accountsRefreshPlace`, `accountsDescribe`, `accountsApproveProvider`, `accountsRestoreBuiltInProviders`, `accountsRevealProvidersFolder` etc.
5. **NoteStack Legacy (`noteStack:*` ~20 canais):** `noteStackFileSelection`, `noteStackAddNotes`, `noteStackSpill`, `noteStackUnstack`, `noteStackDeleteKeepingNotes`, `noteStackMoveMember`, `noteStackSetFront` etc. (substituídos pela entidade limpa `fileRef`).
6. **FloorHooks Legados (`floorHooks:*` ~20 canais):** `floorHooksGet`, `floorHooksReplace`, `floorHooksRunSection`, `floorHooksClearResult`, `floorHooksRuns`, `floorHooksReadOutput` etc.
7. **Updates Stubs (`updates:*` ~10 canais):** `updatesState`, `updatesCheck`, `updatesOnProgress`, `updatesRestartAndInstall` (no Tauri substitui-se pelo plugin oficial `@tauri-apps/plugin-updater`).

> [!NOTE]
> Essa higienização reduz a superfície de ataque em mais de **78%** e simplifica a manutenção dos contratos tipados em Rust, garantindo tempo de compilação mínimo e zero código morto.
