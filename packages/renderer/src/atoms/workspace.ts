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
 * Normalizes any workspace payload (including original Maestri disk format)
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

  if (Array.isArray(raw.floors) && raw.floors.length > 0) {
    return {
      ...raw,
      id,
      name,
      workingDirectory,
      preferredIde,
      floors: raw.floors.map((f: any, idx: number) => ({
        id: f?.id || `floor-${idx}`,
        name: f?.name || (idx === 0 ? 'Canvas' : `Floor ${idx + 1}`),
        isGround: f?.isGround ?? idx === 0,
        workingDirectory: f?.workingDirectory || workingDirectory,
        gitBranch: f?.gitBranch || 'main',
        status: f?.status || null,
        nodes: Array.isArray(f?.nodes) ? f.nodes : [],
        cableTies: Array.isArray(f?.cableTies) ? f.cableTies : [],
        bands: Array.isArray(f?.bands) ? f.bands : [],
        drawings: Array.isArray(f?.drawings) ? f.drawings : [],
      })),
    };
  }

  // Convert raw Maestri disk workspace format (nodes and connections directly on payload)
  let nodes: any[] = [];
  if (Array.isArray(raw.nodes)) {
    nodes = raw.nodes.map((n: any) => {
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
        };
      } else if (n.content?.stickyNote) {
        kind = 'note';
        const s = n.content.stickyNote._0 || n.content.stickyNote;
        content = {
          noteId: n.id,
          title: s.fileName || 'Note',
          color: s.color || 'yellow',
          content: '',
        };
      }

      return {
        id: n.id || `node-${Date.now()}`,
        kind,
        x,
        y,
        width,
        height,
        zIndex: n.zIndex ?? 10,
        content,
      };
    });
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
    nodes,
    cableTies,
    bands: Array.isArray(raw.bands) ? raw.bands : [],
    drawings: Array.isArray(raw.drawings) ? raw.drawings : [],
  };

  return {
    id,
    name,
    workingDirectory,
    preferredIde,
    floors: [groundFloor],
  };
}

// Load saved workspaces from localStorage as instant synchronous cache
const getSavedWorkspaces = (): Workspace[] => {
  try {
    const raw = localStorage.getItem('mindagentics_workspaces') || localStorage.getItem('maestri_workspaces');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map(normalizeWorkspace);
      }
    }
  } catch {
    // fallback
  }
  return [initialWorkspace];
};

const getSavedActiveId = (): string => {
  try {
    const saved = localStorage.getItem('mindagentics_active_ws') || localStorage.getItem('maestri_active_ws');
    if (saved) return saved;
  } catch {
    // fallback
  }
  return 'workspace-main';
};

export const workspacesAtom = atom<Workspace[]>(getSavedWorkspaces());

export const activeWorkspaceIdAtom = atom<string>(getSavedActiveId());

export const activeFloorIdAtom = atom<string>('floor-main');

// ==========================================
// Undo / Redo History Atoms & Transactional Groups
// Section 4 of Maestri Interaction Model
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

    const snapshot: CanvasFloorSnapshot = {
      nodes: floor.nodes ? [...floor.nodes] : [],
      cableTies: floor.cableTies ? [...floor.cableTies] : [],
      bands: floor.bands ? [...floor.bands] : [],
      drawings: floor.drawings ? [...floor.drawings] : [],
    };
    set(pushSnapshotAtom, snapshot);

    const currentNodes = floor.nodes || [];
    const newNodes = typeof update === 'function' ? update(currentNodes) : update;
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
