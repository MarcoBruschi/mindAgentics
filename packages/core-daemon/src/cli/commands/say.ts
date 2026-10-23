import type { CommandHandler } from '../../daemon/pipeServer.js';

export const sayCommand: CommandHandler = async (req, state, router, scheduler, sendToMain) => {
  const message = req.args.join(' ') || req.options.message;
  if (!message) {
    return {
      error: 'mindagentics say: message required. Usage: mindagentics say "message"',
      exitCode: 1,
    };
  }

  const caller = state.terminals.get(req.terminalId);
  const callerName = caller ? caller.title : 'Agent';

  // Broadcast to all connected terminals' scrollbacks
  for (const term of state.terminals.values()) {
    if (term.id !== req.terminalId) {
      term.scrollback.push(`[${callerName}]: ${message}`);
    }
  }

  sendToMain({
    type: 'chatProtocolResult',
    payload: {
      type: 'say',
      fromTerminalId: req.terminalId,
      message,
    },
  });

  return {
    output: `Broadcast from ${callerName}: "${message}"`,
    exitCode: 0,
  };
};
