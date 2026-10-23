export interface RoutineInfo {
  id: string;
  name: string;
  schedule: string; // Cron expression or interval
  command: string;
  agentName?: string;
  lastRun?: string;
  nextRun?: string;
}

/**
 * Scheduled routines, periodic health checks, and canvas automations.
 */
export interface RoutineAPI {
  /**
   * Schedule a new recurring routine.
   *
   * @example
   * ```bash
   * mindagentics routine schedule "0 * * * *" --command "npm test" --name "Hourly QA"
   * ```
   */
  schedule(schedule: string, command: string, name?: string): Promise<RoutineInfo>;

  /**
   * List all scheduled routines on the workspace.
   *
   * @example
   * ```bash
   * mindagentics routine list
   * ```
   */
  list(): Promise<RoutineInfo[]>;

  /**
   * Remove a scheduled routine.
   *
   * @example
   * ```bash
   * mindagentics routine remove "Hourly QA"
   * ```
   */
  remove(idOrName: string): Promise<void>;
}
