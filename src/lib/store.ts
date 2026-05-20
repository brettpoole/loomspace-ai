import { sampleState } from './sample';
import type {
  AIProvider,
  AISettings,
  ChatMessage,
  FabricMetrics,
  LoomspaceState,
  PersistedWorkspace,
  ProviderInfo,
  ThreadChatNode,
  ThreadLane,
  ThreadTitleNode,
  ThreadUsageSummary,
  TokenUsage,
} from './types';

const WORKSPACE_KEY = 'loomspace.workspace.v7';
const SETTINGS_COOKIE = 'loomspace.settings.v3';
const SECRET_COOKIE = 'loomspace.settings.secret.v1';
const PBKDF2_ITERATIONS = 310_000;

export const PROVIDERS: ProviderInfo[] = [
  { id: 'openai', label: 'OpenAI', defaultModel: 'gpt-4o-mini' },
  { id: 'anthropic', label: 'Anthropic', defaultModel: 'claude-3-5-sonnet-latest' },
  { id: 'openrouter', label: 'OpenRouter (free)', defaultModel: 'meta-llama/llama-3.3-70b-instruct:free' },
];

export function isProvider(value: string): value is AIProvider {
  return PROVIDERS.some((entry) => entry.id === value);
}

export function providerInfo(provider: AIProvider): ProviderInfo {
  return PROVIDERS.find((entry) => entry.id === provider) ?? PROVIDERS[0];
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

interface PersistedSettingsPayload {
  provider: AIProvider;
  model: string;
}

interface EncryptedSecretPayload {
  version: 1;
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
}

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

export function loadSettings(): AISettings {
  const persisted = readSettingsPayload();
  const provider = persisted?.provider ?? 'openai';
  return {
    provider,
    model: persisted?.model?.trim() || providerInfo(provider).defaultModel,
    apiKey: '',
    hasEncryptedApiKey: Boolean(readSecretPayload()),
  };
}

export async function saveSettings(settings: AISettings, passphrase: string, options?: { clearSecret?: boolean }) {
  writeSettingsPayload({ provider: settings.provider, model: settings.model });

  if (options?.clearSecret) {
    deleteCookie(SECRET_COOKIE);
    return;
  }

  if (settings.apiKey.trim()) {
    if (!passphrase.trim()) {
      throw new Error('Enter a passphrase before saving the API key.');
    }
    const payload = await encryptSecret(settings.apiKey.trim(), passphrase);
    writeCookie(SECRET_COOKIE, JSON.stringify(payload));
  }
}

export async function unlockApiKey(passphrase: string): Promise<string> {
  const payload = readSecretPayload();
  if (!payload) throw new Error('No encrypted API key is stored yet.');
  if (!passphrase.trim()) throw new Error('Enter your passphrase to unlock the API key.');
  return decryptSecret(payload, passphrase);
}

export function clearSecretCookie() {
  deleteCookie(SECRET_COOKIE);
}

export function clearSettingsCookies() {
  deleteCookie(SETTINGS_COOKIE);
  deleteCookie(SECRET_COOKIE);
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

export function createThread(title: string, description: string, index: number, defaults?: { provider?: AIProvider; model?: string }): ThreadLane {
  const provider = defaults?.provider ?? 'openai';
  const model = defaults?.model ?? providerInfo(provider).defaultModel;
  const threadId = `thread-${crypto.randomUUID().slice(0, 8)}`;
  const titleNode: ThreadTitleNode = {
    id: `title-${crypto.randomUUID().slice(0, 8)}`,
    kind: 'title',
    title,
    description,
  };
  const firstChatNode = createChatNode('AI chat ready', 'medium', [], model);

  return {
    id: threadId,
    color: pickColor(index),
    status: 'draft',
    title,
    description,
    provider,
    model,
    context: [],
    nodes: [titleNode, firstChatNode],
    activeNodeId: firstChatNode.id,
    infoOpen: false,
  };
}

export function createChatNode(
  summarySource: string,
  confidence: 'low' | 'medium' | 'high',
  messages: ChatMessage[] = [],
  model = 'gpt-4o-mini',
  usage?: TokenUsage,
): ThreadChatNode {
  return {
    id: `chat-${crypto.randomUUID().slice(0, 8)}`,
    kind: 'chat',
    summary: summarize(summarySource, 52),
    messages,
    model,
    confidence,
    createdAt: new Date().toISOString(),
    usage,
  };
}

export function updateThreadDetails(
  thread: ThreadLane,
  next: { title: string; description: string; provider: AIProvider; model: string },
): ThreadLane {
  return {
    ...thread,
    title: next.title,
    description: next.description,
    provider: next.provider,
    model: next.model,
    nodes: thread.nodes.map((node) => (node.kind === 'title' ? { ...node, title: next.title, description: next.description } : node)),
  };
}

export function updateThreadTitle(thread: ThreadLane, title: string): ThreadLane {
  return updateThreadDetails(thread, { title, description: thread.description, provider: thread.provider, model: thread.model });
}

export function updateThreadDescription(thread: ThreadLane, description: string): ThreadLane {
  return updateThreadDetails(thread, { title: thread.title, description, provider: thread.provider, model: thread.model });
}

export function updateThreadModel(thread: ThreadLane, model: string): ThreadLane {
  return updateThreadDetails(thread, { title: thread.title, description: thread.description, provider: thread.provider, model });
}

export function updateThreadProvider(thread: ThreadLane, provider: AIProvider): ThreadLane {
  return updateThreadDetails(thread, { title: thread.title, description: thread.description, provider, model: thread.model });
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

export async function fetchProviderModels(provider: AIProvider, apiKey: string): Promise<string[]> {
  if (!apiKey.trim()) throw new Error('Unlock or enter the API key before fetching models.');

  if (provider === 'openai') {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) throw new Error((await response.text()) || 'OpenAI /models request failed');
    const data = (await response.json()) as { data?: Array<{ id?: string }> };
    const ids = (data.data ?? []).map((entry) => entry.id ?? '').filter(Boolean);
    return ids.filter((id) => /^(gpt|o\d|chatgpt)/i.test(id)).sort();
  }

  if (provider === 'anthropic') {
    const response = await fetch('https://api.anthropic.com/v1/models', {
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

  if (provider === 'openrouter') {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) throw new Error((await response.text()) || 'OpenRouter /models request failed');
    const data = (await response.json()) as {
      data?: Array<{ id?: string; pricing?: { prompt?: string; completion?: string } }>;
    };
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

  throw new Error(`Unknown provider: ${provider}`);
}

function readSettingsPayload(): PersistedSettingsPayload | null {
  try {
    const raw = readCookie(SETTINGS_COOKIE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedSettingsPayload>;
    const provider: AIProvider = typeof parsed.provider === 'string' && isProvider(parsed.provider) ? parsed.provider : 'openai';
    return {
      provider,
      model: typeof parsed.model === 'string' ? parsed.model : providerInfo(provider).defaultModel,
    };
  } catch {
    return null;
  }
}

function writeSettingsPayload(payload: PersistedSettingsPayload) {
  writeCookie(SETTINGS_COOKIE, JSON.stringify(payload));
}

function readSecretPayload(): EncryptedSecretPayload | null {
  try {
    const raw = readCookie(SECRET_COOKIE);
    if (!raw) return null;
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

async function decryptSecret(payload: EncryptedSecretPayload, passphrase: string) {
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

function writeCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}

function readCookie(name: string) {
  const prefix = `${name}=`;
  const match = document.cookie.split('; ').find((entry) => entry.startsWith(prefix));
  if (!match) return null;
  return decodeURIComponent(match.slice(prefix.length));
}

function deleteCookie(name: string) {
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
}

function toBase64(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
