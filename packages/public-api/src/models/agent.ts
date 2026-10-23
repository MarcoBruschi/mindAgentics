/**
 * Supported Agent presets for mindAgentics terminal recruitment.
 */
export type AgentPreset = 'Antigravity' | 'Codex' | 'OpenCode' | 'Claude Code' | 'Shell';

/**
 * Metadata and runtime state of an agent terminal connected on the canvas.
 */
export interface AgentTerminal {
  /** Unique terminal identifier */
  id: string;
  /** Display name of the agent on the canvas */
  name: string;
  /** Presetting engine powering the terminal */
  preset: AgentPreset;
  /** Specialized role assigned to the agent (e.g. Frontend Specialist, QA Reviewer) */
  role: string;
  /** Current execution status */
  status: 'idle' | 'running' | 'waiting' | 'error';
  /** ID of the workspace this agent belongs to */
  workspaceId: string;
  /** Optional floor / isolated worktree branch assigned to this agent */
  floor?: string;
  /** Current working directory of the agent process */
  workingDirectory: string;
}

/**
 * Options for recruiting a new agent terminal to the canvas.
 */
export interface RecruitOptions {
  /** Agent preset runtime engine */
  preset: AgentPreset;
  /** Role description and mission guidelines */
  role: string;
  /** Initial prompt or startup task instructions */
  prompt?: string;
  /** Specific workspace ID to place the agent in (defaults to current) */
  workspaceId?: string;
  /** Specific worktree floor name to assign */
  floor?: string;
  /** Auto-inject workspace Knowledge Graph context */
  injectKnowledgeGraph?: boolean;
}

/**
 * Result returned when delegating tasks to agents via peer messaging.
 */
export interface AgentResponse {
  /** Target agent name */
  name: string;
  /** Clean text output from the agent's response */
  output: string;
  /** Error message if the agent could not be reached or failed */
  error?: string;
  /** Process exit status code */
  exitCode: number;
}
