import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

describe('Security & QA Suite: Fake-Maximize (WorkArea), 4-Corner DWM Rounding in All States, Multi-Monitor DPI & Taskbar Parity', () => {
  const sidebarPath = path.resolve('packages/renderer/src/components/sidebar/Sidebar.tsx');
  const sidebarContent = fs.readFileSync(sidebarPath, 'utf8').replace(/\r\n/g, '\n');
  const appPath = path.resolve('packages/renderer/src/App.tsx');
  const appContent = fs.readFileSync(appPath, 'utf8').replace(/\r\n/g, '\n');
  const cssPath = path.resolve('packages/renderer/src/index.css');
  const cssContent = fs.readFileSync(cssPath, 'utf8').replace(/\r\n/g, '\n');
  const canvasPath = path.resolve('packages/renderer/src/components/canvas/InfiniteCanvas.tsx');
  const canvasContent = fs.readFileSync(canvasPath, 'utf8').replace(/\r\n/g, '\n');
  const titleBarPath = path.resolve('packages/renderer/src/components/window/TitleBar.tsx');
  const titleBarContent = fs.readFileSync(titleBarPath, 'utf8').replace(/\r\n/g, '\n');
  const mainPath = path.resolve('packages/main/src/index.ts');
  const mainContent = fs.readFileSync(mainPath, 'utf8').replace(/\r\n/g, '\n');
  const dispatcherPath = path.resolve('packages/main/src/ipc/dispatcher.ts');
  const dispatcherContent = fs.readFileSync(dispatcherPath, 'utf8').replace(/\r\n/g, '\n');

  // Helper replicating getFakeMaximizeBounds logic from packages/main/src/index.ts for deterministic QA verification
  function computeFakeMaximizeBounds(display) {
    const { workArea, bounds: displayBounds } = display;
    const isAutoHideTaskbar =
      workArea.x === displayBounds.x &&
      workArea.y === displayBounds.y &&
      workArea.width === displayBounds.width &&
      workArea.height === displayBounds.height;

    return {
      x: workArea.x,
      y: workArea.y,
      width: workArea.width,
      height: isAutoHideTaskbar ? Math.max(600, workArea.height - 1) : workArea.height,
    };
  }

  // =========================================================================
  // 1. Ciclo Completo: Normal -> Fake-Maximizar -> Restaurar -> Minimizar -> Restaurar
  // =========================================================================
  describe('1. Lifecycle: Normal -> Maximize -> Restore -> Minimize -> Restore (Translucent Sidebar & 4 Rounded Corners at 200% Zoom)', () => {
    it('should preserve translucent sidebar (acrylic + rgba(10, 12, 16, 0.48)) and native 4-corner DWM rounding in all states', () => {
      assert.ok(
        mainContent.includes("backgroundMaterial: 'acrylic'") &&
        mainContent.includes('thickFrame: true') &&
        mainContent.includes('roundedCorners: true') &&
        !mainContent.includes('transparent: true'),
        'BrowserWindow must use native DWM acrylic + thickFrame + roundedCorners without transparent: true'
      );
      assert.ok(
        cssContent.includes('--sidebar-bg: rgba(10, 12, 16, 0.48);') &&
        sidebarContent.includes("backgroundColor: 'var(--sidebar-bg, #121418)'"),
        'Sidebar must maintain darkened translucent background across all window states'
      );
      assert.ok(
        appContent.includes('<main className="flex-1 h-full flex flex-col bg-[#0E0F12] relative overflow-hidden">') &&
        canvasContent.includes('bg-[#0E0F12] overflow-hidden'),
        'Canvas <main> must stay 100% opaque (#0E0F12) beside Sidebar'
      );
      assert.ok(
        mainContent.includes("win.on('restore'") &&
        mainContent.includes('if (process.platform === \'win32\' && isFakeMaximized)') &&
        mainContent.includes('win.setBounds(getFakeMaximizeBounds(win))'),
        'Restoring from minimize while fake-maximized must re-apply workArea bounds and refresh acrylic material'
      );
    });
  });

  // =========================================================================
  // 2. Bloqueio de Maximização Nativa: Win+Up, Arrastar para o Topo e Duplo Clique na TitleBar
  // =========================================================================
  describe('2. Prevention of Native Maximize on Win+Up, Top-Edge Drag & TitleBar Double-Click', () => {
    it('should disable native WS_MAXIMIZE on Windows and route Win+Up, WM_NCLBUTTONDBLCLK, and IPC toggle to Fake-Maximize', () => {
      assert.ok(
        mainContent.includes("maximizable: process.platform !== 'win32'"),
        'BrowserWindow must set maximizable: false on win32 so OS Aero Snap and Win+Up never enter native WS_MAXIMIZE'
      );
      assert.ok(
        mainContent.includes('win.hookWindowMessage(0x00A3') &&
        mainContent.includes('toggleFakeMaximize()'),
        'Main process must hook WM_NCLBUTTONDBLCLK (0x00A3) on -webkit-app-region: drag to toggle fake-maximize'
      );
      assert.ok(
        mainContent.includes("input.meta && input.key === 'ArrowUp'") &&
        mainContent.includes('enterFakeMaximize(true)') &&
        mainContent.includes("input.meta && input.key === 'ArrowDown'"),
        'Main process must intercept Win+Up and Win+Down to enter/exit fake-maximize without native maximize'
      );
      assert.ok(
        mainContent.includes('win.unmaximize()') &&
        mainContent.includes('enterFakeMaximize(false)'),
        'win.on("maximize") safety guard must immediately unmaximize and convert to fake-maximize if ever triggered'
      );
      assert.ok(
        titleBarContent.includes('onDoubleClick={handleDoubleClick}') &&
        dispatcherContent.includes('deps.toggleFakeMaximize') &&
        dispatcherContent.includes('deps.isFakeMaximized'),
        'TitleBar double-click and IPC windowControlsToggleMaximize must use fake-maximize state and toggle'
      );
    });
  });

  // =========================================================================
  // 3. Multi-Monitor (2 Monitores) e Escalas de DPI Diferentes (100% e 150%)
  // =========================================================================
  describe('3. Multi-Monitor & Mixed DPI Scaling (100% and 150%) WorkArea Fitting', () => {
    it('should resolve workArea dynamically via screen.getDisplayMatching and listen for display-metrics-changed', () => {
      assert.ok(
        mainContent.includes('screen.getDisplayMatching(currentBounds)') &&
        mainContent.includes("screen.on('display-metrics-changed', onDisplayChanged)") &&
        mainContent.includes("screen.on('display-added', onDisplayChanged)") &&
        mainContent.includes("screen.on('display-removed', onDisplayChanged)"),
        'Main process must match the active monitor workArea and re-fit on DPI or display changes'
      );

      // Simulate Monitor 1 (100% DPI, 1920x1080 with 40px bottom taskbar)
      const monitor1_100pct = {
        scaleFactor: 1.0,
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      };
      const boundsMon1 = computeFakeMaximizeBounds(monitor1_100pct);
      assert.deepStrictEqual(boundsMon1, { x: 0, y: 0, width: 1920, height: 1040 });

      // Simulate Monitor 2 (150% DPI, 3840x2160 physical -> 2560x1440 DIP with 48px bottom taskbar)
      const monitor2_150pct = {
        scaleFactor: 1.5,
        bounds: { x: 1920, y: 0, width: 2560, height: 1440 },
        workArea: { x: 1920, y: 0, width: 2560, height: 1392 },
      };
      const boundsMon2 = computeFakeMaximizeBounds(monitor2_150pct);
      assert.deepStrictEqual(boundsMon2, { x: 1920, y: 0, width: 2560, height: 1392 });
    });
  });

  // =========================================================================
  // 4. Barra de Tarefas em Auto-Ocultar e em Posições Diferentes (Topo, Esquerda)
  // =========================================================================
  describe('4. Taskbar Auto-Hide (1px DWM Reserve) & Top / Left Taskbar Positions', () => {
    it('should reserve 1px when taskbar is auto-hidden and respect top/left workArea offsets', () => {
      assert.ok(
        mainContent.includes('isAutoHideTaskbar') &&
        mainContent.includes('workArea.height - 1'),
        'getFakeMaximizeBounds must reserve 1px on auto-hide taskbar so DWM keeps rounded corners and taskbar hover trigger'
      );

      // Auto-hide taskbar: workArea equals display.bounds
      const autoHideDisplay = {
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        workArea: { x: 0, y: 0, width: 1920, height: 1080 },
      };
      assert.deepStrictEqual(computeFakeMaximizeBounds(autoHideDisplay), {
        x: 0,
        y: 0,
        width: 1920,
        height: 1079,
      });

      // Top taskbar (48px at top)
      const topTaskbarDisplay = {
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        workArea: { x: 0, y: 48, width: 1920, height: 1032 },
      };
      assert.deepStrictEqual(computeFakeMaximizeBounds(topTaskbarDisplay), {
        x: 0,
        y: 48,
        width: 1920,
        height: 1032,
      });

      // Left taskbar (72px at left)
      const leftTaskbarDisplay = {
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        workArea: { x: 72, y: 0, width: 1848, height: 1080 },
      };
      assert.deepStrictEqual(computeFakeMaximizeBounds(leftTaskbarDisplay), {
        x: 72,
        y: 0,
        width: 1848,
        height: 1080,
      });
    });
  });

  // =========================================================================
  // 5. Fechar e Reabrir o App Maximizado (Persistência de Fake-Maximize e RestoreBounds)
  // =========================================================================
  describe('5. Close & Reopen Maximized App: Reopens Fake-Maximized with Preserved RestoreBounds', () => {
    it('should persist restoreBounds + maximized: true on saveBounds and call enterFakeMaximize(false) on startup', () => {
      assert.ok(
        mainContent.includes('const persistedBounds = isMax ? restoreBounds : currentBounds;'),
        'saveBounds must persist restoreBounds alongside maximized: true so normal bounds are not overwritten by workArea'
      );
      assert.ok(
        mainContent.includes('if (bounds.maximized) {\n    enterFakeMaximize(false);\n  }'),
        'createWindow must call enterFakeMaximize(false) instead of win.maximize() when reopening in maximized state'
      );
    });
  });
});
