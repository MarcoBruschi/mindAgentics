import { CanvasNode, Band, CableTie } from '@mindagentics/shared';

export const CANVAS_GRID_STEP = 20;

export const ZOOM_LEVELS = [
  0.1, 0.2, 0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0,
];

/**
 * Snap a scalar value to the nearest canvas grid step (20px)
 */
export function snapToGrid(val: number): number {
  return Math.round(val / CANVAS_GRID_STEP) * CANVAS_GRID_STEP;
}

/**
 * Calculates outer bounding rectangle snapped to multiples of 20 by floor and ceil
 */
export function snapRectOutward(
  a: { x: number; y: number },
  b: { x: number; y: number }
): { x: number; y: number; width: number; height: number } {
  const x = Math.floor(Math.min(a.x, b.x) / CANVAS_GRID_STEP) * CANVAS_GRID_STEP;
  const y = Math.floor(Math.min(a.y, b.y) / CANVAS_GRID_STEP) * CANVAS_GRID_STEP;
  const maxX = Math.ceil(Math.max(a.x, b.x) / CANVAS_GRID_STEP) * CANVAS_GRID_STEP;
  const maxY = Math.ceil(Math.max(a.y, b.y) / CANVAS_GRID_STEP) * CANVAS_GRID_STEP;
  return { x, y, width: Math.max(CANVAS_GRID_STEP, maxX - x), height: Math.max(CANVAS_GRID_STEP, maxY - y) };
}

/**
 * Cursor-anchored continuous zoom calculation
 */
export function zoomAtPoint(
  prevZoom: number,
  nextZoom: number,
  prevOffset: { x: number; y: number },
  screenAnchor: { x: number; y: number }
): { x: number; y: number; zoom: number } {
  const clampedZoom = Math.min(3.0, Math.max(0.1, Number(nextZoom.toFixed(3))));
  const canvasPointX = (screenAnchor.x - prevOffset.x) / prevZoom;
  const canvasPointY = (screenAnchor.y - prevOffset.y) / prevZoom;

  const newX = screenAnchor.x - canvasPointX * clampedZoom;
  const newY = screenAnchor.y - canvasPointY * clampedZoom;

  return {
    x: Math.round(newX),
    y: Math.round(newY),
    zoom: clampedZoom,
  };
}

/**
 * Default dimensions for new canvas nodes
 */
export const DEFAULT_NODE_DIMENSIONS = {
  note: { width: 280, height: 280 },
  noteCompact: { width: 260, height: 160 },
  terminal: { width: 800, height: 500 },
  portal: { width: 800, height: 600 },
  noteStack: { width: 380, height: 340 },
};

/**
 * Automatic relative positioning: places new element to the right of a reference node with 60px gap
 */
export function framePlacedNextTo(
  nodes: CanvasNode[],
  refId?: string | null,
  fallbackCenter?: { x: number; y: number }
): { x: number; y: number } {
  if (refId) {
    const ref = nodes.find((n) => n.id === refId);
    if (ref) {
      return {
        x: snapToGrid(ref.x + ref.width + 60),
        y: snapToGrid(ref.y),
      };
    }
  }

  if (nodes.length > 0) {
    // Pick the rightmost node
    const rightmost = [...nodes].sort((a, b) => b.x + b.width - (a.x + a.width))[0];
    return {
      x: snapToGrid(rightmost.x + rightmost.width + 60),
      y: snapToGrid(rightmost.y),
    };
  }

  return {
    x: snapToGrid(fallbackCenter?.x ?? 300),
    y: snapToGrid(fallbackCenter?.y ?? 200),
  };
}

export type AlignmentType =
  | 'left'
  | 'centerHorizontally'
  | 'right'
  | 'top'
  | 'centerVertically'
  | 'bottom'
  | 'distributeHorizontally'
  | 'distributeVertically';

/**
 * Align and distribute nodes based on bounding box
 */
