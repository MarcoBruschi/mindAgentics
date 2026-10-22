import { randomUUID } from 'node:crypto';
import type { CommandHandler } from '../../daemon/pipeServer.js';
import type { TerminalNode } from '@maestri/shared';

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
      error: 'maestri recruit: name required. Usage: maestri recruit "Name" [--preset "..."] [--role "..."]',
      exitCode: 1,
    };
  }

  const preset = (req.options.preset as string) || 'Claude Code';
  const role = req.options.role as string | undefined;
  const floor = (req.options.floor as string) || req.floorId || 'ground';
  const workspace = (req.options.workspace as string) || req.workspaceId || 'default';
  const account = req.options.account as string | undefined;

  const terminalId = randomUUID();
  const nodeId = `node-term-${terminalId.slice(0, 8)}`;

  state.registerTerminal({
    id: terminalId,
    title: name,
    workspaceId: workspace,
    floorId: floor,
    presetId: preset,
    agentRole: role,
    account,
    maestroMode: false,
    status: 'idle',
    scrollback: [],
  });

  const termNode: TerminalNode = {
    id: nodeId,
    kind: 'terminal',
    x: 600,
    y: 200,
    width: 640,
    height: 480,
    zIndex: 10,
    content: {
      terminalId,
      presetId: preset,
      title: name,
      agentRole: role,
      account,
      maestroMode: false,
      status: 'idle',
    },
  };

  state.nodes.set(nodeId, termNode);

  // Auto-connect to caller terminal
  state.connections.push({
    fromId: req.terminalId,
    toId: nodeId,
    label: 'Teammate',
  });

  sendToMain({
    type: 'placeNode',
    id: `place-${nodeId}`,
    payload: {
      width: 640,
      height: 480,
      existingNodes: Array.from(state.nodes.values()),
      anchorNodeId: req.terminalId,
      placementDirection: 'right',
    },
  });

  return {
    output: `Recruited teammate "${name}" [preset: ${preset}]${role ? ` [role: ${role}]` : ''} (ID: ${terminalId.slice(0, 8)}). Auto-connected.`,
    exitCode: 0,
    data: { terminalId, nodeId, name },
  };
};
