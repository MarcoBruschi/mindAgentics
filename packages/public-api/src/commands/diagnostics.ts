export interface DiagnosticReport {
  pipeStatus: 'healthy' | 'unreachable' | 'elevation_mismatch';
  activeTerminals: number;
  activeWorkspaces: number;
  environment: Record<string, string>;
}

/**
 * Diagnostic utilities for inspecting terminals, pipe status, and sending user notifications.
 */
export interface DiagnosticsAPI {
  /**
   * Check the current terminal output of an agent without interrupting or prompting them.
   *
   * @example
   * ```bash
   * mindagentics check "Frontend Dev"
   * ```
   */
  check(agentName: string): Promise<string>;

  /**
   * Diagnose pipe connectivity, daemon state, or elevation issues.
   *
   * @example
   * ```bash
   * mindagentics debug
   * ```
   */
  debug(): Promise<DiagnosticReport>;

  /**
   * Send a non-intrusive notification to the human user.
   *
   * @example
   * ```bash
   * mindagentics notify "All tests passed successfully!"
   * ```
   */
  notify(message: string): Promise<void>;
}
