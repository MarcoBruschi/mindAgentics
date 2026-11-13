/**
 * fileRef helpers: resolve which file/folder references are wired to an agent
 * terminal and notify the main process so it can refresh AGENTS.md.
 *
 * Privacy/size rule: only the path and the type (arquivo/pasta) ever leave
 * this module. The content of a referenced file is never read or injected.
 */

import type { DaemonState } from './state.js';
import { sanitizeForPtyLine } from '@mindagentics/shared';

export interface AgentRef {
  nodeId: string;
  path: string;
  isDirectory: boolean;
  label: string;
}

function stripControl(text: string): string {
  // eslint-disable-next-line no-control-regex
  return String(text ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
}

/** Node IDs (canvas node id + terminal id) that identify the given terminal. */
export function terminalNodeIds(state: DaemonState, terminalId: string): Set<string> {
  const ids = new Set<string>([terminalId]);
  for (const node of state.nodes.values()) {
    if (node.kind !== 'terminal') continue;
    const content = node.content as any;
    if (node.id === terminalId || content?.terminalId === terminalId) {
      ids.add(node.id);
      if (content?.terminalId) ids.add(content.terminalId);
    }
  }
  return ids;
}

export function toAgentRef(node: any): AgentRef | null {
  if (!node || node.kind !== 'fileRef' || !node.content?.path) return null;
  return {
    nodeId: node.id,
    path: String(node.content.path),
    isDirectory: Boolean(node.content.isDirectory),
    label: String(node.content.label || node.content.path),
  };
}

/** Every fileRef currently connected (either direction) to the terminal. */
export function getAgentRefs(state: DaemonState, terminalId: string): AgentRef[] {
  const ids = terminalNodeIds(state, terminalId);
  const refs = new Map<string, AgentRef>();
  for (const conn of state.connections) {
    const otherId = ids.has(conn.fromId) ? conn.toId : ids.has(conn.toId) ? conn.fromId : null;
    if (!otherId) continue;
    const ref = toAgentRef(state.nodes.get(otherId));
    if (ref) refs.set(ref.nodeId, ref);
  }
  return Array.from(refs.values());
}

/** The single line injected in the terminal: path + type only. Sanitized against terminal injection. */
export function refLine(ref: { path: string; isDirectory: boolean }): string {
  const safePath = sanitizeForPtyLine(ref.path);
  return `[ref] ${ref.isDirectory ? 'pasta' : 'arquivo'}: ${safePath}`;
}

/**
 * Tell the main process the reference set of a terminal changed (it rewrites the
 * agent's AGENTS.md block) and optionally type one `[ref] ...` line in the pty.
 */
export function notifyRefsChanged(
  state: DaemonState,
  terminalId: string,
  sendToMain: (frame: any) => void,
  inject?: { path: string; isDirectory: boolean },
): AgentRef[] {
  const refs = getAgentRefs(state, terminalId);
  sendToMain({
    type: 'agentRefsChanged',
    id: `refs-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    payload: {
      terminalId,
      refs: refs.map((r) => ({ path: r.path, isDirectory: r.isDirectory, label: r.label })),
    },
  });
  if (inject) {
    sendToMain({
      type: 'ptyWrite',
      id: `refline-${Date.now()}`,
      payload: { terminalId, data: refLine(inject) + '\r' },
    });
  }
  return refs;
}