export function alignElements(
  nodesToAlign: CanvasNode[],
  alignment: AlignmentType
): CanvasNode[] {
  if (nodesToAlign.length < 2) return nodesToAlign;

  const minX = Math.min(...nodesToAlign.map((n) => n.x));
  const maxX = Math.max(...nodesToAlign.map((n) => n.x + n.width));
  const minY = Math.min(...nodesToAlign.map((n) => n.y));
  const maxY = Math.max(...nodesToAlign.map((n) => n.y + n.height));

  const totalWidth = maxX - minX;
  const totalHeight = maxY - minY;

  switch (alignment) {
    case 'left':
      return nodesToAlign.map((n) => ({
        ...n,
        x: snapToGrid(minX),
      }));

    case 'centerHorizontally': {
      const centerX = (minX + maxX) / 2;
      return nodesToAlign.map((n) => ({
        ...n,
        x: snapToGrid(centerX - n.width / 2),
      }));
    }

    case 'right':
      return nodesToAlign.map((n) => ({
        ...n,
        x: snapToGrid(maxX - n.width),
      }));

    case 'top':
      return nodesToAlign.map((n) => ({
        ...n,
        y: snapToGrid(minY),
      }));

    case 'centerVertically': {
      const centerY = (minY + maxY) / 2;
      return nodesToAlign.map((n) => ({
        ...n,
        y: snapToGrid(centerY - n.height / 2),
      }));
    }

    case 'bottom':
      return nodesToAlign.map((n) => ({
        ...n,
        y: snapToGrid(maxY - n.height),
      }));

    case 'distributeHorizontally': {
      if (nodesToAlign.length < 3) return nodesToAlign;
      const sorted = [...nodesToAlign].sort((a, b) => a.x - b.x);
      const sumWidths = sorted.reduce((acc, n) => acc + n.width, 0);
      const freeSpace = totalWidth - sumWidths;
      const spacing = freeSpace / (sorted.length - 1);

      let currentX = sorted[0].x;
      const updatedMap = new Map<string, number>();

      sorted.forEach((node, idx) => {
        if (idx === 0) {
          updatedMap.set(node.id, snapToGrid(currentX));
        } else if (idx === sorted.length - 1) {
          updatedMap.set(node.id, snapToGrid(maxX - node.width));
        } else {
          currentX += sorted[idx - 1].width + spacing;
          updatedMap.set(node.id, snapToGrid(currentX));
        }
      });

      return nodesToAlign.map((n) => ({
        ...n,
        x: updatedMap.get(n.id) ?? n.x,
      }));
    }

    case 'distributeVertically': {
      if (nodesToAlign.length < 3) return nodesToAlign;
      const sorted = [...nodesToAlign].sort((a, b) => a.y - b.y);
      const sumHeights = sorted.reduce((acc, n) => acc + n.height, 0);
      const freeSpace = totalHeight - sumHeights;
      const spacing = freeSpace / (sorted.length - 1);

      let currentY = sorted[0].y;
      const updatedMap = new Map<string, number>();

      sorted.forEach((node, idx) => {
        if (idx === 0) {
          updatedMap.set(node.id, snapToGrid(currentY));
        } else if (idx === sorted.length - 1) {
          updatedMap.set(node.id, snapToGrid(maxY - node.height));
        } else {
          currentY += sorted[idx - 1].height + spacing;
          updatedMap.set(node.id, snapToGrid(currentY));
        }
      });

      return nodesToAlign.map((n) => ({
        ...n,
        y: updatedMap.get(n.id) ?? n.y,
      }));
    }

    default:
      return nodesToAlign;
  }
}

/**
 * Tidy Algorithm (Auto-organize)
 * Arranges selected nodes in an aesthetic grid or flow layout.
 * Supports alternating variants for consecutive calls.
 */
