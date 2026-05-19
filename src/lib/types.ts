export type Confidence = 'low' | 'medium' | 'high';
export type ThreadStatus = 'draft' | 'active' | 'stitch-ready' | 'closed';
export type MessageRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  text: string;
}

export interface ThreadExchange {
  id: string;
  summary: string;
  messages: ChatMessage[];
  confidence: Confidence;
  createdAt: string;
}

export interface ThreadLane {
  id: string;
  title: string;
  summary: string;
  description: string;
  color: string;
  status: ThreadStatus;
  exchanges: ThreadExchange[];
}

export interface LoomspaceState {
  workspaceId: string;
  title: string;
  threads: ThreadLane[];
  selectedThreadId: string | null;
  selectedExchangeId: string | null;
  densityOverlay: boolean;
  version: number;
}

export interface FabricMetrics {
  threadCount: number;
  exchangeCount: number;
  activeExchangeCount: number;
  density: number;
  saturation: number;
}

export type LoomspaceEvent =
  | { type: 'thread.add'; thread: ThreadLane }
  | { type: 'thread.update'; id: string; patch: Partial<Omit<ThreadLane, 'id' | 'exchanges'>> }
  | { type: 'exchange.add'; threadId: string; exchange: ThreadExchange }
  | { type: 'thread.select'; threadId: string | null }
  | { type: 'exchange.select'; threadId: string | null; exchangeId: string | null }
  | { type: 'ui.toggleDensityOverlay' };

export interface PersistedLog {
  events: LoomspaceEvent[];
}
