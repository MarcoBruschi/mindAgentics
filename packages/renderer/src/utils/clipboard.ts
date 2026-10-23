import { CanvasNode, CableTie, Band } from '@maestri/shared';
import { snapToGrid } from './layout';

export const PARTITURA_MIME = 'application/x-maestri-partitura';
export const PASTE_CASCADE_PX = 30;

export interface PartituraV2ClipboardPayload {
  type: 'application/x-maestri-partitura';
  version: 2;
  nodes: CanvasNode[];
  cableTies: CableTie[];
  bands?: Band[];
}

/**
 * Checks if a string is a valid web URL
 */
export function isWebUrl(str: string): boolean {
  if (!str) return false;
  const trimmed = str.trim();
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Serializes canvas selection into Partitura v2 format
 */
export function serializeCanvasSelection(
  selectedNodes: CanvasNode[],
  allTies: CableTie[],
  allBands: Band[]
): string {
  const selectedNodeIds = new Set(selectedNodes.map((n) => n.id));

  // Only include cable ties where both endpoints are selected
  const matchingTies = allTies.filter(
    (t) => selectedNodeIds.has(t.fromNodeId) && selectedNodeIds.has(t.toNodeId)
  );

  // Include bands whose member nodes are in selection
  const matchingBands = allBands.filter((b) =>
    b.memberNodeIds.some((id) => selectedNodeIds.has(id))
  );

  const payload: PartituraV2ClipboardPayload = {
    type: PARTITURA_MIME,
    version: 2,
    nodes: selectedNodes,
    cableTies: matchingTies,
    bands: matchingBands,
  };

  return JSON.stringify(payload, null, 2);
}

/**
 * Attempts to parse text as a Partitura v2 clipboard payload
 */
export function parsePartituraPayload(
  rawText: string
): PartituraV2ClipboardPayload | null {
  try {
    const parsed = JSON.parse(rawText);
    if (
      parsed &&
      (parsed.type === PARTITURA_MIME || parsed.version === 2) &&
      Array.isArray(parsed.nodes)
    ) {
      return parsed as PartituraV2ClipboardPayload;
    }
  } catch {}
  return null;
}

/**
 * Remaps all IDs in a pasted Partitura payload and offsets them
 */
export function remapPastedCanvasElements(
  payload: PartituraV2ClipboardPayload,
  offsetPosition?: { x: number; y: number }
): {
  nodes: CanvasNode[];
  cableTies: CableTie[];
  bands: Band[];
} {
  const idMap = new Map<string, string>();
  const now = Date.now();

  // Calculate delta if offsetPosition is provided
  let dx = PASTE_CASCADE_PX;
  let dy = PASTE_CASCADE_PX;

  if (offsetPosition && payload.nodes.length > 0) {
    const minX = Math.min(...payload.nodes.map((n) => n.x));
    const minY = Math.min(...payload.nodes.map((n) => n.y));
    dx = snapToGrid(offsetPosition.x - minX);
    dy = snapToGrid(offsetPosition.y - minY);
  }

  const remappedNodes: CanvasNode[] = payload.nodes.map((node, index) => {
    const newId = `node-pasted-${now}-${index}-${Math.random().toString(36).slice(2, 7)}`;
    idMap.set(node.id, newId);

    // Deep clone content to prevent shared mutations
    const clonedContent = JSON.parse(JSON.stringify(node.content || {}));
    if (clonedContent.terminalId) {
      clonedContent.terminalId = `term-${now}-${index}`;
    }
    if (clonedContent.noteId) {
      clonedContent.noteId = `note-${now}-${index}`;
    }
    if (clonedContent.stackId) {
      clonedContent.stackId = `stack-${now}-${index}`;
    }

    return {
      ...node,
      id: newId,
      x: snapToGrid(node.x + dx),
      y: snapToGrid(node.y + dy),
      zIndex: (node.zIndex || 10) + 1,
      content: clonedContent,
    };
  });

  const remappedTies: CableTie[] = (payload.cableTies || [])
    .filter((tie) => idMap.has(tie.fromNodeId) && idMap.has(tie.toNodeId))
    .map((tie, index) => ({
      ...tie,
      id: `tie-pasted-${now}-${index}`,
      fromNodeId: idMap.get(tie.fromNodeId)!,
      toNodeId: idMap.get(tie.toNodeId)!,
    }));

  const remappedBands: Band[] = (payload.bands || []).map((band, index) => ({
    ...band,
    id: `band-pasted-${now}-${index}`,
    bounds: {
      ...band.bounds,
      x: snapToGrid(band.bounds.x + dx),
      y: snapToGrid(band.bounds.y + dy),
    },
    memberNodeIds: band.memberNodeIds
      .map((oldId) => idMap.get(oldId))
      .filter((newId): newId is string => Boolean(newId)),
  }));

  return {
    nodes: remappedNodes,
    cableTies: remappedTies,
    bands: remappedBands,
  };
}
