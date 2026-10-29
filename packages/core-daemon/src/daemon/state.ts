import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
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
} from '@mindagentics/shared';

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

  private memoryFilePath: string;
  private usageFilePath: string;
  private usageSaveTimer: NodeJS.Timeout | null = null;

  constructor() {
    const baseDir = path.join(os.homedir(), '.mindagentics');
    this.memoryFilePath = path.join(baseDir, 'memory.jsonl');
    this.usageFilePath = path.join(baseDir, 'usage', 'usage.json');

    this.seedDefaultState();
    this.hydrateMemory();
    this.wrapMemoryEntries();
    this.hydrateUsage();
  }


  private hydrateMemory() {
    try {
      if (fs.existsSync(this.memoryFilePath)) {
        const content = fs.readFileSync(this.memoryFilePath, 'utf8');
        const lines = content.split(/\r?\n/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const entry = JSON.parse(trimmed);
            if (entry && typeof entry.text === 'string') {
              this.memoryEntries.push({
                terminalId: entry.terminalId || '',
                text: entry.text,
                timestamp: entry.timestamp || new Date().toISOString(),
              });
            }
          } catch {
            // ignore corrupted line
          }
        }
      }
    } catch (err) {
      console.warn('[DaemonState] Failed to hydrate memory entries:', err);
    }
  }

  private wrapMemoryEntries() {
    const originalPush = this.memoryEntries.push.bind(this.memoryEntries);
    this.memoryEntries.push = (...items: Array<{ terminalId: string; text: string; timestamp: string }>) => {
      const count = originalPush(...items);
      for (const item of items) {
        this.appendMemoryEntry(item);
      }
      return count;
    };
  }

  public addMemoryEntry(entry: { terminalId: string; text: string; timestamp?: string }) {
    const fullEntry = {
      terminalId: entry.terminalId,
      text: entry.text,
      timestamp: entry.timestamp || new Date().toISOString(),
    };
    this.memoryEntries.push(fullEntry);
  }

  private appendMemoryEntry(entry: { terminalId: string; text: string; timestamp: string }) {
    try {
      const dir = path.dirname(this.memoryFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.appendFileSync(this.memoryFilePath, JSON.stringify(entry) + '\n', 'utf8');
    } catch (err) {
      console.warn('[DaemonState] Failed to append memory entry:', err);
    }
  }

  private hydrateUsage() {
    try {
      if (fs.existsSync(this.usageFilePath)) {
        const raw = fs.readFileSync(this.usageFilePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          if (parsed.totals) {
            this.usage.totals = {
              tokensIn: Number(parsed.totals.tokensIn) || 0,
              tokensOut: Number(parsed.totals.tokensOut) || 0,
              costEstimate: Number(parsed.totals.costEstimate) || 0,
              totalCalls: Number(parsed.totals.totalCalls) || 0,
            };
          }
          if (parsed.byTerminal && typeof parsed.byTerminal === 'object') {
            this.usage.byTerminal = parsed.byTerminal;
          }
        }
      }
    } catch (err) {
      console.warn('[DaemonState] Failed to hydrate usage metrics:', err);
    }
  }

  private scheduleSaveUsage() {
    if (this.usageSaveTimer) {
      clearTimeout(this.usageSaveTimer);
    }
    this.usageSaveTimer = setTimeout(() => {
      this.persistUsage();
    }, 500);
  }

  public persistUsage() {
    try {
      const dir = path.dirname(this.usageFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const tmpPath = `${this.usageFilePath}.tmp.${Date.now()}`;
      fs.writeFileSync(tmpPath, JSON.stringify(this.usage, null, 2), 'utf8');
      fs.renameSync(tmpPath, this.usageFilePath);
    } catch (err) {
      console.warn('[DaemonState] Failed to persist usage.json:', err);
    }
  }

  public flush() {
    if (this.usageSaveTimer) {
      clearTimeout(this.usageSaveTimer);
      this.usageSaveTimer = null;
    }
    this.persistUsage();
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

  public unregisterTerminal(id: string) {
    this.terminals.delete(id);
    // Also remove from any asks in flight
    for (const [askId, ask] of this.asksInFlight.entries()) {
      if (ask.fromTerminalId === id || ask.toTerminalId === id) {
        this.asksInFlight.delete(askId);
      }
    }
  }

  public getTerminalByNameOrId(nameOrId: string, callerWorkspaceId?: string, excludeTerminalId?: string): TerminalRuntime | undefined {
    const norm = nameOrId.trim().toLowerCase();

    // 1. Direct ID match
    if (this.terminals.has(nameOrId)) {
      return this.terminals.get(nameOrId);
    }

    // 2. Exact Title match in caller's workspace
    for (const term of this.terminals.values()) {
      if (excludeTerminalId && term.id === excludeTerminalId) continue;
      if (term.title.toLowerCase() === norm) {
        if (!callerWorkspaceId || term.workspaceId === callerWorkspaceId) {
          return term;
        }
      }
    }

    // 3. Exact Title match across any workspace
    for (const term of this.terminals.values()) {
      if (excludeTerminalId && term.id === excludeTerminalId) continue;
      if (term.title.toLowerCase() === norm) {
        return term;
      }
    }

    // 4. Match "Name @ Workspace"
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

    // 5. Substring / partial Title match
    for (const term of this.terminals.values()) {
      if (excludeTerminalId && term.id === excludeTerminalId) continue;
      if (term.title.toLowerCase().includes(norm) || norm.includes(term.title.toLowerCase())) {
        return term;
      }
    }

    // 6. Check state.nodes (in case a terminal node was registered on canvas)
    for (const node of this.nodes.values()) {
      if (node.kind === 'terminal') {
        const content = node.content as any;
        const termId = content?.terminalId;
        const title = (content?.title || '').toLowerCase();
        if (node.id.toLowerCase() === norm || termId === nameOrId || title === norm || title.includes(norm)) {
          if (termId && this.terminals.has(termId)) {
            return this.terminals.get(termId);
          }
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
    this.scheduleSaveUsage();
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
