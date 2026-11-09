import React, { useState } from 'react';
import { useAtom } from 'jotai';
import {
  workspacesAtom,
  activeWorkspaceIdAtom,
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
  Trash2,
  Edit2,
  Terminal,
} from 'lucide-react';
import { Workspace } from '@mindagentics/shared';

export const Sidebar: React.FC = () => {
  const [workspaces, setWorkspaces] = useAtom(workspacesAtom);
  const [activeWorkspaceId, setActiveWorkspaceId] = useAtom(activeWorkspaceIdAtom);
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
      className={`relative h-full border-r border-[#23262C]/80 flex flex-col z-30 select-none text-[#E7E8EA] transition-all duration-300 ease-in-out shrink-0 overflow-hidden ${
        isCollapsed
          ? 'w-0 border-r-0 opacity-0 pointer-events-none'
          : 'w-[248px] opacity-100'
      }`}
      style={{
        backgroundColor: 'rgba(10, 12, 16, 0.82)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
      }}
    >
      <div className="w-[248px] h-full flex flex-col shrink-0 pt-2">
        {/* Workspaces List Section */}
        <div className="flex-1 overflow-y-auto px-2 py-1 space-y-4">
          <div>
            <div className="flex items-center justify-between px-2.5 py-2 text-[11px] font-semibold text-[#8A8F98] uppercase tracking-wider">
              <span>ESPAÇOS DE TRABALHO</span>
              <button
                onClick={() => setIsCreateWorkspaceOpen(true)}
                className="w-6 h-6 flex items-center justify-center text-[#8A8F98] hover:text-[#E7E8EA] rounded-lg hover:bg-[#181B20] transition-colors cursor-pointer"
                title="Adicionar Novo Workspace"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="space-y-1 mt-0.5">
              {workspaces.map((ws: Workspace) => {
                const isActive = ws.id === activeWorkspaceId;
                const nodeCount = isActive
                  ? (allNodes?.length ?? (ws.floors || []).reduce((acc: number, f: any) => acc + (f?.nodes?.length || 0), 0))
                  : (ws.floors || []).reduce((acc: number, f: any) => acc + (f?.nodes?.length || 0), 0) || ((ws as any).nodes?.length || 0);

                return (
                  <div
                    key={ws.id}
                    onClick={() => setActiveWorkspaceId(ws.id)}
                    className={`group flex items-center justify-between h-9 px-3 text-xs cursor-pointer rounded-xl transition-all ${
                      isActive
                        ? 'bg-[#181B20]/90 text-[#E7E8EA] font-medium border border-[#23262C]'
                        : 'text-[#8A8F98] hover:text-[#E7E8EA] hover:bg-[#14161A]/60 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 truncate flex-1 min-w-0 mr-2">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 transition-all ${
                          isActive
                            ? 'bg-[#8B93FF] shadow-[0_0_8px_rgba(139,147,255,0.7)]'
                            : 'bg-[#23262C] group-hover:bg-[#8A8F98]/40'
                        }`}
                      />
                      <span className="truncate text-[13px] tracking-tight">{ws.name}</span>
                    </div>

                    {/* Fixed-size right container preventing any layout shift on hover */}
                    <div className="relative flex items-center justify-end w-12 h-6 shrink-0">
                      {/* Dimmed counter */}
                      <div className="flex items-center gap-1 text-[#8A8F98]/50 transition-opacity duration-150 group-hover:opacity-0 group-hover:pointer-events-none">
                        <Terminal className="w-3 h-3 opacity-60" strokeWidth={1.6} />
                        <span className="text-[11px] font-mono">{nodeCount}</span>
                      </div>

                      {/* Hover action buttons: Edit and Delete */}
                      <div className="absolute inset-y-0 right-0 flex items-center gap-0.5 opacity-0 pointer-events-none transition-opacity duration-150 group-hover:opacity-100 group-hover:pointer-events-auto">
                        <button
                          onClick={(e) => handleEditWorkspace(ws, e)}
                          className="p-1 hover:text-[#8B93FF] rounded hover:bg-[#23262C] text-[#8A8F98] transition-colors"
                          title="Editar Workspace"
                        >
                          <Edit2 className="w-3 h-3" strokeWidth={1.6} />
                        </button>
                        {workspaces.length > 1 && (
                          <button
                            onClick={(e) => handleDeleteWorkspace(ws, e)}
                            className="p-1 hover:text-red-400 rounded hover:bg-red-500/10 text-[#8A8F98] transition-colors"
                            title="Excluir Workspace"
                          >
                            <Trash2 className="w-3 h-3" strokeWidth={1.6} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Bottom Panel Actions */}
        <div className="p-3 border-t border-[#23262C]/50 flex items-center justify-between bg-transparent">
          <button
            onClick={() => setIsCreateWorkspaceOpen(true)}
            className="flex items-center gap-2 text-xs text-[#8A8F98] hover:text-[#E7E8EA] transition-colors cursor-pointer"
          >
            <Folder className="w-3.5 h-3.5 text-[#8A8F98]" strokeWidth={1.6} />
            <span>Novo grupo</span>
          </button>

          <button
            onClick={() => setIsSettingsOpen(true)}
            className="p-1.5 text-[#8A8F98] hover:text-[#E7E8EA] rounded-xl hover:bg-[#181B20] transition-colors cursor-pointer"
            title="Ajustes do Workspace"
          >
            <Settings className="w-4 h-4" strokeWidth={1.6} />
          </button>
        </div>
      </div>

      {/* Delete Workspace Confirmation Dialog */}
      {workspaceToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm bg-[#14161A] border border-[#23262C] rounded-2xl p-5 shadow-2xl text-[#E7E8EA] space-y-3">
            <h3 className="text-sm font-semibold text-[#E7E8EA] flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-rose-400" />
              <span>Excluir Workspace</span>
            </h3>
            <p className="text-xs text-[#8A8F98] leading-relaxed">
              Tem certeza que deseja excluir o workspace <strong className="text-[#E7E8EA]">"{workspaceToDelete.name}"</strong>? O canvas será removido, mas seus arquivos no disco serão preservados.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setWorkspaceToDelete(null)}
                className="px-3 py-1.5 rounded-xl text-xs text-[#8A8F98] hover:text-[#E7E8EA] hover:bg-[#181B20] transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={confirmDelete}
                className="px-3.5 py-1.5 rounded-xl text-xs bg-rose-600 hover:bg-rose-500 text-white font-medium transition-colors"
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
