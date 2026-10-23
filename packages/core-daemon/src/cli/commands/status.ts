import type { CommandHandler } from '../../daemon/pipeServer.js';

export const statusCommand: CommandHandler = async (req, state) => {
  const caller = state.terminals.get(req.terminalId);
  const callerTitle = caller ? caller.title : 'Current Terminal';
  const role = caller?.agentRole || 'None';
  const preset = caller?.presetId || 'Default';
  const maestro = (caller?.maestroMode ?? req.options?.maestroMode) ? 'Enabled' : 'Disabled';
  const status = caller?.status || 'idle';

  const ws = caller ? state.workspaces.get(caller.workspaceId) : undefined;
  const wsName = ws ? ws.name : (req.workspaceId || 'Default Workspace');

  return {
    output: [
      'mindAgentics Terminal Status:',
      `  Terminal ID:   ${req.terminalId}`,
      `  Title:         ${callerTitle}`,
      `  Role:          ${role}`,
      `  Preset:        ${preset}`,
      `  Maestro Mode:  ${maestro}`,
      `  Status:        ${status}`,
      `  Workspace:     ${wsName}`,
      `  Floor:         ${req.floorId || 'Ground Floor'}`,
      `  Connected Nodes: ${state.connections.filter((c: any) => c.fromId === req.terminalId || c.toId === req.terminalId).length}`,
      `  Daemon Health: OK`,
    ].join('\n'),
    exitCode: 0,
  };
};
