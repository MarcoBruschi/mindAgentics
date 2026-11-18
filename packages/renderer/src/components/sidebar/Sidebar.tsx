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
  isProfileModalOpenAtom,
} from '@/atoms/ui';
import { useUserProfile, getAvatarOption } from '@/atoms/profile';
import { AvatarIcon } from '@/components/profile/AvatarIcon';
import {
  Folder,
  Settings,
  Plus,
  Trash2,
  Edit2,
  Terminal,
  Flame,
} from 'lucide-react';
import { Floor, Workspace } from '@mindagentics/shared';

const NO_DRAG_STYLE: React.CSSProperties & { WebkitAppRegion: 'no-drag' } = {
  WebkitAppRegion: 'no-drag',
};

const SIDEBAR_STYLE: React.CSSProperties & { WebkitAppRegion: 'no-drag' } = {
  backgroundColor: 'var(--sidebar-bg, #121418)',
  backdropFilter: 'blur(24px) saturate(140%)',
  WebkitBackdropFilter: 'blur(24px) saturate(140%)',
  transform: 'translateZ(0)',
  willChange: 'transform',
  WebkitAppRegion: 'no-drag',
};

export const Sidebar: React.FC = () => {
  const [workspaces, setWorkspaces] = useAtom(workspacesAtom);
  const [activeWorkspaceId, setActiveWorkspaceId] = useAtom(activeWorkspaceIdAtom);
  const [allNodes] = useAtom(nodesAtom);

  const [isCollapsed] = useAtom(isSidebarCollapsedAtom);
  const [, setIsSettingsOpen] = useAtom(isWorkspaceSettingsModalOpenAtom);
  const [, setIsCommandPaletteOpen] = useAtom(isCommandPaletteOpenAtom);
  const [, setIsCreateWorkspaceOpen] = useAtom(isCreateWorkspaceModalOpenAtom);
  const [, setIsProfileOpen] = useAtom(isProfileModalOpenAtom);
  const { profile } = useUserProfile();
  const avatar = getAvatarOption(profile?.avatarId);

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
      aria-hidden={isCollapsed}
      className={`relative h-full border-r border-[#23262C]/80 flex flex-col z-30 select-none text-[#E7E8EA] transition-all duration-300 ease-in-out shrink-0 overflow-hidden ${
        isCollapsed
          ? 'w-0 border-r-0 opacity-0 pointer-events-none'
          : 'w-[248px] opacity-100 pointer-events-auto'
      }`}
      style={SIDEBAR_STYLE}
    >
      <div className="w-[248px] h-full flex flex-col shrink-0 pt-2" style={NO_DRAG_STYLE}>
        {/* Minimalist Operator / Runtime Badge (Anti-AI-Slop) */}
        <div className="px-2 pb-2 shrink-0" style={NO_DRAG_STYLE}>
          <div
            role="button"
            tabIndex={0}
            onClick={() => setIsProfileOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setIsProfileOpen(true);
              }
            }}
            data-streak={profile?.streakDays || 1}
            data-activity="activityHistory"
            className="group flex items-center justify-between p-2 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] hover:border-white/[0.12] cursor-pointer transition-all select-none"
            style={NO_DRAG_STYLE}
            title="Perfil do Operador & Configurações"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {/* Clean Avatar matching Profile */}
              {profile?.avatarUrl ? (
                <img
                  src={profile.avatarUrl}
                  alt={profile?.name || 'Operador'}
                  className="w-8 h-8 rounded-lg object-cover ring-1 ring-white/10 shrink-0"
                />
              ) : (
                <div className="w-8 h-8 rounded-lg bg-[#181B20] border border-white/[0.08] flex items-center justify-center shrink-0">
                  <AvatarIcon avatarId={profile?.avatarId} className="w-4 h-4 text-[#8B93FF]" />
                </div>
              )}

              {/* Identity & Runtime Telemetry */}
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-[#E7E8EA] group-hover:text-white truncate">
                    {profile?.name || 'Orquestrador'}
                  </span>
                  <span className="text-[9px] px-1.5 py-0.2 rounded font-mono font-medium bg-white/[0.06] text-[#8A8F98] border border-white/[0.08] shrink-0">
                    {profile?.callsign || 'ARCHITECT-01'}
                  </span>
                </div>
                <span className="text-[11px] text-[#8A8F98] truncate mt-0.5">
                  {profile?.title || 'Compositor de Agentes'}
                </span>
              </div>
            </div>

            {/* Streak Badge with Flame Icon */}
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-medium shrink-0 ml-1">
              <Flame className="w-3 h-3 text-emerald-400 fill-emerald-500/20" />
              <span>{profile?.streakDays || 1}d</span>
            </div>
          </div>
        </div>

        {/* Workspaces List Section */}
        <div className="flex-1 overflow-y-auto px-2 py-1 space-y-4">
          <div>
            <div className="flex items-center justify-between px-2.5 py-2 text-[11px] font-semibold text-[#8A8F98] uppercase tracking-wider">
              <span>ESPAÇOS DE TRABALHO</span>
              <button
                tabIndex={0}
                onClick={() => setIsCreateWorkspaceOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setIsCreateWorkspaceOpen(true);
                  }
                }}
                className="w-6 h-6 flex items-center justify-center text-[#8A8F98] hover:text-[#E7E8EA] focus:text-[#E7E8EA] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#8B93FF] rounded-lg hover:bg-[#181B20] transition-colors cursor-pointer"
                title="Adicionar Novo Workspace"
                aria-label="Adicionar Novo Workspace"
              >
                <Plus className="w-4 h-4" strokeWidth={1.75} />
              </button>
            </div>

            <div className="space-y-1 mt-0.5">
              {workspaces.map((ws: Workspace) => {
                const isActive = ws.id === activeWorkspaceId;
                const nodeCount = isActive
                  ? (allNodes?.length ?? (ws.floors || []).reduce((acc: number, f: Floor) => acc + (f?.nodes?.length || 0), 0))
                  : (ws.floors || []).reduce((acc: number, f: Floor) => acc + (f?.nodes?.length || 0), 0) || ((ws as Workspace & { nodes?: unknown[] }).nodes?.length || 0);

                return (
                  <div
                    key={ws.id}
                    onClick={() => setActiveWorkspaceId(ws.id)}
                    className={`group flex items-center justify-between h-9 px-3 text-xs cursor-pointer rounded-xl transition-all ${
                      isActive
                        ? 'bg-[#181B20]/75 text-[#E7E8EA] font-medium border border-[#23262C]/80'
                        : 'text-[#8A8F98] hover:text-[#E7E8EA] hover:bg-white/[0.04] border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 truncate flex-1 min-w-0 mr-2">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 transition-all ${
                          isActive
                            ? 'bg-[#8B93FF]'
                            : 'bg-[#23262C] group-hover:bg-[#8A8F98]/40'
                        }`}
                      />
                      <span className="truncate text-[13px] tracking-tight">{ws.name}</span>
                    </div>

                    {/* Fixed-size right container preventing any layout shift on hover */}
                    <div className="relative flex items-center justify-end w-12 h-6 shrink-0">
                      {/* Dimmed counter */}
                      <div className="flex items-center gap-1 text-[#8A8F98]/50 transition-opacity duration-150 group-hover:opacity-0 group-hover:pointer-events-none">
                        <Terminal className="w-3.5 h-3.5 opacity-60" strokeWidth={1.75} />
                        <span className="text-[11px] font-mono">{nodeCount}</span>
                      </div>

                      {/* Hover action buttons: Edit and Delete */}
                      <div className="absolute inset-y-0 right-0 flex items-center gap-0.5 opacity-0 pointer-events-none transition-opacity duration-150 group-hover:opacity-100 group-hover:pointer-events-auto">
                        <button
                          onClick={(e) => handleEditWorkspace(ws, e)}
                          className="p-1 hover:text-[#8B93FF] rounded hover:bg-[#23262C] text-[#8A8F98] transition-colors"
                          title="Editar Workspace"
                        >
                          <Edit2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                        </button>
                        {workspaces.length > 1 && (
                          <button
                            onClick={(e) => handleDeleteWorkspace(ws, e)}
                            className="p-1 hover:text-red-400 rounded hover:bg-red-500/10 text-[#8A8F98] transition-colors"
                            title="Excluir Workspace"
                          >
                            <Trash2 className="w-3.5 h-3.5" strokeWidth={1.75} />
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
            tabIndex={0}
            onClick={() => setIsCreateWorkspaceOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setIsCreateWorkspaceOpen(true);
              }
            }}
            className="flex items-center gap-2 text-xs text-[#8A8F98] hover:text-[#E7E8EA] focus:text-[#E7E8EA] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#8B93FF] rounded px-1.5 py-1 transition-colors cursor-pointer"
            title="Criar Novo Workspace"
            aria-label="Criar Novo Workspace"
          >
            <Folder className="w-4 h-4 text-[#8A8F98]" strokeWidth={1.75} />
            <span>Novo Workspace</span>
          </button>

          <button
            onClick={() => setIsSettingsOpen(true)}
            className="p-1.5 text-[#8A8F98] hover:text-[#E7E8EA] rounded-xl hover:bg-[#181B20] transition-colors cursor-pointer"
            title="Ajustes do Workspace"
          >
            <Settings className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {/* Delete Workspace Confirmation Dialog */}
      {workspaceToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm bg-[#14161A] border border-[#23262C] rounded-2xl p-5 shadow-2xl text-[#E7E8EA] space-y-3">
            <h3 className="text-sm font-semibold text-[#E7E8EA] flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-rose-400" strokeWidth={1.75} />
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
