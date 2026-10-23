import React, { useState } from 'react';
import { useAtom } from 'jotai';
import {
  workspacesAtom,
  activeWorkspaceIdAtom,
  activeWorkspaceAtom,
  nodesAtom,
} from '@/atoms/workspace';
import {
  isWorkspaceSettingsModalOpenAtom,
  isSidebarCollapsedAtom,
  isCommandPaletteOpenAtom,
  isCreateWorkspaceModalOpenAtom,
} from '@/atoms/ui';
import {
  Folder,
  Settings,
  Plus,
  Search,
  Trash2,
  Edit2,
  Terminal,
} from 'lucide-react';
import { Workspace } from '@maestri/shared';

const WORKSPACE_ICON_COLORS = [
  '#3B82F6', // Blue
  '#EF4444', // Coral / Red
  '#A855F7', // Purple
  '#10B981', // Emerald
  '#F59E0B', // Amber
];

export const Sidebar: React.FC = () => {
  const [workspaces, setWorkspaces] = useAtom(workspacesAtom);
  const [activeWorkspaceId, setActiveWorkspaceId] = useAtom(activeWorkspaceIdAtom);
  const [activeWorkspace] = useAtom(activeWorkspaceAtom);
  const [allNodes] = useAtom(nodesAtom);

  const [isCollapsed] = useAtom(isSidebarCollapsedAtom);
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

  return (
    <aside
      className={`relative h-full border-r border-white/[0.08] flex flex-col z-30 select-none text-zinc-300 transition-all duration-300 ease-in-out shrink-0 overflow-hidden ${
        isCollapsed
          ? 'w-0 border-r-0 opacity-0 pointer-events-none'
          : 'w-64 opacity-100'
      }`}
      style={{
        backgroundColor: 'var(--sidebar-bg, rgba(30, 32, 38, 0.45))',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}
    >
      <div className="w-64 h-full flex flex-col shrink-0">
        {/* Quick Search */}
        <div className="p-3 pb-1">
        <button
          onClick={() => setIsCommandPaletteOpen(true)}
          className="w-full flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.06] border border-white/[0.05] text-xs text-[#8E8E93] hover:text-zinc-200 transition-colors cursor-pointer"
        >
          <Search className="w-3.5 h-3.5 text-[#8E8E93] shrink-0" strokeWidth={1.5} />
          <span>Filtrar</span>
        </button>
      </div>

      {/* Workspaces List Section */}
      <div className="flex-1 overflow-y-auto px-2 py-1 space-y-4">
        <div>
          <div className="flex items-center justify-between px-2 py-1.5 text-[11px] font-semibold text-[#8E8E93] uppercase tracking-[0.05em]">
            <span>WORKSPACES</span>
            <button
              onClick={() => setIsCreateWorkspaceOpen(true)}
              className="p-1 text-[#AEAEB2] hover:text-white transition-colors cursor-pointer"
              title="Adicionar Novo Workspace"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-1 mt-1">
            {workspaces.map((ws: Workspace, index: number) => {
              const isActive = ws.id === activeWorkspaceId;
              const nodeCount = isActive
                ? (allNodes?.length ?? (ws.floors || []).reduce((acc: number, f: any) => acc + (f?.nodes?.length || 0), 0))
                : (ws.floors || []).reduce((acc: number, f: any) => acc + (f?.nodes?.length || 0), 0) || ((ws as any).nodes?.length || 0);
              const iconColor = WORKSPACE_ICON_COLORS[index % WORKSPACE_ICON_COLORS.length];

              return (
                <div
                  key={ws.id}
                  onClick={() => setActiveWorkspaceId(ws.id)}
                  className={`group flex items-center justify-between px-2.5 py-2 text-xs cursor-pointer transition-colors ${
                    isActive
                      ? 'bg-white/10 text-white font-medium rounded-[6px] border-none'
                      : 'text-[#E5E5EA] bg-transparent hover:bg-white/[0.05] rounded-[6px]'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate flex-1 mr-1">
                    <Folder
                      className="w-3.5 h-3.5 shrink-0"
                      strokeWidth={1.5}
                      style={{ color: iconColor }}
                    />
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

                    {/* Real Node / Item count */}
                    <div className="flex items-center gap-1 text-[#8E8E93] group-hover:hidden">
                      <Terminal className="w-3 h-3 text-[#8E8E93]" strokeWidth={1.5} />
                      <span className="text-[10px] font-mono">{nodeCount}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bottom Panel Actions */}
      <div className="p-3 border-t border-white/[0.08] flex items-center justify-between bg-transparent">
        <button
          onClick={() => setIsCreateWorkspaceOpen(true)}
          className="flex items-center gap-2 text-[12px] text-[#8E8E93] hover:text-white transition-colors cursor-pointer"
        >
          <Folder className="w-3.5 h-3.5 text-[#8E8E93]" strokeWidth={1.5} />
          <span>Novo grupo</span>
        </button>

        <button
          onClick={() => setIsSettingsOpen(true)}
          className="p-1.5 text-[#8E8E93] hover:text-white rounded-md hover:bg-white/[0.06] transition-colors cursor-pointer"
          title="Configurações do Workspace"
        >
          <Settings className="w-4 h-4" strokeWidth={1.5} />
        </button>
      </div>
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
