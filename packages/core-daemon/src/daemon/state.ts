/**
 * Core Daemon In-Memory State & Coordination Store
 */

import type {
  AsksInFlightPayload,
  AgentUsageStatePayload,
  FloorStatusInfo,
  FloorStatusState,
  CanvasNode,
  TerminalContent,
  NoteContent,
  PortalContent,
} from '@maestri/shared';

export interface TerminalRuntime {
  id: string;
  title: string;
  workspaceId: string;
  floorId: string;
  presetId?: string;
  agentRole?: string;
  account?: string;
  maestroMode: boolean;
  status: 'idle' | 'working' | 'attention' | 'error';
  scrollback: string[];
  lastTurnOutput?: string;
}

export interface AskSession {
  id: string;
  fromTerminalId: string;
  toTerminalId: string;
  prompt: string;
  raw?: boolean;
  startedAt: string;
  resolve?: (value: string) => void;
  reject?: (reason: any) => void;
  timeoutTimer?: NodeJS.Timeout;
}

export class DaemonState {
  // Terminals indexed by ID
  public terminals: Map<string, TerminalRuntime> = new Map();

  // Canvas nodes by floor
  public nodes: Map<string, CanvasNode> = new Map();

  // Connections (cable ties)
  public connections: Array<{ fromId: string; toId: string; label?: string }> = [];

  // Asks in flight
  public asksInFlight: Map<string, AskSession> = new Map();

  // Floor statuses: key is `${workspaceId}:${floorId}`
  public floorStatuses: Map<string, FloorStatusInfo> = new Map();

  // Agent usage metrics
  public usage: AgentUsageStatePayload = {
    totals: {
      tokensIn: 0,
      tokensOut: 0,
      costEstimate: 0,
      totalCalls: 0,
    },
    byTerminal: {},
  };

  // License state
  public license = {
    state: 'active' as 'active' | 'trial' | 'expired' | 'revoked',
    daysRemaining: 30,
    licenseKey: null as string | null,
  };

  // Workspace & Floors index
  public workspaces: Map<string, { id: string; name: string; workingDirectory: string }> = new Map();
  public floors: Map<string, { id: string; workspaceId: string; name: string; branch: string | null; isGround: boolean }> = new Map();

  // Roles store
  public roles: Map<string, { name: string; prompt: string; scope: 'current' | 'global'; workspaceId?: string }> = new Map();

  // Presets store
  public presets: Map<string, any> = new Map();

  // Semantic memory for recall: list of entries
  public memoryEntries: Array<{ terminalId: string; text: string; timestamp: string }> = [];

  constructor() {
    this.seedDefaultState();
  }

  private seedDefaultState() {
    // Default roles
    this.roles.set('Code Reviewer', {
      name: 'Code Reviewer',
      prompt: 'Review code for correctness, style, and safety. Never edit files — only respond with findings.',
      scope: 'global',
    });
    this.roles.set('API Specialist', {
      name: 'API Specialist',
      prompt: 'You own API endpoints in this repository. Maintain consistency with documentation.',
      scope: 'global',
    });

    // Default presets
    this.presets.set('Claude Code', {
      id: 'C1A0DE00-0000-4000-8000-000000000001',
      name: 'Claude Code',
      agentType: 'claude_code',
      command: 'claude',
      icon: 'seal',
      isActive: true,
      maestroMode: false,
      startInChatMode: false,
      accounts: ['Default', 'Work'],
    });
    this.presets.set('Codex', {
      id: 'C1A0DE00-0000-4000-8000-000000000002',
      name: 'Codex',
      agentType: 'codex',
      command: 'codex --no-daemon',
      icon: 'brain',
      isActive: true,
      maestroMode: false,
      startInChatMode: false,
      accounts: ['Default'],
    });
    this.presets.set('Antigravity', {
      id: 'C1A0DE00-0000-4000-8000-000000000003',
      name: 'Antigravity',
      agentType: 'antigravity_cli',
      command: 'agy',
      icon: 'sparkle',
      isActive: true,
      maestroMode: false,
      startInChatMode: false,
      accounts: ['Default'],
    });
    this.presets.set('OpenCode', {
      id: 'C1A0DE00-0000-4000-8000-000000000004',
      name: 'OpenCode',
      agentType: 'open_code',
      command: 'opencode',
      icon: 'rectangle.portrait',
      isActive: true,
      maestroMode: false,
      startInChatMode: false,
      accounts: ['Default'],
    });
    this.presets.set('Shell', {
      id: 'C1A0DE00-0000-4000-8000-000000000005',
      name: 'Shell',
      agentType: 'generic_shell',
      command: '',
      icon: 'terminal',
      isActive: true,
      maestroMode: false,
      startInChatMode: false,
      accounts: ['Default'],
    });
  }

