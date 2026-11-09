import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useAtom } from 'jotai';
import {
  canvasOffsetAtom,
  canvasModeAtom,
  selectedNodeIdsAtom,
  marqueeBoxAtom,
  isSpacePressedAtom,
  activeDrawColorAtom,
  activeDrawWidthAtom,
  activeBrushSizeAtom,
  activeBrushTypeAtom,
  MarqueeBox,
} from '@/atoms/canvas';
import {
  nodesAtom,
  cableTiesAtom,
  bandsAtom,
  drawingsAtom,
  activeWorkspaceAtom,
  workspacesAtom,
  activeFloorAtom,
  beginUndoGroupAtom,
  endUndoGroupAtom,
  patchFramesAtom,
} from '@/atoms/workspace';
import { CanvasNode, Band, CableTie, DrawingStroke } from '@mindagentics/shared';
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
import { TextBlockNode } from '../nodes/TextBlockNode';
import {
  zoomAtPoint,
  snapToGrid,
  snapRectOutward,
  tidyNodes,
  layOutDissolvedBandMembers,
  DEFAULT_NODE_DIMENSIONS,
} from '@/utils/layout';
import {
  serializeCanvasSelection,
  parsePartituraPayload,
  remapPastedCanvasElements,
  isWebUrl,
} from '@/utils/clipboard';
import { isInputOrEditable } from '@/utils/keyboard';

