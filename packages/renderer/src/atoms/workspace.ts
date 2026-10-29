import { atom } from 'jotai';
import { Workspace, Floor, CanvasNode, CableTie, Band, DrawingStroke } from '@mindagentics/shared';

// Initial clean workspace
export const initialWorkspace: Workspace = {
  id: 'workspace-main',
  name: 'Main Workspace',
  workingDirectory: 'C:\\Users\\mabru\\Documents\\mindAgentics',
  preferredIde: 'vscode',
  floors: [
    {
      id: 'floor-main',
      name: 'Canvas',
      isGround: true,
      workingDirectory: 'C:\\Users\\mabru\\Documents\\mindAgentics',
      gitBranch: 'main',
      status: null,
      nodes: [],
      cableTies: [],
      bands: [],
      drawings: [],
    },
  ],
};

/**
 * Normalizes any workspace payload (including original mindAgentics disk format)
 * so that it always has a valid `floors` array and never throws undefined errors.
 */
export function normalizeWorkspace(raw: any): Workspace {
  if (!raw || typeof raw !== 'object') {
    return initialWorkspace;
  }

  const id = raw.id || `workspace-${Date.now()}`;
  const name = raw.name || 'Workspace';
  const workingDirectory = raw.workingDirectory || 'C:\\Users\\mabru\\Documents\\mindAgentics';
  const preferredIde = raw.preferredIde || 'vscode';

  // Extract saved canvasOffset or convert from legacy canvasOrigin
  let canvasOffset: { x: number; y: number; zoom: number } | undefined = raw.canvasOffset || raw.viewport;
  if (!canvasOffset && Array.isArray(raw.canvasOrigin) && raw.canvasOrigin.length >= 2) {
    const origX = raw.canvasOrigin[0];
    const origY = raw.canvasOrigin[1];
    const zoom = raw.canvasZoom || 1.0;
    canvasOffset = {
      x: Math.round(-origX * zoom + 600),
      y: Math.round(-origY * zoom + 350),
      zoom: Number(zoom.toFixed(2)),
    };
  }

  const normalizeNode = (n: any): CanvasNode => {
    let x = n.x ?? 100;
    let y = n.y ?? 100;
    let width = n.width ?? 680;
    let height = n.height ?? 480;

    if (Array.isArray(n.frame)) {
      x = n.frame[0]?.[0] ?? x;
      y = n.frame[0]?.[1] ?? y;
      width = n.frame[1]?.[0] ?? width;
      height = n.frame[1]?.[1] ?? height;
    }

    let kind = n.kind || 'terminal';
    let content = n.content || {};

    if (n.content?.terminal) {
      kind = 'terminal';
      const t = n.content.terminal._0 || n.content.terminal;
      content = {
        terminalId: t.id || n.id,
        title: t.name || 'Terminal',
        command: t.command || '',
        workingDirectory: t.workingDirectory || workingDirectory,
        status: t.status,
        color: t.color,
        fontSize: t.fontSize,
        isAutonomous: true,
        agentRole: t.agentType || 'Developer',
        maestroMode: Boolean(t.maestroMode),
      };
    } else if (n.content?.stickyNote) {
      kind = 'note';
      const s = n.content.stickyNote._0 || n.content.stickyNote;
      content = {
        noteId: n.id,
        title: s.fileName || 'Note',
        color: s.color || 'yellow',
        body: s.text || '',
      };
    } else if (n.content?.browser) {
      kind = 'portal';
      const b = n.content.browser._0 || n.content.browser;
      content = {
        portalKind: 'browser',
        url: b.url || '',
        viewport: { width: 1280, height: 800 },
        actionTags: [],
      };
    } else if (kind === 'terminal') {
      if (!content.terminalId) {
        content.terminalId = n.id;
      }
    }

    return {
      id: n.id || `node-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      kind,
      x,
      y,
      width,
      height,
      zIndex: n.zIndex ?? 10,
      content,
    };
  };

  const rawLegacyNodes = Array.isArray(raw.nodes) ? raw.nodes.map(normalizeNode) : [];

  if (Array.isArray(raw.floors) && raw.floors.length > 0) {
    return {
      ...raw,
      id,
      name,
      workingDirectory,
      preferredIde,
      canvasOffset,
      floors: raw.floors.map((f: any, idx: number) => {
        let fNodes: CanvasNode[] = [];
        if (Array.isArray(f?.nodes) && f.nodes.length > 0) {
          fNodes = f.nodes.map(normalizeNode);
        } else if (idx === 0 && rawLegacyNodes.length > 0) {
          fNodes = rawLegacyNodes;
        }

        let fTies: CableTie[] = [];
        if (Array.isArray(f?.cableTies) && f.cableTies.length > 0) {
          fTies = f.cableTies;
        } else if (idx === 0 && Array.isArray(raw.connections)) {
          fTies = raw.connections.map((c: any) => ({
            id: c.id || `tie-${Date.now()}`,
            fromNodeId: c.terminalIdA || c.fromNodeId || '',
            toNodeId: c.terminalIdB || c.toNodeId || '',
            label: c.label || '',
          }));
        }

        return {
          id: f?.id || `floor-${idx}`,
          name: f?.name || (idx === 0 ? 'Canvas' : `Floor ${idx + 1}`),
          isGround: f?.isGround ?? idx === 0,
          workingDirectory: f?.workingDirectory || workingDirectory,
          gitBranch: f?.gitBranch || 'main',
          status: f?.status || null,
          nodes: fNodes,
          cableTies: fTies,
          bands: Array.isArray(f?.bands) ? f.bands : [],
          drawings: Array.isArray(f?.drawings) ? f.drawings : [],
        };
      }),
    };
  }

  let cableTies: any[] = [];
  if (Array.isArray(raw.connections)) {
    cableTies = raw.connections.map((c: any) => ({
      id: c.id || `tie-${Date.now()}`,
      fromNodeId: c.terminalIdA || c.fromNodeId || '',
      toNodeId: c.terminalIdB || c.toNodeId || '',
      label: c.label || '',
    }));
  }

  const groundFloor: Floor = {
    id: `floor-${id}`,
    name: 'Canvas',
    isGround: true,
    workingDirectory,
    gitBranch: 'main',
    status: null,
    nodes: rawLegacyNodes,
    cableTies,
    bands: Array.isArray(raw.bands) ? raw.bands : [],
    drawings: Array.isArray(raw.drawings) ? raw.drawings : [],
  };

  return {
    id,
    name,
    workingDirectory,
    preferredIde,
    canvasOffset,
    floors: [groundFloor],
  };
}

// Clean up any legacy giant workspaces cache from localStorage to prevent QuotaExceededError
try {
  localStorage.removeItem('mindagentics_workspaces');
  localStorage.removeItem('maestri_workspaces');
} catch {
  // ignore
}

const getSavedActiveId = (): string => {
  try {
    const saved = localStorage.getItem('mindagentics_active_ws') || localStorage.getItem('maestri_active_ws');
    if (saved) return saved;
  } catch {
    // fallback
  }
  return 'workspace-main';
};

export const workspacesAtom = atom<Workspace[]>([initialWorkspace]);

export const activeWorkspaceIdAtom = atom<string>(getSavedActiveId());

export const activeFloorIdAtom = atom<string>('floor-main');

// ==========================================
// Undo / Redo History Atoms & Transactional Groups
// Section 4 of mindAgentics Interaction Model
// ==========================================
export const MAX_UNDO_LEVELS = 50;

export interface CanvasFloorSnapshot {
  nodes: CanvasNode[];
  cableTies: CableTie[];
  bands: Band[];
  drawings: DrawingStroke[];
}

export const undoStackAtom = atom<CanvasFloorSnapshot[]>([]);
export const redoStackAtom = atom<CanvasFloorSnapshot[]>([]);
export const undoGroupDepthAtom = atom<number>(0);
export const undoGroupPushedAtom = atom<boolean>(false);

export const beginUndoGroupAtom = atom(null, (get, set) => {
  const depth = get(undoGroupDepthAtom);
  if (depth === 0) {
    set(undoGroupPushedAtom, false);
  }
  set(undoGroupDepthAtom, depth + 1);
});

export const endUndoGroupAtom = atom(null, (get, set) => {
  const depth = get(undoGroupDepthAtom);
  const nextDepth = Math.max(0, depth - 1);
  set(undoGroupDepthAtom, nextDepth);
  if (nextDepth === 0) {
    set(undoGroupPushedAtom, false);
  }
});

export const pushSnapshotAtom = atom(
  null,
  (get, set, snapshot: CanvasFloorSnapshot) => {
    const depth = get(undoGroupDepthAtom);
    const alreadyPushed = get(undoGroupPushedAtom);

    if (depth > 0) {
      if (alreadyPushed) {
        return;
      }
      set(undoGroupPushedAtom, true);
    }

    const currentUndo = get(undoStackAtom);
    set(undoStackAtom, [...currentUndo.slice(-(MAX_UNDO_LEVELS - 1)), snapshot]);
    set(redoStackAtom, []);
  }
);

/**
 * Reconciles live terminal processes so that undo/redo restores positions
 * and geometry without disconnecting active background processes or PTY sessions.
 */
function keepingLiveTerminals(restoredNodes: CanvasNode[], currentNodes: CanvasNode[]): CanvasNode[] {
  const liveMap = new Map<string, CanvasNode>();
  for (const n of currentNodes) {
    if (n.kind === 'terminal') {
      liveMap.set(n.id, n);
    }
  }

  return restoredNodes.map((n) => {
    if (n.kind === 'terminal') {
      const live = liveMap.get(n.id);
      if (live && live.content) {
        return {
          ...n,
          content: {
            ...n.content,
            status: (live.content as any)?.status ?? (n.content as any)?.status,
          },
        };
      }
    }
    return n;
  });
}

export const undoAtom = atom(null, (get, set) => {
  const floor = get(activeFloorAtom);
  const workspace = get(activeWorkspaceAtom);
  const undoStack = get(undoStackAtom);
  if (!floor || !workspace || !Array.isArray(workspace.floors) || undoStack.length === 0) return;

  const currentSnapshot: CanvasFloorSnapshot = {
    nodes: floor.nodes || [],
    cableTies: floor.cableTies || [],
    bands: floor.bands || [],
    drawings: floor.drawings || [],
  };

  const previousSnapshot = undoStack[undoStack.length - 1];
  set(undoStackAtom, undoStack.slice(0, -1));
  set(redoStackAtom, (prev) => [...prev, currentSnapshot]);

  const reconciledNodes = keepingLiveTerminals(previousSnapshot.nodes || [], floor.nodes || []);
  const restoredSnapshot: CanvasFloorSnapshot = {
    ...previousSnapshot,
    nodes: reconciledNodes,
  };

  const updatedFloors = workspace.floors.map((f) =>
    f.id === floor.id ? { ...f, ...restoredSnapshot } : f
  );
  const updatedWorkspaces = get(workspacesAtom).map((w) =>
    w.id === workspace.id ? { ...w, floors: updatedFloors } : w
  );
  set(workspacesAtom, updatedWorkspaces);
});

export const redoAtom = atom(null, (get, set) => {
  const floor = get(activeFloorAtom);
  const workspace = get(activeWorkspaceAtom);
  const redoStack = get(redoStackAtom);
  if (!floor || !workspace || !Array.isArray(workspace.floors) || redoStack.length === 0) return;

  const currentSnapshot: CanvasFloorSnapshot = {
    nodes: floor.nodes || [],
    cableTies: floor.cableTies || [],
    bands: floor.bands || [],
    drawings: floor.drawings || [],
  };

  const nextSnapshot = redoStack[redoStack.length - 1];
  set(redoStackAtom, redoStack.slice(0, -1));
  set(undoStackAtom, (prev) => [...prev, currentSnapshot]);

  const reconciledNodes = keepingLiveTerminals(nextSnapshot.nodes || [], floor.nodes || []);
  const restoredSnapshot: CanvasFloorSnapshot = {
    ...nextSnapshot,
    nodes: reconciledNodes,
  };

  const updatedFloors = workspace.floors.map((f) =>
    f.id === floor.id ? { ...f, ...restoredSnapshot } : f
  );
  const updatedWorkspaces = get(workspacesAtom).map((w) =>
    w.id === workspace.id ? { ...w, floors: updatedFloors } : w
  );
  set(workspacesAtom, updatedWorkspaces);
});

// ==========================================
// Derived atoms with bulletproof null safety
// ==========================================
export const activeWorkspaceAtom = atom<Workspace | null>((get) => {
  const workspaces = get(workspacesAtom);
  if (!workspaces || !Array.isArray(workspaces) || workspaces.length === 0) return null;
  const activeId = get(activeWorkspaceIdAtom);
  return workspaces.find((w) => w && w.id === activeId) || workspaces[0] || null;
});

export const activeFloorAtom = atom<Floor | null>((get) => {
  const workspace = get(activeWorkspaceAtom);
  if (!workspace || !workspace.floors || !Array.isArray(workspace.floors) || workspace.floors.length === 0) {
    return null;
  }
  const activeFloorId = get(activeFloorIdAtom);
  return (
    workspace.floors.find((f) => f && f.id === activeFloorId) ||
    workspace.floors[0] ||
    null
  );
});

/**
 * Detects if an update between previous nodes and next nodes is purely ephemeral
 * (such as PTY terminal status changes: 'working', 'idle', 'attention', hasAttention),
 * which should not create undo/redo history snapshots.
 */
function isEphemeralNodeUpdate(prevNodes: CanvasNode[], nextNodes: CanvasNode[]): boolean {
  if (prevNodes === nextNodes) return true;
  if (!Array.isArray(prevNodes) || !Array.isArray(nextNodes)) return false;
  if (prevNodes.length !== nextNodes.length) return false;

  for (let i = 0; i < prevNodes.length; i++) {
    const prev = prevNodes[i];
    const next = nextNodes[i];

    if (!prev || !next) return false;
    if (prev.id !== next.id || prev.kind !== next.kind) {
      return false;
    }

    if (
      prev.x !== next.x ||
      prev.y !== next.y ||
      prev.width !== next.width ||
      prev.height !== next.height ||
      prev.zIndex !== next.zIndex
    ) {
      return false;
    }

    if (prev.kind !== 'terminal') {
      if (prev.content !== next.content) {
        return false;
      }
    } else {
      if (prev.content !== next.content) {
        const prevContent = (prev.content || {}) as Record<string, any>;
        const nextContent = (next.content || {}) as Record<string, any>;

        const allKeys = new Set([...Object.keys(prevContent), ...Object.keys(nextContent)]);
        for (const key of allKeys) {
          if (key === 'status' || key === 'hasAttention') {
            continue;
          }
          if (prevContent[key] !== nextContent[key]) {
            return false;
          }
        }
      }
    }
  }

  return true;
}

export const pushUndoSnapshotAtom = pushSnapshotAtom;

// ==========================================
// Writable proxy atoms with automatic history capture
// ==========================================
export const nodesAtom = atom(
  (get) => {
    const floor = get(activeFloorAtom);
    return floor && floor.nodes && Array.isArray(floor.nodes) ? floor.nodes : [];
  },
  (get, set, update: CanvasNode[] | ((prev: CanvasNode[]) => CanvasNode[])) => {
    const floor = get(activeFloorAtom);
    const workspace = get(activeWorkspaceAtom);
    if (!floor || !workspace || !Array.isArray(workspace.floors)) return;

    const currentNodes = floor.nodes || [];
    const newNodes = typeof update === 'function' ? update(currentNodes) : update;

    // Filter ephemeral status events: ensure PTY terminal status changes do not trigger undo snapshot
    if (!isEphemeralNodeUpdate(currentNodes, newNodes)) {
      const snapshot: CanvasFloorSnapshot = {
        nodes: currentNodes ? [...currentNodes] : [],
        cableTies: floor.cableTies ? [...floor.cableTies] : [],
        bands: floor.bands ? [...floor.bands] : [],
        drawings: floor.drawings ? [...floor.drawings] : [],
      };
      set(pushSnapshotAtom, snapshot);
    }

    const updatedFloors = workspace.floors.map((f) =>
      f.id === floor.id ? { ...f, nodes: newNodes } : f
    );
    const updatedWorkspaces = get(workspacesAtom).map((w) =>
      w.id === workspace.id ? { ...w, floors: updatedFloors } : w
    );
    set(workspacesAtom, updatedWorkspaces);
  }
);

export const cableTiesAtom = atom(
  (get) => {
    const floor = get(activeFloorAtom);
    return floor && floor.cableTies && Array.isArray(floor.cableTies) ? floor.cableTies : [];
  },
  (get, set, update: CableTie[] | ((prev: CableTie[]) => CableTie[])) => {
    const floor = get(activeFloorAtom);
    const workspace = get(activeWorkspaceAtom);
    if (!floor || !workspace || !Array.isArray(workspace.floors)) return;

    const snapshot: CanvasFloorSnapshot = {
      nodes: floor.nodes ? [...floor.nodes] : [],
      cableTies: floor.cableTies ? [...floor.cableTies] : [],
      bands: floor.bands ? [...floor.bands] : [],
      drawings: floor.drawings ? [...floor.drawings] : [],
    };
    set(pushSnapshotAtom, snapshot);

    const currentTies = floor.cableTies || [];
    const newTies = typeof update === 'function' ? update(currentTies) : update;
    const updatedFloors = workspace.floors.map((f) =>
      f.id === floor.id ? { ...f, cableTies: newTies } : f
    );
    const updatedWorkspaces = get(workspacesAtom).map((w) =>
      w.id === workspace.id ? { ...w, floors: updatedFloors } : w
    );
    set(workspacesAtom, updatedWorkspaces);
  }
);

export const bandsAtom = atom(
  (get) => {
    const floor = get(activeFloorAtom);
    return floor && floor.bands && Array.isArray(floor.bands) ? floor.bands : [];
  },
  (get, set, update: Band[] | ((prev: Band[]) => Band[])) => {
    const floor = get(activeFloorAtom);
    const workspace = get(activeWorkspaceAtom);
    if (!floor || !workspace || !Array.isArray(workspace.floors)) return;

    const snapshot: CanvasFloorSnapshot = {
      nodes: floor.nodes ? [...floor.nodes] : [],
      cableTies: floor.cableTies ? [...floor.cableTies] : [],
      bands: floor.bands ? [...floor.bands] : [],
      drawings: floor.drawings ? [...floor.drawings] : [],
    };
    set(pushSnapshotAtom, snapshot);

    const currentBands = floor.bands || [];
    const newBands = typeof update === 'function' ? update(currentBands) : update;
    const updatedFloors = workspace.floors.map((f) =>
      f.id === floor.id ? { ...f, bands: newBands } : f
    );
    const updatedWorkspaces = get(workspacesAtom).map((w) =>
      w.id === workspace.id ? { ...w, floors: updatedFloors } : w
    );
    set(workspacesAtom, updatedWorkspaces);
  }
);

export const drawingsAtom = atom(
  (get) => {
    const floor = get(activeFloorAtom);
    return floor && floor.drawings && Array.isArray(floor.drawings) ? floor.drawings : [];
  },
  (get, set, update: DrawingStroke[] | ((prev: DrawingStroke[]) => DrawingStroke[])) => {
    const floor = get(activeFloorAtom);
    const workspace = get(activeWorkspaceAtom);
    if (!floor || !workspace || !Array.isArray(workspace.floors)) return;

    const snapshot: CanvasFloorSnapshot = {
      nodes: floor.nodes ? [...floor.nodes] : [],
      cableTies: floor.cableTies ? [...floor.cableTies] : [],
      bands: floor.bands ? [...floor.bands] : [],
      drawings: floor.drawings ? [...floor.drawings] : [],
    };
    set(pushSnapshotAtom, snapshot);

    const currentDrawings = floor.drawings || [];
    const newDrawings =
      typeof update === 'function' ? update(currentDrawings) : update;
    const updatedFloors = workspace.floors.map((f) =>
      f.id === floor.id ? { ...f, drawings: newDrawings } : f
    );
    const updatedWorkspaces = get(workspacesAtom).map((w) =>
      w.id === workspace.id ? { ...w, floors: updatedFloors } : w
    );
    set(workspacesAtom, updatedWorkspaces);
  }
);

/**
 * Patch frames of multiple nodes atomically inside a single undo step
 */
export const patchFramesAtom = atom(
  null,
  (
    get,
    set,
    updates: Array<{ id: string; x?: number; y?: number; width?: number; height?: number }>
  ) => {
    const floor = get(activeFloorAtom);
    const workspace = get(activeWorkspaceAtom);
    if (!floor || !workspace || !Array.isArray(workspace.floors)) return;

    const snapshot: CanvasFloorSnapshot = {
      nodes: floor.nodes ? [...floor.nodes] : [],
      cableTies: floor.cableTies ? [...floor.cableTies] : [],
      bands: floor.bands ? [...floor.bands] : [],
      drawings: floor.drawings ? [...floor.drawings] : [],
    };
    set(pushSnapshotAtom, snapshot);

    const updateMap = new Map(updates.map((u) => [u.id, u]));
    const newNodes = (floor.nodes || []).map((node) => {
      const patch = updateMap.get(node.id);
      if (!patch) return node;
      return {
        ...node,
        x: patch.x !== undefined ? patch.x : node.x,
        y: patch.y !== undefined ? patch.y : node.y,
        width: patch.width !== undefined ? patch.width : node.width,
        height: patch.height !== undefined ? patch.height : node.height,
      };
    });

    const updatedFloors = workspace.floors.map((f) =>
      f.id === floor.id ? { ...f, nodes: newNodes } : f
    );
    const updatedWorkspaces = get(workspacesAtom).map((w) =>
      w.id === workspace.id ? { ...w, floors: updatedFloors } : w
    );
    set(workspacesAtom, updatedWorkspaces);
  }
);
