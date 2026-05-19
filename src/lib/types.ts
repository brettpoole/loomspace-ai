export type NodeKind = 'loom' | 'warp' | 'thread' | 'idea' | 'evidence' | 'stitch' | 'decision';
export type EdgeKind = 'supports' | 'questions' | 'contradicts' | 'promotes' | 'links';

export type Confidence = 'low' | 'medium' | 'high';

export interface FabricNode {
  id: string;
  kind: NodeKind;
  title: string;
  summary: string;
  x: number;
  y: number;
  confidence: Confidence;
  threadId?: string;
  provenance: string[];
  collapsed?: boolean;
  pinned?: boolean;
}

export interface FabricEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  label: string;
}

export interface WorkspaceThread {
  id: string;
  title: string;
  color: string;
  status: 'active' | 'stitch-ready' | 'dormant';
}

export interface LoomspaceState {
  workspaceId: string;
  title: string;
  nodes: FabricNode[];
  edges: FabricEdge[];
  threads: WorkspaceThread[];
  selectedId: string | null;
  zoom: number;
  panX: number;
  panY: number;
  densityOverlay: boolean;
  version: number;
}

export interface FabricMetrics {
  nodeCount: number;
  edgeCount: number;
  stitchedCount: number;
  contradictionCount: number;
  density: number;
  saturation: number;
}

export type LoomspaceEvent =
  | { type: 'node.add'; node: FabricNode }
  | { type: 'node.update'; id: string; patch: Partial<FabricNode> }
  | { type: 'node.move'; id: string; x: number; y: number }
  | { type: 'node.remove'; id: string }
  | { type: 'edge.add'; edge: FabricEdge }
  | { type: 'thread.add'; thread: WorkspaceThread }
  | { type: 'thread.update'; id: string; patch: Partial<WorkspaceThread> }
  | { type: 'ui.select'; id: string | null }
  | { type: 'ui.zoom'; zoom: number }
  | { type: 'ui.pan'; panX: number; panY: number }
  | { type: 'ui.toggleDensityOverlay' }
  | { type: 'node.toggleCollapse'; id: string };

export interface PersistedLog {
  events: LoomspaceEvent[];
}
