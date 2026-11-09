import React from 'react';
import { useAtom } from 'jotai';
import { CanvasNode } from '@mindagentics/shared';
import {
  selectedNodeIdsAtom,
  canvasModeAtom,
  connectingFromNodeIdAtom,
} from '@/atoms/canvas';
import {
  cableTiesAtom,
  beginUndoGroupAtom,
  endUndoGroupAtom,
} from '@/atoms/workspace';
import { snapToGrid } from '@/utils/layout';

interface NodeWrapperProps {
  node: CanvasNode;
  children: React.ReactNode;
  onUpdate: (updated: CanvasNode) => void;
  onMove: (id: string, x: number, y: number) => void;
  onMoveMultiple?: (nodeIds: string[], dx: number, dy: number) => void;
  onResize: (id: string, width: number, height: number) => void;
  onBringToFront: (id: string) => void;
  zoom: number;
}

const NodeWrapperComponent: React.FC<NodeWrapperProps> = ({
  node,
  children,
  onUpdate,
  onMove,
  onMoveMultiple,
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
  const [, beginUndoGroup] = useAtom(beginUndoGroupAtom);
  const [, endUndoGroup] = useAtom(endUndoGroupAtom);

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

  const [isDragging, setIsDragging] = React.useState(false);

  const handleHeaderPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || canvasMode !== 'select') return;
    e.stopPropagation();
    onBringToFront(node.id);

    // Open transaction group for the drag operation
    beginUndoGroup();
    setIsDragging(true);
    document.body.classList.add('is-dragging-node');

    const startX = e.clientX;
    const startY = e.clientY;
    const initialNodeX = nodeRef.current.x;
    const initialNodeY = nodeRef.current.y;
    let lastDx = 0;
    let lastDy = 0;

    const isMultiDrag = selectedIds.includes(node.id) && selectedIds.length > 1;

    let rafId: number | null = null;
    let latestTargetX = initialNodeX;
    let latestTargetY = initialNodeY;
    let latestCurDx = 0;
    let latestCurDy = 0;
    let hasMoved = false;

    const flushMove = () => {
      rafId = null;
      if (!hasMoved) return;
      if (isMultiDrag && onMoveMultiple) {
        const deltaX = latestCurDx - lastDx;
        const deltaY = latestCurDy - lastDy;
        lastDx = latestCurDx;
        lastDy = latestCurDy;
        onMoveMultiple(selectedIds, deltaX, deltaY);
      } else {
        onMove(node.id, latestTargetX, latestTargetY);
      }
    };

    const handlePointerMove = (moveEvt: PointerEvent) => {
      const rawDx = (moveEvt.clientX - startX) / zoom;
      const rawDy = (moveEvt.clientY - startY) / zoom;

      // Magnetic snap modifier (Ctrl or Cmd held) or smooth snap
      const shouldSnap = moveEvt.ctrlKey || moveEvt.metaKey || moveEvt.altKey;
      latestTargetX = shouldSnap ? snapToGrid(initialNodeX + rawDx) : Math.round(initialNodeX + rawDx);
      latestTargetY = shouldSnap ? snapToGrid(initialNodeY + rawDy) : Math.round(initialNodeY + rawDy);

      latestCurDx = latestTargetX - initialNodeX;
      latestCurDy = latestTargetY - initialNodeY;
      hasMoved = true;

      if (rafId === null) {
        rafId = requestAnimationFrame(flushMove);
      }
    };

    const handlePointerUp = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      flushMove();
      setIsDragging(false);
      document.body.classList.remove('is-dragging-node');
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      // Close transaction group
      endUndoGroup();
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerup', handlePointerUp, { once: true });
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

    beginUndoGroup();
    setIsDragging(true);
    document.body.classList.add('is-dragging-node');

    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = nodeRef.current.width;
    const startHeight = nodeRef.current.height;

    let rafId: number | null = null;
    let latestWidth = startWidth;
    let latestHeight = startHeight;
    let hasResized = false;

    const flushResize = () => {
      rafId = null;
      if (!hasResized) return;
      onResize(node.id, latestWidth, latestHeight);
    };

    const handleResizeMove = (moveEvt: PointerEvent) => {
      const dx = (moveEvt.clientX - startX) / zoom;
      const dy = (moveEvt.clientY - startY) / zoom;

      const shouldSnap = moveEvt.ctrlKey || moveEvt.metaKey;
      const rawW = Math.max(260, startWidth + dx);
      const rawH = Math.max(160, startHeight + dy);

      latestWidth =
        axis === 'vertical'
          ? startWidth
          : shouldSnap
          ? snapToGrid(rawW)
          : Math.round(rawW);
      latestHeight =
        axis === 'horizontal'
          ? startHeight
          : shouldSnap
          ? snapToGrid(rawH)
          : Math.round(rawH);
      hasResized = true;

      if (rafId === null) {
        rafId = requestAnimationFrame(flushResize);
      }
    };

    const handleResizeUp = (upEvt: PointerEvent) => {
      try {
        targetEl.releasePointerCapture?.(upEvt.pointerId);
      } catch {}
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      flushResize();
      setIsDragging(false);
      document.body.classList.remove('is-dragging-node');
      window.removeEventListener('pointermove', handleResizeMove);
      window.removeEventListener('pointerup', handleResizeUp);
      endUndoGroup();
    };

    window.addEventListener('pointermove', handleResizeMove, { passive: true });
    window.addEventListener('pointerup', handleResizeUp, { once: true });
  };

  const isConnectingOrigin = connectingFromId === node.id;
  const isTextBlock = node.kind === 'textBlock';
  const isOrchestratorNode = node.kind === 'terminal' && Boolean((node.content as any)?.orchestratorMode ?? (node.content as any)?.maestroMode);

  return (
    <div
      onPointerDown={handlePointerDown}
      className={`absolute flex flex-col ${
        isTextBlock
          ? isSelected
            ? 'ring-1 ring-blue-500/80 rounded-lg'
            : 'hover:ring-1 hover:ring-white/20 rounded-lg'
          : `rounded-xl overflow-hidden transition-[box-shadow,border-color] duration-150 group/node ${
              isSelected
                ? isOrchestratorNode
                  ? 'ring-2 ring-amber-400/80 shadow-xl'
                  : 'ring-2 ring-blue-500 shadow-xl'
                : isOrchestratorNode
                ? 'ring-1 ring-amber-500/30 hover:ring-amber-500/50 shadow-xl'
                : 'ring-1 ring-white/10 hover:ring-white/20 shadow-2xl'
            } ${
              isConnectingOrigin ? 'ring-2 ring-emerald-400 animate-pulse' : ''
            }`
      } ${
        isDragging
          ? isTextBlock
            ? 'opacity-90 cursor-grabbing'
            : 'shadow-[0_20px_50px_rgba(0,0,0,0.55)] cursor-grabbing ring-blue-400/60'
          : ''
      }`}
      style={{
        left: 0,
        top: 0,
        transform: isTextBlock
          ? `translate(${Math.round(node.x)}px, ${Math.round(node.y)}px)`
          : `translate3d(${node.x}px, ${node.y}px, 0)`,
        width: isTextBlock ? 'max-content' : `${node.width}px`,
        height: isTextBlock ? 'auto' : `${node.height}px`,
        minWidth: isTextBlock ? '180px' : undefined,
        whiteSpace: isTextBlock ? 'nowrap' : undefined,
        writingMode: isTextBlock ? 'horizontal-tb' : undefined,
        zIndex: isDragging ? 9999 : node.zIndex,
        willChange: isTextBlock ? (isDragging ? 'transform' : 'auto') : 'transform',
      }}
    >
      {/* Passing header drag handler to children via header container */}
      <div
        className="flex flex-col w-full h-full relative"
        style={{
          writingMode: isTextBlock ? 'horizontal-tb' : undefined,
          whiteSpace: isTextBlock ? 'nowrap' : undefined,
          minWidth: isTextBlock ? '180px' : undefined,
          width: isTextBlock ? 'max-content' : undefined,
        }}
        onPointerDown={(e) => {
          const target = e.target as HTMLElement;
          if (target.closest('.node-drag-handle')) {
            handleHeaderPointerDown(e);
          }
        }}
      >
        {children}
      </div>

      {/* Resize handles only for non-textBlock nodes */}
      {!isTextBlock && (
        <>
          {/* Right Edge Resize Handle */}
          <div
            onPointerDown={(e) => handleResizePointerDown(e, 'horizontal')}
            className="absolute top-8 right-0 bottom-6 w-2 cursor-ew-resize hover:bg-blue-500/20 active:bg-blue-500/40 transition-colors z-20"
            title="Redimensionar Largura"
          />

          {/* Bottom Edge Resize Handle */}
          <div
            onPointerDown={(e) => handleResizePointerDown(e, 'vertical')}
            className="absolute bottom-0 left-4 right-6 h-2 cursor-ns-resize hover:bg-blue-500/20 active:bg-blue-500/40 transition-colors z-20"
            title="Redimensionar Altura"
          />

          {/* Bottom-Right Corner Resize Grip Handle */}
          <div
            onPointerDown={(e) => handleResizePointerDown(e, 'both')}
            className="absolute bottom-0 right-0 w-6 h-6 cursor-nwse-resize z-30 flex items-center justify-center group/resize"
            title="Redimensionar"
          >
            <div className="w-3.5 h-3.5 border-r-2 border-b-2 border-zinc-500/80 group-hover/resize:border-blue-400 group-hover/node:border-zinc-400 transition-colors" />
          </div>
        </>
      )}
    </div>
  );
};

export const NodeWrapper = React.memo(NodeWrapperComponent);
