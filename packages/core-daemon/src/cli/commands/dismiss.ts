import type { CommandHandler } from '../../daemon/pipeServer.js';

export const dismissCommand: CommandHandler = async (req, state) => {
  const name = req.args[0];
  if (!name) return { error: 'mindagentics dismiss: agent name required. Usage: mindagentics dismiss "Name"', exitCode: 1 };

  const target = state.getTerminalByNameOrId(name, req.workspaceId);
  if (!target) return { error: `Agent "${name}" not found.`, exitCode: 1 };

  state.terminals.delete(target.id);
  // Remove associated canvas node
  for (const [id, node] of state.nodes.entries()) {
    if (node.kind === 'terminal' && (node as any).content?.terminalId === target.id) {
      state.nodes.delete(id);
      break;
    }
  }

  // Remove connections
  state.connections = state.connections.filter(
    (c: any) => c.fromId !== target.id && c.toId !== target.id,
  );

  return {
    output: `Dismissed teammate "${target.title}". Terminal removed from canvas.`,
    exitCode: 0,
  };
};
