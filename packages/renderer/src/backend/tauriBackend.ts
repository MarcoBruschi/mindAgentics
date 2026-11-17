import { invoke, Channel } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { BackendAdapter, TerminalSpawnOptions } from './types';
import { tauriBackend as fullTauriBackend } from '../tauriBackend';

/**
 * Race-condition safe event listener for Tauri v2.
 * Ensures that if unlisten is called before the asynchronous listen promise resolves,
 * the unlisten callback will still be properly invoked as soon as the promise fulfills.
 */
export function safeListen<T = any>(
  event: string,
  handler: (payload: T) => void
): () => void {
  let unlistenFn: (() => void) | null = null;
  let isCancelled = false;

  listen<T>(event, (ev) => {
    if (!isCancelled) {
      handler(ev.payload);
    }
  })
    .then((fn) => {
      if (isCancelled) {
        fn();
      } else {
        unlistenFn = fn;
      }
    })
    .catch((err) => {
      console.warn(`[TauriBackend] safeListen failed for event "${event}":`, err);
    });

  return () => {
    isCancelled = true;
    if (unlistenFn) {
      unlistenFn();
      unlistenFn = null;
    }
  };
}

/**
 * Tauri backend adapter: delegates to Tauri v2 Rust commands and event listeners.
 */
