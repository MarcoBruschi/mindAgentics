/// <reference types="vite/client" />

type WindowProfileBadgeTier = 'bronze' | 'silver' | 'gold' | 'platinum';

interface WindowUserBadge {
  id: string;
  name: string;
  description: string;
  icon: string;
  tier: WindowProfileBadgeTier;
  unlockedAt?: string;
  progress?: number;
  maxProgress?: number;
}

interface WindowOrchestratorStats {
  recruitsCount: number;
  tasksDelegated: number;
  portalsOpened: number;
  knowledgeGraphsBuilt: number;
  routinesExecuted: number;
  totalCanvasTimeMinutes: number;
}

interface WindowUserProfile {
  id: string;
  name: string;
  callsign: string;
  avatarId: string;
  avatarUrl?: string;
  title: string;
  level: number;
  currentXp: number;
  xpToNextLevel: number;
  totalXp: number;
  streakDays: number;
  longestStreakDays?: number;
  lastActiveDate: string;
  activityHistory?: Record<string, number>;
  hasCompletedOnboarding?: boolean;
  badges: WindowUserBadge[];
  stats: WindowOrchestratorStats;
}

interface WindowResizeOptions {
  cols?: number;
  rows?: number;
  [key: string]: unknown;
}

interface WindowControlState {
  isMaximized: boolean;
  isFullScreen: boolean;
}