export function tidyNodes(
  nodesToTidy: CanvasNode[],
  targetAspect = 4 / 3,
  variant = 0
): CanvasNode[] {
  if (nodesToTidy.length < 2) return nodesToTidy;

  // Compute top-left origin
  const originX = snapToGrid(Math.min(...nodesToTidy.map((n) => n.x)));
  const originY = snapToGrid(Math.min(...nodesToTidy.map((n) => n.y)));
  const GAP = 40;

  const count = nodesToTidy.length;
  const modVariant = variant % 3;

  if (modVariant === 1) {
    // Variant 1: Pure horizontal row
    let currentX = originX;
    return nodesToTidy.map((n) => {
      const res = { ...n, x: currentX, y: originY };
      currentX += n.width + GAP;
      return res;
    });
  }

  if (modVariant === 2) {
    // Variant 2: Pure vertical column
    let currentY = originY;
    return nodesToTidy.map((n) => {
      const res = { ...n, x: originX, y: currentY };
      currentY += n.height + GAP;
      return res;
    });
  }

  // Variant 0: Compact Grid packing based on targetAspect
  // Estimate number of columns
  const cols = Math.max(1, Math.min(count, Math.round(Math.sqrt(count * targetAspect))));
  
  // Calculate max row height and column widths
  let rowMaxHeight = 0;
  let colX = originX;
  let currentY = originY;

  return nodesToTidy.map((n, idx) => {
    const colIndex = idx % cols;
    if (colIndex === 0 && idx !== 0) {
      currentY += rowMaxHeight + GAP;
      colX = originX;
      rowMaxHeight = 0;
    }

    const nodeX = colX;
    const nodeY = currentY;

    colX += n.width + GAP;
    rowMaxHeight = Math.max(rowMaxHeight, n.height);

    return {
      ...n,
      x: snapToGrid(nodeX),
      y: snapToGrid(nodeY),
    };
  });
}

/**
 * Dissolve a band into independent members laid out side by side
 */
export function layOutDissolvedBandMembers(
  band: Band,
  allNodes: CanvasNode[]
): CanvasNode[] {
  const memberNodes = allNodes.filter((n) => band.memberNodeIds.includes(n.id));
  if (memberNodes.length === 0) return allNodes;

  let currentX = band.bounds.x;
  const currentY = band.bounds.y;
  const GAP = 30;

  const movedMembersMap = new Map<string, { x: number; y: number }>();

  memberNodes.forEach((node) => {
    movedMembersMap.set(node.id, {
      x: snapToGrid(currentX),
      y: snapToGrid(currentY),
    });
    currentX += node.width + GAP;
  });

  return allNodes.map((n) => {
    const pos = movedMembersMap.get(n.id);
    return pos ? { ...n, x: pos.x, y: pos.y } : n;
  });
}

/**
 * Spill a noteStack into individual sticky notes side by side on the canvas
 */
export function noteStackSpill(
  stackNode: CanvasNode,
  allNodes: CanvasNode[]
): { updatedNodes: CanvasNode[]; createdNotes: CanvasNode[] } {
  const content = (stackNode as any).content || {};
  const pages = content.pages || [];
  if (pages.length === 0) {
    return { updatedNodes: allNodes, createdNotes: [] };
  }

  const startX = stackNode.x + stackNode.width + 30;
  const startY = stackNode.y;
  const NOTE_W = 280;
  const NOTE_H = 280;
  const GAP = 30;

  const createdNotes: CanvasNode[] = pages.map((page: any, idx: number) => ({
    id: `node-spilled-${Date.now()}-${idx}`,
    kind: 'note',
    x: snapToGrid(startX + idx * (NOTE_W + GAP)),
    y: snapToGrid(startY),
    width: NOTE_W,
    height: NOTE_H,
    zIndex: (stackNode.zIndex || 10) + idx + 1,
    content: {
      noteId: `note-spilled-${Date.now()}-${idx}`,
      title: page.title || `Note ${idx + 1}`,
      body: page.body || '',
      color: page.color || 'yellow',
      isNamePinned: false,
      stackId: null,
    },
  }));

  // Remove the old stack node and append the newly created sticky notes
  const updatedNodes = allNodes
    .filter((n) => n.id !== stackNode.id)
    .concat(createdNotes);

  return { updatedNodes, createdNotes };
}