export function createTauriBackend(): BackendAdapter {
  const terminalDataSubscribers = new Set<(terminalId: string, data: string | Uint8Array) => void>();
  const terminalExitSubscribers = new Set<(terminalId: string, code: number) => void>();
  const terminalStatusSubscribers = new Set<(terminalId: string, status: string) => void>();
  const windowControlSubscribers = new Set<(state: { isMaximized: boolean; isFullScreen: boolean }) => void>();

  // Global event listeners for Tauri events with race-condition protection
  safeListen<{ terminalId: string; data: string | number[] }>('mindagentics:terminal:data', (payload) => {
    if (!payload?.terminalId) return;
    const chunk = Array.isArray(payload.data) ? new Uint8Array(payload.data) : payload.data;
    for (const sub of terminalDataSubscribers) {
      sub(payload.terminalId, chunk);
    }
  });

  safeListen<{ terminalId: string; exitCode: number }>('mindagentics:terminal:exit', (payload) => {
    if (!payload?.terminalId) return;
    for (const sub of terminalExitSubscribers) {
      sub(payload.terminalId, payload.exitCode ?? 0);
    }
  });

  safeListen<{ terminalId: string; status: string }>('mindagentics:terminal:status', (payload) => {
    if (!payload?.terminalId) return;
    for (const sub of terminalStatusSubscribers) {
      sub(payload.terminalId, payload.status);
    }
  });

  safeListen<{ isMaximized: boolean; isFullScreen: boolean }>('mindagentics:window:state', (payload) => {
    for (const sub of windowControlSubscribers) {
      sub(payload);
    }
  });

  safeListen<{ isMaximized: boolean; isFullScreen: boolean }>('mindagentics:windowControls:onChanged', (payload) => {
    for (const sub of windowControlSubscribers) {
      sub(payload);
    }
  });

  // Active terminal channels for high-throughput Xterm binary streaming
  const terminalChannels = new Map<string, Channel<ArrayBuffer | Uint8Array>>();

  const base = fullTauriBackend as Record<string, any>;

  return {
    ...base,
    isTauri: true,

    app: {
      ...(base.app ?? {}),
      pickDirectory: async () => {
        try {
          return await invoke<string | null>('pick_directory');
        } catch {
          return null;
        }
      },
      pickReference: async (options?: { target?: 'file' | 'folder' | 'directory' | 'all'; title?: string; path?: string }) => {
        try {
          const normalizedOptions = options
            ? {
                ...options,
                target: options.target === 'folder' ? 'directory' : options.target,
              }
            : undefined;
          return await invoke<{ path: string; isDirectory: boolean; label?: string } | null>('app_pick_reference', {
            options: normalizedOptions,
          });
        } catch {
          return null;
        }
      },
      openPath: async (filePath: string) => {
        try {
          await invoke('open_path', { path: filePath });
          return true;
        } catch {
          return false;
        }
      },
      openExternal: async (url: string) => {
        try {
          await invoke('open_external', { url });
          return true;
        } catch {
          window.open(url, '_blank', 'noreferrer');
          return true;
        }
      },
      info: async () => {
        try {
          return await invoke('app_info');
        } catch {
          return { platform: 'tauri', arch: 'unknown' };
        }
      },
    },

    terminal: {
      ...(base.terminal ?? {}),
      spawn: async (options: TerminalSpawnOptions) => {
        const terminalId = options.id || options.terminalId || `term-${Date.now()}`;

        // Binary Channel for Xterm streaming without serialization overhead
        const streamChannel = new Channel<ArrayBuffer | Uint8Array>();
        streamChannel.onmessage = (message) => {
          const chunk = message instanceof Uint8Array ? message : new Uint8Array(message);
          for (const sub of terminalDataSubscribers) {
            sub(terminalId, chunk);
          }
        };
        terminalChannels.set(terminalId, streamChannel);

        try {
          await invoke('terminal_spawn', {
            options: {
              ...options,
              terminalId,
            },
            onData: streamChannel,
          });
          return { terminalId, attached: true };
        } catch (err) {
          console.warn('[TauriBackend] terminal_spawn error:', err);
          return { terminalId, attached: false };
        }
      },

      write: (terminalId: string, data: string | Uint8Array) => {
        if (typeof data === 'string') {
          invoke('terminal_write', { terminalId, data }).catch((err) => {
            console.warn('[TauriBackend] terminal_write error:', err);
          });
        } else {
          invoke('terminal_write_binary', { terminalId, data: Array.from(data) }).catch((err) => {
            console.warn('[TauriBackend] terminal_write_binary error:', err);
          });
        }
      },

      resize: async (terminalId: string, cols: number, rows: number) => {
        try {
          await invoke('terminal_resize', { terminalId, cols, rows });
          return { ok: true };
        } catch {
          return { ok: false };
        }
      },

      kill: async (terminalId: string) => {
        terminalChannels.delete(terminalId);
        try {
          await invoke('terminal_kill', { terminalId });
          return { ok: true };
        } catch {
          return { ok: false };
        }
      },

      restart: async (terminalId: string) => {
        try {
          await invoke('terminal_restart', { terminalId });
          return { ok: true };
        } catch {
          return { ok: false };
        }
      },

      reconfigure: async (terminalId: string, config: any) => {
        try {
          await invoke('terminal_reconfigure', { terminalId, config });
          return { ok: true };
        } catch {
          return { ok: false };
        }
      },

      getScrollback: async (terminalId: string) => {
        try {
          return await invoke<string>('terminal_get_scrollback', { terminalId });
        } catch {
          return '';
        }
      },

      getAgentLimits: async () => {
        try {
          return await invoke<any[]>('get_agent_limits');
        } catch {
          return [];
        }
      },

      detectAgents: async () => {
        try {
          return await invoke<any[]>('detect_agents');
        } catch {
          return [
            { id: 'shell', name: 'Shell', command: '', installed: true },
          ];
        }
      },

      setOrchestratorMode: async (terminalId: string, enabled: boolean) => {
        try {
          await invoke('terminal_set_orchestrator_mode', { terminalId, enabled });
        } catch {}
      },

      setMaestroMode: async (terminalId: string, enabled: boolean) => {
        try {
          await invoke('terminal_set_maestro_mode', { terminalId, enabled });
        } catch {}
      },

      onData: (handler: (terminalId: string, data: string | Uint8Array) => void) => {
        terminalDataSubscribers.add(handler);
        return () => {
          terminalDataSubscribers.delete(handler);
        };
      },

      onExit: (handler: (terminalId: string, exitCode: number) => void) => {
        terminalExitSubscribers.add(handler);
        return () => {
          terminalExitSubscribers.delete(handler);
        };
      },

      onStatus: (handler: (terminalId: string, status: string) => void) => {
        terminalStatusSubscribers.add(handler);
        return () => {
          terminalStatusSubscribers.delete(handler);
        };
      },
    },

    windowControls: {
      ...(base.windowControls ?? {}),
      minimize: async () => {
        try {
          await invoke('window_minimize');
        } catch {}
      },
      maximize: async () => {
        try {
          await invoke('window_maximize');
        } catch {}
      },
      toggleMaximize: async () => {
        try {
          await invoke('window_toggle_maximize');
        } catch {}
      },
      close: async () => {
        try {
          await invoke('window_close');
        } catch {}
      },
      state: async () => {
        try {
          return await invoke<{ isMaximized: boolean; isFullScreen: boolean }>('window_state');
        } catch {
          return { isMaximized: false, isFullScreen: false };
        }
      },
      onChanged: (handler) => {
        windowControlSubscribers.add(handler);
        invoke<{ isMaximized: boolean; isFullScreen: boolean }>('window_state')
          .then((state) => {
            if (windowControlSubscribers.has(handler)) {
              handler(state);
            }
          })
          .catch(() => {});
        return () => {
          windowControlSubscribers.delete(handler);
        };
      },
    },

    workspace: {
      ...(base.workspace ?? {}),
      list: async () => {
        try {
          return await invoke<any[]>('workspace_list');
        } catch {
          return [];
        }
      },
      getActiveId: async () => {
        try {
          return await invoke<string | null>('workspace_get_active_id');
        } catch {
          return null;
        }
      },
      create: async (data: any) => {
        try {
          return await invoke('workspace_create', { data });
        } catch {
          return null;
        }
      },
      patch: async (id: string, data: any) => {
        try {
          return await invoke('workspace_patch', { id, data });
        } catch {
          return null;
        }
      },
      delete: async (id: string) => {
        try {
          return await invoke('workspace_delete', { id });
        } catch {
          return null;
        }
      },
      switch: async (id: string) => {
        try {
          return await invoke('workspace_switch', { id });
        } catch {
          return null;
        }
      },
    },

    canvas: {
      ...(base.canvas ?? {}),
      sync: async (payload: any) => {
        try {
          return await invoke('canvas_sync', { payload });
        } catch {
          return null;
        }
      },
    },

    note: {
      ...(base.note ?? {}),
      read: async (workspaceId: string, noteId: string) => {
        return invoke<string>('note_read', { workspaceId, noteId });
      },
      write: async (workspaceId: string, noteId: string, content: string) => {
        return invoke<void>('note_write', { workspaceId, noteId, content });
      },
    },

    profile: {
      ...(base.profile ?? {}),
      get: async () => {
        try {
          return await invoke('profile_load');
        } catch {
          return null;
        }
      },
      load: async () => {
        try {
          return await invoke('profile_load');
        } catch {
          return null;
        }
      },
      update: async (patch: any) => {
        try {
          return await invoke('ipc_dispatch', {
            channel: 'mindagentics:profile:update',
            args: [patch],
          });
        } catch {
          return null;
        }
      },
      awardXp: async (xp: number, statKey?: string) => {
        try {
          return await invoke('profile_award_xp', {
            xp,
            reason: statKey ?? 'action',
            statKey: statKey ?? null,
          });
        } catch {
          return null;
        }
      },
    },

    graphify: {
      ...(base.graphify ?? {}),
      buildGraph: async (params: any) => {
        try {
          return await invoke('graphify_build', { params });
        } catch (err: any) {
          return { ok: false, error: err?.message || String(err) };
        }
      },
      checkGraph: async (dir: string) => {
        try {
          return await invoke('graphify_check', { dir });
        } catch {
          return { hasGraph: false, exists: false };
        }
      },
      query: async (dir: string, question: string, dfs?: boolean) => {
        return invoke('ipc_dispatch', {
          channel: 'mindagentics:graphify:query',
          args: [dir, question, dfs],
        });
      },
      explain: async (dir: string, symbol: string, all?: boolean) => {
        return invoke('ipc_dispatch', {
          channel: 'mindagentics:graphify:explain',
          args: [dir, symbol, all],
        });
      },
      path: async (dir: string, from: string, to: string, undirected?: boolean) => {
        return invoke('ipc_dispatch', {
          channel: 'mindagentics:graphify:path',
          args: [dir, from, to, undirected],
        });
      },
      onProgress: (handler: (data: { message: string }) => void) => {
        return safeListen<{ message: string }>('mindagentics:graphify:progress', handler);
      },
    },

    portal: {
      ...(base.portal ?? {}),
      openWindow: async (url: string, title?: string) => {
        try {
          return await invoke('portal_open_window', { url, title });
        } catch {
          window.open(url, '_blank', 'noreferrer');
          return null;
        }
      },
    },
  };
}
