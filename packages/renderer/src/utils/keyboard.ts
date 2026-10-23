/**
 * Keyboard Shortcuts & Resolution Pipeline
 * Section 2 of Maestri Interaction Model
 */

export const isMac =
  typeof navigator !== 'undefined' &&
  navigator.platform.toUpperCase().indexOf('MAC') >= 0;

/**
 * Checks if active focus is inside an editable input where single-key shortcuts
 * should be suppressed to avoid stealing typed characters.
 */
export function isInputOrEditable(element: Element | null): boolean {
  if (!element) return false;
  const tag = element.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  if ((element as HTMLElement).isContentEditable) return true;
  if (
    element.classList.contains('xterm-helper-textarea') ||
    element.classList.contains('cm-content') ||
    element.closest('.xterm') !== null
  ) {
    return true;
  }
  return false;
}

/**
 * Match a modifier key normalized across platforms (macOS Cmd -> Windows/Linux Ctrl)
 */
export function hasPrimaryModifier(e: KeyboardEvent): boolean {
  return isMac ? e.metaKey : e.ctrlKey;
}

export const DEFAULT_SHORTCUTS = {
  commandPalette: isMac ? '⌘P' : 'Ctrl+P',
  commandPaletteAlt: isMac ? '⌘K' : 'Ctrl+K',
  undo: isMac ? '⌘Z' : 'Ctrl+Z',
  redo: isMac ? '⌘⇧Z' : 'Ctrl+Y / Ctrl+Shift+Z',
  tidy: isMac ? '⌘⇧T' : 'Ctrl+Shift+T',
  resetZoom: isMac ? '⌘0' : 'Ctrl+0',
  zoomToggle: isMac ? '⌘\\' : 'Ctrl+\\',
  zoomToSelection: isMac ? '⌘⌥\\' : 'Ctrl+Alt+\\',
  connectTie: isMac ? '⌘L' : 'Ctrl+L',
  deleteSelection: isMac ? '⌘W / ⌫' : 'Ctrl+W / Del',
  toggleSidebar: isMac ? '⌘S' : 'Ctrl+S',
  panTool: 'H',
  selectTool: 'V',
  drawTool: 'B',
  brushThicknessDown: '[',
  brushThicknessUp: ']',
};