export const InfiniteCanvas: React.FC = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [offset, setOffset] = useAtom(canvasOffsetAtom);
  const [canvasMode, setCanvasMode] = useAtom(canvasModeAtom);
  const [selectedIds, setSelectedIds] = useAtom(selectedNodeIdsAtom);
  const [marquee, setMarquee] = useAtom(marqueeBoxAtom);
  const [isSpacePressed, setIsSpacePressed] = useAtom(isSpacePressedAtom);
  const [drawColor] = useAtom(activeDrawColorAtom);
  const [drawWidth, setDrawWidth] = useAtom(activeDrawWidthAtom);
  const [brushSize] = useAtom(activeBrushSizeAtom);
  const [brushType] = useAtom(activeBrushTypeAtom);

  const [nodes, setNodes] = useAtom(nodesAtom);
  const [cableTies, setCableTies] = useAtom(cableTiesAtom);
  const [bands, setBands] = useAtom(bandsAtom);
  const [drawings, setDrawings] = useAtom(drawingsAtom);
  const [activeWorkspace] = useAtom(activeWorkspaceAtom);
  const [activeFloor] = useAtom(activeFloorAtom);
  const [, setWorkspaces] = useAtom(workspacesAtom);
  const lastWsIdRef = useRef<string | null>(null);

  // Sync canvas viewport when active workspace loads or switches
  useEffect(() => {
    if (!activeWorkspace) return;
    const isDifferentWs = lastWsIdRef.current !== activeWorkspace.id;
    lastWsIdRef.current = activeWorkspace.id;

    if (isDifferentWs) {
      if (activeWorkspace.canvasOffset) {
        setOffset(activeWorkspace.canvasOffset);
        return;
      }

      // If no saved offset and there are nodes, check if they need auto-framing
      if (nodes.length > 0 && containerRef.current) {
        const minX = Math.min(...nodes.map((n) => n.x));
        const maxX = Math.max(...nodes.map((n) => n.x + n.width));
        const minY = Math.min(...nodes.map((n) => n.y));
        const maxY = Math.max(...nodes.map((n) => n.y + n.height));

        const rect = containerRef.current.getBoundingClientRect();
        const selWidth = Math.max(maxX - minX, 400);
        const selHeight = Math.max(maxY - minY, 300);

        const fitZoom = Math.min(
          1.0,
          Math.max(0.3, Math.min((rect.width - 160) / selWidth, (rect.height - 160) / selHeight))
        );
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;

        setOffset({
          x: Math.round(rect.width / 2 - centerX * fitZoom),
          y: Math.round(rect.height / 2 - centerY * fitZoom),
          zoom: Number(fitZoom.toFixed(2)),
        });
      }
    }
  }, [activeWorkspace?.id, nodes.length, setOffset]);

  // Persist current offset to active workspace
  useEffect(() => {
    if (!activeWorkspace) return;
    const timer = setTimeout(() => {
      setWorkspaces((prev) =>
        prev.map((w) =>
          w.id === activeWorkspace.id ? { ...w, canvasOffset: offset } : w
        )
      );
    }, 600);
    return () => clearTimeout(timer);
  }, [offset, activeWorkspace?.id, setWorkspaces]);

  const [, beginUndoGroup] = useAtom(beginUndoGroupAtom);
  const [, endUndoGroup] = useAtom(endUndoGroupAtom);
  const [, patchFrames] = useAtom(patchFramesAtom);

  const [currentStroke, setCurrentStroke] = useState<DrawingStroke | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [isErasing, setIsErasing] = useState(false);
  const [tidyVariant, setTidyVariant] = useState(0);
  const panStartRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(
    null
  );

  // Convert Screen Coordinates to Canvas Coordinates
  const screenToCanvas = (screenX: number, screenY: number) => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    return {
      x: (screenX - rect.left - offset.x) / offset.zoom,
      y: (screenY - rect.top - offset.y) / offset.zoom,
    };
  };

  const eraseAtPoint = (pt: { x: number; y: number }) => {
    const eraseRadius = 22;
    const eraseRadiusSq = eraseRadius * eraseRadius;

    setDrawings((prev) => {
      if (!prev || prev.length === 0) return prev;

      let changed = false;
      const nextDrawings: DrawingStroke[] = [];

      for (const stroke of prev) {
        if (!stroke.points || stroke.points.length === 0) continue;

        // Check if any point in stroke is within eraser radius
        const hasPointInEraser = stroke.points.some((p) => {
          const dx = p.x - pt.x;
          const dy = p.y - pt.y;
          return dx * dx + dy * dy <= eraseRadiusSq;
        });

        if (!hasPointInEraser) {
          nextDrawings.push(stroke);
          continue;
        }

        // Cut through stroke like a pencil eraser!
        changed = true;
        const subSegments: { x: number; y: number }[][] = [];
        let currentSegment: { x: number; y: number }[] = [];

        for (const p of stroke.points) {
          const dx = p.x - pt.x;
          const dy = p.y - pt.y;
          const isInside = dx * dx + dy * dy <= eraseRadiusSq;

          if (!isInside) {
            currentSegment.push(p);
          } else {
            if (currentSegment.length > 0) {
              subSegments.push(currentSegment);
              currentSegment = [];
            }
          }
        }

        if (currentSegment.length > 0) {
          subSegments.push(currentSegment);
        }

        // Add remaining sub-segments back as smaller strokes
        for (let i = 0; i < subSegments.length; i++) {
          const seg = subSegments[i];
          if (seg.length >= 2) {
            nextDrawings.push({
              ...stroke,
              id: `${stroke.id}-seg-${i}-${Date.now().toString().slice(-4)}`,
              points: seg,
            });
          } else if (seg.length === 1) {
            nextDrawings.push({
              ...stroke,
              id: `${stroke.id}-dot-${i}-${Date.now().toString().slice(-4)}`,
              points: [seg[0], { x: seg[0].x + 0.1, y: seg[0].y + 0.1 }],
            });
          }
        }
      }

      return changed ? nextDrawings : prev;
    });
  };

  // Anchored Zoom & Smooth Pan Wheel listener
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();

      const rect = el.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Ctrl + Wheel or Alt + Wheel (zoomScrollModifier)
      if (e.ctrlKey || e.metaKey || e.altKey) {
        const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
        const nextZoom = offset.zoom * zoomFactor;
        const updated = zoomAtPoint(offset.zoom, nextZoom, offset, { x: mouseX, y: mouseY });
        setOffset(updated);
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

  // Master Keyboard Pipeline with Focus Isolation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const inInput = isInputOrEditable(activeEl);
      const isMod = e.ctrlKey || e.metaKey;

      // When focused inside an input, textarea, or terminal:
      // Allow Shift+Escape to blur out of the focused element to return control to the canvas.
      // Global canvas shortcuts must NOT hijack keystrokes (e.g. Ctrl+L for clear screen, Escape for Vim).
      if (inInput) {
        if (e.key === 'Escape' && e.shiftKey) {
          if (activeEl instanceof HTMLElement) {
            activeEl.blur();
          }
          setSelectedIds([]);
          setCanvasMode('select');
        }
        return;
      }

      // Escape key when not in input: clear selection, and return to select mode
      if (e.key === 'Escape') {
        setSelectedIds([]);
        setCanvasMode('select');
        return;
      }

      // 1. Reset Zoom: Ctrl+0 / Cmd+0
      if (isMod && e.key === '0') {
        e.preventDefault();
        setOffset((prev) => ({ ...prev, zoom: 1.0 }));
        return;
      }

      // 2. Tidy Selected Nodes: Ctrl+Shift+T / Cmd+Shift+T
      if (isMod && e.shiftKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        const selected = nodes.filter((n) => selectedIds.includes(n.id));
        if (selected.length >= 2) {
          beginUndoGroup();
          const tidied = tidyNodes(selected, 4 / 3, tidyVariant);
          setTidyVariant((prev) => prev + 1);
          patchFrames(
            tidied.map((n) => ({ id: n.id, x: n.x, y: n.y, width: n.width, height: n.height }))
          );
          endUndoGroup();
        }
        return;
      }

      // 3. Zoom Toggle / Fit Selection: Ctrl+\ or Ctrl+Alt+\
      if (isMod && e.key === '\\') {
        e.preventDefault();
        const selected = nodes.filter((n) => selectedIds.includes(n.id));
        if (selected.length > 0 && containerRef.current) {
          const rect = containerRef.current.getBoundingClientRect();
          const minX = Math.min(...selected.map((n) => n.x));
          const maxX = Math.max(...selected.map((n) => n.x + n.width));
          const minY = Math.min(...selected.map((n) => n.y));
          const maxY = Math.max(...selected.map((n) => n.y + n.height));

          const selWidth = maxX - minX;
          const selHeight = maxY - minY;

          const fitZoom = Math.min(
            1.5,
            Math.max(0.2, Math.min((rect.width - 120) / selWidth, (rect.height - 120) / selHeight))
          );
          const centerX = (minX + maxX) / 2;
          const centerY = (minY + maxY) / 2;

          setOffset({
            x: Math.round(rect.width / 2 - centerX * fitZoom),
            y: Math.round(rect.height / 2 - centerY * fitZoom),
            zoom: Number(fitZoom.toFixed(2)),
          });
        } else {
          // Toggle reset view
          setOffset({ x: 0, y: 0, zoom: 1.0 });
        }
        return;
      }

      // 4. Connect Cable Tie Tool: Ctrl+L
      if (isMod && e.key.toLowerCase() === 'l' && !e.shiftKey) {
        e.preventDefault();
        setCanvasMode((prev) => (prev === 'connect' ? 'select' : 'connect'));
        return;
      }

      // 5. Delete element: Delete or Backspace or Ctrl+W
      if (e.key === 'Delete' || e.key === 'Backspace' || (isMod && e.key.toLowerCase() === 'w')) {
        if (selectedIds.length > 0) {
          e.preventDefault();
          beginUndoGroup();
          for (const id of selectedIds) {
            const target = nodes.find((n) => n.id === id);
            if (target && target.kind === 'terminal') {
              const termId = (target as any).content?.terminalId;
              if (termId) {
                window.api?.terminal?.kill?.(termId)?.catch?.(() => {});
                window.mindAgentics?.terminal?.kill?.(termId)?.catch?.(() => {});
                (window.mindAgentics?.terminal || window.api?.terminal ?.terminal)?.kill?.(termId)?.catch?.(() => {});
              }
            }
          }
          setNodes((prev) => prev.filter((n) => !selectedIds.includes(n.id)));
          setCableTies((prev) =>
            prev.filter(
              (t) => !selectedIds.includes(t.fromNodeId) && !selectedIds.includes(t.toNodeId)
            )
          );
          setSelectedIds([]);
          endUndoGroup();
        }
        return;
      }

      // 6. Copy selection: Ctrl+C / Cmd+C
      if (isMod && e.key.toLowerCase() === 'c' && selectedIds.length > 0) {
        const selected = nodes.filter((n) => selectedIds.includes(n.id));
        const payloadStr = serializeCanvasSelection(selected, cableTies, []);
        navigator.clipboard.writeText(payloadStr).catch(() => {});
        return;
      }

      // Spacebar for continuous pan
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        setIsSpacePressed(true);
        return;
      }

      // H for Pan toggle
      if (e.key.toLowerCase() === 'h' && !isMod) {
        e.preventDefault();
        setCanvasMode((prev) => (prev === 'pan' ? 'select' : 'pan'));
        return;
      }

      // V for Select
      if (e.key.toLowerCase() === 'v' && !isMod) {
        e.preventDefault();
        setCanvasMode('select');
        return;
      }

      // B for Draw mode
      if (e.key.toLowerCase() === 'b' && !isMod) {
        e.preventDefault();
        setCanvasMode((prev) => (prev === 'draw' ? 'select' : 'draw'));
        return;
      }

      // [ and ] for brush thickness (clamped 1px to 24px)
      if (e.key === '[') {
        e.preventDefault();
        setDrawWidth((prev) => Math.max(1, prev - 2));
        return;
      }
      if (e.key === ']') {
        e.preventDefault();
        setDrawWidth((prev) => Math.min(24, prev + 2));
        return;
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
  }, [
    nodes,
    cableTies,
    bands,
    selectedIds,
    tidyVariant,
    offset,
    setOffset,
    setNodes,
    setCableTies,
    setSelectedIds,
    setCanvasMode,
    setIsSpacePressed,
    setDrawWidth,
    beginUndoGroup,
    endUndoGroup,
    patchFrames,
  ]);

  // Global Paste Handler (Native Partitura v2 & External OS Fallback)
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      if (isInputOrEditable(document.activeElement)) return;

      const clipboardData = e.clipboardData;
      if (!clipboardData) return;

      // 1. Check for image files in clipboard
      const items = Array.from(clipboardData.items || []);
      const imageItem = items.find((item) => item.type.startsWith('image/'));
      if (imageItem) {
        e.preventDefault();
        const file = imageItem.getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = (event) => {
            const dataUrl = event.target?.result as string;
            beginUndoGroup();
            const center = screenToCanvas(window.innerWidth / 2, window.innerHeight / 2);
            const newNote: CanvasNode = {
              id: `node-img-${Date.now()}`,
              kind: 'note',
              x: snapToGrid(center.x),
              y: snapToGrid(center.y),
              width: 320,
              height: 280,
              zIndex: 30,
              content: {
                noteId: `note-img-${Date.now()}`,
                title: 'Imagem Colada',
                body: `![Pasted Image](${dataUrl})`,
                color: 'blue',
                isNamePinned: false,
                stackId: null,
              },
            };
            setNodes((prev) => [...prev, newNote]);
            setSelectedIds([newNote.id]);
            endUndoGroup();
          };
          reader.readAsDataURL(file);
          return;
        }
      }

      // 2. Read plain text / json
      const text = clipboardData.getData('text/plain');
      if (!text || !text.trim()) return;

      e.preventDefault();

      // Check if Partitura v2 native format
      const partituraPayload = parsePartituraPayload(text);
      if (partituraPayload) {
        beginUndoGroup();
        const center = screenToCanvas(window.innerWidth / 2, window.innerHeight / 2);
        const remapped = remapPastedCanvasElements(partituraPayload, center);

        setNodes((prev) => [...prev, ...remapped.nodes]);
        if (remapped.cableTies.length > 0) {
          setCableTies((prev) => [...prev, ...remapped.cableTies]);
        }
        setSelectedIds(remapped.nodes.map((n) => n.id));
        endUndoGroup();
        return;
      }

      // External OS Fallback: Web URL -> Browser Portal
      if (isWebUrl(text)) {
        beginUndoGroup();
        const center = screenToCanvas(window.innerWidth / 2, window.innerHeight / 2);
        const newPortal: CanvasNode = {
          id: `node-portal-${Date.now()}`,
          kind: 'portal',
          x: snapToGrid(center.x),
          y: snapToGrid(center.y),
          width: DEFAULT_NODE_DIMENSIONS.portal.width,
          height: DEFAULT_NODE_DIMENSIONS.portal.height,
          zIndex: 30,
          content: {
            portalKind: 'browser',
            url: text.trim(),
            viewport: { width: 1280, height: 800 },
            actionTags: [],
          },
        };
        setNodes((prev) => [...prev, newPortal]);
        setSelectedIds([newPortal.id]);
        endUndoGroup();
        return;
      }

      // External OS Fallback: Plain Text / Markdown -> Sticky Note
      beginUndoGroup();
      const center = screenToCanvas(window.innerWidth / 2, window.innerHeight / 2);
      const newNote: CanvasNode = {
        id: `node-note-${Date.now()}`,
        kind: 'note',
        x: snapToGrid(center.x),
        y: snapToGrid(center.y),
        width: DEFAULT_NODE_DIMENSIONS.note.width,
        height: DEFAULT_NODE_DIMENSIONS.note.height,
        zIndex: 30,
        content: {
          noteId: `note-${Date.now()}`,
          title: 'Texto Colado',
          body: text,
          color: 'yellow',
          isNamePinned: false,
          stackId: null,
        },
      };
      setNodes((prev) => [...prev, newNote]);
      setSelectedIds([newNote.id]);
      endUndoGroup();
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [
    setNodes,
    setCableTies,
    setBands,
    setSelectedIds,
    beginUndoGroup,
    endUndoGroup,
    offset,
  ]);

  // Pointer Down Handler
  const handlePointerDown = (e: React.PointerEvent) => {
    if (!containerRef.current) return;

    // Never intercept clicks or start marquee when interacting with nodes, terminals, or toolbars
    const targetEl = e.target as HTMLElement | null;
    if (targetEl && targetEl.closest('.node-wrapper, .canvas-node, .xterm, .terminal, .canvas-toolbar, [data-canvas-ignore]')) {
      return;
    }

    // Unfocus terminal or input when clicking canvas background
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

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
        setCurrentStroke({
          id: `draw-${Date.now()}`,
          color: drawColor,
          width: brushSize,
          brushType,
          points: [canvasPt],
        });
        return;
      }

      if (canvasMode === 'erase') {
        setIsErasing(true);
        eraseAtPoint(canvasPt);
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

    if (canvasMode === 'erase' && isErasing) {
      eraseAtPoint(canvasPt);
      return;
    }

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

      // Snap outward for selection boundary
      const snappedBounds = snapRectOutward(
        { x: updatedMarquee.startX, y: updatedMarquee.startY },
        { x: updatedMarquee.currentX, y: updatedMarquee.currentY }
      );

      const mLeft = snappedBounds.x;
      const mTop = snappedBounds.y;
      const mRight = snappedBounds.x + snappedBounds.width;
      const mBottom = snappedBounds.y + snappedBounds.height;

      const intersecting = nodes.filter((node) => {
        const nRight = node.x + node.width;
        const nBottom = node.y + node.height;
        return node.x < mRight && nRight > mLeft && node.y < mBottom && nBottom > mTop;
      });

      setSelectedIds(intersecting.map((n) => n.id));
    }
  };

  const handlePointerUp = () => {
    if (isPanning) {
      setIsPanning(false);
      panStartRef.current = null;
    }

    if (isErasing) {
      setIsErasing(false);
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
      const syncFn = window.mindAgentics?.canvas?.sync || (window.mindAgentics?.canvas?.sync || window.api?.canvas?.sync ?.canvas?.sync);
      if (syncFn) {
        syncFn({
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
  const handleMoveNode = useCallback((id: string, x: number, y: number) => {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, x, y } : n)));
  }, [setNodes]);

  const handleMoveNodes = useCallback((nodeIds: string[], dx: number, dy: number) => {
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
  }, [setNodes]);

  const handleResizeNode = useCallback((id: string, width: number, height: number) => {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, width, height } : n)));
  }, [setNodes]);

  const handleUpdateNode = useCallback((updated: CanvasNode) => {
    setNodes((prev) => prev.map((n) => (n.id === updated.id ? { ...n, ...updated } : n)));
  }, [setNodes]);

  const handleDeleteNode = useCallback((id: string) => {
    beginUndoGroup();
    setNodes((prev) => {
      const target = prev.find((n) => n.id === id);
      if (target && target.kind === 'terminal') {
        const termId = (target as any).content?.terminalId;
        if (termId) {
          window.api?.terminal?.kill?.(termId)?.catch?.(() => {});
          window.mindAgentics?.terminal?.kill?.(termId)?.catch?.(() => {});
          (window.mindAgentics?.terminal || window.api?.terminal ?.terminal)?.kill?.(termId)?.catch?.(() => {});
        }
      }
      return prev.filter((n) => n.id !== id);
    });
    setCableTies((prev) => prev.filter((t) => t.fromNodeId !== id && t.toNodeId !== id));
    setSelectedIds((prev) => prev.filter((i) => i !== id));
    endUndoGroup();
  }, [setNodes, setCableTies, setSelectedIds, beginUndoGroup, endUndoGroup]);

  const bringToFront = useCallback((id: string) => {
    setNodes((prev) => {
      const maxZ = Math.max(...prev.map((n) => n.zIndex || 1), 10);
      return prev.map((n) => (n.id === id ? { ...n, zIndex: maxZ + 1 } : n));
    });
  }, [setNodes]);

  // Band operations
  const handleUpdateBand = useCallback((updated: Band) => {
    setBands((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
  }, [setBands]);

  const handleDeleteBand = useCallback((bandId: string) => {
    beginUndoGroup();
    setBands((prev) => prev.filter((b) => b.id !== bandId));
    endUndoGroup();
  }, [setBands, beginUndoGroup, endUndoGroup]);

  const handleDissolveBand = useCallback((bandId: string) => {
    const targetBand = bands.find((b) => b.id === bandId);
    if (!targetBand) return;
    beginUndoGroup();
    const updatedNodes = layOutDissolvedBandMembers(targetBand, nodes);
    setNodes(updatedNodes);
    setBands((prev) => prev.filter((b) => b.id !== bandId));
    endUndoGroup();
  }, [bands, nodes, setNodes, setBands, beginUndoGroup, endUndoGroup]);

  // Cable Tie operations
  const handleDeleteTie = (tieId: string) => {
    beginUndoGroup();
    setCableTies((prev) => prev.filter((t) => t.id !== tieId));
    endUndoGroup();
  };

  // Fast O(1) node lookup index for Cable Ties
  const nodeLookup = useMemo(() => {
    const map = new Map<string, CanvasNode>();
    for (const n of nodes) {
      map.set(n.id, n);
      if (n.kind === 'terminal' && (n.content as any)?.terminalId) {
        map.set((n.content as any).terminalId, n);
      }
    }
    return map;
  }, [nodes]);

  const cursorClass = isPanning || isSpacePressed
    ? 'cursor-grab active:cursor-grabbing'
    : canvasMode === 'pan'
    ? 'cursor-grab active:cursor-grabbing'
    : canvasMode === 'draw'
    ? 'cursor-crosshair'
    : canvasMode === 'erase'
    ? 'cursor-cell'
    : canvasMode === 'connect'
    ? 'cursor-pointer'
    : 'cursor-default';

  return (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      className={`relative w-full h-full bg-[#0E0F12] overflow-hidden ${cursorClass}`}
    >
      {/* Background Grid */}
      <GridBackground offset={offset} />

      {/* Canvas World Container */}
      <div
        className={`absolute origin-top-left ${isPanning ? 'will-change-transform' : ''}`}
        style={{
          transform: `translate(${Math.round(offset.x)}px, ${Math.round(offset.y)}px) scale(${offset.zoom})`,
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale',
          textRendering: 'geometricPrecision',
        }}
      >
        {/* Bands Layer */}
        {bands.map((band) => (
          <BandComponent
            key={band.id}
            band={band}
            nodes={nodes}
            onUpdateBand={handleUpdateBand}
            onDeleteBand={handleDeleteBand}
            onDissolveBand={handleDissolveBand}
            onMoveNodes={handleMoveNodes}
            zoom={offset.zoom}
          />
        ))}

        {/* Cable Ties SVG Layer */}
        <svg className="absolute inset-0 w-[50000px] h-[50000px] pointer-events-none -left-[25000px] -top-[25000px] overflow-visible">
          <g transform="translate(25000, 25000)">
            {cableTies.map((tie) => {
              const fromNode = nodeLookup.get(tie.fromNodeId);
              const toNode = nodeLookup.get(tie.toNodeId);
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

        {/* Draw / Erase Mode Interceptor Overlay */}
        {(canvasMode === 'draw' || canvasMode === 'erase') && (
          <div
            className={`absolute z-30 ${canvasMode === 'erase' ? 'cursor-cell' : 'cursor-crosshair'}`}
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
            onMoveMultiple={handleMoveNodes}
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
            {node.kind === 'textBlock' && (
              <TextBlockNode
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
