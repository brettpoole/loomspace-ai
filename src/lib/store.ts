import { sampleState } from './sample';
import type { FabricMetrics, LoomspaceEvent, LoomspaceState, PersistedLog } from './types';

const STORAGE_KEY = 'loomspace.thread-log.v3';

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
    case 'thread.add':
      return {
        ...state,
        version: state.version + 1,
        threads: [...state.threads, event.thread],
      };
    case 'thread.update':
      return {
        ...state,
        version: state.version + 1,
        threads: state.threads.map((thread) => (thread.id === event.id ? { ...thread, ...event.patch } : thread)),
      };
    case 'exchange.add':
      return {
        ...state,
        version: state.version + 1,
        threads: state.threads.map((thread) =>
          thread.id === event.threadId ? { ...thread, exchanges: [...thread.exchanges, event.exchange] } : thread,
        ),
      };
    case 'thread.select':
      return { ...state, selectedThreadId: event.threadId };
    case 'exchange.select':
      return { ...state, selectedThreadId: event.threadId, selectedExchangeId: event.exchangeId };
    case 'ui.toggleDensityOverlay':
      return { ...state, densityOverlay: !state.densityOverlay };
    default:
      return state;
  }
}

export function computeMetrics(state: LoomspaceState): FabricMetrics {
  const exchangeCount = state.threads.reduce((total, thread) => total + thread.exchanges.length, 0);
  const activeExchangeCount = state.threads.filter((thread) => thread.exchanges.length > 0).length;
  const density = exchangeCount / Math.max(state.threads.length || 1, 1);
  const saturation = Math.min(1, (exchangeCount + activeExchangeCount) / Math.max(state.threads.length * 4 || 1, 1));

  return {
    threadCount: state.threads.length,
    exchangeCount,
    activeExchangeCount,
    density,
    saturation,
  };
}

export function summarize(text: string, limit = 62) {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > limit ? `${compact.slice(0, limit - 1)}…` : compact;
}
