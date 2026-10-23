import { app, BrowserWindow, session } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { IPC_CHANNELS as C } from '@maestri/shared';
import { DataService } from './storage/dataService.js';
import { CoreDaemonSupervisor } from './supervisor/coreDaemonSupervisor.js';
import { TerminalManager } from './terminal/terminalManager.js';
import { GitWorktreeService } from './git/gitWorktreeService.js';
import { registerIpcDispatcher } from './ipc/dispatcher.js';

let mainWindow: BrowserWindow | null = null;
const dataService = new DataService();
const supervisor = new CoreDaemonSupervisor();
const terminalManager = new TerminalManager(supervisor, dataService);
const gitService = new GitWorktreeService();

function resolvePreloadPath(): string {
  const candidates = [
    path.resolve(__dirname, '../../preload/dist/index.js'),
    path.resolve(__dirname, '../../../preload/dist/index.js'),
    path.resolve(process.cwd(), 'packages/preload/dist/index.js'),
    path.resolve(process.cwd(), 'clone/packages/preload/dist/index.js')
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

async function createWindow(): Promise<BrowserWindow> {
  await dataService.initLayout();
  const appStateDoc = await dataService.getAppState();
  const bounds = appStateDoc.payload?.windowBounds || {
    x: 100,
    y: 100,
    width: 1280,
    height: 800,
    maximized: false,
    fullScreen: false
  };

  const preloadPath = resolvePreloadPath();

  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width || 1280,
    height: bounds.height || 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 14, y: 14 },
    backgroundColor: '#0f1012',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true
    }
  });

  if (bounds.maximized) {
    win.maximize();
  }

  let boundsSaveTimer: NodeJS.Timeout | null = null;
  const saveBounds = () => {
    if (!win.isDestroyed()) {
      const isMax = win.isMaximized();
      const isFull = win.isFullScreen();
      const currentBounds = win.getBounds();

      win.webContents.send(C.windowControlsOnChanged, {
        isMaximized: isMax,
        isFullScreen: isFull,
        isMinimized: win.isMinimized()
      });

      if (boundsSaveTimer) {
        clearTimeout(boundsSaveTimer);
      }
      boundsSaveTimer = setTimeout(() => {
        dataService.saveAppState({
          windowBounds: {
            x: currentBounds.x,
            y: currentBounds.y,
            width: currentBounds.width,
            height: currentBounds.height,
            maximized: isMax,
            fullScreen: isFull
          }
        }).catch((err) => {
          console.warn('[saveAppState] Debounced save failed:', err);
        });
      }, 300);
    }
  };

  win.on('resize', saveBounds);
  win.on('move', saveBounds);
  win.on('maximize', saveBounds);
  win.on('unmaximize', saveBounds);

  win.on('closed', () => {
    mainWindow = null;
  });

  // Forward renderer console and errors to terminal
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log('[Renderer console]', level, message, sourceId, line);
  });
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('[Renderer load failed]', errorCode, errorDescription, validatedURL);
  });

  // Load renderer
  const rendererIndex = path.resolve(__dirname, '../../renderer/dist/index.html');
  if (fs.existsSync(rendererIndex)) {
    win.loadFile(rendererIndex);
  } else {
    // Attempt local dev server fallback
    win.loadURL('http://localhost:5173').catch(() => {
      // If dev server not yet running, load basic splash html
      win.loadURL(`data:text/html;charset=utf-8,<html><body style="background:%230b0f17;color:white;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;"><h1>Maestri Ready</h1></body></html>`);
    });
  }

  return win;
}

if (app && typeof app.whenReady === 'function') {
  app.whenReady().then(async () => {
    // Strip X-Frame-Options and frame-ancestors CSP so portal nodes can embed external URLs
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      const responseHeaders = { ...(details.responseHeaders || {}) };
      for (const key of Object.keys(responseHeaders)) {
        const lower = key.toLowerCase();
        if (lower === 'x-frame-options' || lower === 'content-security-policy') {
          delete responseHeaders[key];
        }
      }
      callback({ cancel: false, responseHeaders });
    });

    mainWindow = await createWindow();

    // Start CoreDaemon
    await supervisor.start().catch((err) => {
      console.warn('[CoreDaemon startup]', err);
    });

    // Register all 470 IPC channels
    registerIpcDispatcher({
      mainWindow,
      dataService,
      supervisor,
      terminalManager,
      gitService
    });

    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = await createWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', async () => {
    terminalManager.killAll();
    supervisor.stop();
    await dataService.saveAppState({ cleanShutdown: true });
  });
}

export { dataService, supervisor, terminalManager, gitService };
