import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

describe('Security & UX QA Suite: Layer Isolation, Performance & Accessibility', () => {

  // =========================================================================
  // 1. Verificação de Opacidade do Canvas (#0E0F12)
  // =========================================================================
  describe('Checklist 1: Canvas Solid Opacity & Leak Prevention (#0E0F12)', () => {
    const canvasPath = path.resolve('packages/renderer/src/components/canvas/InfiniteCanvas.tsx');
    const canvasContent = fs.readFileSync(canvasPath, 'utf8');
    const appPath = path.resolve('packages/renderer/src/App.tsx');
    const appContent = fs.readFileSync(appPath, 'utf8');

    it('should configure InfiniteCanvas root container with solid #0E0F12 background', () => {
      assert.ok(
        canvasContent.includes('bg-[#0E0F12]'),
        'InfiniteCanvas root must have solid background bg-[#0E0F12]'
      );
    });

    it('should configure App shell and main container with solid #0E0F12 so zero external elements leak', () => {
      assert.ok(
        appContent.includes('app-shell') && appContent.includes('bg-[#0E0F12]'),
        'App shell must have solid background #0E0F12'
      );
      assert.ok(
        appContent.includes('<main') && appContent.includes('bg-[#0E0F12]'),
        'Main workspace container must enforce solid background #0E0F12'
      );
    });
  });

  // =========================================================================
  // 2. Efeito Visual da Sidebar (Frosted Glass Blur sobre o Canvas)
  // =========================================================================
  describe('Checklist 2: Sidebar Frosted Glass Blur & Canvas Layering', () => {
    const sidebarPath = path.resolve('packages/renderer/src/components/sidebar/Sidebar.tsx');
    const sidebarContent = fs.readFileSync(sidebarPath, 'utf8');
    const appPath = path.resolve('packages/renderer/src/App.tsx');
    const appContent = fs.readFileSync(appPath, 'utf8');

    it('should configure Sidebar with frosted acrylic blur operating over canvas layer', () => {
      assert.ok(
        sidebarContent.includes('backdropFilter') &&
        (sidebarContent.includes('blur(24px)') || sidebarContent.includes('blur(28px)')),
        'Sidebar must specify frosted glass backdrop-filter blur'
      );
      assert.ok(
        sidebarContent.includes("backgroundColor: 'rgba(10, 12, 16, 0.45)'") ||
        sidebarContent.includes('rgba(10, 12, 16,'),
        'Sidebar must use calibrated translucent surface'
      );
    });

    it('should mount InfiniteCanvas underneath Sidebar in App.tsx so nodes remain visible under frosted blur', () => {
      const mainIndex = appContent.indexOf('<main');
      const canvasIndex = appContent.indexOf('<InfiniteCanvas />');
      const sidebarIndex = appContent.indexOf('<Sidebar />');

      assert.ok(mainIndex !== -1 && canvasIndex !== -1 && sidebarIndex !== -1);
      assert.ok(canvasIndex < sidebarIndex, 'InfiniteCanvas must be layered underneath Sidebar');
    });
  });

  // =========================================================================
  // 3. Teste de Resposta da Barra de Ferramentas (~150ms)
  // =========================================================================
  describe('Checklist 3: Toolbar Fast Response Time (~150ms)', () => {
    const toolbarPath = path.resolve('packages/renderer/src/components/toolbar/CanvasToolbar.tsx');
    const toolbarContent = fs.readFileSync(toolbarPath, 'utf8');

    it('should configure auto-hide leave timeout to exactly 150ms for agile closing', () => {
      assert.ok(
        toolbarContent.includes('handleMouseLeave') &&
        toolbarContent.includes('150'),
        'handleMouseLeave must buffer auto-hide with agile 150ms delay'
      );
    });

    it('should immediately clear leave timeout on mouse enter to prevent animation repeat and flicker', () => {
      assert.ok(
        toolbarContent.includes('handleMouseEnter') &&
        toolbarContent.includes('clearTimeout(hoverTimeoutRef.current)'),
        'handleMouseEnter must cancel pending leave timeout'
      );
      assert.ok(
        toolbarContent.includes('cubic-bezier(0.4,0,0.2,1)'),
        'Toolbar transitions must use smooth cubic-bezier curve'
      );
    });
  });

  // =========================================================================
  // 4. Conferência Visual da Linha de Centro & Ausência de Ruído
  // =========================================================================
  describe('Checklist 4: Centerline Alignment & Clean Aesthetic Handle', () => {
    const titleBarPath = path.resolve('packages/renderer/src/components/window/TitleBar.tsx');
    const titleBarContent = fs.readFileSync(titleBarPath, 'utf8');
    const toolbarPath = path.resolve('packages/renderer/src/components/toolbar/CanvasToolbar.tsx');
    const toolbarContent = fs.readFileSync(toolbarPath, 'utf8');

    it('should align TitleBar height to h-14 (56px) with center at 28px', () => {
      assert.ok(
        titleBarContent.includes('h-14') && titleBarContent.includes('flex items-center'),
        'TitleBar must be h-14 with center at y = 28px'
      );
    });

    it('should position collapsed handle geometric center at top: 28px (mt-[19px] + h-4.5 / 2)', () => {
      assert.ok(
        toolbarContent.includes('mt-[19px]') && toolbarContent.includes('h-4.5'),
        'Collapsed handle center must be at y = 28px (19px + 9px)'
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

  // =========================================================================
  // 5. Drag vs Click & Hitbox Isolation Homologation
  // =========================================================================
  describe('Checklist 5: Drag vs Click & Hitbox Isolation Homologation', () => {
    const titleBarPath = path.resolve('packages/renderer/src/components/window/TitleBar.tsx');
    const titleBarContent = fs.readFileSync(titleBarPath, 'utf8');
    const toolbarPath = path.resolve('packages/renderer/src/components/toolbar/CanvasToolbar.tsx');
    const toolbarContent = fs.readFileSync(toolbarPath, 'utf8');

    it('should allow window drag in TitleBar while respecting fullscreen lock', () => {
      assert.ok(
        titleBarContent.includes("WebkitAppRegion: isFullScreen ? 'no-drag' : 'drag'"),
        'TitleBar drag must toggle based on fullscreen state'
      );
    });

    it('should isolate collapsed handle and expanded tools with WebkitAppRegion: no-drag', () => {
      assert.ok(
        toolbarContent.includes("WebkitAppRegion: 'no-drag'"),
        'Handle and tool capsule must prevent window dragging on interaction'
      );
    });

    it('should maintain pointer-events-none on outer wrapper to prevent ghost click dead zones', () => {
      assert.ok(
        toolbarContent.includes('pointer-events-none transition-all duration-200'),
        'Toolbar outer wrapper must be pointer-events-none'
      );
    });
  });
});
