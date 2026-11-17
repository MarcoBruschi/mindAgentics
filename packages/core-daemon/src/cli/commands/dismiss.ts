import type { CommandHandler } from '../../daemon/pipeServer.js';

export const dismissCommand: CommandHandler = async (req, state, router, scheduler, sendToMain) => {
  const caller = req.terminalId ? state.terminals.get(req.terminalId) : undefined;
  // Exigir que o chamador esteja em modo Orquestrador se req.terminalId pertencer a um agente do canvas
  if (caller && !caller.orchestratorMode && !caller.maestroMode) {
    return {
      error: 'Permissão negada: o comando "mindagentics dismiss" requer Modo Orquestrador ativo.',
      exitCode: 1,
    };
  }

  const name = req.args[0];
  if (!name) return { error: 'mindagentics dismiss: agent name required. Usage: mindagentics dismiss "Name"', exitCode: 1 };

  const target = state.getTerminalByNameOrId(name, req.workspaceId);
  if (!target) return { error: `Agent "${name}" not found.`, exitCode: 1 };

  // Bloquear demissão/remoção de qualquer terminal Orquestrador
  if (target.orchestratorMode || target.maestroMode) {
    return {
      error: `Não é permitido dispensar um terminal Orquestrador ("${target.title}").`,
      exitCode: 1,
    };
  }

  state.terminals.delete(target.id);
  // Remove associated canvas node
  let removedNodeId: string | undefined;
  for (const [id, node] of state.nodes.entries()) {
    if (node.kind === 'terminal' && (node as any).content?.terminalId === target.id) {
      removedNodeId = id;
      state.nodes.delete(id);
      break;
    }
  }

  // Remove connections
  state.connections = state.connections.filter(
    (c: any) =>
      c.fromId !== target.id &&
      c.toId !== target.id &&
      (!removedNodeId || (c.fromId !== removedNodeId && c.toId !== removedNodeId)),
  );

  // Enviar evento para Main encerrar o PTY e remover o nó do canvas
  sendToMain({
    type: 'deleteNode',
    id: `del-${removedNodeId || target.id}`,
    payload: {
      nodeId: removedNodeId || target.id,
      terminalId: target.id,
    },
  });

  return {
    output: `Dismissed teammate "${target.title}". Terminal removed from canvas.`,
    exitCode: 0,
  };
};
