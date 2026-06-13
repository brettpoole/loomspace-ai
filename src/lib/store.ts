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
  PersistedWorkspace,
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

const WORKSPACE_KEY = 'loomspace.workspace.v7';
const SETTINGS_COOKIE = 'loomspace.settings.v4';
const MODEL_CACHE_KEY = 'loomspace.model-cache.v1';
const LEGACY_SETTINGS_COOKIE = 'loomspace.settings.v3';
const LEGACY_SECRET_COOKIE = 'loomspace.settings.secret.v1';
const SECRET_COOKIE_PREFIX = 'loomspace.settings.secret.';
const PBKDF2_ITERATIONS = 310_000;

let legacySecretConfigId: string | null = null;

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

interface PersistedProviderConfig {
  id: string;
  kind: AIProvider;
  label: string;
  model: string;
  hasEncryptedApiKey: boolean;
  baseUrl?: string;
  params?: GenerationParams;
}

interface PersistedSettingsPayload {
  activeProviderConfigId: string;
  providerConfigs: PersistedProviderConfig[];
}

type PersistedModelCache = Record<string, string[]>;

interface LegacySettingsPayload {
  provider?: AIProvider;
  model?: string;
}

interface EncryptedSecretPayload {
  version: 1;
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
}

function newWorkspaceId() {
  return `workspace-${crypto.randomUUID().slice(0, 8)}`;
}

