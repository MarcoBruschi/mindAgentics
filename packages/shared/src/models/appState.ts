/**
 * Application State Models
 * Application global state and workspace tracking schema.
 */

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
  fullScreen: boolean;
  isFakeMaximized?: boolean;
  restoreBounds?: { x: number; y: number; width: number; height: number };
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
