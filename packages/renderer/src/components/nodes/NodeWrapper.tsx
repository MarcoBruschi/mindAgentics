import React from 'react';
import { useAtom } from 'jotai';
import { CanvasNode } from '@maestri/shared';
import {
  selectedNodeIdsAtom,
  canvasModeAtom,
  connectingFromNodeIdAtom,
} from '@/atoms/canvas';
import { cableTiesAtom } from '@/atoms/workspace';

interface NodeWrapperProps {
  node: CanvasNode;
  children: React.ReactNode;
  onUpdate: (updated: CanvasNode) => void;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, width: number, height: number) => void;
  onBringToFront: (id: string) => void;
  zoom: number;
}

export const NodeWrapper: React.FC<NodeWrapperProps> = ({
  node,
  children,
  onUpdate,
  onMove,
  onResize,
  onBringToFront,
  zoom,
}) => {
  const nodeRef = React.useRef(node);
  nodeRef.current = node;

  const [selectedIds, setSelectedIds] = useAtom(selectedNodeIdsAtom);
  const [canvasMode, setCanvasMode] = useAtom(canvasModeAtom);
  const [connectingFromId, setConnectingFromId] = useAtom(connectingFromNodeIdAtom);
  const [, setCableTies] = useAtom(cableTiesAtom);

  const isSelected = selectedIds.includes(node.id);

  const handlePointerDown = (e: React.PointerEvent) => {
    // Only handle left click
    if (e.button !== 0) return;

    if (canvasMode === 'connect') {
      e.stopPropagation();
      if (!connectingFromId) {
        setConnectingFromId(node.id);
      } else if (connectingFromId !== node.id) {
        // Create Cable Tie between connectingFromId and node.id
        setCableTies((prev) => [
          ...prev,
          {
            id: `tie-${Date.now()}`,
            fromNodeId: connectingFromId,
            toNodeId: node.id,
            label: 'Connected',
          },
        ]);
        setConnectingFromId(null);
        setCanvasMode('select');
      }
      return;
    }

    if (canvasMode !== 'select') return;

    onBringToFront(node.id);

    if (e.shiftKey) {
      setSelectedIds((prev) =>
        prev.includes(node.id) ? prev.filter((id) => id !== node.id) : [...prev, node.id]
      );
    } else {
      if (!selectedIds.includes(node.id)) {
        setSelectedIds([node.id]);
      }
    }
  };

  const handleHeaderPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || canvasMode !== 'select') return;
    e.stopPropagation();
    onBringToFront(node.id);

    const startX = e.clientX;
    const startY = e.clientY;
    const initialNodeX = nodeRef.current.x;
    const initialNodeY = nodeRef.current.y;

    const handlePointerMove = (moveEvt: PointerEvent) => {
      const dx = (moveEvt.clientX - startX) / zoom;
      const dy = (moveEvt.clientY - startY) / zoom;
      onMove(node.id, Math.round(initialNodeX + dx), Math.round(initialNodeY + dy));
    };

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const handleResizePointerDown = (
    e: React.PointerEvent,
    axis: 'both' | 'horizontal' | 'vertical' = 'both'
  ) => {
    if (e.button !== 0) return;
    e.stopPropagation();

    const targetEl = e.currentTarget as HTMLElement;
    try {
      targetEl.setPointerCapture?.(e.pointerId);
    } catch {}

    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = nodeRef.current.width;
    const startHeight = nodeRef.current.height;

    const handleResizeMove = (moveEvt: PointerEvent) => {
      const dx = (moveEvt.clientX - startX) / zoom;
      const dy = (moveEvt.clientY - startY) / zoom;

      const newWidth =
        axis === 'vertical'
          ? startWidth
          : Math.max(280, Math.round(startWidth + dx));
      const newHeight =
        axis === 'horizontal'
          ? startHeight
          : Math.max(180, Math.round(startHeight + dy));

      onResize(node.id, newWidth, newHeight);
    };

    const handleResizeUp = (upEvt: PointerEvent) => {
      try {
        targetEl.releasePointerCapture?.(upEvt.pointerId);
      } catch {}
      window.removeEventListener('pointermove', handleResizeMove);
      window.removeEventListener('pointerup', handleResizeUp);
    };

    window.addEventListener('pointermove', handleResizeMove);
    window.addEventListener('pointerup', handleResizeUp);
  };

  const isConnectingOrigin = connectingFromId === node.id;

  return (
    <div
      onPointerDown={handlePointerDown}
      className={`absolute flex flex-col rounded-xl overflow-hidden transition-[box-shadow,border-color] duration-150 group/node ${
        isSelected
          ? 'ring-2 ring-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.25)]'
          : 'ring-1 ring-white/10 hover:ring-white/20 shadow-2xl'
      } ${
        isConnectingOrigin ? 'ring-2 ring-emerald-400 animate-pulse' : ''
      }`}
      style={{
        left: `${node.x}px`,
        top: `${node.y}px`,
        width: `${node.width}px`,
        height: `${node.height}px`,
        zIndex: node.zIndex,
      }}
    >
      {/* Passing header drag handler to children via header container */}
      <div
        className="flex flex-col w-full h-full relative"
        onPointerDown={(e) => {
          const target = e.target as HTMLElement;
          if (target.closest('.node-drag-handle')) {
            handleHeaderPointerDown(e);
          }
        }}
      >
        {children}
      </div>

      {/* Right Edge Resize Handle */}
      <div
        onPointerDown={(e) => handleResizePointerDown(e, 'horizontal')}
        className="absolute top-8 right-0 bottom-6 w-2 cursor-ew-resize hover:bg-blue-500/20 active:bg-blue-500/40 transition-colors z-20"
        title="Resize Width"
      />

      {/* Bottom Edge Resize Handle */}
      <div
        onPointerDown={(e) => handleResizePointerDown(e, 'vertical')}
        className="absolute bottom-0 left-4 right-6 h-2 cursor-ns-resize hover:bg-blue-500/20 active:bg-blue-500/40 transition-colors z-20"
        title="Resize Height"
      />

      {/* Bottom-Right Corner Resize Grip Handle */}
      <div
        onPointerDown={(e) => handleResizePointerDown(e, 'both')}
        className="absolute bottom-0 right-0 w-6 h-6 cursor-nwse-resize z-30 flex items-center justify-center group/resize"
        title="Resize (Width & Height)"
      >
        <div className="w-3.5 h-3.5 border-r-2 border-b-2 border-zinc-500/80 group-hover/resize:border-blue-400 group-hover/node:border-zinc-400 transition-colors" />
      </div>
    </div>
  );
};
