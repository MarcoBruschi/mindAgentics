import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CommandHandler } from '../../daemon/pipeServer.js';
import type { FileRefNode } from '@mindagentics/shared';
import { sanitizeLabel } from '@mindagentics/shared';
import { placeNode } from '../../daemon/spatial.js';
import { getAgentRefs, notifyRefsChanged, terminalNodeIds, toAgentRef } from '../../daemon/refs.js';
import { resolveWorkspacePath } from '../../security/pathSafety.js';

const HELP = `mindagentics ref <add|list|remove>

  add <caminho> [--label "<nome>"] [--to "<agente>"] [--no-connect]
      Cria uma referência (arquivo ou pasta) no canvas. Só o caminho e o tipo são
      compartilhados com o agente; o conteúdo do arquivo nunca é lido nem injetado.
      Por padrão liga a referência ao terminal que executou o comando. Use --to para
      ligar a outro agente (injeta a linha "[ref] pasta: <caminho>" no terminal dele).
  list [--all]
      Lista as referências ligadas ao agente atual (--all: todas do canvas).
  remove <caminho|nome> [--from "<agente>"]
      Remove a referência do canvas (ou só o vínculo com o agente quando --from).`;

function samePath(a: string, b: string): boolean {
  const norm = (p: string) => path.resolve(p).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
}

function findRefNodes(state: any, query: string, baseCwd: string): FileRefNode[] {
  const q = query.trim().toLowerCase();
  const resolved = path.resolve(baseCwd, query);
  const out: FileRefNode[] = [];
  for (const node of state.nodes.values()) {
    if (node.kind !== 'fileRef') continue;
    const c = (node as FileRefNode).content;
    if (
      node.id.toLowerCase() === q ||
      (c.label || '').toLowerCase() === q ||
      samePath(c.path, resolved) ||
      samePath(c.path, query)
    ) {
      out.push(node as FileRefNode);
    }
  }
  return out;
}

function callerNodeId(state: any, terminalId?: string): string | undefined {
  if (!terminalId) return undefined;
  for (const node of state.nodes.values()) {
    if (node.kind === 'terminal' && (node.content?.terminalId === terminalId || node.id === terminalId)) {
      return node.id;
    }
  }
  return undefined;
}

