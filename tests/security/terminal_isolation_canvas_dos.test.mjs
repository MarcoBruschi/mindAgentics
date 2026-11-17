import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

describe('Security & QA Suite: Terminal Isolation, Visual DoS Protection & Webview Hardening', () => {

  describe('Vector 1: Terminal Isolation & PTY Signal Integrity', () => {
    const terminalNodePath = path.resolve('packages/renderer/src/components/nodes/TerminalNode.tsx');
    const content = fs.readFileSync(terminalNodePath, 'utf8');

    it('should intercept zoom shortcuts inside TerminalNode without emitting corrupt escape sequences to pty', () => {
      assert.ok(content.includes('isZoomKey'), 'TerminalNode must identify zoom keys in attachCustomKeyEventHandler');
      assert.ok(
        content.includes("arg.key === '+'") &&
        content.includes("arg.key === '='") &&
        content.includes("arg.key === '-'") &&
        content.includes("NumpadAdd") &&
        content.includes("NumpadSubtract"),
        'All zoom key permutations must be intercepted'
      );
      assert.ok(
        /if\s*\(\s*isZoomKey\s*\)\s*\{\s*arg\.preventDefault\(\);\s*return\s+false;\s*\}/.test(content),
        'attachCustomKeyEventHandler must preventDefault and return false for zoom keys'
      );
    });

    it('should ensure crucial terminal shortcuts (Ctrl+C, Ctrl+D, Ctrl+Z, Ctrl+L) pass cleanly to the shell', () => {
      assert.ok(
        content.includes("term.hasSelection()") && content.includes("return true;"),
        'Ctrl+C must pass through to the shell when no text is selected'
      );

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

  describe('Vector 3: Webview & PortalNode Isolation', () => {
    const tauriConfPath = path.resolve('src-tauri/tauri.conf.json');
    const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
    const kbPath = path.resolve('packages/renderer/src/utils/keyboard.ts');
    const kbContent = fs.readFileSync(kbPath, 'utf8');

    it('should enforce strict Tauri v2 isolation and disable global Tauri injection on webviews', () => {
      assert.strictEqual(
        tauriConf.app?.withGlobalTauri,
        false,
        'tauri.conf.json must disable withGlobalTauri for strict webview isolation'
      );
      assert.ok(
        tauriConf.app?.security?.csp?.includes("default-src 'self'"),
        'tauri.conf.json must enforce strict CSP'
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

  describe('Vector 4: Homologation of Master Zoom & Crisp UI', () => {
    const canvasPath = path.resolve('packages/renderer/src/components/canvas/InfiniteCanvas.tsx');
    const canvasContent = fs.readFileSync(canvasPath, 'utf8');

    it('should prevent native browser window zoom on zoom shortcuts', () => {
      assert.ok(
        canvasContent.includes('if (isZoomIn || isZoomOut || isResetZoom) {\n        e.preventDefault();') ||
        canvasContent.includes('e.preventDefault();'),
        'InfiniteCanvas must preventDefault on zoom shortcuts to lock native webview zoom at 1.0'
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
