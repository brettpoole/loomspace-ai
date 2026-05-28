import { sampleState } from './sample';
import { migrateMessage } from './mediaUtils';
import type {
  AIProvider,
  AIProviderConfig,
  AISettings,
  ChatMessage,
  FabricMetrics,
  LoomspaceState,
  ProviderInfo,
  ThreadChatNode,
  ThreadContextNode,
  ThreadLane,
  ThreadTitleNode,
  ThreadUsageSummary,
  TokenUsage,
} from './types';

const WORKSPACE_KEY = 'loomspace.workspace.v7';
const MODEL_CACHE_KEY = 'loomspace.model-cache.v1';

/** Wipe all loomspace keys from localStorage. Call on logout before clearing the auth token. */
export function clearLocalData(): void {
  localStorage.removeItem(WORKSPACE_KEY);
  localStorage.removeItem(MODEL_CACHE_KEY);
}

export const PROVIDERS: ProviderInfo[] = [
  { id: 'openai', label: 'OpenAI', defaultModel: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1' },
  { id: 'anthropic', label: 'Anthropic', defaultModel: 'claude-3-5-sonnet-latest', baseUrl: 'https://api.anthropic.com/v1' },
  { id: 'openrouter', label: 'OpenRouter (free)', defaultModel: 'meta-llama/llama-3.3-70b-instruct:free', baseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'openai-compatible-custom', label: 'OpenAI Compatible (custom)', defaultModel: 'gpt-4o-mini' },
];

export function isProvider(value: string): value is AIProvider {
  return PROVIDERS.some((entry) => entry.id === value);
}

export function providerInfo(provider: AIProvider): ProviderInfo {
  return PROVIDERS.find((entry) => entry.id === provider) ?? PROVIDERS[0];
}

export function createProviderConfig(kind: AIProvider = 'openai-compatible-custom', overrides: Partial<AIProviderConfig> = {}): AIProviderConfig {
  const info = providerInfo(kind);
  return {
    id: overrides.id ?? `provider-${crypto.randomUUID().slice(0, 8)}`,
    kind,
    label: overrides.label ?? info.label,
    model: overrides.model ?? '',
    apiKey: overrides.apiKey ?? '',
    hasEncryptedApiKey: overrides.hasEncryptedApiKey ?? false,
    baseUrl: overrides.baseUrl ?? info.baseUrl,
  };
}

const MODEL_WINDOWS: Record<string, number> = {
  'gpt-4o-mini': 128_000,
  'gpt-4o': 128_000,
  'gpt-5': 256_000,
  'claude-3-5-sonnet-latest': 200_000,
  'claude-3-5-haiku-latest': 200_000,
  'claude-3-opus-latest': 200_000,
};

const MODEL_PRICING: Record<string, { inputPerMillion: number; outputPerMillion: number }> = {
  'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  'gpt-4o': { inputPerMillion: 5, outputPerMillion: 15 },
  'gpt-5': { inputPerMillion: 1.25, outputPerMillion: 10 },
  'claude-3-5-sonnet-latest': { inputPerMillion: 3, outputPerMillion: 15 },
  'claude-3-5-haiku-latest': { inputPerMillion: 0.8, outputPerMillion: 4 },
  'claude-3-opus-latest': { inputPerMillion: 15, outputPerMillion: 75 },
};

interface PersistedProviderConfig {
  id: string;
  kind: AIProvider;
  label: string;
  model: string;
  hasEncryptedApiKey: boolean;
  baseUrl?: string;
}

interface PersistedSettingsPayload {
  activeProviderConfigId: string;
  providerConfigs: PersistedProviderConfig[];
}

type PersistedModelCache = Record<string, string[]>;

interface PersistedWorkspace {
  state: LoomspaceState;
}

function migrateWorkspaceState(state: LoomspaceState): LoomspaceState {
  // Identity migration placeholder for now
  return state;
}

export function loadWorkspace(): LoomspaceState {
  try {
    const raw = localStorage.getItem(WORKSPACE_KEY);
    if (!raw) return structuredClone(sampleState);
    const parsed = JSON.parse(raw) as PersistedWorkspace;
    return migrateWorkspaceState(parsed.state ?? structuredClone(sampleState));
  } catch {
    return structuredClone(sampleState);
  }
}

export function saveWorkspace(state: LoomspaceState) {
  localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ state } as PersistedWorkspace));
}

export function readCookie(name: string): string | null {
  const pattern = `${encodeURIComponent(name)}=`;
  const entry = document.cookie
    .split('; ')
    .find((e) => e.startsWith(pattern));
  if (!entry) return null;
  return decodeURIComponent(entry.slice(pattern.length));
}

function readSettingsPayload(): PersistedSettingsPayload | null {
  const raw = readCookie('loomspace.settings.v4');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedSettingsPayload>;
    if (!parsed) return null;
    const providerConfigs = Array.isArray(parsed.providerConfigs)
      ? (parsed.providerConfigs as PersistedProviderConfig[])
      : [];
    return {
      activeProviderConfigId: typeof parsed.activeProviderConfigId === 'string' ? parsed.activeProviderConfigId : 'openai',
      providerConfigs: providerConfigs.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        label: entry.label,
        model: typeof entry.model === 'string' ? entry.model : '',
        hasEncryptedApiKey: Boolean(entry.hasEncryptedApiKey),
        baseUrl: typeof entry.baseUrl === 'string' ? entry.baseUrl : providerInfo(entry.kind).baseUrl,
      })),
    };
  } catch {
    return null;
  }
}

