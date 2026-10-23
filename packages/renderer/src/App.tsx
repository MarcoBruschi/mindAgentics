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
import { Menu } from 'lucide-react';
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
  const [isSidebarOpen, setIsSidebarOpen] = useAtom(isSidebarOpenAtom);
  const [, undo] = useAtom(undoAtom);
  const [, redo] = useAtom(redoAtom);
  const [, setNodes] = useAtom(nodesAtom);
  const [, setCableTies] = useAtom(cableTiesAtom);

  // Initial backend load with normalization for existing disk workspaces
  useEffect(() => {
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
    const api = window.api || window.maestri;
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
    <div className="w-screen h-screen flex flex-col overflow-hidden bg-[#1E1E1E] text-zinc-100 select-none font-sans relative">
      {/* Top Draggable Electron Titlebar / Tab Bar */}
      <TitleBar />

      {/* Main Workspace Body */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Full Canvas Viewport (runs underneath the frosted sidebar) */}
        <main className="w-full h-full absolute inset-0 overflow-hidden flex flex-col">
          <InfiniteCanvas />
          <CanvasToolbar />
        </main>

        {/* Frosted Glass Sidebar */}
        <Sidebar />

        {/* Canvas Hamburger Toggle Button (3 horizontal stacked bars) */}
        <button
          onClick={() => setIsSidebarOpen((prev: boolean) => !prev)}
          className={`absolute top-3 z-40 p-2 rounded-lg bg-[#1c1d22]/80 hover:bg-[#282930] backdrop-blur-md border border-white/10 text-zinc-300 hover:text-white shadow-lg transition-all duration-300 ease-in-out flex items-center justify-center cursor-pointer ${
            isSidebarOpen ? 'left-[268px]' : 'left-3'
          }`}
          title={isSidebarOpen ? 'Esconder barra lateral' : 'Mostrar barra lateral'}
        >
          <Menu className="w-4 h-4" strokeWidth={2} />
        </button>
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
