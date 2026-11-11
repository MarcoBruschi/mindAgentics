import type { CommandHandler } from '../../daemon/pipeServer.js';

export const listCommand: CommandHandler = async (req, state) => {
  const caller = state.terminals.get(req.terminalId);
  const callerTitle = caller ? caller.title : 'Current Terminal';
  const callerWs = caller ? state.workspaces.get(caller.workspaceId) : undefined;
  const callerWsName = callerWs ? callerWs.name : 'Current Workspace';

  const lines: string[] = [];

  // You section
  const callerMaestro = (caller?.orchestratorMode || caller?.maestroMode) ? ' [🎼 Orchestrator Mode Active]' : '';
  lines.push('You:');
  lines.push(`  ${callerTitle}${callerMaestro} (ID: ${req.terminalId.slice(0, 8)})`);
  if (callerWs) {
    lines.push(`  ${callerTitle} @ ${callerWsName}`);
  }
  lines.push('');

  // Caller node mapping and cable ties resolution
  const callerIds = new Set<string>([req.terminalId]);
  for (const [id, node] of state.nodes.entries()) {
    if (node.kind === 'terminal' && (node.content?.terminalId === req.terminalId || node.id === req.terminalId)) {
      callerIds.add(node.id);
      if (node.content?.terminalId) callerIds.add(node.content.terminalId);
    }
  }

  const connectedNodeIds = new Set<string>();
  for (const conn of state.connections) {
    if (callerIds.has(conn.fromId)) {
      connectedNodeIds.add(conn.toId);
    }
    if (callerIds.has(conn.toId)) {
      connectedNodeIds.add(conn.fromId);
    }
  }

  // Teammates / Recruits
  lines.push('Connected Agents:');
  let hasAgents = false;
  for (const term of state.terminals.values()) {
    if (term.id === req.terminalId) continue;
    hasAgents = true;
    const maestroStr = (term.orchestratorMode || term.maestroMode) ? ' [🎼 Orquestrador]' : '';
    const roleStr = term.agentRole ? ` [Role: ${term.agentRole}]` : '';
    const presetStr = term.presetId ? ` (${term.presetId})` : '';
    const statusStr = ` [${term.status}]`;
    const accStr = term.account ? ` (Account: ${term.account})` : '';
    lines.push(`  * ${term.title}${maestroStr}${roleStr}${presetStr}${statusStr}${accStr}`);
  }
  if (!hasAgents) {
    lines.push('  (none connected)');
  }
  lines.push('');

  // Notes
  lines.push('Connected Notes:');
  let hasNotes = false;
  for (const node of state.nodes.values()) {
    if (node.kind === 'note') {
      const isConnected =
        connectedNodeIds.has(node.id) ||
        (node.content?.noteId && connectedNodeIds.has(node.content.noteId));

      if (isConnected || state.connections.length === 0) {
        hasNotes = true;
        const n = node.content;
        const lockStr = n.locked ? ' [locked: true]' : '';
        const stackStr = n.stackId ? ` (in stack "${n.stackId}")` : '';
        lines.push(`  * "${n.title}" [color: ${n.color}]${lockStr}${stackStr}`);
      }
    }
  }
  if (!hasNotes) {
    lines.push('  (none connected)');
  }
  lines.push('');

  // Portals
  lines.push('Connected Portals:');
  let hasPortals = false;
  for (const node of state.nodes.values()) {
    if (node.kind === 'portal') {
      hasPortals = true;
      const p = node.content;
      const name = p.title || (p.portalKind === 'device' ? (p.deviceName || 'Device') : 'Portal');
      const target = p.portalKind === 'device' ? `[device: ${p.deviceName || 'Android'}]` : (p.url || 'blank');
      const vp = p.viewport ? ` (${p.viewport.width}x${p.viewport.height})` : '';
      lines.push(`  * "${name}" -> ${target}${vp} [read with: mindagentics portal read "${name}"]`);
    }
  }
  if (!hasPortals) {
    lines.push('  (none connected)');
  }
  lines.push('');

  // Bands
  lines.push('Bands:');
  let hasBands = false;
  for (const node of state.nodes.values()) {
    if (node.kind === 'band') {
      hasBands = true;
      const b = (node as any).content || node;
      const members = Array.isArray(b.memberNodeIds) ? b.memberNodeIds.join(', ') : '';
      lines.push(`  * "${b.title}" [members: ${members || 'empty'}]`);
    }
  }
  if (!hasBands) {
    lines.push('  (none)');
  }

  return {
    output: lines.join('\n'),
    exitCode: 0,
  };
};
