import { sampleState } from './sample';
import type { FabricMetrics, LoomspaceEvent, LoomspaceState, PersistedLog } from './types';

const STORAGE_KEY = 'loomspace.fabric-log.v1';

export function loadWorkspace(): LoomspaceState {
  const log = loadLog();
  return log.events.reduce(applyEvent, structuredClone(sampleState));
}

export function loadLog(): PersistedLog {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { events: [] };
    const parsed = JSON.parse(raw) as PersistedLog;
    return Array.isArray(parsed.events) ? parsed : { events: [] };
  } catch {
    return { events: [] };
  }
}

export function saveLog(events: LoomspaceEvent[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ events } satisfies PersistedLog));
}

export function appendEvent(events: LoomspaceEvent[], event: LoomspaceEvent) {
  const next = [...events, event];
  saveLog(next);
  return next;
}

export function applyEvent(state: LoomspaceState, event: LoomspaceEvent): LoomspaceState {
  switch (event.type) {
    case 'node.add':
      return { ...state, nodes: [...state.nodes, event.node], version: state.version + 1 };
    case 'node.update':
      return {
        ...state,
        version: state.version + 1,
        nodes: state.nodes.map((node) => (node.id === event.id ? { ...node, ...event.patch } : node)),
      };
    case 'node.move':
      return {
        ...state,
        version: state.version + 1,
        nodes: state.nodes.map((node) => (node.id === event.id ? { ...node, x: event.x, y: event.y } : node)),
      };
    case 'node.remove':
      return { ...state, version: state.version + 1, nodes: state.nodes.filter((node) => node.id !== event.id) };
    case 'edge.add':
      return { ...state, version: state.version + 1, edges: [...state.edges, event.edge] };
    case 'thread.add':
      return { ...state, version: state.version + 1, threads: [...state.threads, event.thread] };
    case 'thread.update':
      return {
        ...state,
        version: state.version + 1,
        threads: state.threads.map((thread) => (thread.id === event.id ? { ...thread, ...event.patch } : thread)),
      };
    case 'ui.select':
      return { ...state, selectedId: event.id };
    case 'ui.zoom':
      return { ...state, zoom: clamp(event.zoom, 0.5, 1.5) };
    case 'ui.pan':
      return { ...state, panX: event.panX, panY: event.panY };
    case 'ui.toggleDensityOverlay':
      return { ...state, densityOverlay: !state.densityOverlay };
    case 'node.toggleCollapse':
      return {
        ...state,
        version: state.version + 1,
        nodes: state.nodes.map((node) =>
          node.id === event.id ? { ...node, collapsed: !node.collapsed } : node,
        ),
      };
    default:
      return state;
  }
}

export function computeMetrics(state: LoomspaceState): FabricMetrics {
  const stitchedCount = state.nodes.filter((node) => node.kind === 'stitch').length;
  const contradictionCount = state.edges.filter((edge) => edge.kind === 'contradicts').length;
  const density = state.edges.length / Math.max(state.nodes.length, 1);
  const saturation = Math.min(1, (stitchedCount + contradictionCount + state.nodes.filter((n) => n.confidence === 'high').length) / Math.max(state.nodes.length, 1));

  return {
    nodeCount: state.nodes.length,
    edgeCount: state.edges.length,
    stitchedCount,
    contradictionCount,
    density,
    saturation,
  };
}

export function getNodeLabel(kind: string) {
  switch (kind) {
    case 'loom':
      return 'Loom';
    case 'warp':
      return 'Warp';
    case 'thread':
      return 'Thread';
    case 'idea':
      return 'Idea';
    case 'evidence':
      return 'Evidence';
    case 'stitch':
      return 'Stitch';
    case 'decision':
      return 'Decision';
    default:
      return 'Node';
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
