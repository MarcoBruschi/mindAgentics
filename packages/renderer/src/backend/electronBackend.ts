import { BackendAdapter } from './types';

/**
 * Electron backend adapter: wraps window.api / window.mindAgentics from Electron preload
 */
export function createElectronBackend(): BackendAdapter {
  const electronApi = (window as any).api || (window as any).mindAgentics || {};

  return {
    isTauri: false,
    isElectron: true,

    app: {
      pickDirectory: () => electronApi.app?.pickDirectory?.() ?? Promise.resolve(null),
      pickReference: () => electronApi.app?.pickReference?.() ?? electronApi.app?.pickDirectory?.() ?? Promise.resolve(null),
      openPath: (p: string) => electronApi.app?.openPath?.(p) ?? Promise.resolve(false),
      openExternal: (url: string) => electronApi.app?.openExternal?.(url) ?? Promise.resolve(false),
      info: () => electronApi.app?.info?.() ?? Promise.resolve({}),
      ...electronApi.app,
    },

    terminal: {
      spawn: (options) => electronApi.terminal?.spawn?.(options) ?? Promise.resolve({ terminalId: options.id || options.terminalId || 'term-default' }),
      write: (terminalId, data) => electronApi.terminal?.write?.(terminalId, data),
      resize: (terminalId, cols, rows) => electronApi.terminal?.resize?.(terminalId, cols, rows) ?? Promise.resolve({ ok: true }),
      kill: (terminalId) => electronApi.terminal?.kill?.(terminalId) ?? Promise.resolve({ ok: true }),
      restart: (terminalId) => electronApi.terminal?.restart?.(terminalId) ?? Promise.resolve({ ok: true }),
      reconfigure: (terminalId, config) => electronApi.terminal?.reconfigure?.(terminalId, config) ?? Promise.resolve({ ok: true }),
      getScrollback: (terminalId) => electronApi.terminal?.getScrollback?.(terminalId) ?? Promise.resolve(''),
      getAgentLimits: () => electronApi.terminal?.getAgentLimits?.() ?? Promise.resolve([]),
      detectAgents: () => electronApi.terminal?.detectAgents?.() ?? Promise.resolve([]),
      setOrchestratorMode: (terminalId, enabled) => electronApi.terminal?.setOrchestratorMode?.(terminalId, enabled) ?? Promise.resolve(),
      setMaestroMode: (terminalId, enabled) => electronApi.terminal?.setMaestroMode?.(terminalId, enabled) ?? Promise.resolve(),
      onData: (handler) => electronApi.terminal?.onData?.(handler) ?? (() => {}),
      onExit: (handler) => electronApi.terminal?.onExit?.(handler) ?? (() => {}),
      onStatus: (handler) => electronApi.terminal?.onStatus?.(handler) ?? (() => {}),
      ...electronApi.terminal,
    },

    windowControls: {
      minimize: () => electronApi.windowControls?.minimize?.() ?? Promise.resolve(),
      maximize: () => electronApi.windowControls?.maximize?.() ?? Promise.resolve(),
      toggleMaximize: () => electronApi.windowControls?.toggleMaximize?.() ?? Promise.resolve(),
      close: () => electronApi.windowControls?.close?.() ?? Promise.resolve(),
      state: () => electronApi.windowControls?.state?.() ?? Promise.resolve({ isMaximized: false, isFullScreen: false }),
      onChanged: (handler) => electronApi.windowControls?.onChanged?.(handler) ?? (() => {}),
      ...electronApi.windowControls,
    },

    workspace: {
      list: () => electronApi.workspace?.list?.() ?? Promise.resolve([]),
      getActiveId: () => electronApi.workspace?.getActiveId?.() ?? Promise.resolve(null),
      create: (d) => electronApi.workspace?.create?.(d) ?? Promise.resolve(null),
      patch: (id, d) => electronApi.workspace?.patch?.(id, d) ?? Promise.resolve(null),
      delete: (id) => electronApi.workspace?.delete?.(id) ?? Promise.resolve(null),
      switch: (id) => electronApi.workspace?.switch?.(id) ?? Promise.resolve(null),
      ...electronApi.workspace,
    },

    canvas: {
      sync: (payload) => electronApi.canvas?.sync?.(payload) ?? Promise.resolve(null),
      ...electronApi.canvas,
    },

    profile: {
      load: () => electronApi.profile?.load?.() ?? Promise.resolve(null),
      awardXp: (xp, reason) => electronApi.profile?.awardXp?.(xp, reason) ?? Promise.resolve(null),
      ...electronApi.profile,
    },

    portal: {
      openWindow: (url, title) => electronApi.portal?.openWindow?.(url, title) ?? electronApi.app?.openExternal?.(url) ?? Promise.resolve(null),
      ...electronApi.portal,
    },

    ...electronApi,
  };
}
