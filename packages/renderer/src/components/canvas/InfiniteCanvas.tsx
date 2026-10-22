import React, { useRef, useState, useEffect } from 'react';
import { useAtom } from 'jotai';
import {
  canvasOffsetAtom,
  canvasModeAtom,
  selectedNodeIdsAtom,
  marqueeBoxAtom,
  isSpacePressedAtom,
  activeDrawColorAtom,
  activeDrawWidthAtom,
  MarqueeBox,
} from '@/atoms/canvas';
import {
  nodesAtom,
  cableTiesAtom,
  bandsAtom,
  drawingsAtom,
  activeWorkspaceAtom,
  activeFloorAtom,
} from '@/atoms/workspace';
import { CanvasNode, Band, CableTie, DrawingStroke } from '@maestri/shared';
import { GridBackground } from './GridBackground';
import { MarqueeSelection } from './MarqueeSelection';
import { BandComponent } from './BandComponent';
import { CableTieComponent } from './CableTieComponent';
import { DrawingLayer } from './DrawingLayer';
import { NodeWrapper } from '../nodes/NodeWrapper';
import { TerminalNode } from '../nodes/TerminalNode';
import { StickyNoteNode } from '../nodes/StickyNoteNode';
import { NoteStackNode } from '../nodes/NoteStackNode';
import { PortalNode } from '../nodes/PortalNode';

