/**
 * Maestro Mode Orchestration Protocols and Rules.
 * When MINDAGENTICS_MAESTRO_MODE=1 is active, the agent acts as the Central Orchestrator.
 */
export interface MaestroProtocol {
  /**
   * Rule 1: Mandatory Delegation.
   * Do not execute heavy tasks alone. Decompose into subtasks and delegate via `mindagentics ask`.
   */
  mandatoryDelegation: boolean;

  /**
   * Rule 2: Workspace Agent Recruitment.
   * If specialized roles are needed (Frontend, Backend, QA, Reviewer, Security), recruit via `mindagentics recruit`.
   */
  recruitSpecialists: boolean;

  /**
   * Rule 3: Web References & Knowledge Portals.
   * When inspecting web documentation, open a Portal node (`mindagentics portal open`),
   * link the agent with a cable tie (`mindagentics connect`), and instruct the agent to use it.
   */
  linkWebReferences: boolean;
}