export function createWorkspaceState(title = sampleState.title, workspaceId = newWorkspaceId()): LoomspaceState {
  const nextTitle = title.trim() || sampleState.title;
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

function defaultWorkspaceStore(): PersistedWorkspaceStore {
  const workspace = createWorkspaceEntry(sampleState.title);
  return {
    activeWorkspaceId: workspace.id,
    workspaces: [workspace],
  };
}

export function loadWorkspaceStore(): PersistedWorkspaceStore {
  try {
    const raw = localStorage.getItem(WORKSPACE_KEY);
    if (!raw) return defaultWorkspaceStore();
    const parsed = JSON.parse(raw) as PersistedWorkspaceStore | PersistedWorkspace;
    const collection = parsed as Partial<PersistedWorkspaceStore>;
    if (Array.isArray(collection.workspaces)) {
      const workspaces = collection.workspaces
        .map((entry) => {
          if (!entry?.state) return null;
          const state = migrateWorkspaceState(entry.state);
          return {
            id: state.workspaceId,
            state,
          } satisfies PersistedWorkspaceEntry;
        })
        .filter((entry): entry is PersistedWorkspaceEntry => entry !== null);
      if (workspaces.length === 0) return defaultWorkspaceStore();
      const activeWorkspaceId = workspaces.some((entry) => entry.id === collection.activeWorkspaceId)
        ? collection.activeWorkspaceId ?? workspaces[0].id
        : workspaces[0].id;
      return { activeWorkspaceId, workspaces };
    }
    if ('state' in parsed && parsed.state) {
      const state = migrateWorkspaceState(parsed.state);
      return {
        activeWorkspaceId: state.workspaceId,
        workspaces: [{ id: state.workspaceId, state }],
      };
    }
  } catch {
    // Ignore storage failures and fall back to a blank local workspace.
  }
  return defaultWorkspaceStore();
}

export function saveWorkspaceStore(store: PersistedWorkspaceStore) {
  localStorage.setItem(WORKSPACE_KEY, JSON.stringify(store));
}

export function loadSettings(): AISettings {
  const persisted = readSettingsPayload();
  const legacy = persisted ? null : readLegacySettingsPayload();
  const baseConfigs = persisted?.providerConfigs ?? [];
  const activeProviderConfigId = persisted?.activeProviderConfigId ?? defaultProviderConfigId(legacy?.provider ?? 'openai');

  legacySecretConfigId = !persisted && readCookie(LEGACY_SECRET_COOKIE) ? activeProviderConfigId : null;

  const providerConfigs = baseConfigs.map((config) => {
    const persistedConfig = persisted?.providerConfigs.find((entry) => entry.id === config.id);
    const model = persistedConfig?.model ?? (legacy && config.id === activeProviderConfigId ? legacy.model : undefined) ?? config.model;
    const hasSecret = Boolean(readConfigSecretPayload(config.id) || (legacySecretConfigId === config.id && readLegacySecretPayload()));

    return {
      ...config,
      model: model.trim(),
      apiKey: '',
      hasEncryptedApiKey: Boolean(persistedConfig?.hasEncryptedApiKey || hasSecret),
      params: sanitizeGenerationParams(config.params),
    };
  });

  if (providerConfigs.length > 0 && !providerConfigs.some((config) => config.id === activeProviderConfigId)) {
    throw new Error(`Invalid activeProviderConfigId "${activeProviderConfigId}" in local settings payload.`);
  }

  return {
    activeProviderConfigId: providerConfigs.length > 0 ? activeProviderConfigId : '',
    providerConfigs,
  };
}

export function saveSettings(settings: AISettings) {
  writeSettingsPayload({
    activeProviderConfigId: settings.activeProviderConfigId,
    providerConfigs: settings.providerConfigs.map((config) => ({
      id: config.id,
      kind: config.kind,
      label: config.label,
      model: config.model,
      hasEncryptedApiKey: config.hasEncryptedApiKey,
      baseUrl: config.baseUrl,
      params: config.params,
    })),
  });
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

export async function saveProviderSecret(configId: string, apiKey: string, passphrase: string) {
  if (!apiKey.trim()) throw new Error('No API key to save.');
  if (!passphrase.trim()) throw new Error('Enter a passphrase before saving the API key.');
  const payload = await encryptSecret(apiKey.trim(), passphrase);
  writeCookie(secretCookieName(configId), JSON.stringify(payload));
  if (legacySecretConfigId === configId) {
    deleteCookie(LEGACY_SECRET_COOKIE);
    legacySecretConfigId = null;
  }
}

export async function unlockProviderSecret(configId: string, passphrase: string): Promise<string> {
  const payload = readConfigSecretPayload(configId) ?? (legacySecretConfigId === configId ? readLegacySecretPayload() : null);
  if (!payload) throw new Error('No encrypted API key is stored for this provider yet.');
  if (!passphrase.trim()) throw new Error('Enter your passphrase to unlock the API key.');
  return decryptSecret(payload, passphrase);
}

export function clearProviderSecret(configId: string) {
  deleteCookie(secretCookieName(configId));
  if (legacySecretConfigId === configId) {
    deleteCookie(LEGACY_SECRET_COOKIE);
    legacySecretConfigId = null;
  }
}

export function deleteProviderConfig(settings: AISettings, configId: string): AISettings {
  clearProviderSecret(configId);
  const providerConfigs = settings.providerConfigs.filter((config) => config.id !== configId);
  const activeProviderConfigId =
    settings.activeProviderConfigId === configId
      ? providerConfigs[0]?.id ?? 'openai'
      : settings.activeProviderConfigId;
  return { activeProviderConfigId, providerConfigs };
}

export function clearSettingsCookies() {
  deleteCookie(SETTINGS_COOKIE);
  deleteCookie(LEGACY_SETTINGS_COOKIE);
  deleteCookie(LEGACY_SECRET_COOKIE);
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

export async function fetchProviderModels(config: AIProviderConfig): Promise<string[]> {
  const apiKey = config.apiKey.trim();
  if (!apiKey && config.kind !== 'openai-compatible-custom') {
    throw new Error('Unlock or enter the API key before fetching models.');
  }

  if (config.kind === 'anthropic') {
    const response = await fetch(resolveBaseUrl(config.baseUrl, config.kind) + '/models', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    });
    if (!response.ok) throw new Error((await response.text()) || 'Anthropic /models request failed');
    const data = (await response.json()) as { data?: Array<{ id?: string }> };
    return (data.data ?? []).map((entry) => entry.id ?? '').filter(Boolean).sort();
  }

  const headers: Record<string, string> = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const response = await fetch(resolveBaseUrl(config.baseUrl, config.kind) + '/models', {
    headers,
  });
  if (!response.ok) throw new Error((await response.text()) || `${providerInfo(config.kind).label} /models request failed`);
  const data = (await response.json()) as { data?: Array<{ id?: string; pricing?: { prompt?: string; completion?: string } }> };

  if (config.kind === 'openrouter') {
    return (data.data ?? [])
      .filter((entry) => {
        const id = entry.id ?? '';
        if (!id) return false;
        if (id.endsWith(':free')) return true;
        const prompt = parseFloat(entry.pricing?.prompt ?? '');
        const completion = parseFloat(entry.pricing?.completion ?? '');
        return Number.isFinite(prompt) && Number.isFinite(completion) && prompt === 0 && completion === 0;
      })
      .map((entry) => entry.id ?? '')
      .filter(Boolean)
      .sort();
  }

  return (data.data ?? []).map((entry) => entry.id ?? '').filter(Boolean).sort();
}

export function resolveBaseUrl(baseUrl: string | undefined, kind: AIProvider) {
  if (kind === 'anthropic') return baseUrl?.trim().replace(/\/+$/, '') || 'https://api.anthropic.com/v1';
  if (kind === 'openrouter') return baseUrl?.trim().replace(/\/+$/, '') || 'https://openrouter.ai/api/v1';
  if (kind === 'openai') return baseUrl?.trim().replace(/\/+$/, '') || 'https://api.openai.com/v1';
  if (!baseUrl?.trim()) throw new Error('Enter a Base URL for the custom OpenAI-compatible provider.');
  return baseUrl.trim().replace(/\/+$/, '');
}

function secretCookieName(configId: string) {
  return `${SECRET_COOKIE_PREFIX}${configId}`;
}

function readSettingsPayload(): PersistedSettingsPayload | null {
  const raw = readCookie(SETTINGS_COOKIE) ?? readCookie(LEGACY_SETTINGS_COOKIE);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedSettingsPayload & LegacySettingsPayload>;

    if (Array.isArray(parsed.providerConfigs)) {
      return {
        activeProviderConfigId: typeof parsed.activeProviderConfigId === 'string' ? parsed.activeProviderConfigId : 'openai',
        providerConfigs: parsed.providerConfigs
          .filter((entry): entry is PersistedProviderConfig => Boolean(entry && typeof entry.id === 'string' && isProvider(entry.kind) && typeof entry.label === 'string'))
          .map((entry) => ({
            id: entry.id,
            kind: entry.kind,
            label: entry.label,
            model: typeof entry.model === 'string' ? entry.model : '',
            hasEncryptedApiKey: Boolean(entry.hasEncryptedApiKey),
            baseUrl: typeof entry.baseUrl === 'string' ? entry.baseUrl : providerInfo(entry.kind).baseUrl,
          })),
      };
    }

    const provider: AIProvider = typeof parsed.provider === 'string' && isProvider(parsed.provider) ? parsed.provider : 'openai';
    return {
      activeProviderConfigId: defaultProviderConfigId(provider),
      providerConfigs: [],
    };
  } catch {
    return null;
  }
}

function readLegacySettingsPayload(): LegacySettingsPayload | null {
  try {
    const raw = readCookie(LEGACY_SETTINGS_COOKIE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LegacySettingsPayload>;
    return {
      provider: typeof parsed.provider === 'string' && isProvider(parsed.provider) ? parsed.provider : 'openai',
      model: typeof parsed.model === 'string' ? parsed.model : '',
    };
  } catch {
    return null;
  }
}

function writeSettingsPayload(payload: PersistedSettingsPayload) {
  writeCookie(SETTINGS_COOKIE, JSON.stringify(payload));
}

function parseSecretPayload(raw: string | null): EncryptedSecretPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<EncryptedSecretPayload>;
    if (parsed.version !== 1 || typeof parsed.ciphertext !== 'string' || typeof parsed.iv !== 'string' || typeof parsed.salt !== 'string') {
      return null;
    }
    return {
      version: 1,
      iterations: typeof parsed.iterations === 'number' ? parsed.iterations : PBKDF2_ITERATIONS,
      salt: parsed.salt,
      iv: parsed.iv,
      ciphertext: parsed.ciphertext,
    };
  } catch {
    return null;
  }
}

