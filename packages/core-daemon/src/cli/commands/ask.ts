import type { CommandHandler } from '../../daemon/pipeServer.js';

function parseRawEscapes(str: string): string {
  return str
    .replace(/\\e/g, '\x1b')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\x([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

export const askCommand: CommandHandler = async (req, state, router) => {
  // Check for --batch option
  if (req.options.batch) {
    let batchMap: Record<string, string>;
    try {
      batchMap = typeof req.options.batch === 'string'
        ? JSON.parse(req.options.batch)
        : req.options.batch;
    } catch (e: any) {
      return {
        error: `maestri ask: invalid JSON for --batch: ${e.message}`,
        exitCode: 1,
      };
    }

    const results = await router.askBatch(req.terminalId, batchMap, {
      callerWorkspaceId: req.workspaceId,
    });

    return {
      output: JSON.stringify(results, null, 2),
      exitCode: results.some((r) => r.error) ? 1 : 0,
      data: results,
    };
  }

  // Single ask
  const [targetName, ...promptParts] = req.args;
  let rawPrompt = req.options.raw || promptParts.join(' ');

  if (!targetName) {
    return {
      error: 'maestri ask: target agent name required. Usage: maestri ask "Agent Name" "prompt"',
      exitCode: 1,
    };
  }

  const isRaw = Boolean(req.options.raw);
  if (isRaw && typeof req.options.raw === 'string') {
    rawPrompt = parseRawEscapes(req.options.raw);
  }

  if (!rawPrompt) {
    return {
      error: 'maestri ask: prompt or --raw input required.',
      exitCode: 1,
    };
  }

  try {
    const result = await router.askAgent(req.terminalId, targetName, rawPrompt, {
      raw: isRaw,
      callerWorkspaceId: req.workspaceId,
    });

    return {
      output: result,
      exitCode: 0,
    };
  } catch (err: any) {
    return {
      error: `maestri ask error: ${err.message}`,
      exitCode: 1,
    };
  }
};