export const InfiniteCanvas: React.FC = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [offset, setOffset] = useAtom(canvasOffsetAtom);
  const [canvasMode, setCanvasMode] = useAtom(canvasModeAtom);
  const [selectedIds, setSelectedIds] = useAtom(selectedNodeIdsAtom);
  const [marquee, setMarquee] = useAtom(marqueeBoxAtom);
  const [isSpacePressed, setIsSpacePressed] = useAtom(isSpacePressedAtom);
  const [drawColor] = useAtom(activeDrawColorAtom);
  const [drawWidth] = useAtom(activeDrawWidthAtom);

  const [nodes, setNodes] = useAtom(nodesAtom);
  const [cableTies, setCableTies] = useAtom(cableTiesAtom);
  const [bands, setBands] = useAtom(bandsAtom);
  const [drawings, setDrawings] = useAtom(drawingsAtom);
  const [activeWorkspace] = useAtom(activeWorkspaceAtom);
  const [activeFloor] = useAtom(activeFloorAtom);

  const [currentStroke, setCurrentStroke] = useState<DrawingStroke | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(
    null
  );

  // Key listeners for Spacebar panning
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        const activeEl = document.activeElement;
        const isInput =
          activeEl instanceof HTMLInputElement ||
          activeEl instanceof HTMLTextAreaElement ||
          activeEl?.classList.contains('cm-content');
        if (!isInput) {
          e.preventDefault();
          setIsSpacePressed(true);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePressed(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [setIsSpacePressed]);

  // Native non-passive Wheel listener for seamless zoom and pan
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();

      const rect = el.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      if (e.ctrlKey) {
        // Pinch-to-zoom / Ctrl+wheel: zoom pivot around cursor
        const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
        const newZoom = Math.min(3.0, Math.max(0.1, Number((offset.zoom * zoomFactor).toFixed(3))));

        const canvasPointX = (mouseX - offset.x) / offset.zoom;
        const canvasPointY = (mouseY - offset.y) / offset.zoom;

        const newX = mouseX - canvasPointX * newZoom;
        const newY = mouseY - canvasPointY * newZoom;

        setOffset({
          x: Math.round(newX),
          y: Math.round(newY),
          zoom: newZoom,
        });
      } else {
        // Trackpad 2-finger scroll or wheel panning
        setOffset((prev) => ({
          ...prev,
          x: Math.round(prev.x - e.deltaX),
          y: Math.round(prev.y - e.deltaY),
        }));
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
    };
  }, [offset, setOffset]);

  // Convert Screen Coordinates to Canvas Coordinates
  const screenToCanvas = (screenX: number, screenY: number) => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    return {
      x: (screenX - rect.left - offset.x) / offset.zoom,
      y: (screenY - rect.top - offset.y) / offset.zoom,
    };
  };

  // Canvas PointerDown Handler
  const handlePointerDown = (e: React.PointerEvent) => {
    if (!containerRef.current) return;

    // Middle-click (1) or Spacebar + Left-click or CanvasMode 'pan'
    const isPanTrigger =
      e.button === 1 ||
      (e.button === 0 && (isSpacePressed || canvasMode === 'pan'));

    if (isPanTrigger) {
      e.preventDefault();
      setIsPanning(true);
      panStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        offsetX: offset.x,
        offsetY: offset.y,
      };
      return;
    }

    if (e.button === 0) {
      const canvasPt = screenToCanvas(e.clientX, e.clientY);

      if (canvasMode === 'draw') {
        // Start freeform drawing stroke
        setCurrentStroke({
          id: `draw-${Date.now()}`,
          color: drawColor,
          width: drawWidth,
          points: [canvasPt],
        });
        return;
      }

      if (canvasMode === 'select') {
        // Start marquee selection on empty background
        setSelectedIds([]);
        setMarquee({
          startX: canvasPt.x,
          startY: canvasPt.y,
          currentX: canvasPt.x,
          currentY: canvasPt.y,
        });
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (isPanning && panStartRef.current) {
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      setOffset((prev) => ({
        ...prev,
        x: Math.round(panStartRef.current!.offsetX + dx),
        y: Math.round(panStartRef.current!.offsetY + dy),
      }));
      return;
    }

    const canvasPt = screenToCanvas(e.clientX, e.clientY);

    if (canvasMode === 'draw' && currentStroke) {
      setCurrentStroke((prev) =>
        prev
          ? {
              ...prev,
              points: [...prev.points, canvasPt],
            }
          : null
      );
      return;
    }

    if (marquee) {
      const updatedMarquee: MarqueeBox = {
        ...marquee,
        currentX: canvasPt.x,
        currentY: canvasPt.y,
      };
      setMarquee(updatedMarquee);

      // Calculate intersecting nodes
      const mLeft = Math.min(updatedMarquee.startX, updatedMarquee.currentX);
      const mTop = Math.min(updatedMarquee.startY, updatedMarquee.currentY);
      const mRight = Math.max(updatedMarquee.startX, updatedMarquee.currentX);
      const mBottom = Math.max(updatedMarquee.startY, updatedMarquee.currentY);

      const intersecting = nodes.filter((node) => {
        const nRight = node.x + node.width;
        const nBottom = node.y + node.height;
        return (
          node.x < mRight &&
          nRight > mLeft &&
          node.y < mBottom &&
          nBottom > mTop
        );
      });

      setSelectedIds(intersecting.map((n) => n.id));
    }
  };

  const handlePointerUp = () => {
    if (isPanning) {
      setIsPanning(false);
      panStartRef.current = null;
    }

    if (currentStroke) {
      if (currentStroke.points.length > 1) {
        setDrawings((prev) => [...(prev || []), currentStroke]);
      }
      setCurrentStroke(null);
    }

    if (marquee) {
      setMarquee(null);
    }
  };

  // Synchronize canvas nodes and cable ties to core-daemon supervisor for CLI inter-agent access
  useEffect(() => {
    const timer = setTimeout(() => {
      if (window.maestri?.canvas?.sync) {
        window.maestri.canvas.sync({
          nodes,
          cableTies,
          workspaceId: activeWorkspace?.id,
          floorId: activeFloor?.id,
        });
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [nodes, cableTies, activeWorkspace?.id, activeFloor?.id]);

  // Node operations
  const handleMoveNode = (id: string, x: number, y: number) => {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, x, y } : n)));
  };

  const handleResizeNode = (id: string, width: number, height: number) => {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, width, height } : n)));
  };

  const handleUpdateNode = (updated: CanvasNode) => {
    setNodes((prev) => prev.map((n) => (n.id === updated.id ? { ...n, ...updated } : n)));
  };

  const handleDeleteNode = (id: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== id));
    // Also remove connected ties
    setCableTies((prev) => prev.filter((t) => t.fromNodeId !== id && t.toNodeId !== id));
    // And remove from bands
    setBands((prev) =>
      prev.map((b) => ({
        ...b,
        memberNodeIds: b.memberNodeIds.filter((mId) => mId !== id),
      }))
    );
  };

  const bringToFront = (id: string) => {
    setNodes((prev) => {
      const maxZ = Math.max(...prev.map((n) => n.zIndex || 1), 10);
      return prev.map((n) => (n.id === id ? { ...n, zIndex: maxZ + 1 } : n));
    });
  };

  // Band operations
  const handleUpdateBand = (updated: Band) => {
    setBands((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
  };

  const handleDeleteBand = (bandId: string) => {
    setBands((prev) => prev.filter((b) => b.id !== bandId));
  };

  const handleMoveNodes = (nodeIds: string[], dx: number, dy: number) => {
    setNodes((prev) =>
      prev.map((node) =>
        nodeIds.includes(node.id)
          ? {
              ...node,
              x: Math.round(node.x + dx),
              y: Math.round(node.y + dy),
            }
          : node
      )
    );
  };

  // Cable Tie operations
  const handleDeleteTie = (tieId: string) => {
    setCableTies((prev) => prev.filter((t) => t.id !== tieId));
  };

  const cursorClass = isPanning || isSpacePressed
    ? 'cursor-grab active:cursor-grabbing'
    : canvasMode === 'pan'
    ? 'cursor-grab active:cursor-grabbing'
    : canvasMode === 'draw'
    ? 'cursor-crosshair'
    : canvasMode === 'connect'
    ? 'cursor-pointer'
    : 'cursor-default';

  return (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      className={`relative w-full h-full bg-[#111215] overflow-hidden ${cursorClass}`}
    >
      {/* Background Dots */}
      <GridBackground offset={offset} />

      {/* Canvas World Container */}
      <div
        className="absolute origin-top-left will-change-transform"
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${offset.zoom})`,
        }}
      >
        {/* Bands Layer (Rendered below nodes and ties) */}
        {bands.map((band) => (
          <BandComponent
            key={band.id}
            band={band}
            nodes={nodes}
            onUpdateBand={handleUpdateBand}
            onDeleteBand={handleDeleteBand}
            onMoveNodes={handleMoveNodes}
            zoom={offset.zoom}
          />
        ))}

        {/* Cable Ties SVG Layer */}
        <svg className="absolute inset-0 w-[50000px] h-[50000px] pointer-events-none -left-[25000px] -top-[25000px] overflow-visible">
          <g transform="translate(25000, 25000)">
            {cableTies.map((tie) => {
              const fromNode = nodes.find((n) => n.id === tie.fromNodeId);
              const toNode = nodes.find((n) => n.id === tie.toNodeId);
              return (
                <CableTieComponent
                  key={tie.id}
                  tie={tie}
                  fromNode={fromNode}
                  toNode={toNode}
                  onDelete={handleDeleteTie}
                />
              );
            })}
          </g>
        </svg>

        {/* Freeform Drawings Layer */}
        <DrawingLayer drawings={drawings || []} currentStroke={currentStroke} />

        {/* Draw Mode Interceptor Overlay */}
        {canvasMode === 'draw' && (
          <div
            className="absolute z-30 cursor-crosshair"
            style={{ width: '60000px', height: '60000px', left: '-30000px', top: '-30000px' }}
          />
        )}

        {/* Nodes Layer */}
        {nodes.map((node) => (
          <NodeWrapper
            key={node.id}
            node={node}
            onUpdate={handleUpdateNode}
            onMove={handleMoveNode}
            onResize={handleResizeNode}
            onBringToFront={bringToFront}
            zoom={offset.zoom}
          >
            {node.kind === 'terminal' && (
              <TerminalNode
                node={node as any}
                onUpdate={handleUpdateNode as any}
                onDelete={handleDeleteNode}
              />
            )}
            {node.kind === 'note' && (
              <StickyNoteNode
                node={node as any}
                onUpdate={handleUpdateNode as any}
                onDelete={handleDeleteNode}
              />
            )}
            {node.kind === 'noteStack' && (
              <NoteStackNode
                node={node as any}
                onUpdate={handleUpdateNode as any}
                onDelete={handleDeleteNode}
              />
            )}
            {node.kind === 'portal' && (
              <PortalNode
                node={node as any}
                onUpdate={handleUpdateNode as any}
                onDelete={handleDeleteNode}
              />
            )}
          </NodeWrapper>
        ))}

        {/* Marquee Selection Layer */}
        <MarqueeSelection marquee={marquee} />
      </div>
    </div>
  );
};
