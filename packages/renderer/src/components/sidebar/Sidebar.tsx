import React, { useState } from 'react';
import { useAtom } from 'jotai';
import {
  workspacesAtom,
  activeWorkspaceIdAtom,
  activeWorkspaceAtom,
} from '@/atoms/workspace';
import {
  isWorkspaceSettingsModalOpenAtom,
  isSidebarCollapsedAtom,
  isCommandPaletteOpenAtom,
  isCreateWorkspaceModalOpenAtom,
} from '@/atoms/ui';
import {
  Folder,
  Layers,
  Settings,
  Plus,
  ChevronLeft,
  ChevronRight,
  Search,
  Check,
  Trash2,
  Edit2,
} from 'lucide-react';
import { Workspace } from '@maestri/shared';

export const Sidebar: React.FC = () => {
  const [workspaces, setWorkspaces] = useAtom(workspacesAtom);
  const [activeWorkspaceId, setActiveWorkspaceId] = useAtom(activeWorkspaceIdAtom);
  const [activeWorkspace] = useAtom(activeWorkspaceAtom);

  const [isCollapsed, setIsCollapsed] = useAtom(isSidebarCollapsedAtom);
  const [, setIsSettingsOpen] = useAtom(isWorkspaceSettingsModalOpenAtom);
  const [, setIsCommandPaletteOpen] = useAtom(isCommandPaletteOpenAtom);
  const [, setIsCreateWorkspaceOpen] = useAtom(isCreateWorkspaceModalOpenAtom);

  const [workspaceToDelete, setWorkspaceToDelete] = useState<Workspace | null>(null);

  const handleDeleteWorkspace = (ws: Workspace, e: React.MouseEvent) => {
    e.stopPropagation();
    if (workspaces.length <= 1) {
      alert('Não é possível excluir o único espaço de trabalho restante.');
      return;
    }
    setWorkspaceToDelete(ws);
  };

  const confirmDelete = () => {
    if (!workspaceToDelete) return;
    const id = workspaceToDelete.id;

    if (window.api?.workspace?.delete) {
      window.api.workspace.delete(id).catch(() => {});
    }

    const remaining = workspaces.filter((w) => w.id !== id);
    setWorkspaces(remaining);
    if (activeWorkspaceId === id && remaining.length > 0) {
      setActiveWorkspaceId(remaining[0].id);
    }
    setWorkspaceToDelete(null);
  };

  const handleEditWorkspace = (ws: Workspace, e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveWorkspaceId(ws.id);
    setIsSettingsOpen(true);
  };

  if (isCollapsed) {
    return (
      <div className="w-12 h-full bg-[#121316] border-r border-white/5 flex flex-col items-center py-3 gap-3 z-30 select-none">
        <button
          onClick={() => setIsCollapsed(false)}
          className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-white/5"
          title="Expand Sidebar"
        >
          <ChevronRight className="w-4 h-4" />
        </button>

        <div className="w-6 h-[1px] bg-white/10" />

        <button
          onClick={() => setIsCommandPaletteOpen(true)}
          className="p-2 text-zinc-400 hover:text-white rounded-lg hover:bg-white/5"
          title="Command Palette (Ctrl+K)"
        >
          <Search className="w-4 h-4" />
        </button>

        <button
          onClick={() => setIsCreateWorkspaceOpen(true)}
          className="p-2 text-zinc-400 hover:text-blue-400 rounded-lg hover:bg-blue-500/10"
          title="Novo Workspace"
        >
          <Plus className="w-4 h-4" />
        </button>

        <div className="flex-1" />

        <button
          onClick={() => setIsSettingsOpen(true)}
          className="p-2 text-zinc-400 hover:text-white rounded-lg hover:bg-white/5"
          title="Configurações do Workspace"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <aside className="w-64 h-full bg-[#121316] border-r border-white/5 flex flex-col z-30 select-none text-zinc-300">
      {/* Workspace Header */}
      <div className="p-3 border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-2 overflow-hidden">
          <div className="w-6 h-6 rounded-lg bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400 font-bold text-xs">
            M
          </div>
          <div className="flex flex-col overflow-hidden">
            <span className="font-semibold text-xs text-white truncate">
              {activeWorkspace?.name || 'Maestri'}
            </span>
            <span className="text-[10px] text-zinc-500 truncate font-mono">
              {activeWorkspace?.workingDirectory || ''}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="p-1.5 text-zinc-400 hover:text-white rounded-md hover:bg-white/5"
            title="Configurações do Workspace"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setIsCollapsed(true)}
            className="p-1.5 text-zinc-400 hover:text-white rounded-md hover:bg-white/5"
            title="Recolher Barra Lateral"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Quick Search */}
      <div className="px-3 py-2">
        <button
          onClick={() => setIsCommandPaletteOpen(true)}
          className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[#181a20] border border-white/5 text-xs text-zinc-400 hover:text-zinc-200 hover:border-white/15 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Search className="w-3.5 h-3.5 text-zinc-500" />
            <span>Search actions...</span>
          </div>
          <kbd className="px-1 py-0.5 text-[9px] font-mono bg-black/40 rounded border border-white/10 text-zinc-500">
            Ctrl+K
          </kbd>
        </button>
      </div>

      {/* Workspaces List Section */}
      <div className="flex-1 overflow-y-auto px-2 py-1 space-y-4">
        <div>
          <div className="flex items-center justify-between px-2 py-1.5 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
            <span className="flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-blue-400" />
              Workspaces ({workspaces.length})
            </span>
            <button
              onClick={() => setIsCreateWorkspaceOpen(true)}
              className="p-1 hover:text-blue-400 rounded hover:bg-white/5 transition-colors"
              title="Adicionar Novo Workspace"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-1 mt-1">
            {workspaces.map((ws: Workspace) => {
              const isActive = ws.id === activeWorkspaceId;
              const nodeCount = ws.floors?.[0]?.nodes?.length || 0;
              return (
                <div
                  key={ws.id}
                  onClick={() => setActiveWorkspaceId(ws.id)}
                  className={`group flex items-center justify-between px-2.5 py-2 rounded-lg text-xs cursor-pointer transition-colors ${
                    isActive
                      ? 'bg-blue-600/15 text-blue-300 font-medium border border-blue-500/25'
                      : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate flex-1 mr-1">
                    <Folder className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-blue-400' : 'text-zinc-500'}`} />
                    <span className="truncate">{ws.name}</span>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {/* Hover action buttons: Edit and Delete */}
                    <div className="hidden group-hover:flex items-center gap-0.5 mr-1">
                      <button
                        onClick={(e) => handleEditWorkspace(ws, e)}
                        className="p-1 hover:text-blue-400 rounded hover:bg-white/10 text-zinc-400 transition-colors"
                        title="Editar Workspace"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                      {workspaces.length > 1 && (
                        <button
                          onClick={(e) => handleDeleteWorkspace(ws, e)}
                          className="p-1 hover:text-red-400 rounded hover:bg-red-500/10 text-zinc-400 transition-colors"
                          title="Excluir Workspace"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>

                    <span className="text-[10px] text-zinc-500 font-mono group-hover:hidden">
                      {nodeCount} items
                    </span>
                    {isActive && <Check className="w-3.5 h-3.5 text-blue-400" />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bottom Panel Actions */}
      <div className="p-2 border-t border-white/5 flex items-center justify-between bg-[#101114]">
        <button
          onClick={() => setIsCreateWorkspaceOpen(true)}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Novo Workspace</span>
        </button>
      </div>

      {/* Delete Workspace Confirmation Dialog */}
      {workspaceToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm bg-[#16181e] border border-white/10 rounded-2xl p-5 shadow-2xl text-zinc-200 space-y-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-red-400" />
              <span>Excluir Workspace</span>
            </h3>
            <p className="text-xs text-zinc-400">
              Tem certeza que deseja excluir o workspace <strong className="text-white">"{workspaceToDelete.name}"</strong>? O canvas será removido, mas seus arquivos no disco serão preservados.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setWorkspaceToDelete(null)}
                className="px-3 py-1.5 rounded-xl text-xs text-zinc-400 hover:text-white hover:bg-white/5"
              >
                Cancelar
              </button>
              <button
                onClick={confirmDelete}
                className="px-3.5 py-1.5 rounded-xl text-xs bg-red-600 hover:bg-red-500 text-white font-medium shadow"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};
