import type { AgentResponse } from '../models/agent.js';

export interface AskOptions {
  /** Send raw keystrokes or escape sequences directly to the terminal PTY (e.g. '\e[A', '\n', '\x03') */
  raw?: boolean | string;
  /** JSON map of agent name to prompt for simultaneous parallel querying */
  batch?: Record<string, string>;
  /** Timeout in milliseconds before releasing the waiting ask call */
  timeoutMs?: number;
}

/**
 * Send a prompt or delegated task to a connected agent terminal on the canvas.
 *
 * @example
 * ```bash
 * mindagentics ask "Backend Dev" "Implement database schema in models/user.ts and report back when ready"
 * ```
 *
 * @param targetAgent Name of the target agent (as listed in `mindagentics list`)
 * @param prompt Task description or prompt message
 * @param options Query options (raw escapes, batch delegation, timeout)
 * @returns Response text output from the target agent
 */
export declare function askAgent(
  targetAgent: string,
  prompt: string,
  options?: AskOptions
): Promise<AgentResponse>;

/**
 * Send parallel tasks to multiple connected agents in one batch invocation.
 *
 * @example
 * ```bash
 * mindagentics ask --batch '{"Frontend Dev": "Build Login UI", "Backend Dev": "Build Auth API"}'
 * ```
 */
export declare function askBatch(
  batchMap: Record<string, string>,
  options?: Pick<AskOptions, 'timeoutMs'>
): Promise<AgentResponse[]>;
