import React, { useState } from 'react';
import { useAtom } from 'jotai';
import { isCreateWorkspaceModalOpenAtom } from '@/atoms/ui';
import { workspacesAtom, activeWorkspaceIdAtom } from '@/atoms/workspace';
import { X, FolderOpen, Plus, Folder } from 'lucide-react';
import { Workspace } from '@maestri/shared';

export const CreateWorkspaceModal: React.FC = () => {
  const [isOpen, setIsOpen] = useAtom(isCreateWorkspaceModalOpenAtom);
  const [workspaces, setWorkspaces] = useAtom(workspacesAtom);
  const [, setActiveWorkspaceId] = useAtom(activeWorkspaceIdAtom);

  const [name, setName] = useState(`Workspace ${workspaces.length + 1}`);
  const [workingDirectory, setWorkingDirectory] = useState('C:\\Users\\mabru\\Documents\\maestri');
  const [preferredIde, setPreferredIde] = useState('vscode');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handlePickDirectory = async () => {
    try {
      if (window.api?.app?.pickDirectory) {
        const picked = await window.api.app.pickDirectory();
        if (picked) {
          setWorkingDirectory(picked);
          // Suggest workspace name from folder name if default
          const folderName = picked.split(/[\\/]/).filter(Boolean).pop();
          if (folderName && name.startsWith('Workspace ')) {
            setName(folderName);
          }
        }
      }
    } catch {
      // ignore
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !workingDirectory.trim()) return;

    setIsSubmitting(true);
    const newWsId = `workspace-${Date.now()}`;
    const newWsName = name.trim();
    const newWsDir = workingDirectory.trim();

    try {
      if (window.api?.workspace?.create) {
        const created = await window.api.workspace.create({
          name: newWsName,
          workingDirectory: newWsDir,
          preferredIde,
        });
        if (created) {
          setWorkspaces((prev) => [...prev, created]);
          setActiveWorkspaceId(created.id);
          setIsOpen(false);
          setIsSubmitting(false);
          return;
        }
      }
    } catch (err) {
      console.warn('Backend workspace create failed, using local fallback:', err);
    }

    const fallbackWs: Workspace = {
      id: newWsId,
      name: newWsName,
      workingDirectory: newWsDir,
      preferredIde,
      floors: [
        {
          id: `floor-${Date.now()}`,
          name: 'Canvas',
          isGround: true,
          workingDirectory: newWsDir,
          gitBranch: 'main',
          status: null,
          nodes: [],
          cableTies: [],
          bands: [],
          drawings: [],
        },
      ],
    };

    setWorkspaces((prev) => [...prev, fallbackWs]);
    setActiveWorkspaceId(newWsId);
    setIsOpen(false);
    setIsSubmitting(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150 select-none">
      <div className="w-full max-w-md bg-[#16181e] border border-white/10 rounded-2xl shadow-2xl overflow-hidden text-zinc-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-[#1d1f27] border-b border-white/5">
          <div className="flex items-center gap-2">
            <Folder className="w-4 h-4 text-blue-400" />
            <h2 className="text-sm font-semibold text-white">Novo Espaço de Trabalho</h2>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1 text-zinc-400 hover:text-white rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleCreate} className="p-5 space-y-4 text-xs text-zinc-300">
          <div>
            <label className="block text-zinc-400 font-medium mb-1.5">Nome do Workspace</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ex.: Meu Projeto, Backend Core, etc."
              className="w-full px-3 py-2 bg-[#101115] border border-white/10 rounded-xl text-white outline-none focus:border-blue-500"
              required
            />
          </div>

          <div>
            <label className="block text-zinc-400 font-medium mb-1.5">Pasta do Workspace (Diretório)</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={workingDirectory}
                onChange={(e) => setWorkingDirectory(e.target.value)}
                placeholder="ex.: C:\Users\usuario\Projetos\app"
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
            <span className="block mt-1 text-[11px] text-zinc-500">
              Esta pasta será usada como diretório de trabalho padrão para todos os terminais e agentes deste workspace.
            </span>
          </div>

          <div>
            <label className="block text-zinc-400 font-medium mb-1.5">IDE Preferida</label>
            <select
              value={preferredIde}
              onChange={(e) => setPreferredIde(e.target.value)}
              className="w-full px-3 py-2 bg-[#101115] border border-white/10 rounded-xl text-white outline-none focus:border-blue-500 cursor-pointer"
            >
              <option value="vscode">Visual Studio Code</option>
              <option value="cursor">Cursor</option>
              <option value="windsurf">Windsurf</option>
              <option value="intellij">IntelliJ IDEA</option>
              <option value="none">Apenas Terminal</option>
            </select>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-white/5">
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="px-3.5 py-1.5 rounded-xl text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold rounded-xl shadow-md flex items-center gap-1.5 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{isSubmitting ? 'Criando...' : 'Criar Workspace'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
