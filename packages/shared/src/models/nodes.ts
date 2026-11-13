/**
 * Canvas Node Models & Types
 * Spatial canvas node definitions and element state models.
 */

export type NodeKind =
  | 'terminal'
  | 'note'
  | 'noteStack'
  | 'portal'
  | 'band'
  | 'group'
  | 'drawing'
  | 'cableTie'
  | 'file'
  | 'fileRef'
  | 'textBlock';

export interface NodeBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BaseNode extends NodeBounds {
  id: string;
  kind: NodeKind;
  zIndex: number;
}

export type TerminalStatus = 'idle' | 'working' | 'attention' | 'error';

export interface TerminalContent {
  terminalId: string;
  presetId?: string;
  title: string;
  agentRole?: string;
  isLocked?: boolean;
  account?: string;
  orchestratorMode?: boolean;
  maestroMode?: boolean;
  status?: TerminalStatus;
  command?: string;
  workingDirectory?: string;
  env?: Record<string, string>;
  hasAttention?: boolean;
  isMaximized?: boolean;
  isAutonomous?: boolean;
  monitorWithOmbro?: boolean;
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  instructions?: string;
}

export interface TerminalNode extends BaseNode {
  kind: 'terminal';
  content: TerminalContent;
}

export type NoteColor = 'yellow' | 'blue' | 'green' | 'pink' | 'purple' | 'gray';
export type StickyNoteColor = NoteColor;

export interface NoteContent {
  noteId: string;
  title: string;
  isNamePinned: boolean;
  color: NoteColor;
  stackId?: string | null;
  text?: string;
  body?: string;
  locked?: boolean;
}

export interface NoteNode extends BaseNode {
  kind: 'note';
  content: NoteContent;
}

export interface NoteStackPage {
  id: string;
  title: string;
  body: string;
  color?: NoteColor;
}

export interface NoteStackContent {
  stackId: string;
  title: string;
  noteIds: string[];
  activeNoteId?: string;
  activePageIndex?: number;
  railPosition?: 'top' | 'side';
  tabOrientation?: 'top' | 'side';
  pages?: NoteStackPage[];
}

export interface NoteStackNode extends BaseNode {
  kind: 'noteStack';
  content: NoteStackContent;
}

export type PortalKind = 'browser' | 'device' | 'android';

export interface PortalViewport {
  width: number;
  height: number;
}

export interface ActionRefTag {
  id: string;
  selector?: string;
  x: number;
  y: number;
  label: string;
}

export interface PortalContent {
  portalKind: PortalKind;
  url?: string;
  title?: string;
  viewport?: PortalViewport;
  deviceId?: string;
  deviceName?: string;
  deviceKind?: 'emulator' | 'physical' | 'avd';
  deviceFrame?: 'pixel' | 'none';
  userAgent?: string;
  actionTags?: ActionRefTag[];
}

export interface PortalNode extends BaseNode {
  kind: 'portal';
  content: PortalContent;
}

export type TerminalNodeContent = TerminalContent;
export type StickyNoteNodeContent = NoteContent;
export type NoteStackNodeContent = NoteStackContent;
export type PortalNodeContent = PortalContent;


export interface CanvasBand {
  id: string;
  title: string;
  color: string;
  icon?: string;
  bounds: NodeBounds;
  memberNodeIds: string[];
}

export type Band = CanvasBand;
export type DrawingStroke = CanvasDrawing;


export interface BandNode extends BaseNode {
  kind: 'band';
  content: {
    bandId: string;
    title: string;
    color: string;
    icon?: string;
    memberNodeIds: string[];
  };
}

export interface GroupNode extends BaseNode {
  kind: 'group';
  content: {
    title: string;
    memberNodeIds: string[];
  };
}

export interface DrawingPoint {
  x: number;
  y: number;
}

export interface CanvasDrawing {
  id: string;
  points: DrawingPoint[];
  color: string;
  width: number;
  brushType?: 'pen' | 'highlighter' | 'dashed' | 'neon';
  opacity?: number;
  zIndex?: number;
}

export interface DrawingNode extends BaseNode {
  kind: 'drawing';
  content: {
    points: DrawingPoint[];
    color: string;
    strokeWidth: number;
  };
}

export interface CableTie {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  label?: string;
  style?: 'solid' | 'dashed' | 'accent';
}

export interface FileContent {
  fileId: string;
  fileName: string;
  filePath: string;
  fileSize?: number;
  mimeType?: string;
}

export interface FileNode extends BaseNode {
  kind: 'file';
  content: FileContent;
}

/**
 * Reference to a file or folder on disk. Connecting it to an agent injects only
 * its path and type (never its content).
 */
export interface FileRefContent {
  path: string;
  isDirectory: boolean;
  label: string;
}

export interface FileRefNode extends BaseNode {
  kind: 'fileRef';
  content: FileRefContent;
}

export interface TextBlockContent {
  text: string;
  fontSize?: number;
  color?: string;
  fontFamily?: string;
  fontWeight?: string;
  fontStyle?: string;
}

export interface TextBlockNode extends BaseNode {
  kind: 'textBlock';
  content: TextBlockContent;
}

export type CanvasNode =
  | TerminalNode
  | NoteNode
  | NoteStackNode
  | PortalNode
  | BandNode
  | GroupNode
  | DrawingNode
  | FileNode
  | FileRefNode
  | TextBlockNode;
