import React, { useState, useEffect } from 'react';
import { useAtom } from 'jotai';
import { isWorkspaceSettingsModalOpenAtom } from '@/atoms/ui';
import { activeWorkspaceAtom, workspacesAtom, activeWorkspaceIdAtom } from '@/atoms/workspace';
import { X, FolderOpen, Save, Trash2, AlertTriangle } from 'lucide-react';
import { Workspace } from '@maestri/shared';

interface FormProps {
  workspace: Workspace;
  onClose: () => void;
  onSave: (name: string, workingDirectory: string, preferredIde: string) => void;
  onDelete: (id: string) => void;
  canDelete: boolean;
}

const SettingsForm: React.FC<FormProps> = ({ workspace, onClose, onSave, onDelete, canDelete }) => {
  const [name, setName] = useState(workspace.name);
  const [workingDirectory, setWorkingDirectory] = useState(workspace.workingDirectory);
  const [preferredIde, setPreferredIde] = useState(workspace.preferredIde || 'vscode');
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);

  useEffect(() => {
    setName(workspace.name);
    setWorkingDirectory(workspace.workingDirectory);
    setPreferredIde(workspace.preferredIde || 'vscode');
  }, [workspace]);

  const handlePickDirectory = async () => {
    try {
      if (window.api?.app?.pickDirectory) {
        const picked = await window.api.app.pickDirectory();
        if (picked) setWorkingDirectory(picked);
      }
    } catch {
      // ignore
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(name, workingDirectory, preferredIde);
  };

  return (
    <div className="w-full max-w-md bg-[#16181e] border border-white/10 rounded-2xl shadow-2xl overflow-hidden select-none text-zinc-200">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 bg-[#1d1f27] border-b border-white/5">
        <h2 className="text-sm font-semibold text-white">Configurações do Workspace</h2>
        <button
          onClick={onClose}
          className="p-1 text-zinc-400 hover:text-white rounded"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Form Body */}
      <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs text-zinc-300">
        <div>
          <label className="block text-zinc-400 font-medium mb-1.5">Nome do Workspace</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 bg-[#101115] border border-white/10 rounded-xl text-white outline-none focus:border-blue-500"
            required
          />
        </div>

        <div>
          <label className="block text-zinc-400 font-medium mb-1.5">Pasta do Workspace (Diretório Raiz)</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={workingDirectory}
              onChange={(e) => setWorkingDirectory(e.target.value)}
              className="flex-1 px-3 py-2 bg-[#101115] border border-white/10 rounded-xl text-white font-mono text-[11px] outline-none focus:border-blue-500"
              required
            />
            <button
              type="button"
              onClick={handlePickDirectory}
              className="px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-zinc-300 flex items-center gap-1.5 shrink-0 transition-colors"
              title="Procurar Pasta"
            >
              <FolderOpen className="w-3.5 h-3.5 text-blue-400" />
              <span>Procurar...</span>
            </button>
          </div>
        </div>

        <div>
          <label className="block text-zinc-400 font-medium mb-1.5">IDE Preferida</label>
          <select
            value={preferredIde}
            onChange={(e) => setPreferredIde(e.target.value)}
            className="w-full px-3 py-2 bg-[#101115] border border-white/10 rounded-xl text-white outline-none focus:border-blue-500 cursor-pointer"
          >
            <option value="vscode">VS Code</option>
            <option value="cursor">Cursor</option>
            <option value="windsurf">Windsurf</option>
            <option value="intellij">IntelliJ IDEA</option>
            <option value="none">Apenas Terminal</option>
          </select>
        </div>

        {/* Delete Confirmation or Actions */}
        {showConfirmDelete ? (
          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl space-y-2">
            <div className="flex items-center gap-2 text-red-400 font-medium">
              <AlertTriangle className="w-4 h-4" />
              <span>Excluir este workspace?</span>
            </div>
            <p className="text-[11px] text-zinc-400">
              O workspace "{workspace.name}" e seus nós no canvas serão removidos. Os arquivos no disco NÃO serão apagados.
            </p>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowConfirmDelete(false)}
                className="px-3 py-1 rounded-lg text-zinc-400 hover:text-white hover:bg-white/5"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => onDelete(workspace.id)}
                className="px-3 py-1 rounded-lg bg-red-600 hover:bg-red-500 text-white font-medium shadow"
              >
                Sim, Excluir
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between pt-3 border-t border-white/5">
            {canDelete ? (
              <button
                type="button"
                onClick={() => setShowConfirmDelete(true)}
                className="px-3 py-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-xl flex items-center gap-1.5 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Excluir Workspace</span>
              </button>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-1.5 rounded-xl text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl shadow-md flex items-center gap-1.5 transition-colors"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Salvar Alterações</span>
              </button>
            </div>
          </div>
        )}
      </form>
    </div>
  );
};

export const WorkspaceSettingsModal: React.FC = () => {
  const [isOpen, setIsOpen] = useAtom(isWorkspaceSettingsModalOpenAtom);
  const [activeWorkspace] = useAtom(activeWorkspaceAtom);
  const [workspaces, setWorkspaces] = useAtom(workspacesAtom);
  const [, setActiveWorkspaceId] = useAtom(activeWorkspaceIdAtom);

  if (!isOpen || !activeWorkspace) return null;

  const handleDelete = (id: string) => {
    // Delete in backend
    if (window.api?.workspace?.delete) {
      window.api.workspace.delete(id).catch(() => {});
    }

    const remaining = workspaces.filter((w) => w.id !== id);
    setWorkspaces(remaining);
    if (remaining.length > 0) {
      setActiveWorkspaceId(remaining[0].id);
    }
    setIsOpen(false);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
      <SettingsForm
        workspace={activeWorkspace}
        canDelete={workspaces.length > 1}
        onClose={() => setIsOpen(false)}
        onDelete={handleDelete}
        onSave={(name, workingDirectory, preferredIde) => {
          const updated = {
            ...activeWorkspace,
            name,
            workingDirectory,
            preferredIde: preferredIde as any,
          };

          // Save in backend
          if (window.api?.workspace?.patch) {
            window.api.workspace.patch(activeWorkspace.id, updated).catch(() => {});
          }

          setWorkspaces((prev) =>
            prev.map((w) => (w.id === activeWorkspace.id ? updated : w))
          );
          setIsOpen(false);
        }}
      />
    </div>
  );
};
