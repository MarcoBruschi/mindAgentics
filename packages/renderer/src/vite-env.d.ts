/// <reference types="vite/client" />

interface MindAgenticsWindowBridge {
  terminal: {
    detectAgents?: () => Promise<any[]>;
    spawn: (input: {
      id?: string;
      cwd?: string;
      command?: string;
      env?: Record<string, string>;
      cols?: number;
      rows?: number;
      title?: string;
      presetId?: string;
      orchestratorMode?: boolean;
      maestroMode?: boolean;
    }) => Promise<{ terminalId: string; attached?: boolean }>;
    setOrchestratorMode?: (terminalId: string, orchestratorMode: boolean) => Promise<any>;
    setMaestroMode?: (terminalId: string, maestroMode: boolean) => Promise<any>;
    write: (terminalId: string, data: string) => Promise<void>;
    deliverPrompt: (terminalId: string, text: string) => Promise<{ ok: boolean }>;
    dims: (terminalId: string) => Promise<{ cols: number; rows: number }>;
    resize: (terminalId: string, cols: number, rows: number, options?: any) => Promise<void>;
    kill: (terminalId: string) => Promise<void>;
    restart: (terminalId: string) => Promise<void>;
    attach: (terminalId: string) => Promise<void>;
    getScrollback: (terminalId: string) => Promise<string>;
    markSeen: (terminalId: string) => void;
    setFocused: (terminalId: string) => void;
    onData: (handler: (terminalId: string, data: string) => void) => () => void;
    onExit: (handler: (terminalId: string, code: number) => void) => () => void;
    onStatus?: (handler: (terminalId: string, status: any) => void) => () => void;
    onActivity?: (handler: (terminalId: string, activity: any) => void) => () => void;
  };
  appState?: {
    get: () => Promise<any>;
    setOnboardingCompleted: (val: boolean) => Promise<void>;
    setHasSeenFloorOnboarding: (val: boolean) => Promise<void>;
  };
  canvas?: {
    sync: (data: { nodes: any[]; cableTies: any[]; workspaceId?: string; floorId?: string }) => void;
  };
  profile?: {
    get: () => Promise<import('@mindagentics/shared').UserProfile>;
    update: (patch: Partial<import('@mindagentics/shared').UserProfile>) => Promise<import('@mindagentics/shared').UserProfile>;
    awardXp: (xp: number, statKey?: keyof import('@mindagentics/shared').OrchestratorStats) => Promise<{
      profile: import('@mindagentics/shared').UserProfile;
      leveledUp: boolean;
      unlockedBadges: import('@mindagentics/shared').UserBadge[];
    }>;
  };
}


interface Window {
  mindAgentics?: MindAgenticsWindowBridge & any;
  api?: any;
}
