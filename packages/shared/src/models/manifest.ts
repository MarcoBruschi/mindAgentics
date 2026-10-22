/**
 * Storage Manifest Schema
 * Section 4.3 of CLONE_SPEC.md
 */

export interface ManifestWorkspaceEntry {
  id: string;
  name: string;
  path: string;
}

export interface ManifestFiles {
  appState: string;
  preferences: string;
  sidebarLayout: string;
}

export interface ManifestDocument {
  app: string;
  appVersion: string;
  dataFormat: 'json';
  schemaVersion: 1;
  files: ManifestFiles;
  workspaces: ManifestWorkspaceEntry[];
}
