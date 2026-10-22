/**
 * Workspace and Floor Models & Schemas
 * Section 4.3 of CLONE_SPEC.md
 */

import type { CanvasNode, CableTie, CanvasBand, CanvasDrawing } from './nodes.js';

export type FloorState = 'pending' | 'ready' | 'deleting' | 'orphaned';
export type FloorStatusState = 'working' | 'blocked' | 'review' | 'done';
export type FloorStatus = FloorStatusState | null;


export interface FloorStatusInfo {
  text: string | null;
  state: FloorStatusState | null;
  progress: string | null;
  updatedAt?: string;
}

export interface FloorDescriptor {
  version: 1;
  workspaceId: string;
  floorId: string;
  commonDir: string;
  repoRoot: string;
  worktreePath: string;
  branch: string;
  branchCreatedByMaestri: boolean;
  createdAt: string;
  state: FloorState;
}

export interface Floor {
  id: string;
  name: string;
  isGround: boolean;
  workingDirectory: string;
  gitBranch: string | null;
  status: FloorStatusInfo | null;
  nodes: CanvasNode[];
  cableTies: CableTie[];
  bands: CanvasBand[];
  drawings: CanvasDrawing[];
}

export interface WorkspacePayload {
  id: string;
  name: string;
  workingDirectory: string;
  preferredIde?: string;
  floors: Floor[];
}

export type Workspace = WorkspacePayload;


export interface WorkspaceDocument {
  schemaVersion: 1;
  type: 'workspace';
  payload: WorkspacePayload;
}

export interface SidebarWorkspaceItem {
  id: string;
  name: string;
  path: string;
  groupId?: string;
  folderId?: string;
  isPinned?: boolean;
}

export interface SidebarGroup {
  id: string;
  name: string;
  icon?: string;
  order: number;
}

export interface SidebarFolder {
  id: string;
  name: string;
  groupId?: string;
  order: number;
}

export interface SidebarLayout {
  schemaVersion: 1;
  groups: SidebarGroup[];
  folders: SidebarFolder[];
  workspaces: SidebarWorkspaceItem[];
  pinnedWorkspaceIds: string[];
}
