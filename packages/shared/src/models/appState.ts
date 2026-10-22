/**
 * Application State Models
 * Section 4.3 of CLONE_SPEC.md
 */

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
  fullScreen: boolean;
}

export interface AppStatePayload {
  cleanShutdown: boolean;
  hasCompletedOnboarding: boolean;
  hasSeenFloorOnboarding: boolean;
  lastOpenedAt: string;
  recentWorkspaceIds: string[];
  windowBounds: WindowBounds;
}

export interface AppStateDocument {
  type: 'appState';
  schemaVersion: 1;
  payload: AppStatePayload;
}