interface MindAgenticsWindowBridge {
  isTauri?: boolean;
  app?: {
    info?: () => Promise<any>;
    diagnosticReport?: () => Promise<any>;
    saveDiagnosticReport?: () => Promise<any>;
    setLocale?: (locale: string) => Promise<any>;
    localDirectorySuggestions?: (partialPath: string, limit?: number) => Promise<any>;
    directoryState?: (workspaceId: string, environment: any, path: string) => Promise<any>;
    createDirectory?: (workspaceId: string, environment: any, path: string) => Promise<any>;
    pickDirectory: () => Promise<string | null>;
    pickReference: (options?: { target?: 'file' | 'directory' | 'all'; title?: string; path?: string }) => Promise<{ path: string; isDirectory: boolean; label?: string } | string | null>;
    quit?: () => Promise<any>;
    hideToTray?: () => Promise<any>;
    listIdes?: () => Promise<any>;
    openInIde?: (workspaceId: string, ideId: string) => Promise<any>;
    openExternal: (url: string) => Promise<boolean>;
    openPath: (path: string) => Promise<boolean>;
    showEmojiPanel?: () => Promise<any>;
    rendererBooted?: () => void;
    reportRendererFault?: (fault: any) => void;
    onShutdown?: (handler: (...args: any[]) => void) => () => void;
    shutdownPainted?: () => void;
  };
  terminal: {
    detectAgents?: () => Promise<any[]>;
    getAgentLimits?: () => Promise<any[]>;
    getAgentModels?: (presetId: string) => Promise<any>;
    spawn: (input: {
      id?: string;
      terminalId?: string;
      workspaceId?: string;
      cwd?: string;
      command?: string;
      env?: Record<string, string>;
      cols?: number;
      rows?: number;
      title?: string;
      agentRole?: string;
      instructions?: string;
      isAutonomous?: boolean;
      presetId?: string;
      orchestratorMode?: boolean;
      maestroMode?: boolean;
    }) => Promise<{ terminalId: string; attached?: boolean }>;
    setOrchestratorMode?: (terminalId: string, orchestratorMode: boolean) => Promise<any>;
    setMaestroMode?: (terminalId: string, maestroMode: boolean) => Promise<any>;
    write: (terminalId: string, data: string | Uint8Array) => void | Promise<void>;
    deliverPrompt?: (terminalId: string, text: string) => Promise<{ ok: boolean }>;
    dims?: (terminalId: string) => Promise<{ cols: number; rows: number }>;
    resize: (terminalId: string, cols: number, rows: number, options?: WindowResizeOptions) => Promise<void | { ok: boolean }>;
    kill: (terminalId: string) => Promise<void | { ok: boolean }>;
    restart: (terminalId: string) => Promise<void | { ok: boolean }>;
    reconfigure?: (arg1: any, arg2?: any) => Promise<void | { ok: boolean }>;
    attach?: (terminalId: string) => Promise<void>;
    getScrollback: (terminalId: string) => Promise<string>;
    markSeen?: (terminalId: string) => void;
    setFocused?: (terminalId: string) => void;
    onData: (handler: (terminalId: string, data: string | Uint8Array) => void) => () => void;
    onExit: (handler: (terminalId: string, code: number) => void) => () => void;
    onStatus?: (handler: (terminalId: string, status: any) => void) => () => void;
    onActivity?: (handler: (terminalId: string, activity: any) => void) => () => void;
  };
  windowControls?: {
    minimize: () => Promise<void>;
    maximize?: () => Promise<void>;
    toggleMaximize: () => Promise<void>;
    close: () => Promise<void>;
    state: () => Promise<WindowControlState>;
    onChanged: (handler: (state: WindowControlState) => void) => () => void;
  };
  workspace?: {
    list: () => Promise<any[]>;
    getActiveId: () => Promise<string | null>;
    create?: (data: any) => Promise<any>;
    patch?: (id: string, data: any) => Promise<any>;
    delete?: (id: string) => Promise<any>;
    switch?: (id: string) => Promise<any>;
    duplicate?: (id: string) => Promise<any>;
    export?: (id: string) => Promise<any>;
    prepareImport?: (file?: File | { path?: string; name?: string }) => Promise<any>;
    prepareOpenedImport?: () => Promise<any>;
    completeImport?: (sourcePath: string, destination: string) => Promise<any>;
    onOpenRequested?: (handler: () => void) => () => void;
    unload?: (id: string, scope: any) => Promise<any>;
    setFloorStatus?: (workspaceId: string, floorId: string, status: any) => Promise<any>;
    reorderFloor?: (workspaceId: string, floorId: string, topDownIndex: number) => Promise<any>;
    reveal?: (id: string) => Promise<any>;
    setPreferredIde?: (id: string, ideId: string) => Promise<any>;
    onChanged?: (handler: (payload: any) => void) => () => void;
    onDeleted?: (handler: (payload: any) => void) => () => void;
    undo?: (id: string) => Promise<any>;
    redo?: (id: string) => Promise<any>;
    beginUndoGroup?: () => Promise<any>;
    endUndoGroup?: () => Promise<any>;
    onLevelsUnloaded?: (handler: (payload: any) => void) => () => void;
    configFiles?: {
      status: (id: string) => Promise<any>;
      read: (id: string, kind: any) => Promise<any>;
      write: (id: string, kind: any, text: string) => Promise<any>;
      remove: (id: string, kind: any) => Promise<any>;
      sync: (id: string, winner: any, expect: any) => Promise<any>;
    };
  };
  appState?: {
    get: () => Promise<any>;
    setOnboardingCompleted: (val: boolean) => Promise<void>;
    setHasSeenFloorOnboarding: (val: boolean) => Promise<void>;
  };
  canvas?: {
    sync: (data: { nodes: any[]; cableTies: any[]; workspaceId?: string; floorId?: string }) => void | Promise<any>;
    onNodePlaced?: (handler: (payload: any) => void) => () => void;
    onNodeDeleted?: (handler: (payload: any) => void) => () => void;
    onCableTieCreated?: (handler: (payload: any) => void) => () => void;
    onCableTieDeleted?: (handler: (payload: any) => void) => () => void;
  };
  note?: {
    read: (workspaceId: string, nodeId: string) => Promise<string>;
    write: (workspaceId: string, nodeId: string, text: string) => Promise<void>;
    edit?: (workspaceId: string, nodeId: string, oldText: string, newText: string) => Promise<any>;
    rename?: (workspaceId: string, nodeId: string, newFileName: string) => Promise<any>;
    reveal?: (workspaceId: string, nodeId: string) => Promise<any>;
    moveToExternal?: (workspaceId: string, nodeId: string) => Promise<any>;
    moveToManaged?: (workspaceId: string, nodeId: string) => Promise<any>;
    createFromFile?: (workspaceId: string, node: any, sourcePath: string) => Promise<any>;
    createFromRemoteFile?: (workspaceId: string, node: any, connection: any, path: string, floorId?: string) => Promise<any>;
    refreshFromRemoteFile?: (workspaceId: string, nodeId: string) => Promise<any>;
    onChange?: (handler: (payload: any) => void) => () => void;
    attachImage?: (workspaceId: string, image: { dataBase64: string; ext: string }) => Promise<any>;
    notesDir?: (workspaceId: string) => Promise<any>;
  };
  portal?: {
    openWindow?: (url: string, title?: string) => Promise<any>;
    register?: (portalId: string, webContentsId: number) => Promise<any>;
    unregister?: (portalId: string) => Promise<any>;
    resolveSource?: (path: string) => Promise<any>;
    directoryIndex?: (directory: string) => Promise<any>;
    watchFile?: (portalId: string, file: string) => Promise<any>;
    unwatchFile?: (portalId: string) => Promise<any>;
    onFileChanged?: (handler: (payload: any) => void) => () => void;
    onWakeRequested?: (handler: (payload: any) => void) => () => void;
  };
  routines?: {
    list: () => Promise<any[]>;
    create: (input: any) => Promise<any>;
    update: (id: string, patch: any) => Promise<any>;
    delete: (id: string) => Promise<any>;
    setEnabled: (id: string, enabled: boolean) => Promise<any>;
    runNow: (id: string) => Promise<any>;
    onChanged: (handler: (payload: any) => void) => () => void;
    history: () => Promise<any[]>;
    historyRemove: (id: string) => Promise<any>;
    historyClear: () => Promise<any>;
    onHistoryChanged: (handler: (payload: any) => void) => () => void;
  };
  graphify?: {
    buildGraph: (params: any) => Promise<any>;
    checkGraph: (dir: string) => Promise<any>;
    query: (dir: string, question: string, dfs?: boolean) => Promise<any>;
    explain: (dir: string, symbol: string, all?: boolean) => Promise<any>;
    path: (dir: string, from: string, to: string, undirected?: boolean) => Promise<any>;
    getStatus: () => Promise<any>;
    install: () => Promise<any>;
    onProgress: (handler: (data: { message: string }) => void) => () => void;
  };
  profile?: {
    get?: () => Promise<WindowUserProfile>;
    load?: () => Promise<any>;
    update?: (patch: Partial<WindowUserProfile>) => Promise<WindowUserProfile>;
    awardXp?: (xp: number, statKey?: any) => Promise<{
      profile: WindowUserProfile;
      leveledUp: boolean;
      unlockedBadges: WindowUserBadge[];
    } | any>;
  };
  onNodePlaced?: (handler: (payload: any) => void) => () => void;
  onNodeDeleted?: (handler: (payload: any) => void) => () => void;
  onCableTieCreated?: (handler: (payload: any) => void) => () => void;
  onCableTieDeleted?: (handler: (payload: any) => void) => () => void;
}


interface Window {
  mindAgentics?: MindAgenticsWindowBridge;
  api?: MindAgenticsWindowBridge;
  __TAURI_INTERNALS__?: Record<string, unknown>;
}
