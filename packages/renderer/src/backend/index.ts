import { BackendAdapter } from './types';
import { createElectronBackend } from './electronBackend';
import { createTauriBackend } from './tauriBackend';

let activeBackend: BackendAdapter | null = null;

/**
 * Detects whether the frontend is running inside Tauri v2 or Electron
 */
export function isTauriEnvironment(): boolean {
  if (import.meta.env.VITE_BACKEND === 'tauri') return true;
  if (typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__)) return true;
  return false;
}

/**
 * Initializes the backend adapter and injects window.api and window.mindAgentics
 * before React mounts.
 */
export function initBackend(): BackendAdapter {
  if (activeBackend) return activeBackend;

  const isTauri = isTauriEnvironment();
  activeBackend = isTauri ? createTauriBackend() : createElectronBackend();

  if (typeof window !== 'undefined') {
    (window as any).api = activeBackend;
    (window as any).mindAgentics = activeBackend;
  }

  return activeBackend;
}

/**
 * Returns the currently active backend adapter
 */
export function getBackend(): BackendAdapter {
  if (!activeBackend) {
    return initBackend();
  }
  return activeBackend;
}

export * from './types';
export { createElectronBackend } from './electronBackend';
export { createTauriBackend, safeListen } from './tauriBackend';
