export interface FloorInfo {
  name: string;
  branch: string;
  path: string;
  status: 'clean' | 'dirty';
}

/**
 * Manage isolated git worktree environments (floors) for parallel agent tasks.
 */
export interface WorktreeFloorAPI {
  /**
   * Create a new floor isolated worktree for safe code editing.
   *
   * @example
   * ```bash
   * mindagentics floor create feature-login
   * ```
   */
  create(name: string): Promise<FloorInfo>;

  /**
   * Switch the active terminal to a specific floor.
   *
   * @example
   * ```bash
   * mindagentics floor switch feature-login
   * ```
   */
  switch(name: string): Promise<void>;

  /**
   * Land (merge) changes from a floor back into main and clean up worktree.
   *
   * @example
   * ```bash
   * mindagentics floor land feature-login
   * ```
   */
  land(name: string): Promise<{ merged: boolean; message: string }>;

  /**
   * Check the current floor status and modified files.
   *
   * @example
   * ```bash
   * mindagentics floor status
   * ```
   */
  status(): Promise<FloorInfo>;
}
