import React, { useState } from 'react';
import { useAtom } from 'jotai';
import { isCreateFloorModalOpenAtom } from '@/atoms/ui';
import {
  activeWorkspaceAtom,
  workspacesAtom,
  activeFloorIdAtom,
} from '@/atoms/workspace';
import { Floor } from '@mindagentics/shared';
import {
  X,
  GitBranch,
  Copy,
  FolderPlus,
  GitPullRequest,
  Check,
} from 'lucide-react';

export const CreateFloorModal: React.FC = () => {
  const [isOpen, setIsOpen] = useAtom(isCreateFloorModalOpenAtom);
  const [activeWorkspace] = useAtom(activeWorkspaceAtom);
  const [, setWorkspaces] = useAtom(workspacesAtom);
  const [, setActiveFloorId] = useAtom(activeFloorIdAtom);

  if (!isOpen || !activeWorkspace) return null;

  const [floorName, setFloorName] = useState('');
  const [isolationMode, setIsolationMode] = useState<'worktree' | 'copy' | 'directory' | 'pr'>('worktree');
  const [branchName, setBranchName] = useState('feature/');
  const [prUrl, setPrUrl] = useState('');

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!floorName.trim()) return;

    const floorId = `floor-${Date.now()}`;
    const newFloor: Floor = {
      id: floorId,
      name: floorName.trim(),
      isGround: false,
      workingDirectory: `${activeWorkspace.workingDirectory}\\.mindagentics\\floors\\${floorName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
      gitBranch: isolationMode === 'worktree' ? branchName : null,
      status: { text: 'Working on Floor', state: 'working', progress: null },
      nodes: [
        {
          id: `node-term-${Date.now()}`,
          kind: 'terminal',
          x: 100,
          y: 100,
          width: 680,
          height: 440,
          zIndex: 10,
          content: {
            terminalId: `term-${Date.now()}`,
            presetId: 'C1A0DE00-0000-4000-8000-000000000001',
            title: `${floorName} Shell`,
            agentRole: 'Floor Agent',
            isLocked: false,
            status: 'idle',
            hasAttention: false,
          },
        },
      ],
      cableTies: [],
      bands: [],
      drawings: [],
    };

    setWorkspaces((prev) =>
      prev.map((w) =>
        w.id === activeWorkspace.id
          ? {
              ...w,
              floors: [...w.floors, newFloor],
            }
          : w
      )
    );

    setActiveFloorId(floorId);
    setIsOpen(false);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-[#16181e] border border-white/10 rounded-2xl shadow-2xl overflow-hidden select-none">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-[#1d1f27] border-b border-white/5">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-blue-400" />
            <h2 className="text-sm font-semibold text-white">Create New Floor</h2>
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
            <label className="block text-zinc-400 font-medium mb-1.5">Floor Name</label>
            <input
              type="text"
              value={floorName}
              onChange={(e) => setFloorName(e.target.value)}
              placeholder="e.g. Auth Rewrite or Perf Investigation"
              className="w-full px-3 py-2 bg-[#101115] border border-white/10 rounded-lg text-white outline-none focus:border-blue-500"
              required
            />
          </div>

          <div>
            <label className="block text-zinc-400 font-medium mb-2">Isolation Strategy</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setIsolationMode('worktree')}
                className={`flex flex-col text-left p-3 rounded-xl border transition-all ${
                  isolationMode === 'worktree'
                    ? 'bg-blue-600/15 border-blue-500/50 text-white'
                    : 'bg-[#101115] border-white/5 text-zinc-400 hover:border-white/15'
                }`}
              >
                <div className="flex items-center gap-2 font-medium mb-1">
                  <GitBranch className="w-3.5 h-3.5 text-blue-400" />
                  <span>Git Worktree</span>
                </div>
                <span className="text-[11px] text-zinc-500 leading-tight">
                  Independent worktree branch synced with repo.
                </span>
              </button>

              <button
                type="button"
                onClick={() => setIsolationMode('copy')}
                className={`flex flex-col text-left p-3 rounded-xl border transition-all ${
                  isolationMode === 'copy'
                    ? 'bg-blue-600/15 border-blue-500/50 text-white'
                    : 'bg-[#101115] border-white/5 text-zinc-400 hover:border-white/15'
                }`}
              >
                <div className="flex items-center gap-2 font-medium mb-1">
                  <Copy className="w-3.5 h-3.5 text-purple-400" />
                  <span>Full Copy</span>
                </div>
                <span className="text-[11px] text-zinc-500 leading-tight">
                  Independent snapshot copy of directory.
                </span>
              </button>

              <button
                type="button"
                onClick={() => setIsolationMode('directory')}
                className={`flex flex-col text-left p-3 rounded-xl border transition-all ${
                  isolationMode === 'directory'
                    ? 'bg-blue-600/15 border-blue-500/50 text-white'
                    : 'bg-[#101115] border-white/5 text-zinc-400 hover:border-white/15'
                }`}
              >
                <div className="flex items-center gap-2 font-medium mb-1">
                  <FolderPlus className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Plain Directory</span>
                </div>
                <span className="text-[11px] text-zinc-500 leading-tight">
                  Clean empty floor workspace directory.
                </span>
              </button>

              <button
                type="button"
                onClick={() => setIsolationMode('pr')}
                className={`flex flex-col text-left p-3 rounded-xl border transition-all ${
                  isolationMode === 'pr'
                    ? 'bg-blue-600/15 border-blue-500/50 text-white'
                    : 'bg-[#101115] border-white/5 text-zinc-400 hover:border-white/15'
                }`}
              >
                <div className="flex items-center gap-2 font-medium mb-1">
                  <GitPullRequest className="w-3.5 h-3.5 text-amber-400" />
                  <span>PR Review Floor</span>
                </div>
                <span className="text-[11px] text-zinc-500 leading-tight">
                  Clones remote PR branch for code review.
                </span>
              </button>
            </div>
          </div>

          {isolationMode === 'worktree' && (
            <div>
              <label className="block text-zinc-400 font-medium mb-1.5">New Git Branch</label>
              <input
                type="text"
                value={branchName}
                onChange={(e) => setBranchName(e.target.value)}
                className="w-full px-3 py-2 bg-[#101115] border border-white/10 rounded-lg text-white font-mono text-xs outline-none focus:border-blue-500"
                required
              />
            </div>
          )}

          {isolationMode === 'pr' && (
            <div>
              <label className="block text-zinc-400 font-medium mb-1.5">Pull Request URL or Number</label>
              <input
                type="text"
                value={prUrl}
                onChange={(e) => setPrUrl(e.target.value)}
                placeholder="https://github.com/org/repo/pull/42"
                className="w-full px-3 py-2 bg-[#101115] border border-white/10 rounded-lg text-white text-xs outline-none focus:border-blue-500"
                required
              />
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/5">
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="px-3 py-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg shadow-md flex items-center gap-1.5"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Launch Floor</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
