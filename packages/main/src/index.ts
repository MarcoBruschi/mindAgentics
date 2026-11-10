import { app, BrowserWindow, session } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { IPC_CHANNELS as C } from '@mindagentics/shared';
import { DataService } from './storage/dataService.js';
import { CoreDaemonSupervisor } from './supervisor/coreDaemonSupervisor.js';
import { TerminalManager } from './terminal/terminalManager.js';
import { GitWorktreeService } from './git/gitWorktreeService.js';
import { GraphifyService } from './graphify/graphifyService.js';
import { registerIpcDispatcher } from './ipc/dispatcher.js';

let mainWindow: BrowserWindow | null = null;
const dataService = new DataService();
const supervisor = new CoreDaemonSupervisor();
const terminalManager = new TerminalManager(supervisor, dataService);
const gitService = new GitWorktreeService();
const graphifyService = new GraphifyService();

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

function getWindowMaterial(): 'acrylic' | 'vibrancy' | null {
  if (process.platform === 'darwin') {
    return 'vibrancy';
  }
  if (process.platform === 'win32') {
    try {
      const release = os.release();
      const build = Number.parseInt(release.split('.')[2] ?? '', 10);
      if (Number.isFinite(build) && build >= 22621) {
        return 'acrylic';
      }
    } catch {
      // fallback
    }
  }
  return null;
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
  const material = getWindowMaterial();

  const win = new BrowserWindow({
    title: 'mindAgentics',
    x: bounds.x,
    y: bounds.y,
    width: bounds.width || 1280,
    height: bounds.height || 800,
    minWidth: 900,
    minHeight: 600,
    resizable: true,
    movable: true,
    minimizable: true,
    maximizable: true,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    trafficLightPosition: { x: 14, y: 14 },
    backgroundColor: material ? '#00000000' : '#0f1012',
    ...(material === 'acrylic' ? { backgroundMaterial: 'acrylic' } : {}),
    ...(material === 'vibrancy' ? { vibrancy: 'sidebar' } : {}),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true
    }
  });

  // Disable native visual zoom on window creation
  win.webContents.setVisualZoomLevelLimits(1, 1);

  let activeRefreshTimers: NodeJS.Timeout[] = [];
  const clearRefreshTimers = () => {
    for (const t of activeRefreshTimers) {
      clearTimeout(t);
    }
    activeRefreshTimers = [];
  };

  const refreshMaterial = (isMaximizedState?: boolean) => {
    if (win.isDestroyed() || win.isMinimized()) return;

    // Force transparent background before reapplying material to avoid losing alpha channel
    try {
      win.setBackgroundColor('#00000000');
    } catch {}

    if (material && process.platform === 'win32') {
      clearRefreshTimers();
      // Retain the native window material (e.g. acrylic) consistently across maximized/restored states
      // Switching to 'mica' on maximize strips transparency and causes opaque gray backgrounds.
      const targetMaterial = material;

      const apply = () => {
        if (!win.isDestroyed() && !win.isMinimized()) {
          try {
            win.setBackgroundColor('#00000000');
            if ((win as any).setBackgroundMaterial) {
              try {
                (win as any).setBackgroundMaterial(targetMaterial);
              } catch {
                (win as any).setBackgroundMaterial(material);
              }
            }
          } catch (e) {
            console.warn('[refreshMaterial] Failed to apply material:', e);
          }
        }
      };

      // Direct apply without stripping material with 'none'
      apply();
      activeRefreshTimers.push(setTimeout(apply, 50));
      activeRefreshTimers.push(setTimeout(apply, 150));
      activeRefreshTimers.push(setTimeout(apply, 300));
    } else if (material && process.platform === 'darwin') {
      try {
        if ((win as any).setVibrancy) {
          (win as any).setVibrancy('sidebar');
        }
      } catch (e) {
        console.warn('[refreshMaterial] Failed to apply vibrancy:', e);
      }
    }
  };

  const sendWindowControlsChanged = () => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send(C.windowControlsOnChanged, {
        isMaximized: win.isMaximized(),
        isFullScreen: win.isFullScreen(),
        isMinimized: win.isMinimized()
      });
    }
  };

  if (bounds.maximized) {
    win.maximize();
    win.setBackgroundColor('#00000000');
    refreshMaterial(true);
    sendWindowControlsChanged();
  }

  let boundsSaveTimer: NodeJS.Timeout | null = null;
  const saveBounds = () => {
    if (!win.isDestroyed()) {
      const isMax = win.isMaximized();
      const isFull = win.isFullScreen();
      const currentBounds = win.getBounds();

      sendWindowControlsChanged();

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

  win.on('resize', () => {
    saveBounds();
    refreshMaterial();
  });
  win.on('move', saveBounds);
  win.on('maximize', () => {
    sendWindowControlsChanged();
    saveBounds();
    win.setBackgroundColor('#00000000');
    refreshMaterial(true);
  });
  win.on('unmaximize', () => {
    sendWindowControlsChanged();
    saveBounds();
    win.setBackgroundColor('#00000000');
    refreshMaterial(false);
  });
  win.on('minimize', () => {
    sendWindowControlsChanged();
    saveBounds();
    clearRefreshTimers();
  });
  win.on('restore', () => {
    sendWindowControlsChanged();
    saveBounds();
    win.setBackgroundColor('#00000000');
    refreshMaterial();
  });
  win.on('show', () => {
    sendWindowControlsChanged();
    saveBounds();
    win.setBackgroundColor('#00000000');
    refreshMaterial();
  });
  win.on('enter-full-screen', () => {
    sendWindowControlsChanged();
    saveBounds();
    win.setBackgroundColor('#00000000');
    refreshMaterial();
  });
  win.on('leave-full-screen', () => {
    sendWindowControlsChanged();
    saveBounds();
    win.setBackgroundColor('#00000000');
    refreshMaterial();
  });

  win.once('ready-to-show', () => {
    win.setBackgroundColor('#00000000');
    refreshMaterial();
  });

  win.on('closed', () => {
    mainWindow = null;
  });

  // Support F11 and Alt+Enter for native Fullscreen toggle
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown') {
      if (input.key === 'F11' || (input.alt && input.key === 'Enter')) {
        event.preventDefault();
        win.setFullScreen(!win.isFullScreen());
        sendWindowControlsChanged();
      }
    }
  });

  // Lock zoom levels and intercept zoom-changed attempts
  win.webContents.on('did-finish-load', () => {
    win.webContents.setZoomLevel(0);
    win.webContents.setVisualZoomLevelLimits(1, 1);
    win.setBackgroundColor('#00000000');
    refreshMaterial();
  });

  win.webContents.on('zoom-changed', (event) => {
    event.preventDefault();
    win.webContents.setZoomLevel(0);
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
      win.loadURL(`data:text/html;charset=utf-8,<html><body style="background:%230b0f17;color:white;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;"><h1>mindAgentics Ready</h1></body></html>`);
    });
  }

  return win;
}

if (process.platform === 'win32') {
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  // Prevent DWM direct composition visual tree destruction during window minimize/maximize
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
}

if (app && typeof app.whenReady === 'function') {
  app.whenReady().then(async () => {
    // Webview & Guest WebContents Isolation Policy
    app.on('web-contents-created', (_event, contents) => {
      // Strict isolation for any guest webviews attached
      contents.on('will-attach-webview', (_waEvent, webPreferences, _params) => {
        delete webPreferences.preload;
        webPreferences.nodeIntegration = false;
        webPreferences.nodeIntegrationInSubFrames = false;
        webPreferences.contextIsolation = true;
        webPreferences.sandbox = true;
        webPreferences.webSecurity = true;
      });

      // Strict visual zoom lock: guarantee all windows and webviews stay at 100% crispness
      try {
        contents.setVisualZoomLevelLimits(1, 1);
        contents.on('zoom-changed', (event) => {
          event.preventDefault();
          contents.setZoomLevel(0);
        });
      } catch {}
    });

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
      gitService,
      graphifyService
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
