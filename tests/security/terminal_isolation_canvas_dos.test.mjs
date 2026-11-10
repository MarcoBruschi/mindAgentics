import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

describe('Security & QA Suite: Terminal Isolation, Visual DoS Protection & Webview Hardening', () => {

  // =========================================================================
  // 1. Terminal Isolation (xterm / node-pty)
  // =========================================================================
  describe('Vector 1: Terminal Isolation & PTY Signal Integrity', () => {
    const terminalNodePath = path.resolve('packages/renderer/src/components/nodes/TerminalNode.tsx');
    const content = fs.readFileSync(terminalNodePath, 'utf8');

    it('should intercept zoom shortcuts inside TerminalNode without emitting corrupt escape sequences to pty', () => {
      // Must have isZoomKey detection covering Ctrl++, Ctrl+=, Ctrl+-, Ctrl+NumpadAdd, etc.
      assert.ok(content.includes('isZoomKey'), 'TerminalNode must identify zoom keys in attachCustomKeyEventHandler');
      assert.ok(
        content.includes("arg.key === '+'") &&
        content.includes("arg.key === '='") &&
        content.includes("arg.key === '-'") &&
        content.includes("NumpadAdd") &&
        content.includes("NumpadSubtract"),
        'All zoom key permutations must be intercepted'
      );
      // Must return false to prevent xterm from forwarding \x1f or corrupt characters to node-pty
      assert.ok(
        /if\s*\(\s*isZoomKey\s*\)\s*\{\s*arg\.preventDefault\(\);\s*return\s+false;\s*\}/.test(content),
        'attachCustomKeyEventHandler must preventDefault and return false for zoom keys'
      );
    });

    it('should ensure crucial terminal shortcuts (Ctrl+C, Ctrl+D, Ctrl+Z, Ctrl+L) pass cleanly to the shell', () => {
      // Ctrl+C with selection copies, without selection passes through (SIGINT)
      assert.ok(
        content.includes("term.hasSelection()") && content.includes("return true;"),
        'Ctrl+C must pass through to the shell when no text is selected'
      );

      // Crucial shortcuts verification
      assert.ok(
        content.includes("key === 'c' || key === 'd' || key === 'z' || key === 'l'"),
        'Ctrl+C, Ctrl+D, Ctrl+Z, and Ctrl+L must be explicitly allowed through to node-pty'
      );
    });

    it('should verify canvas and app shortcuts do not steal Ctrl+L, Ctrl+C, or Ctrl+Z when terminal is focused', () => {
      const keyboardUtilsPath = path.resolve('packages/renderer/src/utils/keyboard.ts');
      const kbContent = fs.readFileSync(keyboardUtilsPath, 'utf8');
      assert.ok(
        kbContent.includes('xterm-helper-textarea') && kbContent.includes('.xterm'),
        'isInputOrEditable must identify active terminal focus'
      );

      const appPath = path.resolve('packages/renderer/src/App.tsx');
      const appContent = fs.readFileSync(appPath, 'utf8');
      assert.ok(
        appContent.includes('if (inInput) return;'),
        'App.tsx global undo (Ctrl+Z) must yield when inside active terminal'
      );
    });
  });

  // =========================================================================
  // 2. Protection Against Visual DoS & GPU Exhaustion
  // =========================================================================
  describe('Vector 2: Visual DoS Protection & Bounded Zoom Constraints', () => {
    const layoutPath = path.resolve('packages/renderer/src/utils/layout.ts');
    const layoutContent = fs.readFileSync(layoutPath, 'utf8');
    const canvasPath = path.resolve('packages/renderer/src/components/canvas/InfiniteCanvas.tsx');
    const canvasContent = fs.readFileSync(canvasPath, 'utf8');
    const gridPath = path.resolve('packages/renderer/src/components/canvas/GridBackground.tsx');
    const gridContent = fs.readFileSync(gridPath, 'utf8');

    it('should strictly clamp zoom values between 0.1 and 3.0 in zoomAtPoint', () => {
      assert.ok(
        layoutContent.includes('Math.min(3.0, Math.max(0.1,'),
        'zoomAtPoint must clamp zoom strictly to [0.1, 3.0]'
      );
      assert.ok(
        layoutContent.includes('Number.isFinite'),
        'zoomAtPoint must guard against NaN and Infinity'
      );
    });

    it('should prevent infinite re-renders and GPU thrashing on continuous keydown repeat at limits', () => {
      assert.ok(
        canvasContent.includes('Math.abs(currentZoom - clampedZoom) < 0.001') ||
        canvasContent.includes('return prev;'),
        'InfiniteCanvas must return previous state without re-rendering when clamped boundary is hit'
      );
    });

    it('should ensure GridBackground handles edge cases without NaN, 0px, or Infinity rasterization', () => {
      assert.ok(
        gridContent.includes('React.memo'),
        'GridBackground should be memoized to prevent redundant renders'
      );
      assert.ok(
        gridContent.includes('Number.isFinite'),
        'GridBackground must sanitize offset and zoom against non-finite values'
      );
      assert.ok(
        gridContent.includes('Math.max(2.4,'),
        'GridBackground dotSpacing must never be zero or negative'
      );
    });
  });

  // =========================================================================
  // 3. Webview & PortalNode Security Isolation
  // =========================================================================
  describe('Vector 3: Webview & PortalNode Isolation', () => {
    const mainPath = path.resolve('packages/main/src/index.ts');
    const mainContent = fs.readFileSync(mainPath, 'utf8');
    const kbPath = path.resolve('packages/renderer/src/utils/keyboard.ts');
    const kbContent = fs.readFileSync(kbPath, 'utf8');

    it('should enforce strict contextIsolation and disable nodeIntegration on any attached webview', () => {
      assert.ok(
        mainContent.includes('will-attach-webview'),
        'Main process must register will-attach-webview security listener'
      );
      assert.ok(
        mainContent.includes('webPreferences.nodeIntegration = false') &&
        mainContent.includes('webPreferences.contextIsolation = true') &&
        mainContent.includes('webPreferences.sandbox = true'),
        'will-attach-webview must enforce contextIsolation, sandbox, and disable nodeIntegration'
      );
    });

    it('should isolate keyboard focus in webviews and iframes from triggering canvas tool shortcuts', () => {
      assert.ok(
        kbContent.includes("tag === 'IFRAME'") && kbContent.includes("tag === 'WEBVIEW'"),
        'isInputOrEditable must recognize IFRAME and WEBVIEW tags'
      );
      assert.ok(
        kbContent.includes(".closest?.('iframe')") && kbContent.includes(".closest?.('webview')"),
        'isInputOrEditable must protect nested elements in embedded portals'
      );
    });
  });

  // =========================================================================
  // 4. Homologation: Zoom Keys & 100% UI Chrome Crispness
  // =========================================================================
  describe('Vector 4: Homologation of Master Zoom & Crisp UI', () => {
    const mainPath = path.resolve('packages/main/src/index.ts');
    const mainContent = fs.readFileSync(mainPath, 'utf8');
    const canvasPath = path.resolve('packages/renderer/src/components/canvas/InfiniteCanvas.tsx');
    const canvasContent = fs.readFileSync(canvasPath, 'utf8');

    it('should disable Chromium native webFrame zoom across all webContents', () => {
      assert.ok(
        mainContent.includes('setVisualZoomLevelLimits(1, 1)'),
        'Electron main must lock visual zoom limits to (1, 1)'
      );
      assert.ok(
        mainContent.includes("contents.on('zoom-changed'"),
        'zoom-changed event must be intercepted and reset to level 0'
      );
    });

    it('should homologate all designated zoom shortcut combinations in canvas pipeline', () => {
      assert.ok(
        canvasContent.includes("e.key === '='") &&
        canvasContent.includes("e.key === '+'") &&
        canvasContent.includes("e.code === 'NumpadAdd'"),
        'Must support Ctrl++, Ctrl+=, Ctrl+NumpadAdd'
      );
      assert.ok(
        canvasContent.includes("e.key === '-'") &&
        canvasContent.includes("e.key === '_'") &&
        canvasContent.includes("e.code === 'NumpadSubtract'"),
        'Must support Ctrl+-, Ctrl+_, Ctrl+NumpadSubtract'
      );
      assert.ok(
        canvasContent.includes("e.key === '0'") &&
        canvasContent.includes("e.code === 'Numpad0'"),
        'Must support Ctrl+0, Ctrl+Numpad0'
      );
    });

    it('should keep TitleBar and UI chrome independent of canvas transform scale', () => {
      const appPath = path.resolve('packages/renderer/src/App.tsx');
      const appContent = fs.readFileSync(appPath, 'utf8');

      // TitleBar and Sidebar are siblings outside InfiniteCanvas
      assert.ok(
        appContent.includes('<TitleBar />') && appContent.includes('<InfiniteCanvas />'),
        'TitleBar must be outside InfiniteCanvas to remain crisp at 100% scale'
      );
      assert.ok(
        canvasContent.includes('scale(${offset.zoom})'),
        'Scale must apply strictly to canvas transform container, leaving window chrome untouched'
      );
    });
  });
});
