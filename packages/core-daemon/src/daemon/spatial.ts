/**
 * Spatial Algorithms for Canvas Layout
 * - snapNode: snaps bounds to neighboring nodes and grid
 * - tidyNode: calculates optimal flow spacing without overlaps
 * - placeNode: finds open spatial coordinates on canvas
 */

import type {
  NodeBounds,
  CanvasNode,
  SnapNodePayload,
  SnapNodeResult,
  TidyNodePayload,
  TidyNodeResult,
  PlaceNodePayload,
  PlaceNodeResult,
} from '@mindagentics/shared';

export function snapNode(payload: SnapNodePayload): SnapNodeResult {
  const { bounds, otherNodes, gridSize = 20, snapThreshold = 12 } = payload;
  let snappedX = bounds.x;
  let snappedY = bounds.y;
  let didSnapX = false;
  let didSnapY = false;
  let snappedNodeId: string | undefined = undefined;

  let minDiffX = snapThreshold;
  let minDiffY = snapThreshold;

  // 1. Snap to other nodes (left, center, right, top, center, bottom)
  const nodeRight = bounds.x + bounds.width;
  const nodeBottom = bounds.y + bounds.height;
  const nodeCenterX = bounds.x + bounds.width / 2;
  const nodeCenterY = bounds.y + bounds.height / 2;

  for (const other of otherNodes) {
    const oRight = other.x + other.width;
    const oBottom = other.y + other.height;
    const oCenterX = other.x + other.width / 2;
    const oCenterY = other.y + other.height / 2;

    // Check horizontal alignments
    const xAlignments = [
      { target: other.x, current: bounds.x }, // Left-to-Left
      { target: oRight, current: bounds.x },   // Left-to-Right
      { target: other.x, current: nodeRight, isRight: true }, // Right-to-Left
      { target: oRight, current: nodeRight, isRight: true },   // Right-to-Right
      { target: oCenterX, current: nodeCenterX, isCenter: true },
    ];

    for (const align of xAlignments) {
      const diff = Math.abs(align.current - align.target);
      if (diff < minDiffX) {
        minDiffX = diff;
        if (align.isRight) {
          snappedX = align.target - bounds.width;
        } else if (align.isCenter) {
          snappedX = align.target - bounds.width / 2;
        } else {
          snappedX = align.target;
        }
        didSnapX = true;
      }
    }

    // Check vertical alignments
    const yAlignments = [
      { target: other.y, current: bounds.y }, // Top-to-Top
      { target: oBottom, current: bounds.y }, // Top-to-Bottom
      { target: other.y, current: nodeBottom, isBottom: true }, // Bottom-to-Top
      { target: oBottom, current: nodeBottom, isBottom: true }, // Bottom-to-Bottom
      { target: oCenterY, current: nodeCenterY, isCenter: true },
    ];

    for (const align of yAlignments) {
      const diff = Math.abs(align.current - align.target);
      if (diff < minDiffY) {
        minDiffY = diff;
        if (align.isBottom) {
          snappedY = align.target - bounds.height;
        } else if (align.isCenter) {
          snappedY = align.target - bounds.height / 2;
        } else {
          snappedY = align.target;
        }
        didSnapY = true;
      }
    }
  }

  // 2. Fallback snap to grid
  if (!didSnapX && gridSize > 0) {
    const gridX = Math.round(bounds.x / gridSize) * gridSize;
    if (Math.abs(gridX - bounds.x) <= snapThreshold) {
      snappedX = gridX;
      didSnapX = true;
    }
  }

  if (!didSnapY && gridSize > 0) {
    const gridY = Math.round(bounds.y / gridSize) * gridSize;
    if (Math.abs(gridY - bounds.y) <= snapThreshold) {
      snappedY = gridY;
      didSnapY = true;
    }
  }

  return {
    x: Math.round(snappedX),
    y: Math.round(snappedY),
    snappedX: didSnapX,
    snappedY: didSnapY,
    snappedToNodeId: snappedNodeId,
  };
}

export function tidyNode(payload: TidyNodePayload): TidyNodeResult {
  const { nodes, nodeIds, padding = 40, startX = 100, startY = 100 } = payload;
  const targetNodes = nodeIds
    ? nodes.filter((n) => nodeIds.includes(n.id))
    : [...nodes];

  if (targetNodes.length === 0) {
    return { updatedNodes: [] };
  }

  // Sort nodes by their current positions (top to bottom, left to right)
  targetNodes.sort((a, b) => {
    if (Math.abs(a.y - b.y) > 50) return a.y - b.y;
    return a.x - b.x;
  });

  const updatedNodes: Array<{ id: string; x: number; y: number }> = [];

  // Determine grid layout based on count
  const cols = payload.columns ?? Math.max(1, Math.ceil(Math.sqrt(targetNodes.length)));

  let curX = startX;
  let curY = startY;
  let maxHeightInRow = 0;
  let colIndex = 0;

  for (const node of targetNodes) {
    updatedNodes.push({
      id: node.id,
      x: curX,
      y: curY,
    });

    maxHeightInRow = Math.max(maxHeightInRow, node.height);
    colIndex++;

    if (colIndex >= cols) {
      colIndex = 0;
      curX = startX;
      curY += maxHeightInRow + padding;
      maxHeightInRow = 0;
    } else {
      curX += node.width + padding;
    }
  }

  return { updatedNodes };
}

function boxesOverlap(
  x1: number,
  y1: number,
  w1: number,
  h1: number,
  x2: number,
  y2: number,
  w2: number,
  h2: number,
  margin = 20,
): boolean {
  return !(
    x1 + w1 + margin <= x2 ||
    x2 + w2 + margin <= x1 ||
    y1 + h1 + margin <= y2 ||
    y2 + h2 + margin <= y1
  );
}

export function placeNode(payload: PlaceNodePayload): PlaceNodeResult {
  const {
    width,
    height,
    existingNodes,
    preferredX,
    preferredY,
    anchorNodeId,
    placementDirection = 'right',
  } = payload;

  const anchor = anchorNodeId
    ? existingNodes.find((n) => n.id === anchorNodeId)
    : undefined;

  let originX = preferredX ?? 100;
  let originY = preferredY ?? 100;

  if (anchor) {
    if (placementDirection === 'right') {
      originX = anchor.x + anchor.width + 40;
      originY = anchor.y;
    } else if (placementDirection === 'below') {
      originX = anchor.x;
      originY = anchor.y + anchor.height + 40;
    } else {
      originX = anchor.x + anchor.width + 40;
      originY = anchor.y;
    }
  }

  let candidateX = originX;
  let candidateY = originY;
  const step = 40;
  const maxAttempts = 200;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const hasCollision = existingNodes.some((node) =>
      boxesOverlap(candidateX, candidateY, width, height, node.x, node.y, node.width, node.height),
    );

    if (!hasCollision) {
      return { x: Math.round(candidateX), y: Math.round(candidateY) };
    }

    // Try shifting right or cascading down
    if (attempt % 5 === 4) {
      candidateX = originX;
      candidateY += height + step;
    } else {
      candidateX += step;
    }
  }

  return { x: Math.round(originX), y: Math.round(originY) };
}
