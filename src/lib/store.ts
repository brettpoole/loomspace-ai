import { sampleState } from './sample';
import type {
  ChatMessage,
  FabricMetrics,
  LoomspaceState,
  OpenAISettings,
  PersistedWorkspace,
  ThreadChatNode,
  ThreadLane,
  ThreadTitleNode,
} from './types';

const WORKSPACE_KEY = 'loomspace.workspace.v5';
const SETTINGS_KEY = 'loomspace.settings.v1';

export function loadWorkspace(): LoomspaceState {
  try {
    const raw = localStorage.getItem(WORKSPACE_KEY);
    if (!raw) return structuredClone(sampleState);
    const parsed = JSON.parse(raw) as PersistedWorkspace;
    return parsed.state ?? structuredClone(sampleState);
  } catch {
    return structuredClone(sampleState);
  }
}

export function saveWorkspace(state: LoomspaceState) {
  localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ state } satisfies PersistedWorkspace));
}

export function loadSettings(): OpenAISettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { apiKey: '', model: 'gpt-4o-mini' };
    const parsed = JSON.parse(raw) as OpenAISettings;
    return {
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
      model: typeof parsed.model === 'string' && parsed.model.trim() ? parsed.model : 'gpt-4o-mini',
    };
  } catch {
    return { apiKey: '', model: 'gpt-4o-mini' };
  }
}

export function saveSettings(settings: OpenAISettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function computeMetrics(state: LoomspaceState): FabricMetrics {
  const chatCount = state.threads.reduce((sum, thread) => sum + thread.nodes.filter((node) => node.kind === 'chat').length, 0);
  const nodeCount = state.threads.reduce((sum, thread) => sum + thread.nodes.length, 0);
  const density = chatCount / Math.max(state.threads.length || 1, 1);
  const saturation = Math.min(1, nodeCount / Math.max(state.threads.length * 6 || 1, 1));

  return { threadCount: state.threads.length, nodeCount, chatCount, density, saturation };
}

export function summarize(text: string, limit = 60) {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > limit ? `${compact.slice(0, limit - 1)}…` : compact;
}

export function createThread(title: string, description: string, index: number): ThreadLane {
  const threadId = `thread-${crypto.randomUUID().slice(0, 8)}`;
  const titleNode: ThreadTitleNode = {
    id: `title-${crypto.randomUUID().slice(0, 8)}`,
    kind: 'title',
    title,
    description,
  };
  const firstChatNode = createChatNode('AI chat ready', 'medium');

  return {
    id: threadId,
    color: pickColor(index),
    status: 'draft',
    title,
    description,
    context: [],
    nodes: [titleNode, firstChatNode],
    activeNodeId: firstChatNode.id,
    infoOpen: false,
  };
}

export function createChatNode(summarySource: string, confidence: 'low' | 'medium' | 'high', messages: ChatMessage[] = []): ThreadChatNode {
  return {
    id: `chat-${crypto.randomUUID().slice(0, 8)}`,
    kind: 'chat',
    summary: summarize(summarySource, 52),
    messages,
    confidence,
    createdAt: new Date().toISOString(),
  };
}

export function updateThreadTitle(thread: ThreadLane, title: string): ThreadLane {
  return {
    ...thread,
    title,
    nodes: thread.nodes.map((node) => (node.kind === 'title' ? { ...node, title } : node)),
  };
}

export function appendChatToThread(thread: ThreadLane, chat: ThreadChatNode, messages: ChatMessage[]): ThreadLane {
  return {
    ...thread,
    status: 'active',
    context: [...thread.context, ...messages],
    nodes: [...thread.nodes, chat],
    activeNodeId: chat.id,
  };
}

export function threadWithInfo(thread: ThreadLane, infoOpen: boolean): ThreadLane {
  return { ...thread, infoOpen };
}

export function threadWithActiveNode(thread: ThreadLane, nodeId: string | null): ThreadLane {
  return { ...thread, activeNodeId: nodeId };
}

export function pickColor(index: number) {
  const palette = ['#7cf7c2', '#7ea8ff', '#d48bff', '#ffd166', '#ff8f70'];
  return palette[index % palette.length];
}
