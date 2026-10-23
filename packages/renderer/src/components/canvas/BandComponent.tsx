import React, { useState, useRef } from 'react';
import { Band, CanvasNode } from '@maestri/shared';
import { Trash2, GripHorizontal, Ungroup } from 'lucide-react';

interface BandProps {
  band: Band;
  nodes: CanvasNode[];
  onUpdateBand: (updated: Band) => void;
  onDeleteBand: (bandId: string) => void;
  onDissolveBand?: (bandId: string) => void;
  onMoveNodes: (nodeIds: string[], dx: number, dy: number) => void;
  zoom: number;
}

export const BandComponent: React.FC<BandProps> = ({
  band,
  nodes,
  onUpdateBand,
  onDeleteBand,
  onDissolveBand,
  onMoveNodes,
  zoom,
}) => {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [title, setTitle] = useState(band.title);
  const dragRef = useRef<{ startX: number; startY: number } | null>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    dragRef.current = { startX: e.clientX, startY: e.clientY };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (!dragRef.current) return;
      const dx = (moveEvent.clientX - dragRef.current.startX) / zoom;
      const dy = (moveEvent.clientY - dragRef.current.startY) / zoom;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;

      dragRef.current = { startX: moveEvent.clientX, startY: moveEvent.clientY };

      // Update band position
      onUpdateBand({
        ...band,
        bounds: {
          ...band.bounds,
          x: Math.round(band.bounds.x + dx),
          y: Math.round(band.bounds.y + dy),
        },
      });

      // Move member nodes synchronously
      if (band.memberNodeIds.length > 0) {
        onMoveNodes(band.memberNodeIds, dx, dy);
      }
    };

    const handlePointerUp = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  return (
    <div
      className="absolute rounded-2xl border border-blue-500/30 transition-shadow select-none group"
      style={{
        left: `${band.bounds.x}px`,
        top: `${band.bounds.y}px`,
        width: `${band.bounds.width}px`,
        height: `${band.bounds.height}px`,
        backgroundColor: band.color || 'rgba(59, 130, 246, 0.08)',
        zIndex: 2,
      }}
    >
      {/* Header bar / drag handle */}
      <div
        onPointerDown={handlePointerDown}
        className="flex items-center justify-between px-3 py-1.5 bg-[#181a1f]/90 rounded-t-2xl border-b border-blue-500/20 cursor-move"
      >
        <div className="flex items-center gap-2">
          <GripHorizontal className="w-3.5 h-3.5 text-blue-400/60" />
          {isEditingTitle ? (
            <input
              type="text"
              value={title}
              autoFocus
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => {
                setIsEditingTitle(false);
                onUpdateBand({ ...band, title });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setIsEditingTitle(false);
                  onUpdateBand({ ...band, title });
                }
              }}
              className="bg-black/40 text-blue-300 font-semibold text-xs px-1.5 py-0.5 rounded outline-none border border-blue-500/40"
            />
          ) : (
            <span
              onDoubleClick={() => setIsEditingTitle(true)}
              className="text-xs font-semibold text-blue-300 hover:text-blue-200 cursor-text select-none"
            >
              {band.title}
            </span>
          )}
          <span className="text-[10px] text-zinc-500">
            ({band.memberNodeIds.length} nós)
          </span>
        </div>

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {onDissolveBand && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDissolveBand(band.id);
              }}
              className="p-1 text-zinc-400 hover:text-amber-400 hover:bg-amber-500/10 rounded transition-colors"
              title="Dissolver Band (manter terminais lado a lado)"
            >
              <Ungroup className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            onClick={(e) => {
              e.stopPropagation();
              onDeleteBand(band.id);
            }}
            className="p-1 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
            title="Excluir Band"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
