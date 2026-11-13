import React, { useEffect, useRef } from 'react';
import { useAtom } from 'jotai';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { InfiniteCanvas } from '@/components/canvas/InfiniteCanvas';
import { CanvasToolbar } from '@/components/toolbar/CanvasToolbar';
import { WorkspaceSettingsModal } from '@/components/modals/WorkspaceSettingsModal';
import { CommandPalette } from '@/components/modals/CommandPalette';
import { CreateAgentModal } from '@/components/modals/CreateAgentModal';
import { CreateGraphModal } from '@/components/modals/CreateGraphModal';
import { CreateWorkspaceModal } from '@/components/modals/CreateWorkspaceModal';
import { AgentLimitsModal } from '@/components/modals/AgentLimitsModal';
import { ProfileModal } from '@/components/modals/ProfileModal';
import { OnboardingModal } from '@/components/modals/OnboardingModal';
import { TitleBar } from '@/components/window/TitleBar';
import { isSidebarOpenAtom } from '@/atoms/ui';
import { profileToastAtom } from '@/atoms/profile';
import { isInputOrEditable, hasPrimaryModifier } from '@/utils/keyboard';
import { X, CheckCircle2 } from 'lucide-react';
import {
  nodesAtom,
  cableTiesAtom,
  workspacesAtom,
  activeWorkspaceIdAtom,
  activeWorkspaceAtom,
  undoAtom,
  redoAtom,
  normalizeWorkspace,
} from '@/atoms/workspace';

