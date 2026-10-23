/**
 * Spatial coordinate and bounds on the infinite mindAgentics canvas.
 */
export interface CanvasBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Visual CableTie wiring two nodes on the canvas.
 */
export interface CableTie {
  /** Unique connection identifier */
  id: string;
  /** Origin node ID or agent name */
  fromNodeId: string;
  /** Destination node ID, sticky note name, or portal title */
  toNodeId: string;
  /** Visual presentation style */
  style?: 'solid' | 'dashed' | 'accent';
  /** Optional descriptive label attached to the wire */
  label?: string;
}

/**
 * Sticky note node on the canvas.
 */
export interface StickyNote {
  id: string;
  name: string;
  content: string;
  color?: string;
  stack?: string; // Fichário group name
  locked?: boolean;
}

/**
 * Browser Portal node on the canvas for live web navigation, documentation, and app preview.
 */
export interface BrowserPortal {
  id: string;
  name: string;
  url: string;
  bounds: CanvasBounds;
  isInspecting?: boolean;
}

/**
 * Complete listing of entities present on the current canvas workspace.
 */
export interface CanvasListing {
  currentAgent: {
    name: string;
    id: string;
    workspaceId: string;
  };
  agents: Array<{
    name: string;
    preset: string;
    role: string;
    status: string;
  }>;
  notes: Array<{
    name: string;
    stack?: string;
    locked?: boolean;
    preview: string;
  }>;
  portals: Array<{
    name: string;
    url: string;
  }>;
  cables: CableTie[];
}
