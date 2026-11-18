/**
 * Stdio JSON-RPC Handler for Host Runtime Process
 * Implements framed JSON-RPC communication between daemon and host process.
 */

import { snapNode, tidyNode, placeNode } from './spatial.js';
import { notifyRefsChanged } from './refs.js';
import type { DaemonState } from './state.js';
import type { MessageRouter } from './router.js';
import type { RoutineScheduler } from './scheduler.js';
import type {
  RpcRequestFrame,
  RpcResponseFrame,
  RpcNotificationFrame,
  SnapNodePayload,
  TidyNodePayload,
  PlaceNodePayload,
  FloorCreateKindPayload,
  FloorStatusPayload,
} from '@mindagentics/shared';

export class RpcHandler {
  constructor(
    private state: DaemonState,
    private router: MessageRouter,
    private scheduler: RoutineScheduler,
    private sendFrame: (frame: any) => void,
  ) {}

  public handleFrame(frame: any) {
    if (!frame || typeof frame !== 'object') return;

    const { type, id, payload } = frame;

    // Handle responses or notifications
    switch (type) {
      case 'snapNode': {
        const result = snapNode(payload as SnapNodePayload);
        this.sendResult(id, 'snapNodeResult', result);
        break;
      }

      case 'tidyNode': {
        const result = tidyNode(payload as TidyNodePayload);
        this.sendResult(id, 'tidyNodeResult', result);
        break;
      }

      case 'placeNode': {
        const result = placeNode(payload as PlaceNodePayload);
        this.sendResult(id, 'placeNodeResult', result);
        break;
      }

      case 'floorCreateKind': {
        const { repoRoot } = payload as FloorCreateKindPayload;
        // Check if git repo exists at repoRoot
        const isGit = Boolean(repoRoot);
        this.sendResult(id, 'floorCreateKindResult', {
          kind: isGit ? 'worktree' : 'plain',
          canUseWorktree: isGit,
          canCopyIndependently: true,
        });
        break;
      }

      case 'floorStatus': {
        const { workspaceId, floorId, text, state, progress, clear } = payload as FloorStatusPayload;
        if (clear) {
          this.state.setFloorStatus(workspaceId, floorId, null, null, null);
          this.sendResult(id, 'floorStatusVerdictResult', { ok: true, cleared: true });
        } else if (text !== undefined || state !== undefined || progress !== undefined) {
          const info = this.state.setFloorStatus(workspaceId, floorId, text ?? null, state ?? null, progress ?? null);
          this.sendResult(id, 'floorStatusVerdictResult', { ok: true, status: info });
        } else {
          const current = this.state.getFloorStatus(workspaceId, floorId);
          this.sendResult(id, 'floorStatusVerdictResult', { ok: true, status: current });
        }
        break;
      }

      case 'agentUsage': {
        if (payload?.terminalId) {
          this.state.recordUsage(
            payload.terminalId,
            payload.tokensIn || 0,
            payload.tokensOut || 0,
            payload.cost || 0,
          );
        }
        this.sendResult(id, 'agentUsageState', this.state.usage);
        break;
      }

      case 'syncRoutines':
      case 'loadRoutines': {
        if (Array.isArray(payload?.routines)) {
          this.scheduler.loadRoutines(payload.routines);
        } else if (Array.isArray(payload)) {
          this.scheduler.loadRoutines(payload);
        }
        break;
      }

      case 'settleTurn':
      case 'chatTurnSettled': {
        if (payload?.terminalId) {
          this.router.settleTurn(payload.terminalId, payload.output || '', payload.askId);
        }
        if (id) {
          this.sendResult(id, type + 'Result', { handled: true });
        }
        break;
      }

      case 'terminalMemory': {
        if (payload?.terminalId && payload?.content) {
          this.state.memoryEntries.push({
            terminalId: payload.terminalId,
            text: payload.content,
            timestamp: new Date().toISOString(),
          });
        }
        break;
      }

      case 'unregisterTerminal': {
        if (payload?.terminalId) {
          this.state.unregisterTerminal(payload.terminalId);
        }
        break;
      }

      case 'syncCanvas': {
        const prevNodes = new Map(this.state.nodes);
        const prevConnections = [...this.state.connections];

        if (Array.isArray(payload?.nodes)) {
          this.state.nodes.clear();
          const activeTerminalIds = new Set<string>();

          for (const node of payload.nodes) {
            this.state.nodes.set(node.id, node);
            if (node.kind === 'terminal' && node.content?.terminalId) {
              activeTerminalIds.add(node.content.terminalId);
              const existing = this.state.terminals.get(node.content.terminalId);
              if (existing) {
                existing.title = node.content.title;
                existing.agentRole = node.content.agentRole;
                existing.orchestratorMode = Boolean(node.content.orchestratorMode ?? node.content.maestroMode);
                existing.maestroMode = Boolean(node.content.orchestratorMode ?? node.content.maestroMode);
              } else {
                this.state.registerTerminal({
                  id: node.content.terminalId,
                  title: node.content.title || 'Terminal',
                  workspaceId: payload.workspaceId || 'default',
                  floorId: payload.floorId || 'ground',
                  presetId: node.content.presetId,
                  agentRole: node.content.agentRole,
                  account: node.content.account,
                  orchestratorMode: Boolean(node.content.orchestratorMode ?? node.content.maestroMode),
                  maestroMode: Boolean(node.content.orchestratorMode ?? node.content.maestroMode),
                  status: 'idle',
                  scrollback: [],
                });
              }
            }
          }

          // Expurgar referências a terminais/agentes que foram apagados do canvas
          for (const [termId] of this.state.terminals.entries()) {
            if (!activeTerminalIds.has(termId)) {
              this.state.unregisterTerminal(termId);
            }
          }
        }
        if (Array.isArray(payload?.cableTies)) {
          const newConnections = payload.cableTies.map((c: any) => ({
            fromId: c.fromNodeId || c.fromId,
            toId: c.toNodeId || c.toId,
            label: c.label,
          }));

          const getRefTermPair = (fromId: string, toId: string, nodeMap: Map<string, any>) => {
            const fromNode = nodeMap.get(fromId);
            const toNode = nodeMap.get(toId);
            if (fromNode?.kind === 'fileRef' && (toNode?.kind === 'terminal' || this.state.terminals.has(toId))) {
              const termId = (toNode?.content as any)?.terminalId || toId;
              return { refNode: fromNode, terminalId: termId };
            }
            if (toNode?.kind === 'fileRef' && (fromNode?.kind === 'terminal' || this.state.terminals.has(fromId))) {
              const termId = (fromNode?.content as any)?.terminalId || fromId;
              return { refNode: toNode, terminalId: termId };
            }
            return null;
          };

          const prevPairs = new Map<string, { refNode: any; terminalId: string }>();
          for (const conn of prevConnections) {
            const pair = getRefTermPair(conn.fromId, conn.toId, prevNodes);
            if (pair) {
              prevPairs.set(`${pair.refNode.id}::${pair.terminalId}`, pair);
            }
          }

          const newPairs = new Map<string, { refNode: any; terminalId: string }>();
          for (const conn of newConnections) {
            const pair = getRefTermPair(conn.fromId, conn.toId, this.state.nodes);
            if (pair) {
              newPairs.set(`${pair.refNode.id}::${pair.terminalId}`, pair);
            }
          }

          this.state.connections = newConnections;

          // Avisar o agente imediatamente no terminal quando ligado via UI (mouse / cabo)
          for (const [key, pair] of newPairs.entries()) {
            if (!prevPairs.has(key)) {
              const content = pair.refNode.content || {};
              notifyRefsChanged(this.state, pair.terminalId, this.sendFrame.bind(this), {
                path: String(content.path || ''),
                isDirectory: Boolean(content.isDirectory),
              });
            }
          }

          // Avisar desvinculação para atualizar o AGENTS.md
          for (const [key, pair] of prevPairs.entries()) {
            if (!newPairs.has(key)) {
              notifyRefsChanged(this.state, pair.terminalId, this.sendFrame.bind(this));
            }
          }
        }
        break;
      }

      case 'syncWorkspaces': {
        if (Array.isArray(payload?.workspaces)) {
          this.state.workspaces.clear();
          for (const ws of payload.workspaces) {
            if (ws && ws.id) {
              this.state.workspaces.set(ws.id, {
                id: ws.id,
                name: ws.name || 'Workspace',
                workingDirectory: ws.workingDirectory || ws.rootPath || ws.dir || '',
              });
            }
          }
        }
        break;
      }

      case 'query': {
        const queryTarget = payload?.target;
        if (queryTarget === 'accounts') {
          this.sendResult(id, 'accountsResult', { accounts: [] });
        } else if (queryTarget === 'asksInFlight') {
          this.sendResult(id, 'asksInFlight', this.state.getAsksInFlightPayload());
        } else {
          this.sendResult(id, 'queryResult', { status: 'ok', queryTarget });
        }
        break;
      }

      default:
        // Echo back unhandled requests with empty result
        if (id) {
          this.sendResult(id, `${type}Result`, { handled: true });
        }
        break;
    }
  }

  private sendResult(id: string, type: string, result: any) {
    this.sendFrame({
      type,
      id,
      payload: {
        ok: true,
        result,
      },
    });
  }

  private sendError(id: string, type: string, code: string, message: string) {
    this.sendFrame({
      type,
      id,
      payload: {
        ok: false,
        refusal: {
          code,
          message,
        },
      },
    });
  }
}
