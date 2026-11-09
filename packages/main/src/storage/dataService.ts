import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import * as fflate from 'fflate';
import {
  type AppStateDocument,
  type AppStatePayload,
  type PreferencesDocument,
  type PreferencesPayload,
  type ManifestDocument,
  type ManifestWorkspaceEntry,
  type Workspace,
  type WorkspaceDocument,
  type Routine,
  type RoutineHistoryRecord,
  type RoutinesDocument,
  type RoutineHistoryDocument,
  type UserProfile,
  type OrchestratorStats,
  type UserBadge,
  createDefaultProfile,
  calculateLevelAndXp
} from '@mindagentics/shared';

export class AsyncKeyedMutex {
  private chains: Map<string, Promise<void>> = new Map();

  public async acquire<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(key) ?? Promise.resolve();
    let release: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    this.chains.set(key, gate);

    await prev.catch(() => {});
    try {
      return await fn();
    } finally {
      release!();
      if (this.chains.get(key) === gate) {
        this.chains.delete(key);
      }
    }
  }
}

export class DataService {
  private dataDir: string;
  private fileMutex = new AsyncKeyedMutex();
  private workspaceMutex = new AsyncKeyedMutex();
  private manifestMutex = new AsyncKeyedMutex();

  constructor() {
    this.dataDir = this.resolveDataDir();
  }

  /**
   * Resolve storage directory resolution hierarchy:
   * 1. MINDAGENTICS_DATA_DIR env variable
   * 2. Pointer file (%APPDATA%/mindAgentics/storage-location.json)
   * 3. ~/.mindagentics
   */
  private resolveDataDir(): string {
    if (process.env.MINDAGENTICS_DATA_DIR && process.env.MINDAGENTICS_DATA_DIR.trim() !== '') {
      return path.resolve(process.env.MINDAGENTICS_DATA_DIR.trim());
    }

    try {
      let pointerPath = '';
      if (process.platform === 'win32') {
        const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
        pointerPath = path.join(appData, 'mindAgentics', 'storage-location.json');
      } else if (process.platform === 'darwin') {
        pointerPath = path.join(os.homedir(), 'Library', 'Application Support', 'mindAgentics', 'storage-location.json');
      } else {
        pointerPath = path.join(os.homedir(), '.config', 'mindAgentics', 'storage-location.json');
      }

      if (fs.existsSync(pointerPath)) {
        const content = fs.readFileSync(pointerPath, 'utf-8');
        const parsed = JSON.parse(content);
        if (parsed && typeof parsed.path === 'string' && parsed.path.trim()) {
          return path.resolve(parsed.path.trim());
        }
      }
    } catch {
      // fallback
    }

    return path.join(os.homedir(), '.mindagentics');
  }

  public getDataDir(): string {
    return this.dataDir;
  }