function readConfigSecretPayload(configId: string): EncryptedSecretPayload | null {
  return parseSecretPayload(readCookie(secretCookieName(configId)));
}

function readLegacySecretPayload(): EncryptedSecretPayload | null {
  return parseSecretPayload(readCookie(LEGACY_SECRET_COOKIE));
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

async function encryptSecret(secret: string, passphrase: string): Promise<EncryptedSecretPayload> {
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations: PBKDF2_ITERATIONS,
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );

  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(secret));

  return {
    version: 1,
    iterations: PBKDF2_ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  };
}

async function decryptSecret(payload: EncryptedSecretPayload, passphrase: string): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: fromBase64(payload.salt),
      iterations: payload.iterations,
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(payload.iv) },
    key,
    fromBase64(payload.ciphertext),
  );

  return new TextDecoder().decode(plaintext);
}

function readCookie(name: string): string | null {
  const prefix = `${encodeURIComponent(name)}=`;
  const entry = document.cookie.split('; ').find((part) => part.startsWith(prefix));
  return entry ? decodeURIComponent(entry.slice(prefix.length)) : null;
}

function writeCookie(name: string, value: string) {
  const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Strict${secure}`;
}

function deleteCookie(name: string) {
  document.cookie = `${encodeURIComponent(name)}=; path=/; max-age=0`;
}

function toBase64(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