export const App: React.FC = () => {
  const isHydratedRef = useRef(false);
  const [workspaces, setWorkspaces] = useAtom(workspacesAtom);
  const [activeWorkspaceId, setActiveWorkspaceId] = useAtom(activeWorkspaceIdAtom);
  const [activeWorkspace] = useAtom(activeWorkspaceAtom);
  const [, setIsSidebarOpen] = useAtom(isSidebarOpenAtom);
  const [, undo] = useAtom(undoAtom);
  const [, redo] = useAtom(redoAtom);
  const [, setNodes] = useAtom(nodesAtom);
  const [, setCableTies] = useAtom(cableTiesAtom);
  const [profileToast, setProfileToast] = useAtom(profileToastAtom);

  // Auto-dismiss celebratory level-up/badge toast after 5s
  useEffect(() => {
    if (profileToast) {
      const timer = setTimeout(() => {
        setProfileToast(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [profileToast, setProfileToast]);

  // Initial backend load with normalization for existing disk workspaces
  useEffect(() => {
    const api = (window as any).api || (window as any).mindAgentics ;
    const syncTranslucency = () => {
      if (api?.app?.info) {
        api.app.info().then((info: any) => {
          document.documentElement.classList.toggle(
            'window-translucent',
            Boolean(info?.windowMaterial || info?.windowSeeThrough)
          );
        }).catch(() => {});
      }
    };
    syncTranslucency();

    const controls = window.api?.windowControls || (window as any).mindAgentics?.windowControls ?.windowControls;
    let unsubControls: (() => void) | undefined;
    if (controls?.onChanged) {
      unsubControls = controls.onChanged(() => {
        syncTranslucency();
      });
    }

    if (window.api?.workspace?.list) {
      Promise.all([
        window.api.workspace.list(),
        window.api.workspace.getActiveId ? window.api.workspace.getActiveId() : Promise.resolve(null),
      ])
        .then(([backendWorkspaces, activeId]: [any[], string | null]) => {
          if (Array.isArray(backendWorkspaces) && backendWorkspaces.length > 0) {
            const normalized = backendWorkspaces.map(normalizeWorkspace);
            setWorkspaces(normalized);

            const targetId =
              (activeId && normalized.some((w) => w.id === activeId) ? activeId : null) ||
              (activeWorkspaceId && normalized.some((w) => w.id === activeWorkspaceId) ? activeWorkspaceId : null) ||
              normalized[0].id;

            if (targetId) {
              setActiveWorkspaceId(targetId);
            }
          }
          isHydratedRef.current = true;
        })
        .catch(() => {
          isHydratedRef.current = true;
        });
    } else {
      isHydratedRef.current = true;
    }
  }, [setWorkspaces]);

  // Global Auto-save on every workspace change (Requirement 2)
  useEffect(() => {
    try {
      localStorage.setItem('mindagentics_active_ws', activeWorkspaceId);
    } catch {
      // quota or local storage error
    }

    if (!isHydratedRef.current) {
      return;
    }

    const backendTimer = setTimeout(() => {
      if (activeWorkspace && window.api?.workspace?.patch) {
        window.api.workspace.patch(activeWorkspace.id, activeWorkspace).catch(() => {});
        window.api?.workspace?.switch?.(activeWorkspace.id)?.catch?.(() => {});
      }
    }, 400);

    return () => {
      clearTimeout(backendTimer);
    };
  }, [workspaces, activeWorkspaceId, activeWorkspace]);

  // Listen for canvas placement and cable tie events from CoreDaemon / CLI
  useEffect(() => {
    const api = window.api || window.mindAgentics || (window.mindAgentics || window.api );
    if (!api) return;

    const unsubs: Array<() => void> = [];

    const nodePlacedListener = api.onNodePlaced || api.canvas?.onNodePlaced;
    if (typeof nodePlacedListener === 'function') {
      unsubs.push(
        nodePlacedListener((payload: any) => {
          const node = payload?.node || payload;
          if (!node || !node.id) return;

          setNodes((prev: any[]) => {
            if (prev.some((n) => n.id === node.id)) {
              return prev.map((n) =>
                n.id === node.id
                  ? {
                      ...n,
                      ...node,
                      content: {
                        ...(n.content || {}),
                        ...(node.content || {}),
                      },
                    }
                  : n
              );
            }
            if (node.kind === 'portal' && node.content?.url) {
              const urlExists = prev.some(
                (n) => n.kind === 'portal' && n.content?.url === node.content?.url
              );
              if (urlExists) return prev;
            }
            return [...prev, node];
          });
        })
      );
    }

    const nodeDeletedListener = api.onNodeDeleted || api.canvas?.onNodeDeleted;
    if (typeof nodeDeletedListener === 'function') {
      unsubs.push(
        nodeDeletedListener((payload: any) => {
          const nodeId = payload?.nodeId || payload?.id || payload;
          if (!nodeId) return;

          setNodes((prev: any[]) => prev.filter((n) => n.id !== nodeId));
          setCableTies((prev: any[]) =>
            prev.filter((t) => t.fromNodeId !== nodeId && t.toNodeId !== nodeId)
          );
        })
      );
    }

    const cableTieListener = api.onCableTieCreated || api.canvas?.onCableTieCreated;
    if (typeof cableTieListener === 'function') {
      unsubs.push(
        cableTieListener((payload: any) => {
          const fromNodeId = payload?.fromNodeId;
          const toNodeId = payload?.toNodeId;
          const label = payload?.label || '';
          if (!fromNodeId || !toNodeId) return;

          setCableTies((prev: any[]) => {
            const alreadyExists = prev.some(
              (t) =>
                (t.fromNodeId === fromNodeId && t.toNodeId === toNodeId) ||
                (t.fromNodeId === toNodeId && t.toNodeId === fromNodeId)
            );
            if (alreadyExists) return prev;

            const newTie = {
              id: payload.id || `tie-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              fromNodeId,
              toNodeId,
              label,
            };
            return [...prev, newTie];
          });
        })
      );
    }

    const cableTieDeletedListener = api.onCableTieDeleted || api.canvas?.onCableTieDeleted;
    if (typeof cableTieDeletedListener === 'function') {
      unsubs.push(
        cableTieDeletedListener((payload: any) => {
          const tieId = payload?.id;
          const fromNodeId = payload?.fromNodeId;
          const toNodeId = payload?.toNodeId;

          setCableTies((prev: any[]) =>
            prev.filter((t) => {
              if (tieId && t.id === tieId) return false;
              if (fromNodeId && toNodeId) {
                if (
                  (t.fromNodeId === fromNodeId && t.toNodeId === toNodeId) ||
                  (t.fromNodeId === toNodeId && t.toNodeId === fromNodeId)
                ) {
                  return false;
                }
              }
              return true;
            })
          );
        })
      );
    }

    return () => {
      unsubs.forEach((unsub) => {
        try {
          unsub();
        } catch {
          // ignore
        }
      });
    };
  }, [setNodes, setCableTies]);

  // Global Shortcuts: Ctrl+Z (Undo), Ctrl+Y / Ctrl+Shift+Z (Redo), Ctrl+S (Toggle Sidebar)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const inInput = isInputOrEditable(activeEl);
      const modKey = hasPrimaryModifier(e);

      // Focus isolation: do not hijack keystrokes if focused in an input, textarea, or terminal
      if (inInput) return;

      // Sidebar Toggle: Ctrl+S
      if (modKey && e.key.toLowerCase() === 's' && !e.shiftKey) {
        e.preventDefault();
        setIsSidebarOpen((prev: boolean) => !prev);
        return;
      }

      if (modKey && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (
        (modKey && e.key.toLowerCase() === 'y') ||
        (modKey && e.shiftKey && e.key.toLowerCase() === 'z')
      ) {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, setIsSidebarOpen]);

  return (
    <div className="app-shell w-screen h-screen overflow-hidden bg-transparent text-zinc-100 select-none font-sans relative">
      <div className="w-full h-full flex flex-col relative overflow-hidden bg-transparent">
        <TitleBar />
        <div className="w-full flex-1 flex overflow-hidden relative">
          {/* Sidebar Transparente: Canal alfa direto para a janela do Electron */}
          <Sidebar />

          {/* Canvas Sólido: Fica ESTRITAMENTE ao lado da barra lateral, NUNCA atrás dela */}
          <main className="flex-1 h-full flex flex-col bg-[#0E0F12] relative overflow-hidden">
            <InfiniteCanvas />
            <CanvasToolbar />
          </main>
        </div>
      </div>

      {/* Technical System Toast Notification (Sonner Style - Anti-AI-Slop) */}
      {profileToast && (
        <div className="fixed top-16 right-6 z-50 flex items-center gap-3 px-3.5 py-2.5 bg-[#14161A]/95 border border-white/[0.08] rounded-xl shadow-xl backdrop-blur-md text-[#E7E8EA] animate-in slide-in-from-top-4 duration-150">
          <div className="w-7 h-7 rounded-lg bg-white/[0.05] border border-white/[0.08] flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" strokeWidth={1.75} />
          </div>
          <div className="flex flex-col min-w-0 pr-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-white tracking-tight">
                {profileToast.title}
              </span>
              <span className="text-[9px] px-1.5 py-0.2 rounded bg-white/[0.05] border border-white/[0.08] text-[#8A8F98] font-mono">
                system
              </span>
            </div>
            <span className="text-[11px] text-[#8A8F98] font-mono truncate mt-0.5">
              {profileToast.description}
            </span>
          </div>
          <button
            onClick={() => setProfileToast(null)}
            className="p-1 rounded-md text-[#8A8F98] hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
            title="Fechar notificação"
          >
            <X className="w-3.5 h-3.5" strokeWidth={1.75} />
          </button>
        </div>
      )}

      {/* Modals */}
      <WorkspaceSettingsModal />
      <CommandPalette />
      <CreateAgentModal />
      <CreateGraphModal />
      <CreateWorkspaceModal />
      <AgentLimitsModal />
      <ProfileModal />
      <OnboardingModal />
    </div>
  );
};

export default App;
