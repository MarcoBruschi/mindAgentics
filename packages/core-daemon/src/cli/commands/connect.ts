import type { CommandHandler } from '../../daemon/pipeServer.js';
import { notifyRefsChanged, toAgentRef } from '../../daemon/refs.js';

interface ResolvedEndpoint {
  id: string;
  nodeId?: string;
  terminalId?: string;
  name: string;
  kind: string;
}

function resolveEndpoint(nameOrId: string, state: any, callerWorkspaceId?: string, callerTerminalId?: string): ResolvedEndpoint {
  const norm = (nameOrId || '').trim().toLowerCase();

  // 1. Resolve self/me references
  if (callerTerminalId && (norm === 'me' || norm === 'self' || norm === 'myself' || norm === 'caller' || norm === 'eu' || norm === '')) {
    const term = state.terminals.get(callerTerminalId);
    let matchedNodeId: string | undefined;
    for (const [nid, n] of state.nodes.entries()) {
      if (n.kind === 'terminal' && (n.content?.terminalId === callerTerminalId || n.id === callerTerminalId)) {
        matchedNodeId = n.id;
        break;
      }
    }
    return {
      id: matchedNodeId || callerTerminalId,
      nodeId: matchedNodeId,
      terminalId: callerTerminalId,
      name: term?.title || 'Me',
      kind: 'agent',
    };
  }

  // 2. Try matching terminals in state.terminals
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
      terminalId: term.id,
      name: term.title,
      kind: 'agent',
    };
  }

  // 3. Try matching specific node kinds in state.nodes
  // Pass 3a: Exact matches across nodes
  for (const [nodeId, node] of state.nodes.entries()) {
    if (nodeId.toLowerCase() === norm || node.id.toLowerCase() === norm) {
      const title = (node.content as any)?.title || (node.content as any)?.label || (node.content as any)?.fileName || (node.content as any)?.url || node.kind;
      return { id: node.id, nodeId: node.id, name: title, kind: node.kind };
    }

    const content = (node.content as any);
    if (!content) continue;

    // Notes
    if (node.kind === 'note') {
      const nTitle = (content.title || '').toLowerCase();
      const nId = (content.noteId || '').toLowerCase();
      if (nTitle === norm || nId === norm) {
        return { id: node.id, nodeId: node.id, name: content.title || 'Note', kind: 'note' };
      }
    }

    // Note Stacks
    if (node.kind === 'noteStack') {
      const sTitle = (content.title || '').toLowerCase();
      const sId = (content.stackId || '').toLowerCase();
      if (sTitle === norm || sId === norm) {
        return { id: node.id, nodeId: node.id, name: content.title || 'Stack', kind: 'noteStack' };
      }
      if (Array.isArray(content.pages)) {
        for (const p of content.pages) {
          if ((p.title || '').toLowerCase() === norm || (p.id || '').toLowerCase() === norm) {
            return { id: node.id, nodeId: node.id, name: `${content.title} (${p.title})`, kind: 'noteStack' };
          }
        }
      }
    }

    // Portals
    if (node.kind === 'portal') {
      const pTitle = (content.title || '').toLowerCase();
      const pUrl = (content.url || '').toLowerCase();
      const pId = (content.portalId || '').toLowerCase();
      if (pTitle === norm || pUrl === norm || pId === norm) {
        return { id: node.id, nodeId: node.id, name: content.title || content.url || 'Portal', kind: 'portal' };
      }
    }

    // Bands
    if (node.kind === 'band') {
      const bTitle = (content.title || '').toLowerCase();
      const bId = (content.bandId || '').toLowerCase();
      if (bTitle === norm || bId === norm) {
        return { id: node.id, nodeId: node.id, name: content.title || 'Band', kind: 'band' };
      }
    }

    // File / folder references (fileRef)
    if (node.kind === 'fileRef') {
      const rLabel = String(content.label || '').toLowerCase();
      const rPath = String(content.path || '').toLowerCase().replace(/\\/g, '/');
      const rBase = rPath.split('/').filter(Boolean).pop() || '';
      const nNorm = norm.replace(/\\/g, '/');
      if (rLabel === norm || rPath === nNorm || rBase === norm) {
        return { id: node.id, nodeId: node.id, name: content.label || content.path || 'Ref', kind: 'fileRef' };
      }
    }

    // Files
    if (node.kind === 'file') {
      const fName = (content.fileName || '').toLowerCase();
      const fId = (content.fileId || '').toLowerCase();
      if (fName === norm || fId === norm) {
        return { id: node.id, nodeId: node.id, name: content.fileName || 'File', kind: 'file' };
      }
    }
  }

  // Pass 3b: Substring / partial matches across nodes
  for (const [nodeId, node] of state.nodes.entries()) {
    const content = (node.content as any);
    if (!content) continue;

    const title = content.title || content.label || content.fileName || content.url || '';
    const titleLower = String(title).toLowerCase();

    if (titleLower && (titleLower.includes(norm) || norm.includes(titleLower))) {
      return { id: node.id, nodeId: node.id, name: title || node.kind, kind: node.kind };
    }

    if (node.kind === 'terminal' && (content.orchestratorMode || content.maestroMode) && (norm.includes('orquestrador') || norm.includes('orchestrator') || norm.includes('maestro'))) {
      return { id: node.id, nodeId: node.id, name: content.title || 'Orquestrador', kind: 'agent' };
    }
  }

  // Fallback to the raw string
  return { id: nameOrId, name: nameOrId, kind: 'unknown' };
}

