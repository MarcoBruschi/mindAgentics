import React, { useEffect } from 'react';
import { useAtom } from 'jotai';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { InfiniteCanvas } from '@/components/canvas/InfiniteCanvas';
import { CanvasToolbar } from '@/components/toolbar/CanvasToolbar';
import { WorkspaceSettingsModal } from '@/components/modals/WorkspaceSettingsModal';
import { CommandPalette } from '@/components/modals/CommandPalette';
import { CreateAgentModal } from '@/components/modals/CreateAgentModal';
import { CreateWorkspaceModal } from '@/components/modals/CreateWorkspaceModal';
import { AgentLimitsModal } from '@/components/modals/AgentLimitsModal';
import { TitleBar } from '@/components/window/TitleBar';
import { isSidebarOpenAtom } from '@/atoms/ui';
import { isInputOrEditable, hasPrimaryModifier } from '@/utils/keyboard';
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
  const [workspaces, setWorkspaces] = useAtom(workspacesAtom);
  const [activeWorkspaceId] = useAtom(activeWorkspaceIdAtom);
  const [activeWorkspace] = useAtom(activeWorkspaceAtom);
  const [, setIsSidebarOpen] = useAtom(isSidebarOpenAtom);
  const [, undo] = useAtom(undoAtom);
  const [, redo] = useAtom(redoAtom);
  const [, setNodes] = useAtom(nodesAtom);
  const [, setCableTies] = useAtom(cableTiesAtom);

  // Initial backend load with normalization for existing disk workspaces
  useEffect(() => {
    const api = (window as any).api || (window as any).mindAgentics || (window as any).maestri;
    if (api?.app?.info) {
      api.app.info().then((info: any) => {
        document.documentElement.classList.toggle(
          'window-translucent',
          Boolean(info?.windowMaterial || info?.windowSeeThrough)
        );
      }).catch(() => {});
    }

    if (window.api?.workspace?.list) {
      window.api.workspace
        .list()
        .then((backendWorkspaces: any[]) => {
          if (Array.isArray(backendWorkspaces) && backendWorkspaces.length > 0) {
            setWorkspaces(backendWorkspaces.map(normalizeWorkspace));
          }
        })
        .catch(() => {});
    }
  }, [setWorkspaces]);

  // Global Auto-save on every workspace change (Requirement 2)
  useEffect(() => {
    try {
      localStorage.setItem('mindagentics_workspaces', JSON.stringify(workspaces));
      localStorage.setItem('mindagentics_active_ws', activeWorkspaceId);
      localStorage.setItem('maestri_workspaces', JSON.stringify(workspaces));
      localStorage.setItem('maestri_active_ws', activeWorkspaceId);
    } catch {
      // quota or local storage error
    }

    const timer = setTimeout(() => {
      if (activeWorkspace && window.api?.workspace?.patch) {
        window.api.workspace.patch(activeWorkspace.id, activeWorkspace).catch(() => {});
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [workspaces, activeWorkspaceId, activeWorkspace]);

  // Listen for canvas placement and cable tie events from CoreDaemon / CLI
  useEffect(() => {
    const api = window.api || window.mindAgentics || window.maestri;
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
              return prev;
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

      // Sidebar Toggle: Ctrl+S
      if (modKey && e.key.toLowerCase() === 's' && !e.shiftKey) {
        e.preventDefault();
        setIsSidebarOpen((prev: boolean) => !prev);
        return;
      }

      if (inInput) return;

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
    <div className="app-shell w-screen h-screen overflow-hidden bg-[#1E1E1E] text-zinc-100 select-none font-sans relative">
      {/* Top Floating Chrome Bar (Search, Hamburger, Right Utilities, Window Controls) */}
      <TitleBar />

      {/* Main Workspace Body (Fills full viewport behind the floating chrome) */}
      <div className="w-full h-full flex overflow-hidden relative">
        {/* Frosted Translucent Sidebar */}
        <Sidebar />

        {/* Full Canvas Viewport (runs next to the sidebar with solid canvas background) */}
        <main className="flex-1 h-full relative overflow-hidden flex flex-col bg-[#1E1E1E]">
          <InfiniteCanvas />
          <CanvasToolbar />
        </main>
      </div>

      {/* Modals */}
      <WorkspaceSettingsModal />
      <CommandPalette />
      <CreateAgentModal />
      <CreateWorkspaceModal />
      <AgentLimitsModal />
    </div>
  );
};

export default App;
