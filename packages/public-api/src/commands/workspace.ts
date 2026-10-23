export interface WorkspaceInfo {
  id: string;
  name: string;
  workingDirectory: string;
  agentCount: number;
}

/**
 * Spatial workspace management across multiple codebases or projects.
 */
export interface WorkspaceAPI {
  /**
   * List all configured workspaces in mindAgentics.
   *
   * @example
   * ```bash
   * mindagentics workspace list
   * ```
   */
  list(): Promise<WorkspaceInfo[]>;

  /**
   * Switch the canvas to a specific workspace.
   *
   * @example
   * ```bash
   * mindagentics workspace switch "Main App"
   * ```
   */
  switch(idOrName: string): Promise<void>;

  /**
   * Clone or scaffold a new workspace environment.
   */
  clone(sourceWorkspace: string, newName: string): Promise<WorkspaceInfo>;
}
