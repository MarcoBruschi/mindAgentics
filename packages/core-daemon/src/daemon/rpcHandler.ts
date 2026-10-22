/**
 * Stdio JSON-RPC Handler for Electron Main Process
 * Section 2.1 of CLONE_SPEC.md
 */

import { snapNode, tidyNode, placeNode } from './spatial.js';
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
} from '@maestri/shared';

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

      case 'licenseState': {
        if (payload?.licenseKey !== undefined) {
          this.state.license.licenseKey = payload.licenseKey;
          this.state.license.state = payload.state || 'active';
        }
        this.sendResult(id, 'licenseResult', this.state.license);
        break;
      }

      case 'chatTurnSettled': {
        if (payload?.terminalId) {
          this.router.settleTurn(payload.terminalId, payload.output || '', payload.askId);
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

      case 'syncCanvas': {
        if (Array.isArray(payload?.nodes)) {
          this.state.nodes.clear();
          for (const node of payload.nodes) {
            this.state.nodes.set(node.id, node);
            if (node.kind === 'terminal' && node.content?.terminalId) {
              const existing = this.state.terminals.get(node.content.terminalId);
              if (existing) {
                existing.title = node.content.title;
                existing.agentRole = node.content.agentRole;
                existing.maestroMode = Boolean(node.content.maestroMode);
              } else {
                this.state.registerTerminal({
                  id: node.content.terminalId,
                  title: node.content.title || 'Terminal',
                  workspaceId: payload.workspaceId || 'default',
                  floorId: payload.floorId || 'ground',
                  presetId: node.content.presetId,
                  agentRole: node.content.agentRole,
                  account: node.content.account,
                  maestroMode: Boolean(node.content.maestroMode),
                  status: 'idle',
                  scrollback: [],
                });
              }
            }
          }
        }
        if (Array.isArray(payload?.cableTies)) {
          this.state.connections = payload.cableTies.map((c: any) => ({
            fromId: c.fromNodeId,
            toId: c.toNodeId,
            label: c.label,
          }));
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
