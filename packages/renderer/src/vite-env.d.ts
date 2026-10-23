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
      maestroMode?: boolean;
    }) => Promise<{ terminalId: string; attached?: boolean }>;
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
}

type MaestriWindowBridge = MindAgenticsWindowBridge;

interface Window {
  mindAgentics?: typeof window.maestri;
  maestri?: any;
  api?: any;
}
