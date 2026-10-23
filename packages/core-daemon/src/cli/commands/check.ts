import type { CommandHandler } from '../../daemon/pipeServer.js';

export const checkCommand: CommandHandler = async (req, state) => {
  const targetName = req.args[0];
  if (!targetName) {
    return {
      error: 'mindagentics check: agent name required. Usage: mindagentics check "Agent Name"',
      exitCode: 1,
    };
  }

  const target = state.getTerminalByNameOrId(targetName, req.workspaceId);
  if (!target) {
    return {
      error: `Agent "${targetName}" not found or not connected.`,
      exitCode: 1,
    };
  }

  const output = target.lastTurnOutput || target.scrollback.slice(-30).join('\n') || `[Agent ${target.title} is currently idle with no output]`;

  return {
    output,
    exitCode: 0,
  };
};
