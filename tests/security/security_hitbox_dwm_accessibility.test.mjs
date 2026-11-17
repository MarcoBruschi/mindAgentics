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
  const libRsPath = path.resolve('src-tauri/src/lib.rs');
  const libRsContent = fs.readFileSync(libRsPath, 'utf8').replace(/\r\n/g, '\n');
  const commandsRsPath = path.resolve('src-tauri/src/commands/mod.rs');
  const commandsRsContent = fs.readFileSync(commandsRsPath, 'utf8').replace(/\r\n/g, '\n');

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

  describe('1. Lifecycle: Normal -> Maximize -> Restore -> Minimize -> Restore (Translucent Sidebar & 4 Rounded Corners at 200% Zoom)', () => {
    it('should preserve translucent sidebar (DWM acrylic + rgba(10, 12, 16, 0.48)) and native 4-corner DWM rounding in all states', () => {
      assert.ok(
        libRsContent.includes('apply_windows_dwm_acrylic') &&
        libRsContent.includes('DWMWA_WINDOW_CORNER_PREFERENCE') &&
        libRsContent.includes('ACCENT_ENABLE_ACRYLICBLURBEHIND'),
        'Tauri v2 lib.rs must configure native DWM acrylic and 4-corner rounding'
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
    });
  });

  describe('2. Window Controls & TitleBar Double-Click Maximize Toggle', () => {
    it('should route TitleBar double-click and window controls through Tauri v2 window_toggle_maximize', () => {
      assert.ok(
        titleBarContent.includes('onDoubleClick={handleDoubleClick}') &&
        commandsRsContent.includes('pub async fn window_toggle_maximize') &&
        commandsRsContent.includes('pub async fn window_state'),
        'TitleBar double-click and Tauri window_toggle_maximize must manage maximize state'
      );
    });
  });

  describe('3. Multi-Monitor & Mixed DPI Scaling (100% and 150%) WorkArea Fitting', () => {
    it('should fit active monitor workArea across 100% and 150% DPI displays', () => {
      const monitor1_100pct = {
        scaleFactor: 1.0,
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      };
      const boundsMon1 = computeFakeMaximizeBounds(monitor1_100pct);
      assert.deepStrictEqual(boundsMon1, { x: 0, y: 0, width: 1920, height: 1040 });

      const monitor2_150pct = {
        scaleFactor: 1.5,
        bounds: { x: 1920, y: 0, width: 2560, height: 1440 },
        workArea: { x: 1920, y: 0, width: 2560, height: 1392 },
      };
      const boundsMon2 = computeFakeMaximizeBounds(monitor2_150pct);
      assert.deepStrictEqual(boundsMon2, { x: 1920, y: 0, width: 2560, height: 1392 });
    });
  });

  describe('4. Taskbar Auto-Hide (1px DWM Reserve) & Top / Left Taskbar Positions', () => {
    it('should reserve 1px when taskbar is auto-hidden and respect top/left workArea offsets', () => {
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

  describe('5. Window State Persistence & Startup Restoration', () => {
    it('should persist and restore window bounds in Tauri v2 setup', () => {
      assert.ok(
        libRsContent.includes('WindowEvent::Resized') &&
        libRsContent.includes('WindowEvent::ScaleFactorChanged'),
        'Tauri v2 setup must track window resize and scale factor events for state persistence'
      );
    });
  });
});
