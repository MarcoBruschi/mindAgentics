import type { CommandHandler } from '../../daemon/pipeServer.js';

export const connectCommand: CommandHandler = async (req, state, router, scheduler, sendToMain) => {
  const [fromName, toName] = req.args;
  if (!fromName || !toName) {
    return {
      error: 'maestri connect: both endpoints required. Usage: maestri connect "From" "To"',
      exitCode: 1,
    };
  }

  const fromTerm = state.getTerminalByNameOrId(fromName, req.workspaceId);
  const toTerm = state.getTerminalByNameOrId(toName, req.workspaceId);

  const fromId = fromTerm ? fromTerm.id : fromName;
  const toId = toTerm ? toTerm.id : toName;

  state.connections.push({
    fromId,
    toId,
    label: 'Cable Tie',
  });

  return {
    output: `Connected "${fromName}" <-> "${toName}".`,
    exitCode: 0,
  };
};