function link(state: any, sendToMain: (f: any) => void, fromId: string, toId: string) {
  const exists = state.connections.some(
    (c: any) => (c.fromId === fromId && c.toId === toId) || (c.fromId === toId && c.toId === fromId),
  );
  if (exists) return;
  state.connections.push({ fromId, toId, label: 'Reference' });
  const tieId = `tie-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  sendToMain({
    type: 'cableTieCreated',
    id: tieId,
    payload: { id: tieId, fromNodeId: fromId, toNodeId: toId, label: 'Reference' },
  });
}

export const refCommand: CommandHandler = async (req, state, _router, _scheduler, sendToMain) => {
  const [sub, ...rest] = req.args;
  const action = (sub || '').toLowerCase();
  const baseCwd = req.cwd || process.cwd();

  if (!action || action === 'help' || req.options.help) {
    return { output: HELP, exitCode: 0 };
  }

  switch (action) {
    case 'add': {
      const target = rest[0];
      if (!target) {
        return { error: 'mindagentics ref add: caminho obrigatório. Uso: mindagentics ref add <caminho>', exitCode: 1 };
      }
      const caller = req.terminalId ? state.terminals.get(req.terminalId) : undefined;
      const ws = caller ? state.workspaces.get(caller.workspaceId) : req.workspaceId ? state.workspaces.get(req.workspaceId) : undefined;
      const wsRoot = ws?.workingDirectory || baseCwd;
      const confirmOutside = Boolean(req.options['confirm-outside'] || req.options.confirmOutside || req.options.force || req.options.yes || req.options.y);

      const check = resolveWorkspacePath(wsRoot, target, { confirmOutside });
      if (!check.ok) {
        return { error: `mindagentics ref add: ${check.message}`, exitCode: 1 };
      }
      const abs = check.path!;
      let isDirectory: boolean;
      try {
        isDirectory = fs.statSync(abs).isDirectory();
      } catch {
        return { error: `mindagentics ref add: caminho não encontrado: "${abs}"`, exitCode: 1 };
      }

      const existing = findRefNodes(state, abs, baseCwd).find((n) => samePath(n.content.path, abs));
      let node: FileRefNode;
      let created = false;
      if (existing) {
        node = existing;
      } else {
        created = true;
        const rawLabel = (typeof req.options.label === 'string' && req.options.label) || path.basename(abs) || abs;
        const label = sanitizeLabel(rawLabel, 80);
        const anchor = callerNodeId(state, req.terminalId);
        const width = 140;
        const height = 128;
        const coords = placeNode({
          width,
          height,
          existingNodes: Array.from(state.nodes.values()),
          anchorNodeId: anchor,
          placementDirection: 'right',
        });
        node = {
          id: `node-ref-${randomUUID().slice(0, 8)}`,
          kind: 'fileRef',
          x: coords.x,
          y: coords.y,
          width,
          height,
          zIndex: 10,
          content: { path: abs, isDirectory, label },
        };
        state.nodes.set(node.id, node);
        sendToMain({
          type: 'placeNode',
          id: `place-${node.id}`,
          payload: {
            node,
            width,
            height,
            existingNodes: Array.from(state.nodes.values()),
            anchorNodeId: anchor,
            placementDirection: 'right',
          },
        });
      }

      // Connect: --to <agent> (injects the [ref] line) or the calling terminal.
      let connectedTo = '';
      const noConnect = req.options['no-connect'] === true || req.options.connect === 'false';
      if (!noConnect) {
        const toName = typeof req.options.to === 'string' ? req.options.to : undefined;
        const term = toName
          ? state.getTerminalByNameOrId(toName, req.workspaceId)
          : req.terminalId
            ? state.terminals.get(req.terminalId)
            : undefined;
        if (toName && !term) {
          return { error: `mindagentics ref add: agente "${toName}" não encontrado.`, exitCode: 1 };
        }
        const termNode = term ? callerNodeId(state, term.id) : undefined;
        if (term && termNode) {
          const already = state.connections.some(
            (c: any) => (c.fromId === node.id && c.toId === termNode) || (c.fromId === termNode && c.toId === node.id),
          );
          link(state, sendToMain, node.id, termNode);
          // Inject the [ref] line only when wiring a different agent (the caller already knows the path).
          notifyRefsChanged(state, term.id, sendToMain, toName && !already ? node.content : undefined);
          connectedTo = term.title;
        }
      }

      return {
        output: `${created ? 'Referência criada' : 'Referência já existente'}: ${isDirectory ? 'pasta' : 'arquivo'} "${node.content.label}" (${abs})${connectedTo ? ` — ligada a "${connectedTo}"` : ''}.`,
        exitCode: 0,
        data: { nodeId: node.id, path: abs, isDirectory, created },
      };
    }

    case 'list': {
      const refs = req.options.all
        ? Array.from(state.nodes.values()).map(toAgentRef).filter((r): r is NonNullable<typeof r> => !!r)
        : req.terminalId
          ? getAgentRefs(state, req.terminalId)
          : [];
      if (refs.length === 0) {
        return { output: 'Nenhuma referência de arquivo/pasta no canvas.', exitCode: 0, data: { refs: [] } };
      }
      const lines = refs.map((r) => `- [${r.isDirectory ? 'pasta' : 'arquivo'}] "${r.label}" ${r.path} (ID: ${r.nodeId})`);
      return { output: ['Referências:', ...lines].join('\n'), exitCode: 0, data: { refs } };
    }

    case 'remove':
    case 'rm':
    case 'delete': {
      const target = rest[0];
      if (!target) {
        return { error: 'mindagentics ref remove: informe o caminho ou nome. Uso: mindagentics ref remove <caminho|nome>', exitCode: 1 };
      }
      const nodes = findRefNodes(state, target, baseCwd);
      if (nodes.length === 0) {
        return { error: `mindagentics ref remove: referência "${target}" não encontrada.`, exitCode: 1 };
      }

      const fromName = typeof req.options.from === 'string' ? req.options.from : undefined;
      const affected = new Set<string>();
      for (const node of nodes) {
        // Terminals wired to this ref (needed to refresh their AGENTS.md).
        for (const term of state.terminals.values()) {
          if (getAgentRefs(state, term.id).some((r) => r.nodeId === node.id)) affected.add(term.id);
        }

        if (fromName) {
          const term = state.getTerminalByNameOrId(fromName, req.workspaceId);
          if (!term) return { error: `mindagentics ref remove: agente "${fromName}" não encontrado.`, exitCode: 1 };
          const ids = terminalNodeIds(state, term.id);
          state.connections = state.connections.filter(
            (c: any) => !((c.fromId === node.id && ids.has(c.toId)) || (c.toId === node.id && ids.has(c.fromId))),
          );
          sendToMain({
            type: 'cableTieDeleted',
            id: `del-tie-${Date.now()}`,
            payload: { fromNodeId: node.id, toNodeId: callerNodeId(state, term.id) || term.id },
          });
        } else {
          state.connections = state.connections.filter((c: any) => c.fromId !== node.id && c.toId !== node.id);
          state.nodes.delete(node.id);
          sendToMain({ type: 'deleteNode', id: `del-${node.id}`, payload: { nodeId: node.id } });
        }
      }
      for (const termId of affected) notifyRefsChanged(state, termId, sendToMain);

      return {
        output: fromName
          ? `Vínculo removido: "${nodes[0].content.label}" ↔ "${fromName}".`
          : `Referência removida do canvas: ${nodes.map((n) => `"${n.content.label}"`).join(', ')}.`,
        exitCode: 0,
        data: { removed: nodes.map((n) => n.id) },
      };
    }

    default:
      return { error: `mindagentics ref: subcomando desconhecido "${action}".\n\n${HELP}`, exitCode: 1 };
  }
};
