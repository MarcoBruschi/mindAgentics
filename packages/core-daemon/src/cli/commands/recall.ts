import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CommandHandler } from '../../daemon/pipeServer.js';
import {
  agentSlug,
  findMemoryRoot,
  listAgentMemoryDirs,
  searchMemory,
} from '../../memory/memorySearch.js';

const USAGE = 'Uso: mindagentics recall "<termo>" [--agent "<nome>"] [--all] [--limit <n>]';

export const recallCommand: CommandHandler = async (req, state) => {
  const rawQuery = req.args.join(' ').trim();
  if (!rawQuery) {
    return { error: `mindagentics recall: termo de busca obrigatório. ${USAGE}`, exitCode: 1 };
  }
  const limit = Math.max(1, Math.min(10, Number(req.options.limit) || 3));

  // ---- 1) per-agent turn memory (.mindagentics/memory/<agente>/)
  const caller = req.terminalId ? state.terminals.get(req.terminalId) : undefined;
  const roots = new Set<string>();
  const callerWs = caller ? state.workspaces.get(caller.workspaceId) : req.workspaceId ? state.workspaces.get(req.workspaceId) : undefined;
  for (const start of [req.cwd, callerWs?.workingDirectory]) {
    const root = findMemoryRoot(start);
    if (root) roots.add(path.resolve(root));
  }

  const wantAll = Boolean(req.options.all);
  const agentName =
    (typeof req.options.agent === 'string' && req.options.agent) || caller?.title || '';
  const dirs: string[] = [];
  for (const root of roots) {
    if (wantAll || !agentName) {
      dirs.push(...listAgentMemoryDirs(root));
    } else {
      const dir = path.join(root, agentSlug(agentName));
      dirs.push(dir);
    }
  }

  const existingDirs = Array.from(new Set(dirs)).filter((d) => {
    try {
      return fs.existsSync(d) && fs.statSync(d).isDirectory();
    } catch {
      return false;
    }
  });

  if (existingDirs.length > 0) {
    const { engine, hits } = searchMemory(existingDirs, rawQuery, limit);
    if (hits.length > 0) {
      const lines = [
        `Memória${wantAll || !agentName ? '' : ` de "${agentName}"`} — "${rawQuery}" (${hits.length} trecho${hits.length > 1 ? 's' : ''}, ${engine}):`,
        '',
      ];
      hits.forEach((h, i) => {
        lines.push(`[${i + 1}] ${h.ts.slice(0, 16).replace('T', ' ')} · ${h.agent} · turno ${h.turn}`);
        lines.push(h.excerpt);
        lines.push('---');
      });
      return { output: lines.join('\n'), exitCode: 0, data: { engine, hits } };
    }
  }

  // ---- 2) legacy global memory (ask/chat turns recorded by the router)
  const query = rawQuery.toLowerCase();
  const matches = state.memoryEntries.filter((m) => m.text.toLowerCase().includes(query));
  if (matches.length === 0) {
    return { output: `Nenhuma memória encontrada para: "${rawQuery}"`, exitCode: 0, data: { hits: [] } };
  }

  const lines: string[] = [`Memória global — "${rawQuery}":`, ''];
  for (const m of matches.slice(-limit)) {
    const term = state.terminals.get(m.terminalId);
    const termTitle = term ? term.title : m.terminalId.slice(0, 8);
    lines.push(`[${m.timestamp}] (${termTitle}):`);
    lines.push(m.text.slice(0, 300) + (m.text.length > 300 ? '...' : ''));
    lines.push('---');
  }
  return { output: lines.join('\n'), exitCode: 0 };
};