  public registerTerminal(term: TerminalRuntime) {
    this.terminals.set(term.id, term);
  }

  public getTerminalByNameOrId(nameOrId: string, callerWorkspaceId?: string, excludeTerminalId?: string): TerminalRuntime | undefined {
    // 1. Direct ID match
    if (this.terminals.has(nameOrId)) {
      return this.terminals.get(nameOrId);
    }

    // 2. Exact Title match, prioritizing other terminals over caller self
    for (const term of this.terminals.values()) {
      if (excludeTerminalId && term.id === excludeTerminalId) continue;
      if (term.title.toLowerCase() === nameOrId.toLowerCase()) {
        if (!callerWorkspaceId || term.workspaceId === callerWorkspaceId) {
          return term;
        }
      }
    }

    // 3. Match "Name @ Workspace"
    if (nameOrId.includes('@')) {
      const [titlePart, wsPart] = nameOrId.split('@').map((s) => s.trim().toLowerCase());
      for (const term of this.terminals.values()) {
        if (excludeTerminalId && term.id === excludeTerminalId) continue;
        const ws = this.workspaces.get(term.workspaceId);
        if (
          term.title.toLowerCase() === titlePart &&
          ws &&
          ws.name.toLowerCase() === wsPart
        ) {
          return term;
        }
      }
    }

    return undefined;
  }

  public getAsksInFlightPayload(): AsksInFlightPayload {
    const payload: AsksInFlightPayload = {};
    for (const [id, session] of this.asksInFlight.entries()) {
      payload[id] = {
        fromTerminalId: session.fromTerminalId,
        toTerminalId: session.toTerminalId,
        prompt: session.prompt,
        startedAt: session.startedAt,
      };
    }
    return payload;
  }

  public recordUsage(terminalId: string, tokensIn: number, tokensOut: number, cost = 0) {
    this.usage.totals.tokensIn += tokensIn;
    this.usage.totals.tokensOut += tokensOut;
    this.usage.totals.costEstimate += cost;
    this.usage.totals.totalCalls += 1;

    let rec = this.usage.byTerminal[terminalId];
    if (!rec) {
      rec = {
        terminalId,
        tokensIn: 0,
        tokensOut: 0,
        costEstimate: 0,
        callsCount: 0,
        timestamp: new Date().toISOString(),
      };
      this.usage.byTerminal[terminalId] = rec;
    }

    rec.tokensIn += tokensIn;
    rec.tokensOut += tokensOut;
    rec.costEstimate = (rec.costEstimate || 0) + cost;
    rec.callsCount += 1;
    rec.timestamp = new Date().toISOString();
  }

  public setFloorStatus(workspaceId: string, floorId: string, text: string | null, state: FloorStatusState | null, progress: string | null) {
    const key = `${workspaceId}:${floorId}`;
    if (!text && !state && !progress) {
      this.floorStatuses.delete(key);
      return null;
    }
    const info: FloorStatusInfo = {
      text,
      state: state || 'working',
      progress,
      updatedAt: new Date().toISOString(),
    };
    this.floorStatuses.set(key, info);
    return info;
  }

  public getFloorStatus(workspaceId: string, floorId: string): FloorStatusInfo | null {
    return this.floorStatuses.get(`${workspaceId}:${floorId}`) || null;
  }
}