  /**
   * Atomic file writing via temporary file rename with Windows resilience,
   * exponential backoff & jitter retries, orphan cleanup, and critical file backups.
   */
  public async replaceFileAtomically(filePath: string, content: string | Uint8Array, allowedRootDir?: string): Promise<void> {
    if (!filePath || typeof filePath !== 'string' || filePath.trim() === '') {
      throw new Error('[DataService] Invalid file path provided for atomic write');
    }
    if (filePath.includes('\0')) {
      throw new Error('[DataService] Target path contains invalid characters (null byte)');
    }
    if (/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(filePath)) {
      throw new Error(`[DataService] Access denied: Path traversal detected in path '${filePath}'`);
    }

    const resolvedPath = path.resolve(filePath);
    const dir = path.dirname(resolvedPath);
    const root = path.parse(resolvedPath).root;

    // Validate target directory path safety
    if (!dir || dir === '.' || dir === root) {
      throw new Error(`[DataService] Unsafe target directory for atomic write: ${dir}`);
    }

    // Boundary check: ensure target path is within the allowed root directory
    const baseDir = allowedRootDir ? path.resolve(allowedRootDir) : path.resolve(this.dataDir);
    const isInsideBase = resolvedPath.toLowerCase().startsWith(baseDir.toLowerCase() + path.sep) ||
      resolvedPath.toLowerCase() === baseDir.toLowerCase();
    if (!isInsideBase) {
      throw new Error(`[DataService] Access denied: Path '${filePath}' escapes base directory '${baseDir}'`);
    }

    const normalizedKey = path.normalize(resolvedPath).toLowerCase();
    return this.fileMutex.acquire(normalizedKey, async () => {
      // Validate that target directory path is safe and accessible
      if (fs.existsSync(dir)) {
        const stat = await fsp.stat(dir);
        if (!stat.isDirectory()) {
          throw new Error(`[DataService] Target directory path exists but is not a directory: ${dir}`);
        }
      } else {
        await fsp.mkdir(dir, { recursive: true });
      }

      // Maintain .bak backup for critical files prior to replacing
      const baseName = path.basename(resolvedPath).toLowerCase();
      const criticalFiles = ['manifest.json', 'app-state.json', 'workspace.json'];
      if (criticalFiles.includes(baseName)) {
        try {
          if (fs.existsSync(resolvedPath)) {
            const stat = await fsp.stat(resolvedPath);
            if (stat.size > 0) {
              await fsp.copyFile(resolvedPath, `${resolvedPath}.bak`);
            }
          }
        } catch (bakErr) {
          console.warn(`[DataService] Failed to create backup (.bak) for critical file ${resolvedPath}:`, bakErr);
        }
      }

      const tmpPath = `${resolvedPath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
      let success = false;

      try {
        await fsp.writeFile(tmpPath, content);

        const delays = [50, 150, 300];
        let lastError: any = null;

        for (let attempt = 0; attempt <= delays.length; attempt++) {
          try {
            await fsp.rename(tmpPath, resolvedPath);
            success = true;
            break;
          } catch (err: any) {
            lastError = err;
            const isLockError = err?.code === 'EPERM' || err?.code === 'EBUSY' || err?.code === 'EACCES';
            if (isLockError && attempt < delays.length) {
              const jitter = Math.floor(Math.random() * 30);
              const waitMs = delays[attempt] + jitter;
              await new Promise((r) => setTimeout(r, waitMs));
            } else {
              throw err;
            }
          }
        }

        if (!success && lastError) {
          throw lastError;
        }
      } finally {
        if (!success) {
          try {
            if (fs.existsSync(tmpPath)) {
              await fsp.unlink(tmpPath);
            }
          } catch {
            // ignore unlink error during orphan cleanup
          }
        }
      }
    });
  }

  private async readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }

    let raw: string | null = null;
    let readError: any = null;

    // Retry read up to 3 times to withstand transient Windows locks (EPERM / EBUSY)
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        raw = await fsp.readFile(filePath, 'utf-8');
        readError = null;
        break;
      } catch (err: any) {
        readError = err;
        const isLockError = err?.code === 'EPERM' || err?.code === 'EBUSY';
        if (isLockError && attempt < 2) {
          await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
        } else {
          break;
        }
      }
    }

    if (raw !== null && raw.trim().length > 0) {
      try {
        return JSON.parse(raw) as T;
      } catch (parseErr) {
        console.error(`[DataService] Corrupted JSON in file ${filePath}:`, parseErr);
      }
    } else {
      console.error(`[DataService] File ${filePath} exists but is empty or unreadable:`, readError);
    }

    // File exists but failed parsing or reading: quarantine damaged file
    const quarantinePath = `${filePath}.corrupted.${Date.now()}`;
    try {
      await fsp.copyFile(filePath, quarantinePath);
      console.warn(`[DataService] Quarantined corrupted file: ${filePath} -> ${quarantinePath}`);
    } catch (quarantineErr) {
      console.error(`[DataService] Failed to quarantine corrupted file ${filePath}:`, quarantineErr);
    }

    // Try reading backup (.bak)
    const bakPath = `${filePath}.bak`;
    if (fs.existsSync(bakPath)) {
      try {
        const bakRaw = await fsp.readFile(bakPath, 'utf-8');
        const bakData = JSON.parse(bakRaw) as T;
        console.warn(`[DataService] Restored valid JSON data from backup: ${bakPath}`);
        return bakData;
      } catch (bakErr) {
        console.error(`[DataService] Backup file ${bakPath} also failed to parse:`, bakErr);
      }
    }

    console.error(`[DataService] No valid backup available for ${filePath}. Returning fallback value.`);
    return fallback;
  }

  /**
   * Initializes folder hierarchy and default state files if they don't exist
   */
  public async initLayout(): Promise<void> {
    const subdirs = ['accounts', 'git-hosts', 'usage', 'partituras', 'backups', 'workspaces'];
    for (const sub of subdirs) {
      await fsp.mkdir(path.join(this.dataDir, sub), { recursive: true });
    }

    // Initialize manifest.json if missing
    const manifestPath = path.join(this.dataDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      const defaultManifest: ManifestDocument = {
        app: 'Maestro',
        appVersion: '0.26.0',
        dataFormat: 'json',
        schemaVersion: 1,
        files: {
          appState: 'app-state.json',
          preferences: 'preferences.json',
          sidebarLayout: 'sidebar-layout.json'
        },
        workspaces: []
      };
      await this.replaceFileAtomically(manifestPath, JSON.stringify(defaultManifest, null, 2));
    }

    // Initialize app-state.json if missing
    const appStatePath = path.join(this.dataDir, 'app-state.json');
    if (!fs.existsSync(appStatePath)) {
      const defaultAppState: AppStateDocument = {
        type: 'appState',
        schemaVersion: 1,
        payload: {
          cleanShutdown: true,
          hasCompletedOnboarding: true,
          hasSeenFloorOnboarding: true,
          lastOpenedAt: new Date().toISOString(),
          recentWorkspaceIds: [],
          windowBounds: {
            x: 100,
            y: 100,
            width: 1280,
            height: 800,
            maximized: false,
            fullScreen: false
          }
        }
      };
      await this.replaceFileAtomically(appStatePath, JSON.stringify(defaultAppState, null, 2));
    }

    // Initialize preferences.json if missing
    const prefPath = path.join(this.dataDir, 'preferences.json');
    if (!fs.existsSync(prefPath)) {
      const defaultPreferences: PreferencesDocument = {
        type: 'preferences',
        schemaVersion: 1,
        payload: {
          autosaveIntervalSeconds: 30,
          defaultStickyNoteColor: 'yellow',
          defaultTerminalFontFamily: "Cascadia Mono, Consolas, 'DejaVu Sans Mono', monospace",
          defaultTerminalFontSize: 13,
          agentPresets: [
            {
              id: 'C1A0DE00-0000-4000-8000-000000000001',
              name: 'Claude Code',
              agentType: 'claude_code',
              command: 'claude',
              icon: 'seal',
              isActive: true,
              orchestratorMode: false,
              maestroMode: false,
              startInChatMode: false,
              codexDaemonMigration: 'untouched'
            },
            {
              id: 'C1A0DE00-0000-4000-8000-000000000002',
              name: 'Codex',
              agentType: 'codex',
              command: 'codex --no-daemon',
              icon: 'brain',
              isActive: true,
              orchestratorMode: false,
              maestroMode: false,
              startInChatMode: false,
              codexDaemonMigration: 'added'
            },
            {
              id: 'C1A0DE00-0000-4000-8000-000000000003',
              name: 'Antigravity',
              agentType: 'antigravity_cli',
              command: 'agy',
              icon: 'zap',
              isActive: true,
              orchestratorMode: false,
              maestroMode: false,
              startInChatMode: false,
              codexDaemonMigration: 'untouched'
            }
          ]
        }
      };
      await this.replaceFileAtomically(prefPath, JSON.stringify(defaultPreferences, null, 2));
    }

    // Initialize license.json if missing
    const licensePath = path.join(this.dataDir, 'license.json');
    if (!fs.existsSync(licensePath)) {
      await this.replaceFileAtomically(
        licensePath,
        JSON.stringify({ type: 'trial', isTrial: true, isValid: true, daysRemaining: 30 }, null, 2)
      );
    }

    // Initialize routines.json if missing
    const routinesPath = path.join(this.dataDir, 'routines.json');
    if (!fs.existsSync(routinesPath)) {
      await this.replaceFileAtomically(routinesPath, JSON.stringify({ schemaVersion: 1, routines: [] }, null, 2));
    }

    // Initialize routine_history.json if missing
    const historyPath = path.join(this.dataDir, 'routine_history.json');
    if (!fs.existsSync(historyPath)) {
      await this.replaceFileAtomically(historyPath, JSON.stringify({ schemaVersion: 1, records: [] }, null, 2));
    }

    // Initialize profile.json if missing
    const profilePath = path.join(this.dataDir, 'profile.json');
    if (!fs.existsSync(profilePath)) {
      await this.replaceFileAtomically(profilePath, JSON.stringify(createDefaultProfile(), null, 2));
    }
  }

  // ==========================================
  // App State & Preferences
  // ==========================================

  public async getAppState(): Promise<AppStateDocument> {
    const filePath = path.join(this.dataDir, 'app-state.json');
    return this.readJsonFile<AppStateDocument>(filePath, {
      type: 'appState',
      schemaVersion: 1,
      payload: {
        cleanShutdown: true,
        hasCompletedOnboarding: true,
        hasSeenFloorOnboarding: true,
        lastOpenedAt: new Date().toISOString(),
        recentWorkspaceIds: [],
        windowBounds: { x: 100, y: 100, width: 1280, height: 800, maximized: false, fullScreen: false }
      }
    });
  }

  public async saveAppState(patch: Partial<AppStatePayload>): Promise<AppStateDocument> {
    const current = await this.getAppState();
    const updated: AppStateDocument = {
      ...current,
      payload: {
        ...current.payload,
        ...patch,
        lastOpenedAt: new Date().toISOString()
      }
    };
    const filePath = path.join(this.dataDir, 'app-state.json');
    await this.replaceFileAtomically(filePath, JSON.stringify(updated, null, 2));
    return updated;
  }

  public async getPreferences(): Promise<PreferencesDocument> {
    const filePath = path.join(this.dataDir, 'preferences.json');
    return this.readJsonFile<PreferencesDocument>(filePath, {
      type: 'preferences',
      schemaVersion: 1,
      payload: {
        autosaveIntervalSeconds: 30,
        defaultStickyNoteColor: 'yellow',
        defaultTerminalFontFamily: "Cascadia Mono, Consolas, 'DejaVu Sans Mono', monospace",
        defaultTerminalFontSize: 13,
        agentPresets: []
      }
    });
  }

  public async savePreferences(payload: PreferencesPayload | Partial<PreferencesPayload>): Promise<PreferencesDocument> {
    const current = await this.getPreferences();
    const updated: PreferencesDocument = {
      ...current,
      payload: {
        ...current.payload,
        ...payload
      }
    };
    const filePath = path.join(this.dataDir, 'preferences.json');
    await this.replaceFileAtomically(filePath, JSON.stringify(updated, null, 2));
    return updated;
  }

  // ==========================================
  // Manifest & Workspaces
  // ==========================================

  public async getManifest(): Promise<ManifestDocument> {
    const filePath = path.join(this.dataDir, 'manifest.json');
    return this.readJsonFile<ManifestDocument>(filePath, {
      app: 'Maestro',
      appVersion: '0.26.0',
      dataFormat: 'json',
      schemaVersion: 1,
      files: {
        appState: 'app-state.json',
        preferences: 'preferences.json',
        sidebarLayout: 'sidebar-layout.json'
      },
      workspaces: []
    });
  }

  public async saveManifest(manifest: ManifestDocument): Promise<void> {
    return this.manifestMutex.acquire('manifest', async () => {
      const filePath = path.join(this.dataDir, 'manifest.json');
      await this.replaceFileAtomically(filePath, JSON.stringify(manifest, null, 2));
    });
  }

  public async listWorkspaces(): Promise<any[]> {
    const manifest = await this.getManifest();
    const workspaces: any[] = [];

    const seenWsIds = new Set<string>();
    for (const entry of manifest.workspaces || []) {
      seenWsIds.add(entry.id);
      const ws = await this.getWorkspace(entry.id);
      if (ws) {
        if (!ws.id) ws.id = entry.id;
        if (!ws.name) ws.name = entry.name;
        workspaces.push(ws);
      } else {
        workspaces.push({
          id: entry.id,
          name: entry.name,
          workingDirectory: os.homedir(),
          preferredIde: 'vscode',
          floors: []
        });
      }
    }

    // Auto-discover workspaces on disk ONLY as emergency fallback when manifest has NO workspaces
    if (workspaces.length === 0) {
      try {
        const wsParentDir = path.join(this.dataDir, 'workspaces');
        if (fs.existsSync(wsParentDir)) {
          const entries = await fsp.readdir(wsParentDir, { withFileTypes: true });
          for (const dirent of entries) {
            if (dirent.isDirectory() && !seenWsIds.has(dirent.name)) {
              const discovered = await this.getWorkspace(dirent.name);
              if (discovered) {
                if (!discovered.id) discovered.id = dirent.name;
                workspaces.push(discovered);
                seenWsIds.add(dirent.name);
              }
            }
          }
          if (workspaces.length > 0) {
            const manifestDoc = await this.getManifest();
            manifestDoc.workspaces = workspaces.map((w) => ({
              id: w.id,
              name: w.name || 'Workspace',
              path: path.posix.join('workspaces', w.id, 'workspace.json'),
            }));
            await this.saveManifest(manifestDoc);
          }
        }
      } catch {}
    }

    if (workspaces.length === 0) {
      // Create initial workspace if none exist
      const defaultWs = await this.createWorkspace('Main Workspace', os.homedir(), 'vscode');
      workspaces.push(defaultWs);
    }

    return workspaces;
  }

  public async getWorkspace(id: string): Promise<any | null> {
    const wsFile = path.join(this.dataDir, 'workspaces', id, 'workspace.json');
    if (!fs.existsSync(wsFile)) return null;
    const doc = await this.readJsonFile<any | null>(wsFile, null);
    if (!doc) return null;
    const payload = doc?.payload ? doc.payload : doc;
    if (payload && typeof payload === 'object') {
      if (!payload.id) payload.id = id;
    }
    return payload;
  }

  public async saveWorkspace(ws: any): Promise<void> {
    if (!ws || !ws.id) throw new Error('Workspace must have an id');
    return this.workspaceMutex.acquire(ws.id, async () => {
      await this.saveWorkspaceInternal(ws);
    });
  }

  private async saveWorkspaceInternal(ws: any): Promise<void> {
    const wsDir = path.join(this.dataDir, 'workspaces', ws.id);
    await fsp.mkdir(wsDir, { recursive: true });

    const wsFile = path.join(wsDir, 'workspace.json');
    const doc: WorkspaceDocument = {
      schemaVersion: 1,
      type: 'workspace',
      payload: ws
    };
    await this.replaceFileAtomically(wsFile, JSON.stringify(doc, null, 2));

    // Mirror Markdown notes in workspaces/<ws.id>/notes/<note.content.noteId || note.id>.md
    try {
      await this.syncWorkspaceNotes(ws.id, ws);
    } catch (noteErr) {
      console.error(`[DataService] Error synchronizing notes for workspace ${ws.id}:`, noteErr);
    }

    // Update manifest safely via manifest mutex
    await this.manifestMutex.acquire('manifest', async () => {
      const manifest = await this.getManifest();
      const relPath = path.posix.join('workspaces', ws.id, 'workspace.json');
      const existingIndex = manifest.workspaces.findIndex((entry) => entry.id === ws.id);
      if (existingIndex >= 0) {
        manifest.workspaces[existingIndex].name = ws.name || manifest.workspaces[existingIndex].name;
        manifest.workspaces[existingIndex].path = relPath;
      } else {
        manifest.workspaces.push({
          id: ws.id,
          name: ws.name || 'Workspace',
          path: relPath
        });
      }
      const manifestPath = path.join(this.dataDir, 'manifest.json');
      await this.replaceFileAtomically(manifestPath, JSON.stringify(manifest, null, 2));
    });
  }

  private async syncWorkspaceNotes(wsId: string, ws: any): Promise<void> {
    const notesDir = path.join(this.dataDir, 'workspaces', wsId, 'notes');
    await fsp.mkdir(notesDir, { recursive: true });

    const nodes: any[] = [];
    if (Array.isArray(ws.nodes)) {
      nodes.push(...ws.nodes);
    }
    if (Array.isArray(ws.floors)) {
      for (const floor of ws.floors) {
        if (floor && Array.isArray(floor.nodes)) {
          nodes.push(...floor.nodes);
        }
      }
    }

    const activeNoteFiles = new Set<string>();

    for (const node of nodes) {
      if (!node) continue;
      const isNote = node.kind === 'note' || node.type === 'note';
      if (!isNote) continue;

      const noteId = node.content?.noteId || node.id;
      if (!noteId) continue;

      const fileName = `${noteId}.md`;
      activeNoteFiles.add(fileName);

      let markdown = '';
      if (node.content) {
        if (typeof node.content === 'string') {
          markdown = node.content;
        } else if (typeof node.content.body === 'string') {
          markdown = node.content.body;
        } else if (typeof node.content.text === 'string') {
          markdown = node.content.text;
        } else if (typeof node.content.content === 'string') {
          markdown = node.content.content;
        } else if (typeof node.content.title === 'string') {
          markdown = node.content.title;
        }
      }

      const noteFilePath = path.join(notesDir, fileName);
      let needsWrite = true;
      try {
        if (fs.existsSync(noteFilePath)) {
          const currentMd = await fsp.readFile(noteFilePath, 'utf-8');
          if (currentMd === markdown) {
            needsWrite = false;
          }
        }
      } catch {
        needsWrite = true;
      }

      if (needsWrite) {
        await this.replaceFileAtomically(noteFilePath, markdown);
      }
    }

    // Clean up removed notes from disk
    try {
      const filesOnDisk = await fsp.readdir(notesDir);
      for (const file of filesOnDisk) {
        if (file.endsWith('.md') && !activeNoteFiles.has(file)) {
          const toRemove = path.join(notesDir, file);
          try {
            await fsp.unlink(toRemove);
          } catch (unlinkErr) {
            console.warn(`[DataService] Failed to clean up removed note ${toRemove}:`, unlinkErr);
          }
        }
      }
    } catch (cleanErr) {
      console.warn(`[DataService] Failed to scan notes directory at ${notesDir}:`, cleanErr);
    }
  }

  /**
   * Safe read of a workspace note markdown file with strict path traversal defenses.
   */
  public async noteRead(workspaceId: string, noteId: string): Promise<string> {
    this.assertSafeWorkspaceAndNoteId(workspaceId, noteId);

    const safeWsId = (workspaceId || '').trim();
    const safeNoteId = (noteId || '').replace(/[^a-zA-Z0-9_-]/g, '');
    const notesDir = path.resolve(this.dataDir, 'workspaces', safeWsId, 'notes');
    const noteFile = path.resolve(notesDir, `${safeNoteId}.md`);

    const expectedNotesDir = path.resolve(this.dataDir, 'workspaces', safeWsId, 'notes');
    if (!noteFile.startsWith(expectedNotesDir + path.sep)) {
      throw new Error('Access denied: Path traversal detected');
    }

    if (fs.existsSync(noteFile)) {
      return await fsp.readFile(noteFile, 'utf-8');
    }
    return '';
  }

  /**
   * Safe atomic write of a workspace note markdown file with strict path traversal defenses.
   */
  public async noteWrite(workspaceId: string, noteId: string, content: string): Promise<{ ok: boolean }> {
    this.assertSafeWorkspaceAndNoteId(workspaceId, noteId);

    const safeWsId = (workspaceId || '').trim();
    const safeNoteId = (noteId || '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!safeNoteId) {
      throw new Error('Invalid noteId: only alphanumeric, dash and underscore characters allowed');
    }

    const notesDir = path.resolve(this.dataDir, 'workspaces', safeWsId, 'notes');
    const noteFile = path.resolve(notesDir, `${safeNoteId}.md`);

    const expectedNotesDir = path.resolve(this.dataDir, 'workspaces', safeWsId, 'notes');
    if (!noteFile.startsWith(expectedNotesDir + path.sep)) {
      throw new Error('Access denied: Path traversal detected');
    }

    await this.replaceFileAtomically(noteFile, content);
    return { ok: true };
  }

  private assertSafeWorkspaceAndNoteId(workspaceId: string, noteId: string): void {
    if (!workspaceId || typeof workspaceId !== 'string') {
      throw new Error('Access denied: Invalid workspaceId provided');
    }
    if (!noteId || typeof noteId !== 'string') {
      throw new Error('Access denied: Invalid noteId provided');
    }
    if (
      workspaceId.includes('..') ||
      workspaceId.includes('/') ||
      workspaceId.includes('\\') ||
      workspaceId.includes('\0')
    ) {
      throw new Error('Access denied: Path traversal detected in workspaceId');
    }
    if (
      noteId.includes('..') ||
      noteId.includes('/') ||
      noteId.includes('\\') ||
      noteId.includes('\0')
    ) {
      throw new Error('Access denied: Path traversal detected in noteId');
    }
  }

  public async createWorkspace(name: string, dir: string, ide = 'vscode'): Promise<any> {
    const id = crypto.randomUUID();
    const ws = {
      id,
      name: name || 'New Workspace',
      workingDirectory: dir || os.homedir(),
      preferredIde: ide || 'vscode',
      floors: [
        {
          id: `floor-${id}`,
          name: 'Canvas',
          isGround: true,
          workingDirectory: dir || os.homedir(),
          gitBranch: 'main',
          status: null,
          nodes: [],
          cableTies: [],
          bands: [],
          drawings: []
        }
      ]
    };
    await this.saveWorkspace(ws);
    return ws;
  }

  public async patchWorkspace(id: string, patch: any): Promise<any> {
    return this.workspaceMutex.acquire(id, async () => {
      const current = (await this.getWorkspace(id)) || {};
      const updated = {
        ...current,
        ...patch,
        id
      };
      await this.saveWorkspaceInternal(updated);
      return updated;
    });
  }

  public async deleteWorkspace(id: string, deleteProjectFiles = false): Promise<void> {
    await this.workspaceMutex.acquire(id, async () => {
      // 1. Remove from manifest.json
      await this.manifestMutex.acquire('manifest', async () => {
        const manifest = await this.getManifest();
        manifest.workspaces = (manifest.workspaces || []).filter((w) => w.id !== id);
        const filePath = path.join(this.dataDir, 'manifest.json');
        await this.replaceFileAtomically(filePath, JSON.stringify(manifest, null, 2));
      });

      // 2. Always remove mindAgentics internal storage directory for this workspace (~/.mindagentics/workspaces/<id>)
      const wsDir = path.join(this.dataDir, 'workspaces', id);
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          if (fs.existsSync(wsDir)) {
            await fsp.rm(wsDir, { recursive: true, force: true });
          }
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
        }
      }

      // 3. Clean up app-state.json (remove from recentWorkspaceIds and update activeWorkspaceId)
      try {
        const appState = await this.getAppState();
        const recents = (appState.payload?.recentWorkspaceIds || []).filter((wid) => wid !== id);
        let activeId = (appState.payload as any)?.activeWorkspaceId;
        if (activeId === id) {
          activeId = recents[0] || null;
        }
        await this.saveAppState({
          recentWorkspaceIds: recents,
          activeWorkspaceId: activeId,
        } as any);
      } catch {
        // ignore
      }
    });
  }

  // ==========================================
  // Routines & Automation
  // ==========================================

  public async getRoutines(): Promise<Routine[]> {
    const filePath = path.join(this.dataDir, 'routines.json');
    const doc = await this.readJsonFile<RoutinesDocument>(filePath, {
      schemaVersion: 1,
      routines: []
    });
    return doc.routines || [];
  }

  public async saveRoutines(routines: Routine[]): Promise<void> {
    const filePath = path.join(this.dataDir, 'routines.json');
    const doc: RoutinesDocument = {
      schemaVersion: 1,
      routines
    };
    await this.replaceFileAtomically(filePath, JSON.stringify(doc, null, 2));
  }

  public async getRoutineHistory(): Promise<RoutineHistoryRecord[]> {
    const filePath = path.join(this.dataDir, 'routine_history.json');
    const doc = await this.readJsonFile<RoutineHistoryDocument>(filePath, {
      schemaVersion: 1,
      records: []
    });
    return doc.records || [];
  }

  public async appendRoutineHistory(record: Partial<RoutineHistoryRecord> & { routineId: string; status: any }): Promise<void> {
    const history = await this.getRoutineHistory();
    const newRecord: RoutineHistoryRecord = {
      id: crypto.randomUUID(),
      firedAt: new Date().toISOString(),
      ...record
    };
    history.unshift(newRecord);
    // Retain up to 500 recent history entries
    const capped = history.slice(0, 500);
    const filePath = path.join(this.dataDir, 'routine_history.json');
    const doc: RoutineHistoryDocument = {
      schemaVersion: 1,
      records: capped
    };
    await this.replaceFileAtomically(filePath, JSON.stringify(doc, null, 2));
  }

  // ==========================================
  // License
  // ==========================================

  public async getLicense(): Promise<any> {
    const filePath = path.join(this.dataDir, 'license.json');
    return this.readJsonFile(filePath, {
      type: 'trial',
      isTrial: true,
      isValid: true,
      daysRemaining: 30
    });
  }

  public async saveLicense(doc: any): Promise<void> {
    const filePath = path.join(this.dataDir, 'license.json');
    await this.replaceFileAtomically(filePath, JSON.stringify(doc, null, 2));
  }

  // ==========================================
  // Backups (ZIP Archive)
  // ==========================================

  public async exportBackup(dest?: string): Promise<{ ok: boolean; path?: string; error?: string }> {
    try {
      const backupDir = path.join(this.dataDir, 'backups');
      await fsp.mkdir(backupDir, { recursive: true });

      const targetPath =
        dest ||
        path.join(
          backupDir,
          `mindagentics-backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 8)}.zip`
        );

      const filesToArchive: Record<string, Uint8Array> = {};

      const addDirToArchive = async (currentDir: string, relativePrefix: string) => {
        if (!fs.existsSync(currentDir)) return;
        const entries = await fsp.readdir(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          if (
            entry.name === 'backups' ||
            entry.name.endsWith('.tmp') ||
            entry.name.includes('.tmp.') ||
            entry.name.endsWith('.bak') ||
            entry.name.includes('.corrupted.')
          ) {
            continue;
          }
          const fullPath = path.join(currentDir, entry.name);
          const zipPath = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            await addDirToArchive(fullPath, zipPath);
          } else if (entry.isFile()) {
            const data = await fsp.readFile(fullPath);
            filesToArchive[zipPath] = new Uint8Array(data);
          }
        }
      };

      await addDirToArchive(this.dataDir, '');

      const zipped = fflate.zipSync(filesToArchive, { level: 6 });
      await this.replaceFileAtomically(targetPath, zipped, dest ? path.dirname(dest) : undefined);

      return { ok: true, path: targetPath };
    } catch (err: any) {
      return { ok: false, error: err.message || String(err) };
    }
  }

  public async importBackup(zipPath: string): Promise<{ ok: boolean; error?: string }> {
    try {
      if (!fs.existsSync(zipPath)) {
        return { ok: false, error: 'Backup zip file not found' };
      }

      const zipData = await fsp.readFile(zipPath);
      const unzipped = fflate.unzipSync(new Uint8Array(zipData));

      for (const [relPath, content] of Object.entries(unzipped)) {
        // Prevent path traversal
        const safeRel = path.normalize(relPath).replace(/^(\.\.[\/\\])+/, '');
        const target = path.resolve(this.dataDir, safeRel);
        if (!target.startsWith(path.resolve(this.dataDir))) {
          console.warn(`[DataService] Blocked unsafe path traversal in backup import: ${relPath}`);
          continue;
        }
        await this.replaceFileAtomically(target, content);
      }

      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message || String(err) };
    }
  }

  // ==========================================
  // User Profile & Gamification (Pillar 3)
  // ==========================================

  private async getProfileInternal(): Promise<UserProfile> {
    const profilePath = path.join(this.dataDir, 'profile.json');
    if (!fs.existsSync(profilePath)) {
      const def = createDefaultProfile();
      await this.replaceFileAtomically(profilePath, JSON.stringify(def, null, 2));
      return def;
    }
    try {
      const raw = await fsp.readFile(profilePath, 'utf8');
      const profile: UserProfile = JSON.parse(raw);

      // Check daily streak
      const today = new Date().toISOString().split('T')[0];
      if (profile.lastActiveDate !== today) {
        const lastDate = new Date(profile.lastActiveDate);
        const currDate = new Date(today);
        const diffTime = currDate.getTime() - lastDate.getTime();
        const diffDays = Math.round(diffTime / (1000 * 3600 * 24));

        if (diffDays === 1) {
          profile.streakDays = (profile.streakDays || 0) + 1;
        } else if (diffDays > 1) {
          profile.streakDays = 1;
        }
        profile.lastActiveDate = today;

        // Check "Em Chamas" badge progress
        const emChamas = profile.badges.find((b) => b.id === 'badge-em-chamas');
        if (emChamas) {
          emChamas.progress = profile.streakDays;
          if (!emChamas.unlockedAt && emChamas.progress >= (emChamas.maxProgress || 3)) {
            emChamas.unlockedAt = new Date().toISOString();
          }
        }
        await this.replaceFileAtomically(profilePath, JSON.stringify(profile, null, 2));
      }

      return profile;
    } catch (err) {
      console.warn('[DataService] Failed to read profile.json, recreating default:', err);
      const def = createDefaultProfile();
      await this.replaceFileAtomically(profilePath, JSON.stringify(def, null, 2));
      return def;
    }
  }

  public async getProfile(): Promise<UserProfile> {
    return this.fileMutex.acquire('profile.json', () => this.getProfileInternal());
  }

  public async updateProfile(patch: Partial<UserProfile>): Promise<UserProfile> {
    return this.fileMutex.acquire('profile.json', async () => {
      const current = await this.getProfileInternal();
      const updated: UserProfile = {
        ...current,
        ...patch,
        stats: {
          ...current.stats,
          ...(patch.stats || {}),
        },
        badges: patch.badges || current.badges,
      };

      // Recalculate level & XP in case totalXp was patched
      if (patch.totalXp !== undefined) {
        const lvlInfo = calculateLevelAndXp(updated.totalXp);
        updated.level = lvlInfo.level;
        updated.currentXp = lvlInfo.currentXp;
        updated.xpToNextLevel = lvlInfo.xpToNextLevel;
        if (!patch.title) {
          updated.title = lvlInfo.title;
        }
      }

      const profilePath = path.join(this.dataDir, 'profile.json');
      await this.replaceFileAtomically(profilePath, JSON.stringify(updated, null, 2));
      return updated;
    });
  }

  public async awardXp(
    xp: number,
    statKey?: keyof OrchestratorStats
  ): Promise<{ profile: UserProfile; leveledUp: boolean; unlockedBadges: UserBadge[] }> {
    return this.fileMutex.acquire('profile.json', async () => {
      const profile = await this.getProfileInternal();
      const previousLevel = profile.level;
      profile.totalXp = Math.max(0, profile.totalXp + xp);

      const lvlInfo = calculateLevelAndXp(profile.totalXp);
      const leveledUp = lvlInfo.level > previousLevel;
      profile.level = lvlInfo.level;
      profile.currentXp = lvlInfo.currentXp;
      profile.xpToNextLevel = lvlInfo.xpToNextLevel;
      profile.title = lvlInfo.title;

      if (statKey && profile.stats[statKey] !== undefined) {
        profile.stats[statKey] = (profile.stats[statKey] || 0) + 1;
      }

      const unlockedBadges: UserBadge[] = [];
      const nowIso = new Date().toISOString();

      // Evaluate badge progress based on stats
      for (const badge of profile.badges) {
        if (badge.unlockedAt) continue;

        let shouldUnlock = false;
        if (badge.id === 'badge-primeira-sinfonia') {
          if (profile.stats.recruitsCount >= 1 || profile.stats.tasksDelegated >= 1) {
            badge.progress = 1;
            shouldUnlock = true;
          }
        } else if (badge.id === 'badge-delegacao-cirurgica') {
          badge.progress = profile.stats.tasksDelegated;
          if (badge.progress >= (badge.maxProgress || 10)) {
            shouldUnlock = true;
          }
        } else if (badge.id === 'badge-mapeador-neural') {
          badge.progress = profile.stats.knowledgeGraphsBuilt;
          if (badge.progress >= (badge.maxProgress || 1)) {
            shouldUnlock = true;
          }
        } else if (badge.id === 'badge-ponte-conhecimento') {
          badge.progress = profile.stats.portalsOpened;
          if (badge.progress >= (badge.maxProgress || 5)) {
            shouldUnlock = true;
          }
        } else if (badge.id === 'badge-sentinela-autonomo') {
          badge.progress = profile.stats.routinesExecuted;
          if (badge.progress >= (badge.maxProgress || 1)) {
            shouldUnlock = true;
          }
        } else if (badge.id === 'badge-em-chamas') {
          badge.progress = profile.streakDays;
          if (badge.progress >= (badge.maxProgress || 3)) {
            shouldUnlock = true;
          }
        }

        if (shouldUnlock && !badge.unlockedAt) {
          badge.unlockedAt = nowIso;
          unlockedBadges.push(badge);
        }
      }

      const profilePath = path.join(this.dataDir, 'profile.json');
      await this.replaceFileAtomically(profilePath, JSON.stringify(profile, null, 2));

      return {
        profile,
        leveledUp,
        unlockedBadges,
      };
    });
  }
}
