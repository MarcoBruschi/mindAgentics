import type { AgentPreset, AgentTerminal, RecruitOptions } from '../models/agent.js';

/**
 * Recruit and instantiate a new AI agent terminal into the active mindAgentics workspace.
 *
 * Presets available:
 * - 'Antigravity': Advanced multi-modal agent with full system capability and tool execution.
 * - 'Codex': High-speed deterministic code generation and refactoring engine.
 * - 'OpenCode': Open-weight reasoning and specialized tooling agent.
 * - 'Claude Code': Agentic terminal CLI with tool workflows.
 * - 'Shell': Interactive headless terminal environment for manual execution or scripts.
 *
 * @example
 * ```bash
 * mindagentics recruit "Frontend Dev" --preset "Antigravity" --role "React and UI Specialist"
 * mindagentics recruit "QA Reviewer" --preset "Codex" --role "Test coverage and lint verification"
 * ```
 */
export declare function recruitAgent(
  name: string,
  options: RecruitOptions
): Promise<AgentTerminal>;

/**
 * Dismiss and terminate an agent terminal from the canvas.
 *
 * @example
 * ```bash
 * mindagentics dismiss "QA Reviewer"
 * ```
 */
export declare function dismissAgent(name: string): Promise<{ dismissed: boolean; message: string }>;