/**
 * fileRef <-> agent wiring: refresh the agent's AGENTS.md block and, on connect,
 * inject a single `[ref] pasta|arquivo: <path>` line (never the file content).
 */
function notifyRefLink(
  state: any,
  a: ResolvedEndpoint,
  b: ResolvedEndpoint,
  sendToMain: (frame: any) => void,
  connecting: boolean,
) {
  const agent = a.kind === 'agent' ? a : b.kind === 'agent' ? b : undefined;
  const refEp = a.kind === 'fileRef' ? a : b.kind === 'fileRef' ? b : undefined;
  if (!agent?.terminalId || !refEp) return;
  const ref = toAgentRef(state.nodes.get(refEp.nodeId || refEp.id));
  notifyRefsChanged(state, agent.terminalId, sendToMain, connecting && ref ? ref : undefined);
}

export const connectCommand: CommandHandler = async (req, state, router, scheduler, sendToMain) => {
  let isDisconnect = Boolean(req.options.disconnect || req.options.remove || req.options.delete);
  let args = [...req.args];

  if (args[0] === 'disconnect' || args[0] === 'remove') {
    isDisconnect = true;
    args = args.slice(1);
  }

  const [fromName, toName] = args;
  if (!fromName || !toName) {
    return {
      error: 'mindagentics connect: both endpoints required. Usage: mindagentics connect "From" "To" [--label "..."] [--disconnect]',
      exitCode: 1,
    };
  }

  const fromEp = resolveEndpoint(fromName, state, req.workspaceId, req.terminalId);
  const toEp = resolveEndpoint(toName, state, req.workspaceId, req.terminalId);

  const fromTargetId = fromEp.nodeId || fromEp.id;
  const toTargetId = toEp.nodeId || toEp.id;

  if (isDisconnect) {
    // Disconnect logic
    const prevLen = state.connections.length;
    state.connections = state.connections.filter((c: any) => {
      const matches =
        (c.fromId === fromTargetId && c.toId === toTargetId) ||
        (c.fromId === toTargetId && c.toId === fromTargetId) ||
        (c.fromId === fromEp.id && c.toId === toEp.id) ||
        (c.fromId === toEp.id && c.toId === fromEp.id);
      return !matches;
    });

    sendToMain({
      type: 'cableTieDeleted',
      id: `del-tie-${Date.now()}`,
      payload: {
        fromNodeId: fromTargetId,
        toNodeId: toTargetId,
      },
    });

    const changed = state.connections.length < prevLen;
    notifyRefLink(state, fromEp, toEp, sendToMain, false);
    return {
      output: changed
        ? `Disconnected "${fromEp.name}" (${fromEp.kind}) </-> "${toEp.name}" (${toEp.kind}).`
        : `No active connection found between "${fromEp.name}" and "${toEp.name}".`,
      exitCode: 0,
      data: { from: fromEp, to: toEp, disconnected: true },
    };
  }

  // Connect logic
  const label =
    (req.options.label as string) ||
    ((fromEp.kind === 'agent' && (toEp.kind === 'portal' || toEp.kind === 'fileRef')) ||
    (toEp.kind === 'agent' && (fromEp.kind === 'portal' || fromEp.kind === 'fileRef'))
      ? 'Reference'
      : 'Cable Tie');

  // Avoid duplicate connections
  const alreadyExists = state.connections.some(
    (c: any) =>
      (c.fromId === fromTargetId && c.toId === toTargetId) ||
      (c.fromId === toTargetId && c.toId === fromTargetId)
  );

  if (!alreadyExists) {
    state.connections.push({
      fromId: fromTargetId,
      toId: toTargetId,
      label,
    });
  }

  if (!alreadyExists) {
    notifyRefLink(state, fromEp, toEp, sendToMain, true);
  }

  const tieId = `tie-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  sendToMain({
    type: 'cableTieCreated',
    id: tieId,
    payload: {
      id: tieId,
      fromNodeId: fromTargetId,
      toNodeId: toTargetId,
      label,
    },
  });

  return {
    output: `Connected "${fromEp.name}" (${fromEp.kind}) <-> "${toEp.name}" (${toEp.kind}) [label: ${label}]. Placed on canvas.`,
    exitCode: 0,
    data: { from: fromEp, to: toEp, label, tieId },
  };
};
