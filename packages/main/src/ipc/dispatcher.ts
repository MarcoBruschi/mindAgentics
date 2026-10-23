import { ipcMain, dialog, shell, clipboard, app, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { IPC_CHANNELS as C } from '@mindagentics/shared';

const execAsync = promisify(exec);
import { DataService } from '../storage/dataService.js';
import { CoreDaemonSupervisor } from '../supervisor/coreDaemonSupervisor.js';
import { TerminalManager } from '../terminal/terminalManager.js';
import { GitWorktreeService } from '../git/gitWorktreeService.js';

export interface DispatcherDeps {
  mainWindow: BrowserWindow | null;
  dataService: DataService;
  supervisor: CoreDaemonSupervisor;
  terminalManager: TerminalManager;
  gitService: GitWorktreeService;
}

export function registerIpcDispatcher(deps: DispatcherDeps): void {
  const { dataService, supervisor, terminalManager, gitService } = deps;
  const getWin = () => deps.mainWindow || BrowserWindow.getAllWindows()[0] || null;

  const handle = (channel: string, handler: (...args: any[]) => any) => {
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        return await handler(...args);
      } catch (err: any) {
        console.error(`[IPC Error: ${channel}]`, err);
        throw err;
      }
    });
  };

  const on = (channel: string, listener: (...args: any[]) => void) => {
    ipcMain.on(channel, (_event, ...args) => {
      try {
        listener(...args);
      } catch (err) {
        console.error(`[IPC On Error: ${channel}]`, err);
      }
    });
  };

  // ==========================================
  // App & Window Management
  // ==========================================
  handle(C.appInfo, () => {
    let windowMaterial: 'acrylic' | 'vibrancy' | null = null;
    if (process.platform === 'darwin') {
      windowMaterial = 'vibrancy';
    } else if (process.platform === 'win32') {
      try {
        const build = Number.parseInt(os.release().split('.')[2] ?? '', 10);
        if (Number.isFinite(build) && build >= 22621) {
          windowMaterial = 'acrylic';
        }
      } catch {}
    }

    return {
      appVersion: '0.26.0',
      electronVersion: process.versions.electron || '',
      platform: process.platform,
      locale: app.getLocale(),
      isPackaged: app.isPackaged,
      windowMaterial,
      windowSeeThrough: false,
      buildSha: 'clean-room-0.26.0'
    };
  });

  handle(C.appDiagnosticReport, () => ({
    os: `${process.platform} ${process.arch}`,
    version: '0.26.0',
    dataDir: dataService.getDataDir(),
    daemonReady: supervisor.daemonReady,
    pipeAddress: supervisor.pipeAddress
  }));

  handle(C.appSaveDiagnosticReport, async () => {
    const reportPath = path.join(dataService.getDataDir(), 'diagnostic-report.json');
    const report = {
      date: new Date().toISOString(),
      platform: process.platform,
      arch: process.arch,
      dataDir: dataService.getDataDir()
    };
    await dataService.replaceFileAtomically(reportPath, JSON.stringify(report, null, 2));
    return { ok: true, path: reportPath };
  });

  handle(C.appPickDirectory, async () => {
    const win = getWin();
    const res = await dialog.showOpenDialog(win || undefined, {
      properties: ['openDirectory', 'createDirectory']
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0];
  });

  handle(C.appLocalDirectorySuggestions, async (partialPath: string, limit = 10) => {
    try {
      const dir = partialPath && fs.existsSync(partialPath) ? partialPath : os.homedir();
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      return entries.filter(e => e.isDirectory()).slice(0, limit).map(e => path.join(dir, e.name));
    } catch {
      return [];
    }
  });

  handle(C.appDirectoryState, async (_wsId: string, _env: any, dirPath: string) => {
    const exists = fs.existsSync(dirPath);
    return { exists, isDirectory: exists ? fs.statSync(dirPath).isDirectory() : false };
  });

  handle(C.appCreateDirectory, async (_wsId: string, _env: any, dirPath: string) => {
    await fs.promises.mkdir(dirPath, { recursive: true });
    return { ok: true };
  });

  handle(C.appQuit, () => {
    app.quit();
  });

  handle(C.appHideToTray, () => {
    const win = getWin();
    if (win) win.hide();
  });

  handle(C.appListIdes, () => [
    { id: 'vscode', name: 'Visual Studio Code', command: 'code' },
    { id: 'cursor', name: 'Cursor', command: 'cursor' },
    { id: 'windsurf', name: 'Windsurf', command: 'windsurf' },
    { id: 'intellij', name: 'IntelliJ IDEA', command: 'idea' }
  ]);

  handle(C.appOpenInIde, async (workspaceId: string, ideId: string) => {
    const ws = await dataService.getWorkspace(workspaceId);
    if (!ws || !ws.workingDirectory) return { ok: false };
    const ideCmd = ideId === 'cursor' ? 'cursor' : ideId === 'windsurf' ? 'windsurf' : 'code';
    require('child_process').exec(`${ideCmd} "${ws.workingDirectory}"`);
    return { ok: true };
  });

  handle(C.appOpenExternal, (url: string) => shell.openExternal(url));
  handle(C.appOpenPath, (p: string) => shell.openPath(p));
  handle(C.appShowEmojiPanel, () => app.showEmojiPanel());
  on(C.appRendererBooted, () => console.log('[Renderer] Booted'));
  on(C.appRendererFault, (fault) => console.error('[Renderer Fault]', fault));
  on(C.appShutdownPainted, () => console.log('[Renderer] Shutdown painted'));

  // Window Controls
  handle(C.windowControlsState, () => {
    const win = getWin();
    return {
      isMaximized: win ? win.isMaximized() : false,
      isFullScreen: win ? win.isFullScreen() : false,
      isMinimized: win ? win.isMinimized() : false
    };
  });

  handle(C.windowControlsMinimize, () => {
    const win = getWin();
    if (win) win.minimize();
  });

  handle(C.windowControlsToggleMaximize, () => {
    const win = getWin();
    if (win) {
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    }
  });

  handle(C.windowControlsClose, () => {
    const win = getWin();
    if (win) win.close();
  });

  // App State
  handle(C.appStateGet, async () => {
    const doc = await dataService.getAppState();
    return doc.payload;
  });

  handle(C.appStateSetOnboardingCompleted, async (completed: boolean) => {
    await dataService.saveAppState({ hasCompletedOnboarding: completed });
    return { ok: true };
  });

  handle(C.appStateSetHasSeenFloorOnboarding, async (seen: boolean) => {
    await dataService.saveAppState({ hasSeenFloorOnboarding: seen });
    return { ok: true };
  });

  // Preferences
  handle(C.preferencesGet, async () => {
    const doc = await dataService.getPreferences();
    return doc.payload;
  });

  handle(C.preferencesSet, async (patch: any) => {
    const current = await dataService.getPreferences();
    const updated = { ...current.payload, ...patch };
    await dataService.savePreferences(updated);
    const win = getWin();
    if (win && !win.isDestroyed()) {
      win.webContents.send(C.preferencesOnChanged, updated);
    }
    return { ok: true };
  });

  on(C.preferencesSubscribe, () => {});
  on(C.preferencesUnsubscribe, () => {});

  // Workspace
  handle(C.workspaceList, async () => dataService.listWorkspaces());
  handle(C.workspaceCreate, async (input: any) => {
    const name = input?.name || 'New Workspace';
    const dir = input?.workingDirectory || os.homedir();
    const ide = input?.preferredIde || 'vscode';
    return dataService.createWorkspace(name, dir, ide);
  });
  handle(C.workspacePatch, async (id: string, patch: any) => dataService.patchWorkspace(id, patch));
  handle(C.workspaceDelete, async (id: string, deleteDir = false) => {
    await dataService.deleteWorkspace(id, deleteDir);
    const win = getWin();
    if (win && !win.isDestroyed()) win.webContents.send(C.workspaceOnDeleted, id);
    return { ok: true };
  });
  handle(C.workspaceDuplicate, async (id: string) => {
    const ws = await dataService.getWorkspace(id);
    if (!ws) throw new Error('Workspace not found');
    return dataService.createWorkspace(`${ws.name} Copy`, ws.workingDirectory, ws.preferredIde);
  });
  handle(C.workspaceExport, async (id: string) => {
    const ws = await dataService.getWorkspace(id);
    return JSON.stringify(ws, null, 2);
  });
  handle(C.workspaceImport, async (content: string) => {
    const ws = JSON.parse(content);
    await dataService.saveWorkspace(ws);
    return ws;
  });
  handle(C.workspaceReveal, (p: string) => {
    shell.showItemInFolder(p);
    return { ok: true };
  });
  handle(C.workspaceGetActiveId, async () => {
    const state = await dataService.getAppState();
    return (state.payload as any)?.activeWorkspaceId || state.payload.recentWorkspaceIds[0] || null;
  });
  handle(C.workspaceSwitch, async (id: string) => {
    await dataService.saveAppState({
      activeWorkspaceId: id,
      recentWorkspaceIds: [id]
    } as any);
    return { ok: true };
  });

  // Floor & Git Worktree
  handle(C.floorIsolationAvailable, async (_wsId: string, dir: string) => gitService.isGitRepo(dir));
  handle(C.floorCanCopy, async () => ({ canCopy: true }));
  handle(C.floorCreateKind, async (_wsId: string, dir: string) => {
    const isGit = await gitService.isGitRepo(dir);
    return isGit ? 'worktree' : 'copy';
  });
  handle(C.floorCreateIsolated, async (options: any) => {
    return gitService.createIsolatedFloor(options);
  });
  handle(C.floorListBranches, async (_wsId: string, dir: string) => gitService.listBranches(dir));
  handle(C.floorLandingPreflight, async (input: any) => {
    return gitService.landingPreflight(input.repoDir, input.worktreePath, input.targetBranch);
  });
  handle(C.floorLand, async (input: any) => {
    return gitService.landFloor(input.repoDir, input.worktreePath, input.sourceBranch, input.targetBranch, input.deleteBranch);
  });
  handle(C.floorDelete, async (descriptor: any, deleteBranch = false) => {
    await gitService.removeIsolatedFloor(descriptor, deleteBranch);
    return { ok: true };
  });

  // Terminal PTY
  handle('maestri:terminal:detectAgents', () => terminalManager.detectInstalledAgents());
  handle('maestri:terminal:getAgentLimits', () => terminalManager.getAgentLimits());
  handle('maestri:terminal:setMaestroMode', (_event: any, terminalId: string, maestroMode: boolean) => {
    terminalManager.setMaestroMode(terminalId, maestroMode);
    return { ok: true };
  });
  handle(C.terminalSpawn, async (opts: any) => terminalManager.spawn(opts));

  // Forward CoreDaemon canvas placement events to renderer
  supervisor.on('placeNode', (payload: any) => {
    const win = getWin();
    if (win && !win.isDestroyed()) {
      win.webContents.send('maestri:canvas:nodePlaced', payload);
    }
  });

  supervisor.on('cableTieCreated', (payload: any) => {
    const win = getWin();
    if (win && !win.isDestroyed()) {
      win.webContents.send('maestri:canvas:cableTieCreated', payload);
    }
  });

  ipcMain.on('maestri:canvas:sync', (_event, payload: any) => {
    supervisor.syncCanvas(payload);
  });

  ipcMain.on(C.terminalWrite, (_event, terminalId: string, data: string) => {
    terminalManager.write(terminalId, data);
  });
  handle(C.terminalWrite, async (terminalId: string, data: string) => {
    terminalManager.write(terminalId, data);
    return { ok: true };
  });

  ipcMain.on(C.terminalMarkSeen, (_event, terminalId: string) => {
    terminalManager.markSeen(terminalId);
  });
  ipcMain.on(C.terminalSetFocused, (_event, terminalId: string) => {
    terminalManager.setFocused(terminalId);
  });
  handle(C.terminalDims, (terminalId: string) => terminalManager.dims(terminalId));
  handle(C.terminalResize, (terminalId: string, cols: number, rows: number) => {
    terminalManager.resize(terminalId, cols, rows);
    return { ok: true };
  });
  handle(C.terminalKill, (terminalId: string) => {
    terminalManager.kill(terminalId);
    return { ok: true };
  });
  handle(C.terminalRestart, async (terminalId: string) => {
    await terminalManager.restart(terminalId);
    return { ok: true };
  });
  handle(C.terminalGetScrollback, (terminalId: string) => terminalManager.getScrollback(terminalId));
  handle(C.terminalMarkSeen, (terminalId: string) => {
    terminalManager.markSeen(terminalId);
    return { ok: true };
  });
  handle(C.terminalSetFocused, (terminalId: string) => {
    terminalManager.setFocused(terminalId);
    return { ok: true };
  });
  handle(C.terminalDeliverPrompt, async (terminalId: string, prompt: string) => {
    return terminalManager.deliverPrompt(terminalId, prompt);
  });
  handle(C.terminalProcessList, async (terminalId: string) => {
    return supervisor.terminalProcessList(terminalId);
  });
  handle(C.terminalProcessStop, async (terminalId: string, pid: number) => {
    return supervisor.terminalProcessStop(terminalId, pid);
  });

  // Forward terminal manager events to renderer
  terminalManager.on('data', ({ terminalId, data }) => {
    const win = getWin();
    if (win && !win.isDestroyed()) win.webContents.send(C.terminalOnData, terminalId, data);
  });
  terminalManager.on('exit', ({ terminalId, exitCode }) => {
    const win = getWin();
    if (win && !win.isDestroyed()) win.webContents.send(C.terminalOnExit, terminalId, exitCode);
  });
  terminalManager.on('status', ({ terminalId, status }) => {
    const win = getWin();
    if (win && !win.isDestroyed()) win.webContents.send(C.terminalOnStatus, terminalId, status);
  });

  // Notes
  handle(C.noteRead, async (workspaceId: string, noteId: string) => {
    const noteFile = path.join(dataService.getDataDir(), 'workspaces', workspaceId, 'notes', `${noteId}.md`);
    if (fs.existsSync(noteFile)) {
      return fs.promises.readFile(noteFile, 'utf-8');
    }
    return '';
  });
  handle(C.noteWrite, async (workspaceId: string, noteId: string, content: string) => {
    const noteFile = path.join(dataService.getDataDir(), 'workspaces', workspaceId, 'notes', `${noteId}.md`);
    await dataService.replaceFileAtomically(noteFile, content);
    return { ok: true };
  });
  handle(C.nodeDelete, async (nodeId: string) => {
    return { ok: true, deleted: nodeId };
  });

  // Routines
  handle(C.routineList, () => dataService.getRoutines());
  handle(C.routineCreate, async (routine: any) => {
    const routines = await dataService.getRoutines();
    routines.push(routine);
    await dataService.saveRoutines(routines);
    return { ok: true };
  });
  handle(C.routineUpdate, async (routine: any) => {
    const routines = await dataService.getRoutines();
    const idx = routines.findIndex(r => r.id === routine.id);
    if (idx !== -1) routines[idx] = routine;
    await dataService.saveRoutines(routines);
    return { ok: true };
  });
  handle(C.routineDelete, async (id: string) => {
    const routines = await dataService.getRoutines();
    const filtered = routines.filter(r => r.id !== id);
    await dataService.saveRoutines(filtered);
    return { ok: true };
  });
  handle(C.routineRunNow, async (id: string) => {
    const routines = await dataService.getRoutines();
    const r = routines.find(item => item.id === id);
    if (!r) return { ok: false, error: 'Routine not found' };

    let prompt = r.action?.command || (r as any).command || '';
    if (r.preRunScript) {
      try {
        const { stdout } = await require('util').promisify(require('child_process').exec)(r.preRunScript);
        prompt = prompt.replace('{{output}}', stdout.trim());
      } catch (e: any) {
        await dataService.appendRoutineHistory({ routineId: id, status: 'skippedByScript', error: e.message });
        return { ok: false, status: 'skippedByScript' };
      }
    }

    if (r.targetTerminalId) {
      await terminalManager.deliverPrompt(r.targetTerminalId, prompt);
    }
    await dataService.appendRoutineHistory({ routineId: id, status: 'success' });
    return { ok: true };
  });
  handle(C.routineHistory, () => dataService.getRoutineHistory());

  // License
  handle(C.licenseGet, () => dataService.getLicense());
  handle(C.licenseActivate, async (key: string) => {
    const doc = { type: 'license', isValid: true, key, activatedAt: new Date().toISOString() };
    await dataService.saveLicense(doc);
    return { ok: true };
  });
  handle(C.licenseDeactivate, async () => {
    const doc = { type: 'trial', isTrial: true, isValid: true, daysRemaining: 30 };
    await dataService.saveLicense(doc);
    return { ok: true };
  });

  // Spatial & Collision proxy via daemon
  handle(C.snapNode, async (context: any) => supervisor.snapNode(context));
  handle(C.tidyNode, async (request: any) => supervisor.tidyNode(request));

  // Clipboard
  handle(C.clipboardWriteImage, (dataUrl: string) => {
    const img = require('electron').nativeImage.createFromDataURL(dataUrl);
    clipboard.writeImage(img);
    return { ok: true };
  });

  // Data & Backups
  handle(C.dataExportBackup, (dest?: string) => dataService.exportBackup(dest));
  handle(C.dataImportBackup, (zipPath: string) => dataService.importBackup(zipPath));
  handle(C.dataStorageLocation, () => dataService.getDataDir());

  // Knowledge Graph (Graphify)
  handle('mindagentics:graphify:build', async (params: { target: string; isGitUrl?: boolean; branch?: string; directed?: boolean }) => {
    const target = params?.target?.trim() || '.';
    const directed = params?.directed !== false;
    let projectDir = target;

    if (params?.isGitUrl || target.startsWith('http://') || target.startsWith('https://')) {
      const cloneCmd = `graphify clone "${target}"` + (params.branch ? ` --branch "${params.branch}"` : '');
      const { stdout } = await execAsync(cloneCmd);
      const lines = stdout.trim().split(/\r?\n/);
      projectDir = lines[lines.length - 1] || target;
    }

    projectDir = path.resolve(projectDir);

    const graphifyCmd = `graphify "${projectDir}" ${directed ? '--directed' : ''}`;
    try {
      await execAsync(graphifyCmd, { cwd: projectDir });
    } catch (err: any) {
      const fallbackCmd = `${graphifyCmd} --code-only`;
      await execAsync(fallbackCmd, { cwd: projectDir });
    }

    const outDir = path.join(projectDir, 'graphify-out');
    const graphHtml = path.join(outDir, 'graph.html');
    const graphJson = path.join(outDir, 'graph.json');
    const graphReport = path.join(outDir, 'GRAPH_REPORT.md');

    if (!fs.existsSync(graphReport) || !fs.existsSync(graphHtml)) {
      try {
        await execAsync(`graphify cluster-only "${projectDir}" --no-label`, { cwd: projectDir });
      } catch {}
      if (!fs.existsSync(graphHtml) && fs.existsSync(graphJson)) {
        try {
          await execAsync(`graphify export html --graph "${graphJson}"`, { cwd: projectDir });
        } catch {}
      }
    }

    let reportText = '';
    if (fs.existsSync(graphReport)) {
      reportText = fs.readFileSync(graphReport, 'utf-8');
    }

    let nodesCount = 0;
    let edgesCount = 0;
    if (fs.existsSync(graphJson)) {
      try {
        const data = JSON.parse(fs.readFileSync(graphJson, 'utf-8'));
        nodesCount = data.nodes?.length || 0;
        edgesCount = (data.links || data.edges)?.length || 0;
      } catch {}
    }

    const projectName = path.basename(projectDir);
    const htmlUrl = 'file:///' + graphHtml.replace(/\\/g, '/');

    return {
      ok: true,
      projectName,
      projectDir,
      htmlUrl,
      graphHtmlPath: graphHtml,
      graphReportPath: graphReport,
      reportContent: reportText,
      nodesCount,
      edgesCount
    };
  });

  handle('mindagentics:graphify:check', async (dir: string) => {
    let curr = path.resolve(dir || process.cwd());
    for (let i = 0; i < 4; i++) {
      const rep = path.join(curr, 'graphify-out', 'GRAPH_REPORT.md');
      const html = path.join(curr, 'graphify-out', 'graph.html');
      const json = path.join(curr, 'graphify-out', 'graph.json');
      if (fs.existsSync(rep) && fs.existsSync(json)) {
        return {
          hasGraph: true,
          projectName: path.basename(curr),
          projectDir: curr,
          reportContent: fs.readFileSync(rep, 'utf-8'),
          htmlUrl: 'file:///' + html.replace(/\\/g, '/')
        };
      }
      const parent = path.dirname(curr);
      if (parent === curr) break;
      curr = parent;
    }
    return { hasGraph: false };
  });

  // Fallback handler for all remaining unhandled channels
  for (const [key, channel] of Object.entries(C)) {
    try {
      ipcMain.handle(channel as string, async () => {
        return { ok: true };
      });
    } catch {
      // Channel already has an explicit handler above - skip silently
    }
  }
}
