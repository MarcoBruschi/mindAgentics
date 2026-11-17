/**
 * Unified Backend Adapter interface for mindAgentics
 * Executes under Tauri v2 (Rust IPC / invoke).
 */

export interface TerminalSpawnOptions {
  id?: string;
  terminalId?: string;
  workspaceId?: string;
  cwd?: string;
  cols?: number;
  rows?: number;
  title?: string;
  agentRole?: string;
  instructions?: string;
  isAutonomous?: boolean;
  command?: string;
  presetId?: string;
  orchestratorMode?: boolean;
  maestroMode?: boolean;
}

export interface BackendAdapter {
  isTauri: boolean;

  app: {
    pickDirectory: () => Promise<string | null>;
    pickReference: (options?: { target?: 'file' | 'directory' | 'all'; title?: string; path?: string }) => Promise<{ path: string; isDirectory: boolean; label?: string } | string | null>;
    openPath: (path: string) => Promise<boolean>;
    openExternal: (url: string) => Promise<boolean>;
    info?: () => Promise<any>;
  };

  terminal: {
    spawn: (options: TerminalSpawnOptions) => Promise<{ terminalId: string; attached?: boolean }>;
    write: (terminalId: string, data: string | Uint8Array) => void;
    resize: (terminalId: string, cols: number, rows: number) => Promise<{ ok: boolean }>;
    kill: (terminalId: string) => Promise<{ ok: boolean }>;
    restart: (terminalId: string) => Promise<{ ok: boolean }>;
    reconfigure: (terminalId: string, config: any) => Promise<{ ok: boolean }>;
    getScrollback: (terminalId: string) => Promise<string>;
    getAgentLimits: () => Promise<any[]>;
    detectAgents: () => Promise<any[]>;
    setOrchestratorMode?: (terminalId: string, enabled: boolean) => Promise<void>;
    setMaestroMode?: (terminalId: string, enabled: boolean) => Promise<void>;
    onData: (handler: (terminalId: string, data: string | Uint8Array) => void) => () => void;
    onExit: (handler: (terminalId: string, exitCode: number) => void) => () => void;
    onStatus?: (handler: (terminalId: string, status: string) => void) => () => void;
  };

  windowControls: {
    minimize: () => Promise<void>;
    maximize: () => Promise<void>;
    toggleMaximize: () => Promise<void>;
    close: () => Promise<void>;
    state: () => Promise<{ isMaximized: boolean; isFullScreen: boolean }>;
    onChanged: (handler: (state: { isMaximized: boolean; isFullScreen: boolean }) => void) => () => void;
  };

  workspace: {
    list: () => Promise<any[]>;
    getActiveId: () => Promise<string | null>;
    create?: (data: any) => Promise<any>;
    patch?: (id: string, data: any) => Promise<any>;
    delete?: (id: string) => Promise<any>;
    switch?: (id: string) => Promise<any>;
  };

  canvas: {
    sync: (payload: any) => Promise<any>;
  };

  profile?: {
    load?: () => Promise<any>;
    awardXp?: (xp: number, reason: string) => Promise<any>;
  };

  portal?: {
    openWindow?: (url: string, title?: string) => Promise<any>;
  };

  [key: string]: any;
}
