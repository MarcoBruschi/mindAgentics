import { BackendAdapter } from './types';
import { createTauriBackend } from './tauriBackend';

let activeBackend: BackendAdapter | null = null;

/**
 * Detects whether the frontend is running inside Tauri v2
 */
export function isTauriEnvironment(): boolean {
  if (import.meta.env.VITE_BACKEND === 'tauri') return true;
  if (typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__)) return true;
  return false;
}

/**
 * Initializes the backend adapter and injects window.api and window.mindAgentics
 * before React mounts.
 */
export function initBackend(): BackendAdapter {
  if (activeBackend) return activeBackend;

  activeBackend = createTauriBackend();

  if (typeof window !== 'undefined') {
    window.api = activeBackend;
    window.mindAgentics = activeBackend;
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
export { createTauriBackend, safeListen } from './tauriBackend';
