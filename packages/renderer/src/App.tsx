import React, { useEffect } from 'react';
import { useAtom } from 'jotai';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { InfiniteCanvas } from '@/components/canvas/InfiniteCanvas';
import { CanvasToolbar } from '@/components/toolbar/CanvasToolbar';
import { WorkspaceSettingsModal } from '@/components/modals/WorkspaceSettingsModal';
import { CommandPalette } from '@/components/modals/CommandPalette';
import { CreateAgentModal } from '@/components/modals/CreateAgentModal';
import { CreateWorkspaceModal } from '@/components/modals/CreateWorkspaceModal';
import {
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
  const [, undo] = useAtom(undoAtom);
  const [, redo] = useAtom(redoAtom);

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

  // Global Shortcuts: Ctrl+Z (Undo) and Ctrl+Y / Ctrl+Shift+Z (Redo) (Requirement 3)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check if user is typing in an input, textarea, or contentEditable element
      const target = e.target as HTMLElement;
      const isInput =
        target &&
        (['INPUT', 'TEXTAREA'].includes(target.tagName) ||
          target.isContentEditable ||
          target.classList.contains('xterm-helper-textarea'));

      if (isInput) return;

      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const modKey = isMac ? e.metaKey : e.ctrlKey;

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
  }, [undo, redo]);

  return (
    <div className="w-screen h-screen flex overflow-hidden bg-[#0e0f12] text-zinc-100 select-none font-sans">
      {/* Sidebar */}
      <Sidebar />

      {/* Main Canvas Viewport */}
      <main className="flex-1 h-full relative overflow-hidden flex flex-col">
        <InfiniteCanvas />
        <CanvasToolbar />
      </main>

      {/* Modals */}
      <WorkspaceSettingsModal />
      <CommandPalette />
      <CreateAgentModal />
      <CreateWorkspaceModal />
    </div>
  );
};

export default App;
