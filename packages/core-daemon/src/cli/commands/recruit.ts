import { randomUUID } from 'node:crypto';
import type { CommandHandler } from '../../daemon/pipeServer.js';
import type { TerminalNode } from '@mindagentics/shared';
import { placeNode } from '../../daemon/spatial.js';

export const recruitCommand: CommandHandler = async (req, state, router, scheduler, sendToMain) => {
  const name = req.args[0] || (req.options.name as string);
  const replaceTarget = req.options.replace as string | undefined;

  // Handle in-place replacement
  if (replaceTarget) {
    const existing = state.getTerminalByNameOrId(replaceTarget, req.workspaceId);
    if (!existing) {
      return { error: `Recruit "${replaceTarget}" to replace not found.`, exitCode: 1 };
    }
    if (name) existing.title = name;
    if (req.options.preset) existing.presetId = req.options.preset;
    if (req.options.role) existing.agentRole = req.options.role;
    if (req.options.account) existing.account = req.options.account;

    return {
      output: `Replaced agent on terminal "${existing.title}" in place. Process restarted.`,
      exitCode: 0,
      data: existing,
    };
  }

  if (!name) {
    return {
      error: 'mindagentics recruit: name required. Usage: mindagentics recruit "Name" [--preset "..."] [--role "..."]',
      exitCode: 1,
    };
  }

  const rawPreset = (req.options.preset as string) || 'Claude Code';
  const role = req.options.role as string | undefined;
  const floor = (req.options.floor as string) || req.floorId || 'ground';
  const workspace = (req.options.workspace as string) || req.workspaceId || 'default';
  const account = req.options.account as string | undefined;

  // Resolve preset and command from state.presets
  let presetName = rawPreset;
  let command = '';
  const rawLower = rawPreset.toLowerCase();

  for (const [pName, pObj] of state.presets.entries()) {
    const pLower = pName.toLowerCase();
    const typeLower = (pObj.agentType || '').toLowerCase();
    if (
      pLower === rawLower ||
      typeLower === rawLower ||
      (rawLower === 'agy' && pLower.includes('antigravity')) ||
      (rawLower === 'claude' && pLower.includes('claude')) ||
      (rawLower === 'codex' && pLower.includes('codex')) ||
      (rawLower === 'opencode' && pLower.includes('opencode'))
    ) {
      presetName = pName;
      command = pObj.command || '';
      break;
    }
  }

  if (!command) {
    if (rawLower.includes('antigravity') || rawLower === 'agy') command = 'agy';
    else if (rawLower.includes('codex')) command = 'codex --no-daemon';
    else if (rawLower.includes('claude')) command = 'claude';
    else if (rawLower.includes('opencode')) command = 'opencode';
  }

  const terminalId = randomUUID();
  const nodeId = `node-term-${terminalId.slice(0, 8)}`;

  // Find caller node id on canvas
  let callerNodeId = req.terminalId;
  for (const n of state.nodes.values()) {
    if (n.kind === 'terminal' && ((n.content as any)?.terminalId === req.terminalId || n.id === req.terminalId)) {
      callerNodeId = n.id;
      break;
    }
  }

  // Calculate intelligent spatial placement
  const existingNodesList = Array.from(state.nodes.values());
  const coords = placeNode({
    width: 640,
    height: 480,
    existingNodes: existingNodesList,
    anchorNodeId: callerNodeId,
    placementDirection: 'right',
  });

  state.registerTerminal({
    id: terminalId,
    title: name,
    workspaceId: workspace,
    floorId: floor,
    presetId: presetName,
    agentRole: role,
    account,
    maestroMode: false,
    status: 'idle',
    scrollback: [],
  });

  const termNode: TerminalNode = {
    id: nodeId,
    kind: 'terminal',
    x: coords.x,
    y: coords.y,
    width: 640,
    height: 480,
    zIndex: 10,
    content: {
      terminalId,
      presetId: presetName,
      title: name,
      agentRole: role,
      account,
      command,
      maestroMode: false,
      status: 'idle',
    },
  };

  state.nodes.set(nodeId, termNode);

  // Auto-connect to caller terminal node
  state.connections.push({
    fromId: callerNodeId,
    toId: nodeId,
    label: 'Teammate',
  });

  sendToMain({
    type: 'placeNode',
    id: `place-${nodeId}`,
    payload: {
      node: termNode,
      width: 640,
      height: 480,
      existingNodes: Array.from(state.nodes.values()),
      anchorNodeId: callerNodeId,
      placementDirection: 'right',
    },
  });

  return {
    output: `Recruited teammate "${name}" [preset: ${presetName}]${role ? ` [role: ${role}]` : ''} (ID: ${terminalId.slice(0, 8)}). Auto-connected.`,
    exitCode: 0,
    data: { terminalId, nodeId, name, command },
  };
};
