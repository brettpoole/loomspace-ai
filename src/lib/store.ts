import { sampleState } from './sample';
import { migrateMessage } from './mediaUtils';
import type {
  AIProvider,
  AIProviderConfig,
  GenerationParams,
  AISettings,
  ChatMessage,
  FabricMetrics,
  LoomspaceState,
  PersistedWorkspaceEntry,
  PersistedWorkspaceStore,
  ProviderInfo,
  ThreadChatNode,
  ThreadContextNode,
  ThreadLane,
  ThreadTitleNode,
  ThreadUsageSummary,
  TokenUsage,
} from './types';

const MODEL_CACHE_KEY = 'loomspace.model-cache.v1';

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

export function defaultProviderConfigId(kind: AIProvider): string {
  return kind === 'openai-compatible-custom' ? 'openai-compatible-custom' : kind;
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
    params: overrides.params ?? {},
  };
}

export const PARAM_SUPPORT: Record<AIProvider, Array<keyof GenerationParams>> = {
  openai: ['temperature', 'topP', 'maxTokens', 'frequencyPenalty', 'presencePenalty', 'seed', 'stop'],
  openrouter: ['temperature', 'topP', 'topK', 'maxTokens', 'frequencyPenalty', 'presencePenalty', 'seed', 'stop'],
  'openai-compatible-custom': ['temperature', 'topP', 'topK', 'maxTokens', 'frequencyPenalty', 'presencePenalty', 'seed', 'stop'],
  anthropic: ['temperature', 'topP', 'topK', 'maxTokens', 'stop'],
};

export function sanitizeGenerationParams(raw: unknown): GenerationParams {
  if (!raw || typeof raw !== 'object') return {};
  const record = raw as Record<string, unknown>;
  const params: GenerationParams = {};
  const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
  const numericKeys: Array<Exclude<keyof GenerationParams, 'stop'>> = ['temperature', 'topP', 'topK', 'maxTokens', 'frequencyPenalty', 'presencePenalty', 'seed'];
  for (const key of numericKeys) {
    const value = num(record[key]);
    if (value !== undefined) params[key] = value;
  }
  if (Array.isArray(record.stop)) {
    const stop = record.stop.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
    if (stop.length > 0) params.stop = stop;
  }
  return params;
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

type PersistedModelCache = Record<string, string[]>;

function newWorkspaceId() {
  return `workspace-${crypto.randomUUID().slice(0, 8)}`;
}

export function createWorkspaceState(title = sampleState.title, workspaceId = newWorkspaceId()): LoomspaceState {
  const nextTitle = typeof title === 'string' && title.trim() ? title.trim() : sampleState.title;
  return {
    ...structuredClone(sampleState),
    workspaceId,
    title: nextTitle,
  };
}

export function createWorkspaceEntry(title = sampleState.title): PersistedWorkspaceEntry {
  const state = createWorkspaceState(title);
  return { id: state.workspaceId, state };
}

export function resetWorkspaceState(state: LoomspaceState): LoomspaceState {
  return createWorkspaceState(state.title, state.workspaceId);
}

export function defaultWorkspaceStore(): PersistedWorkspaceStore {
  const workspace = createWorkspaceEntry(sampleState.title);
  return {
    activeWorkspaceId: workspace.id,
    workspaces: [workspace],
  };
}



export function defaultSettings(): AISettings {
  return { activeProviderConfigId: '', providerConfigs: [] };
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
    // Ignore storage write failures; model listing still works without persistence.
  }
}

export function deleteProviderConfig(settings: AISettings, configId: string): AISettings {
  const providerConfigs = settings.providerConfigs.filter((config) => config.id !== configId);
  const activeProviderConfigId =
    settings.activeProviderConfigId === configId
      ? providerConfigs[0]?.id ?? 'openai'
      : settings.activeProviderConfigId;
  return { activeProviderConfigId, providerConfigs };
}


export function computeMetrics(state: LoomspaceState): FabricMetrics {
  const threads = Array.isArray(state.threads) ? state.threads : [];
  const chatCount = threads.reduce((sum, thread) => sum + (Array.isArray(thread.nodes) ? thread.nodes.filter((node) => node.kind === 'chat').length : 0), 0);
  const nodeCount = threads.reduce((sum, thread) => sum + (Array.isArray(thread.nodes) ? thread.nodes.length : 0), 0);
  const density = chatCount / Math.max(threads.length || 1, 1);
  const saturation = Math.min(1, nodeCount / Math.max(threads.length * 6 || 1, 1));

  return { threadCount: threads.length, nodeCount, chatCount, density, saturation };
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

  return {
    id: threadId,
    color: pickColor(index),
    status: 'draft',
    title,
    description,
    context: [],
    nodes: [titleNode],
    activeNodeId: titleNode.id,
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

export function updateThreadDescription(thread: ThreadLane, description: string): ThreadLane {
  return updateThreadDetails(thread, { title: thread.title, description });
}

export function updateThreadModelSettings(
  thread: ThreadLane,
  modelSettings: { providerConfigId: string | null; model: string; params?: GenerationParams },
): ThreadLane {
  return {
    ...thread,
    modelSettings: { ...modelSettings },
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

export function appendContextInjection(thread: ThreadLane, contextNode: ThreadContextNode, injectedMessages: ChatMessage[]): ThreadLane {
  return {
    ...thread,
    status: 'active',
    nodes: [...thread.nodes, contextNode],
    context: [...thread.context, ...injectedMessages],
    activeNodeId: contextNode.id,
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
    { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 },
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

function migrateWorkspaceState(state: LoomspaceState): LoomspaceState {
  const workspaceId = typeof state.workspaceId === 'string' && state.workspaceId ? state.workspaceId : newWorkspaceId();
  const title = typeof state.title === 'string' && state.title.trim() ? state.title : sampleState.title;
  const threads = Array.isArray(state.threads) ? state.threads : [];

  return {
    ...createWorkspaceState(title, workspaceId),
    ...state,
    workspaceId,
    title,
    threads: threads.map((thread) => {
      const stripped = { ...thread } as ThreadLane & {
        provider?: unknown;
        providerConfigId?: unknown;
        model?: unknown;
      };
      delete stripped.provider;
      delete stripped.providerConfigId;
      delete stripped.model;

      return {
        ...stripped,
        context: Array.isArray(stripped.context) ? stripped.context.map((msg) => migrateMessage(msg)) : [],
        nodes: Array.isArray(stripped.nodes)
          ? stripped.nodes.map((node) => {
              if (node.kind === 'chat') {
                return {
                  ...node,
                  messages: Array.isArray(node.messages) ? node.messages.map((msg) => migrateMessage(msg)) : [],
                };
              }
              return node;
            })
          : [],
      } as ThreadLane;
    }),
    selectedThreadId: typeof state.selectedThreadId === 'string' ? state.selectedThreadId : null,
    selectedNodeId: typeof state.selectedNodeId === 'string' ? state.selectedNodeId : null,
    densityOverlay: typeof state.densityOverlay === 'boolean' ? state.densityOverlay : sampleState.densityOverlay,
    panX: typeof state.panX === 'number' && Number.isFinite(state.panX) ? state.panX : sampleState.panX,
    panY: typeof state.panY === 'number' && Number.isFinite(state.panY) ? state.panY : sampleState.panY,
    zoom: typeof state.zoom === 'number' && Number.isFinite(state.zoom) ? state.zoom : sampleState.zoom,
    version: typeof state.version === 'number' && Number.isFinite(state.version) ? state.version : sampleState.version,
  };
}

