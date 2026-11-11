import type { CommandHandler } from '../../daemon/pipeServer.js';

export const notifyCommand: CommandHandler = async (req, state, router, scheduler, sendToMain) => {
  const message = req.args.join(' ') || req.options.message;
  if (!message) {
    return {
      error: 'mindagentics notify: message required. Usage: mindagentics notify "message"',
      exitCode: 1,
    };
  }

  const caller = state.terminals.get(req.terminalId);
  if (caller) {
    caller.status = 'attention';
  }

  sendToMain({
    type: 'orchestratorAttention',
    payload: {
      terminalId: req.terminalId,
      message,
      level: 'info',
    },
  });

  return {
    output: `Notification sent: "${message}"`,
    exitCode: 0,
  };
};
