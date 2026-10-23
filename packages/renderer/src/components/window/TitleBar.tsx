import React from 'react';
import { useAtom } from 'jotai';
import { activeWorkspaceAtom } from '@/atoms/workspace';
import { WindowControls } from './WindowControls';
import { Layers } from 'lucide-react';

export const TitleBar: React.FC = () => {
  const [activeWorkspace] = useAtom(activeWorkspaceAtom);

  return (
    <header
      className="w-full h-8 bg-[#0d0e12] border-b border-white/5 flex items-center justify-between px-3 select-none shrink-0 relative z-50"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Left: Maestri Logo & Active Workspace Tab */}
      <div
        className="flex items-center gap-2"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <div className="w-4 h-4 rounded bg-blue-600/30 border border-blue-500/40 flex items-center justify-center text-blue-400 font-bold text-[10px]">
          M
        </div>

        {/* Workspace Tab Indicator */}
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-white/[0.04] border border-white/10 text-xs text-zinc-300 shadow-sm">
          <Layers className="w-3 h-3 text-blue-400" />
          <span className="font-medium text-[11px] truncate max-w-[200px]">
            {activeWorkspace?.name || 'Maestri'}
          </span>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80 ml-0.5" />
        </div>
      </div>

      {/* Center Draggable Spacer / App Title */}
      <div className="flex-1 h-full flex items-center justify-center text-[11px] text-zinc-500 font-medium tracking-wide">
        Maestri Canvas
      </div>

      {/* Right: Window Controls */}
      <div
        className="flex items-center"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <WindowControls />
      </div>
    </header>
  );
};
