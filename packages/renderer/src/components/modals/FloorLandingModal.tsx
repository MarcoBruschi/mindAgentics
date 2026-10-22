import React, { useState } from 'react';
import { useAtom } from 'jotai';
import { isFloorLandingModalOpenAtom } from '@/atoms/ui';
import {
  activeFloorAtom,
  activeWorkspaceAtom,
  workspacesAtom,
  activeFloorIdAtom,
} from '@/atoms/workspace';
import { Floor } from '@maestri/shared';
import {
  X,
  GitMerge,
  GitBranch,
  Trash2,
  Check,
  AlertTriangle,
} from 'lucide-react';

export const FloorLandingModal: React.FC = () => {
  const [isOpen, setIsOpen] = useAtom(isFloorLandingModalOpenAtom);
  const [activeFloor] = useAtom(activeFloorAtom);
  const [activeWorkspace] = useAtom(activeWorkspaceAtom);
  const [, setWorkspaces] = useAtom(workspacesAtom);
  const [, setActiveFloorId] = useAtom(activeFloorIdAtom);

  if (!isOpen || !activeFloor || activeFloor.isGround || !activeWorkspace) return null;

  const [targetBranch, setTargetBranch] = useState('main');
  const [deleteBranch, setDeleteBranch] = useState(true);
  const [keepFloor, setKeepFloor] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [mergeSuccess, setMergeSuccess] = useState(false);

  const handleLand = (e: React.FormEvent) => {
    e.preventDefault();
    setIsMerging(true);

    setTimeout(() => {
      setIsMerging(false);
      setMergeSuccess(true);

      setTimeout(() => {
        // If not keep floor, remove floor and switch to ground
        if (!keepFloor) {
          setWorkspaces((prev) =>
            prev.map((w) =>
              w.id === activeWorkspace.id
                ? {
                    ...w,
                    floors: w.floors.filter((f: Floor) => f.id !== activeFloor.id),
                  }
                : w
            )
          );
          setActiveFloorId('floor-ground');
        } else {
          // Mark floor status as done
          setWorkspaces((prev) =>
            prev.map((w) =>
              w.id === activeWorkspace.id
                ? {
                    ...w,
                    floors: w.floors.map((f: Floor) =>
                      f.id === activeFloor.id
                        ? { ...f, status: { text: 'Merged', state: 'done', progress: '100%' } }
                        : f
                    ),
                  }
                : w
            )
          );
        }
        setIsOpen(false);
        setMergeSuccess(false);
      }, 1000);
    }, 1200);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#16181e] border border-white/10 rounded-2xl shadow-2xl overflow-hidden select-none">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-[#1d1f27] border-b border-white/5">
          <div className="flex items-center gap-2">
            <GitMerge className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-white">Land Floor Worktree</h2>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1 text-zinc-400 hover:text-white rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleLand} className="p-5 space-y-4 text-xs text-zinc-300">
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-start gap-3">
            <GitBranch className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-emerald-300">
                Ready to merge into ground branch
              </div>
              <div className="text-[11px] text-zinc-400 mt-0.5 leading-relaxed">
                Floor branch <code className="text-white font-mono">{activeFloor.gitBranch || 'worktree'}</code> will be fast-forward merged into <code className="text-white font-mono">{targetBranch}</code>.
              </div>
            </div>
          </div>

          <div>
            <label className="block text-zinc-400 font-medium mb-1.5">Target Ground Branch</label>
            <input
              type="text"
              value={targetBranch}
              onChange={(e) => setTargetBranch(e.target.value)}
              className="w-full px-3 py-2 bg-[#101115] border border-white/10 rounded-lg text-white font-mono text-xs outline-none focus:border-blue-500"
              required
            />
          </div>

          <div className="space-y-2 pt-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={deleteBranch}
                onChange={(e) => setDeleteBranch(e.target.checked)}
                className="rounded border-white/20 text-blue-600 focus:ring-0 bg-transparent"
              />
              <span className="text-zinc-300">Prune git branch after merge (--delete-branch)</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={keepFloor}
                onChange={(e) => setKeepFloor(e.target.checked)}
                className="rounded border-white/20 text-blue-600 focus:ring-0 bg-transparent"
              />
              <span className="text-zinc-300">Keep floor tab after landing (--keep-floor)</span>
            </label>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-white/5">
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="px-3 py-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isMerging || mergeSuccess}
              className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg shadow-md flex items-center gap-1.5 disabled:opacity-50"
            >
              {isMerging ? (
                <span>Merging worktree...</span>
              ) : mergeSuccess ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Merged!</span>
                </>
              ) : (
                <>
                  <GitMerge className="w-3.5 h-3.5" />
                  <span>Land Floor</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