export function loadSettings(): AISettings {
  const persisted = readSettingsPayload();
  const providerConfigs = (persisted?.providerConfigs ?? []).map((config) => ({
    ...config,
    apiKey: '',
    hasEncryptedApiKey: false,
  }));
  return {
    activeProviderConfigId: persisted?.activeProviderConfigId ?? 'openai',
    providerConfigs,
  };
}

export function loadModelCache(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(MODEL_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PersistedModelCache;
    if (!parsed || typeof parsed !== 'object') return {};
    const sanitized: Record<string, string[]> = {};
    Object.entries(parsed).forEach(([configId, models]) => {
      if (!Array.isArray(models)) return;
      const ids = models.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
      if (ids.length > 0) sanitized[configId] = ids;
    });
    return sanitized;
  } catch {
    return {};
  }
}

export function saveModelCache(cache: Record<string, string[]>) {
  try {
    localStorage.setItem(MODEL_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // ignore storage failure
  }
}

export function deleteProviderConfig(settings: AISettings, configId: string): AISettings {
  const remaining = settings.providerConfigs.filter((config) => config.id !== configId);
  const nextActiveId = settings.activeProviderConfigId === configId ? (remaining[0]?.id ?? 'openai') : settings.activeProviderConfigId;
  return { activeProviderConfigId: nextActiveId, providerConfigs: remaining };
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

export function appendContextInjection(
  thread: ThreadLane,
  contextNode: ThreadContextNode,
  injectedMessages: ChatMessage[],
): ThreadLane {
  return {
    ...thread,
    status: 'active',
    nodes: [...thread.nodes, contextNode],
    context: [...thread.context, ...injectedMessages],
    activeNodeId: contextNode.id,
  };
}

export function createThread(title: string, description: string, index: number, defaults?: { initialModel?: string }): ThreadLane {
  const initialModel = defaults?.initialModel ?? '';
  const threadId = `thread-${crypto.randomUUID().slice(0, 8)}`;
  const titleNode: ThreadTitleNode = {
    id: `title-${crypto.randomUUID().slice(0, 8)}`,
    kind: 'title',
    title,
    description,
  };
  const firstChatNode = createChatNode('AI chat ready', [], initialModel);
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

export function createChatNode(
  summarySource: string,
  messages: ChatMessage[] = [],
  model = '',
  usage?: TokenUsage,
  status?: ThreadChatNode['status'],
): ThreadChatNode {
  return {
    id: `chat-${crypto.randomUUID().slice(0, 8)}`,
    kind: 'chat',
    summary: summarize(summarySource, 52),
    messages,
    model,
    createdAt: new Date().toISOString(),
    usage,
    status,
  };
}

export function createContextNode(
  source: { id: string; title: string; color: string },
  sourceNodeIds: string[],
  messages: ChatMessage[],
): ThreadContextNode {
  return {
    id: `ctx-${crypto.randomUUID().slice(0, 8)}`,
    kind: 'context',
    sourceThreadId: source.id,
    sourceThreadTitle: source.title,
    sourceThreadColor: source.color,
    sourceNodeIds,
    messages,
    createdAt: new Date().toISOString(),
  };
}

export function updateThreadDetails(
  thread: ThreadLane,
  next: { title: string; description: string },
): ThreadLane {
  return {
    ...thread,
    title: next.title,
    description: next.description,
    nodes: thread.nodes.map((node) => (node.kind === 'title' ? { ...node, title: next.title, description: next.description } : node)),
  };
}

export function updateThreadTitle(thread: ThreadLane, title: string): ThreadLane {
  return updateThreadDetails(thread, { title, description: thread.description });
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

export function summarizeThreadUsage(thread: ThreadLane): ThreadUsageSummary {
  const usage = thread.nodes.reduce(
    (acc, node) => {
      if (node.kind !== 'chat' || !node.usage) return acc;
      acc.inputTokens += node.usage.inputTokens;
      acc.outputTokens += node.usage.outputTokens;
      acc.totalTokens += node.usage.totalTokens;
      acc.estimatedCostUsd += node.usage.estimatedCostUsd ?? estimateCost(node.model, node.usage);
      return acc;
    },
    { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 } as ThreadUsageSummary,
  );
  return usage;
}

export function getModelWindow(model: string) {
  return MODEL_WINDOWS[model] ?? 128_000;
}

export function estimateCost(model: string, usage: Pick<TokenUsage, 'inputTokens' | 'outputTokens'>) {
  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING['gpt-4o-mini'];
  return (usage.inputTokens / 1_000_000) * pricing.inputPerMillion + (usage.outputTokens / 1_000_000) * pricing.outputPerMillion;
}

// End lean surface
