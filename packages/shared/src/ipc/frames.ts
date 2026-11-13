/**
 * Stdio JSON-RPC & Named Pipe Frame Protocol Types
 * Structured protocols for Stdio JSON-RPC & Named Pipe inter-process communication.
 */

import type { CanvasNode, NodeBounds } from '../models/nodes.js';
import type { FloorStatusState } from '../models/workspace.js';

// Base RPC frame interfaces
export interface RpcRequestFrame<T = any> {
  type: string;
  id: string;
  payload: T;
}

export interface RpcSuccessPayload<T = any> {
  ok: true;
  result: T;
}

export interface RpcErrorPayload {
  ok: false;
  refusal: {
    code: string;
    message: string;
    details?: any;
  };
}

export interface RpcResponseFrame<T = any> {
  type: string;
  id: string;
  payload: RpcSuccessPayload<T> | RpcErrorPayload;
}

export interface RpcNotificationFrame<T = any> {
  type: string;
  payload: T;
}

export type DaemonFrame = RpcRequestFrame | RpcResponseFrame | RpcNotificationFrame;

// Specific Stdio Frame Payloads
export interface ReadyNotificationPayload {
  envVarName: 'MINDAGENTICS_PIPE' | 'MINDAGENTICS_SOCKET';
  address: string;
}

export interface PtyWritePayload {
  terminalId: string;
  data: string;
}

export interface DeliverPromptPayload {
  terminalId: string;
  prompt: string;
  raw?: boolean;
  askId?: string;
  fromTerminalId?: string;
}

export interface SnapNodePayload {
  nodeId: string;
  bounds: NodeBounds;
  otherNodes: NodeBounds[];
  gridSize?: number;
  snapThreshold?: number;
}

export interface SnapNodeResult {
  x: number;
  y: number;
  snappedX: boolean;
  snappedY: boolean;
  snappedToNodeId?: string;
}

export interface TidyNodePayload {
  nodeIds?: string[];
  nodes: CanvasNode[];
  padding?: number;
  columns?: number;
  startX?: number;
  startY?: number;
}

export interface TidyNodeResult {
  updatedNodes: Array<{
    id: string;
    x: number;
    y: number;
  }>;
}

export interface PlaceNodePayload {
  preferredX?: number;
  preferredY?: number;
  width: number;
  height: number;
  existingNodes: CanvasNode[];
  anchorNodeId?: string;
  placementDirection?: 'right' | 'below' | 'auto';
}

export interface PlaceNodeResult {
  x: number;
  y: number;
}

export interface FloorCreateKindPayload {
  workspaceId: string;
  repoRoot: string;
  requestedKind?: 'worktree' | 'copy' | 'plain';
}

export interface FloorCreateKindResult {
  kind: 'worktree' | 'copy' | 'plain';
  canUseWorktree: boolean;
  canCopyIndependently: boolean;
  reason?: string;
}

export interface FloorStatusPayload {
  workspaceId: string;
  floorId: string;
  text?: string;
  state?: FloorStatusState;
  progress?: string;
  clear?: boolean;
}

export interface FloorStatusResult {
  success: boolean;
  currentStatus: {
    text: string | null;
    state: FloorStatusState | null;
    progress: string | null;
    updatedAt: string;
  };
}

export interface AgentUsageRecord {
  terminalId: string;
  presetId?: string;
  tokensIn: number;
  tokensOut: number;
  costEstimate?: number;
  callsCount: number;
  timestamp: string;
}

export interface AgentUsageStatePayload {
  totals: {
    tokensIn: number;
    tokensOut: number;
    costEstimate: number;
    totalCalls: number;
  };
  byTerminal: Record<string, AgentUsageRecord>;
}

export interface AsksInFlightPayload {
  [askId: string]: {
    fromTerminalId: string;
    toTerminalId: string;
    prompt: string;
    startedAt: string;
    isBatch?: boolean;
    batchId?: string;
  };
}

export interface OrchestratorAttentionPayload {
  terminalId: string;
  title?: string;
  message: string;
  level: 'info' | 'warning' | 'error';
}

export type MaestroAttentionPayload = OrchestratorAttentionPayload;

export const MAX_TERMINAL_OUTPUT_LINES = 150;

export interface ChatTurnSettledPayload {
  terminalId: string;
  askId?: string;
  output: string;
  exitCode?: number;
  truncated?: boolean;
  fullOutputLogPath?: string;
}

export interface TerminalMemoryRecord {
  terminalId: string;
  timestamp: string;
  content: string;
  command?: string;
}

// Named Pipe CLI Request and Response
export interface CliRequestEnvelope {
  id: string;
  terminalId: string;
  workspaceId?: string;
  floorId?: string;
  cwd?: string;
  stdin?: string;
  command: string;
  args: string[];
  options: Record<string, any>;
}

export interface CliResponseEnvelope<T = any> {
  id: string;
  ok: boolean;
  output?: string;
  error?: string;
  exitCode: number;
  data?: T;
}
