import type { CommandHandler } from '../../daemon/pipeServer.js';

interface ResolvedEndpoint {
  id: string;
  nodeId?: string;
  name: string;
  kind: string;
}

function resolveEndpoint(nameOrId: string, state: any, callerWorkspaceId?: string): ResolvedEndpoint {
  const norm = nameOrId.trim().toLowerCase();

  // 1. Try matching terminals in state.terminals
  const term = state.getTerminalByNameOrId(nameOrId, callerWorkspaceId);
  if (term) {
    let matchedNodeId: string | undefined;
    for (const [nid, n] of state.nodes.entries()) {
      if (n.kind === 'terminal' && (n.content?.terminalId === term.id || n.id === term.id)) {
        matchedNodeId = n.id;
        break;
      }
    }
    return {
      id: matchedNodeId || term.id,
      nodeId: matchedNodeId,
      name: term.title,
      kind: 'agent',
    };
  }

  // 2. Try matching nodes in state.nodes (by ID, title, url)
  for (const [nodeId, node] of state.nodes.entries()) {
    if (nodeId.toLowerCase() === norm || node.id.toLowerCase() === norm) {
      const title = (node.content as any)?.title || (node.content as any)?.url || node.kind;
      return { id: node.id, nodeId: node.id, name: title, kind: node.kind };
    }

    const content = (node.content as any);
    if (content) {
      const titleLower = (content.title || '').toLowerCase();
      const urlLower = (content.url || '').toLowerCase();
      if (titleLower === norm || titleLower.includes(norm)) {
        return { id: node.id, nodeId: node.id, name: content.title, kind: node.kind };
      }
      if (node.kind === 'portal' && (urlLower === norm || urlLower.includes(norm))) {
        return { id: node.id, nodeId: node.id, name: content.title || content.url, kind: 'portal' };
      }
      if (node.kind === 'terminal' && content.maestroMode && norm.includes('maestro')) {
        return { id: node.id, nodeId: node.id, name: content.title || 'Maestro', kind: 'agent' };
      }
    }
  }

  // Fallback to the raw string
  return { id: nameOrId, name: nameOrId, kind: 'unknown' };
}

export const connectCommand: CommandHandler = async (req, state, router, scheduler, sendToMain) => {
  const [fromName, toName] = req.args;
  if (!fromName || !toName) {
    return {
      error: 'mindagentics connect: both endpoints required. Usage: mindagentics connect "From" "To" [--label "..."]',
      exitCode: 1,
    };
  }

  const fromEp = resolveEndpoint(fromName, state, req.workspaceId);
  const toEp = resolveEndpoint(toName, state, req.workspaceId);

  const label = (req.options.label as string) || (fromEp.kind === 'agent' && toEp.kind === 'portal' ? 'Reference' : 'Cable Tie');

  state.connections.push({
    fromId: fromEp.id,
    toId: toEp.id,
    label,
  });

  sendToMain({
    type: 'cableTieCreated',
    id: `tie-${Date.now()}`,
    payload: {
      fromNodeId: fromEp.nodeId || fromEp.id,
      toNodeId: toEp.nodeId || toEp.id,
      label,
    },
  });

  return {
    output: `Connected "${fromEp.name}" (${fromEp.kind}) <-> "${toEp.name}" (${toEp.kind}) [label: ${label}].`,
    exitCode: 0,
    data: { from: fromEp, to: toEp, label },
  };
};
