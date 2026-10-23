import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import * as fflate from 'fflate';
import type {
  AppStateDocument,
  AppStatePayload,
  PreferencesDocument,
  PreferencesPayload,
  ManifestDocument,
  ManifestWorkspaceEntry,
  Workspace,
  WorkspaceDocument,
  Routine,
  RoutineHistoryRecord,
  RoutinesDocument,
  RoutineHistoryDocument
} from '@maestri/shared';

export class DataService {
  private dataDir: string;

  constructor() {
    this.dataDir = this.resolveDataDir();
  }

  /**
   * Resolve storage directory according to Section 4.1 of CLONE_SPEC.md:
   * 1. MAESTRI_DATA_DIR env variable
   * 2. Pointer file (%APPDATA%/Maestri/storage-location.json)
   * 3. ~/.maestri
   */
  private resolveDataDir(): string {
    if (process.env.MAESTRI_DATA_DIR && process.env.MAESTRI_DATA_DIR.trim() !== '') {
      return path.resolve(process.env.MAESTRI_DATA_DIR.trim());
    }

    try {
      let pointerPath = '';
      if (process.platform === 'win32') {
        const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
        pointerPath = path.join(appData, 'Maestri', 'storage-location.json');
      } else if (process.platform === 'darwin') {
        pointerPath = path.join(os.homedir(), 'Library', 'Application Support', 'Maestri', 'storage-location.json');
      } else {
        pointerPath = path.join(os.homedir(), '.config', 'Maestri', 'storage-location.json');
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

    return path.join(os.homedir(), '.maestri');
  }

  public getDataDir(): string {
    return this.dataDir;
  }

  /**
   * Atomic file writing via temporary file rename
   */
  public async replaceFileAtomically(filePath: string, content: string | Uint8Array): Promise<void> {
    const dir = path.dirname(filePath);
    await fsp.mkdir(dir, { recursive: true });
    const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
    await fsp.writeFile(tmpPath, content);
    await fsp.rename(tmpPath, filePath);
  }

  private async readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
    try {
      if (!fs.existsSync(filePath)) return fallback;
      const raw = await fsp.readFile(filePath, 'utf-8');
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
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
    const filePath = path.join(this.dataDir, 'manifest.json');
    await this.replaceFileAtomically(filePath, JSON.stringify(manifest, null, 2));
  }

  public async listWorkspaces(): Promise<any[]> {
    const manifest = await this.getManifest();
    const workspaces: any[] = [];

    for (const entry of manifest.workspaces || []) {
      const ws = await this.getWorkspace(entry.id);
      if (ws) {
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
    try {
      const raw = await fsp.readFile(wsFile, 'utf-8');
      const doc = JSON.parse(raw);
      return doc?.payload ? doc.payload : doc;
    } catch {
      return null;
    }
  }

  public async saveWorkspace(ws: any): Promise<void> {
    if (!ws || !ws.id) throw new Error('Workspace must have an id');
    const wsDir = path.join(this.dataDir, 'workspaces', ws.id);
    await fsp.mkdir(wsDir, { recursive: true });

    const wsFile = path.join(wsDir, 'workspace.json');
    const doc: WorkspaceDocument = {
      schemaVersion: 1,
      type: 'workspace',
      payload: ws
    };
    await this.replaceFileAtomically(wsFile, JSON.stringify(doc, null, 2));

    // Update manifest
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
    await this.saveManifest(manifest);
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
    const current = (await this.getWorkspace(id)) || {};
    const updated = {
      ...current,
      ...patch,
      id
    };
    await this.saveWorkspace(updated);
    return updated;
  }

  public async deleteWorkspace(id: string, deleteDir = false): Promise<void> {
    const manifest = await this.getManifest();
    manifest.workspaces = (manifest.workspaces || []).filter((w) => w.id !== id);
    await this.saveManifest(manifest);

    if (deleteDir) {
      const wsDir = path.join(this.dataDir, 'workspaces', id);
      try {
        await fsp.rm(wsDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
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
          `maestri-backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 8)}.zip`
        );

      const filesToArchive: Record<string, Uint8Array> = {};

      const addDirToArchive = async (currentDir: string, relativePrefix: string) => {
        if (!fs.existsSync(currentDir)) return;
        const entries = await fsp.readdir(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === 'backups' || entry.name.endsWith('.tmp') || entry.name.includes('.tmp.')) {
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
      await this.replaceFileAtomically(targetPath, zipped);

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
        const target = path.join(this.dataDir, safeRel);
        await this.replaceFileAtomically(target, content);
      }

      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message || String(err) };
    }
  }
}
