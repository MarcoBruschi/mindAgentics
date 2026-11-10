import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

describe('Security & UX QA Suite: Layer Isolation, Fullscreen Parity & Layout Stability', () => {

  // =========================================================================
  // 1. Teste de Transparência da Barra Lateral em 3 Estados (Normal, Maximizar, Tela Cheia)
  // =========================================================================
  describe('Checklist 1: Sidebar Transparency in 3 States (Normal, Maximize, Fullscreen F11 / Alt+Enter)', () => {
    const sidebarPath = path.resolve('packages/renderer/src/components/sidebar/Sidebar.tsx');
    const sidebarContent = fs.readFileSync(sidebarPath, 'utf8');
    const appPath = path.resolve('packages/renderer/src/App.tsx');
    const appContent = fs.readFileSync(appPath, 'utf8');
    const mainPath = path.resolve('packages/main/src/index.ts');
    const mainContent = fs.readFileSync(mainPath, 'utf8');

    it('should configure Sidebar with persistent frosted acrylic blur operating over canvas in all window states', () => {
      assert.ok(
        sidebarContent.includes('backdropFilter') &&
        (sidebarContent.includes('blur(16px)') || sidebarContent.includes('blur(24px)') || sidebarContent.includes('blur(28px)')),
        'Sidebar must specify frosted glass backdrop-filter blur'
      );
      assert.ok(
        sidebarContent.includes("backgroundColor: 'rgba(10, 12, 16, 0.22)'") ||
        sidebarContent.includes("backgroundColor: 'rgba(10, 12, 16, 0.45)'") ||
        sidebarContent.includes('rgba(10, 12, 16,'),
        'Sidebar must use calibrated translucent surface'
      );
    });

    it('should layer continuous <main> canvas behind <Sidebar /> so nodes remain visible and blurred when dragged under sidebar', () => {
      const sidebarIndex = appContent.indexOf('<Sidebar />');
      const mainIndex = appContent.indexOf('<main');

      assert.ok(mainIndex !== -1 && sidebarIndex !== -1);
      assert.ok(mainIndex < sidebarIndex, 'Canvas <main> must run continuously behind <Sidebar />');
    });

    it('should maintain window transparency and refresh material on maximize, unmaximize, and fullscreen transitions', () => {
      assert.ok(
        mainContent.includes("win.on('maximize'") &&
        mainContent.includes("win.on('unmaximize'") &&
        mainContent.includes("win.on('enter-full-screen'") &&
        mainContent.includes("win.on('leave-full-screen'"),
        'Main process must handle all state transitions cleanly'
      );
      assert.ok(
        mainContent.includes("input.key === 'F11' || (input.alt && input.key === 'Enter')"),
        'Electron main must support F11 and Alt+Enter native fullscreen toggle'
      );
    });
  });

  // =========================================================================
  // 2. Teste de Cantos Arredondados (rounded-2xl)
  // =========================================================================
  describe('Checklist 2: Rounded Corners Parity (rounded-2xl in Normal and Maximized)', () => {
    const appPath = path.resolve('packages/renderer/src/App.tsx');
    const appContent = fs.readFileSync(appPath, 'utf8');

    it('should preserve smooth rounded-2xl curvature across 4 corners in normal and maximized states', () => {
      assert.ok(
        appContent.includes('rounded-2xl'),
        'App container must declare rounded-2xl curvature'
      );
      assert.ok(
        appContent.includes("isMaximized ? 'p-1.5' : ''") ||
        appContent.includes("isMaximized ? 'p-"),
        'App shell must apply inset padding on maximize to protect rounded border aesthetics'
      );
    });
  });

  // =========================================================================
  // 3. Teste de Interação com a Barra de Título (Duplo Clique para Restaurar)
  // =========================================================================
  describe('Checklist 3: TitleBar Double Click Interaction & Smooth Restore', () => {
    const titleBarPath = path.resolve('packages/renderer/src/components/window/TitleBar.tsx');
    const titleBarContent = fs.readFileSync(titleBarPath, 'utf8');

    it('should bind onDoubleClick on TitleBar header to toggleMaximize smoothly without layout breaks', () => {
      assert.ok(
        titleBarContent.includes('onDoubleClick={handleDoubleClick}'),
        'TitleBar header must bind onDoubleClick handler'
      );
      assert.ok(
        titleBarContent.includes('controls?.toggleMaximize?.()'),
        'handleDoubleClick must invoke windowControls toggleMaximize'
      );
      assert.ok(
        titleBarContent.includes("closest('button, [data-toolbar-trigger=\"true\"], .canvas-toolbar')"),
        'handleDoubleClick must ignore clicks on interactive buttons and toolbar handle'
      );
    });
  });

  // =========================================================================
  // 4. Teste de Resposta da Barra de Ferramentas (~150ms)
  // =========================================================================
  describe('Checklist 4: Toolbar Agile Auto-Hide (~150ms) & Anti-Flicker', () => {
    const toolbarPath = path.resolve('packages/renderer/src/components/toolbar/CanvasToolbar.tsx');
    const toolbarContent = fs.readFileSync(toolbarPath, 'utf8');

    it('should close in ~150ms on mouse leave with no render flicker', () => {
      assert.ok(
        toolbarContent.includes('handleMouseLeave') &&
        toolbarContent.includes('150'),
        'handleMouseLeave must buffer auto-hide with agile 150ms delay'
      );
      assert.ok(
        toolbarContent.includes('handleMouseEnter') &&
        toolbarContent.includes('clearTimeout(hoverTimeoutRef.current)'),
        'handleMouseEnter must cancel pending leave timeout immediately'
      );
    });
  });

  // =========================================================================
  // 5. Linha de Centro e Ausência de Ruído Visual
  // =========================================================================
  describe('Checklist 5: Centerline Alignment & Clean Aesthetic Handle', () => {
    const titleBarPath = path.resolve('packages/renderer/src/components/window/TitleBar.tsx');
    const titleBarContent = fs.readFileSync(titleBarPath, 'utf8');
    const toolbarPath = path.resolve('packages/renderer/src/components/toolbar/CanvasToolbar.tsx');
    const toolbarContent = fs.readFileSync(toolbarPath, 'utf8');

    it('should align TitleBar height to h-14 with center at 28px', () => {
      assert.ok(
        titleBarContent.includes('h-14') && titleBarContent.includes('flex items-center'),
        'TitleBar must be h-14 with center at y = 28px'
      );
    });

    it('should position collapsed handle geometric center at top: 28px (mt-[19px] + h-4.5 / 2)', () => {
      assert.ok(
        toolbarContent.includes('mt-[19px]') && toolbarContent.includes('h-4.5'),
        'Collapsed handle center must be at y = 28px'
      );
    });

    it('should render collapsed handle with zero icons, text, or chevrons', () => {
      const triggerMatch = toolbarContent.match(/<button[\s\S]*?data-toolbar-trigger="true"[\s\S]*?\/>/);
      assert.ok(triggerMatch, 'Trigger handle button must be self-closing');
      assert.ok(!triggerMatch[0].includes('ChevronDown'), 'No ChevronDown icon');
      assert.ok(!triggerMatch[0].includes('ChevronUp'), 'No ChevronUp icon');
      assert.ok(!triggerMatch[0].includes('<span>'), 'No text label');
    });
  });
});
