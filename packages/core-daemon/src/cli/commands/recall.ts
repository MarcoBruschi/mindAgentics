import type { CommandHandler } from '../../daemon/pipeServer.js';

export const recallCommand: CommandHandler = async (req, state) => {
  const query = req.args.join(' ').toLowerCase();
  if (!query) {
    return {
      error: 'mindagentics recall: search query required. Usage: mindagentics recall "query"',
      exitCode: 1,
    };
  }

  const matches = state.memoryEntries.filter((m) =>
    m.text.toLowerCase().includes(query),
  );

  if (matches.length === 0) {
    return {
      output: `No terminal memory matched query: "${query}"`,
      exitCode: 0,
    };
  }

  const lines: string[] = [`Memory search results for "${query}":`, ''];
  for (const m of matches.slice(-10)) {
    const term = state.terminals.get(m.terminalId);
    const termTitle = term ? term.title : m.terminalId.slice(0, 8);
    lines.push(`[${m.timestamp}] (${termTitle}):`);
    lines.push(m.text.slice(0, 300) + (m.text.length > 300 ? '...' : ''));
    lines.push('---');
  }

  return {
    output: lines.join('\n'),
    exitCode: 0,
  };
};
