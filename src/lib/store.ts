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
const SETTINGS_COOKIE = 'loomspace.settings.v1';
const SECRET_COOKIE = 'loomspace.settings.secret.v1';
const PBKDF2_ITERATIONS = 310_000;

interface PersistedSettingsPayload {
  provider: OpenAISettings['provider'];
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

export function loadSettings(): OpenAISettings {
  const persisted = readSettingsPayload();
  return {
    provider: persisted?.provider ?? 'openai',
    model: persisted?.model?.trim() || 'gpt-4o-mini',
    apiKey: '',
    hasEncryptedApiKey: Boolean(readSecretPayload()),
  };
}

export async function unlockApiKey(passphrase: string): Promise<string> {
  const payload = readSecretPayload();
  if (!payload) throw new Error('No encrypted API key is stored yet.');
  if (!passphrase.trim()) throw new Error('Enter your passphrase to unlock the API key.');
  return decryptSecret(payload, passphrase);
}

export async function saveSettings(settings: OpenAISettings, passphrase: string, options?: { clearSecret?: boolean }) {
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

function readSettingsPayload(): PersistedSettingsPayload | null {
  try {
    const raw = readCookie(SETTINGS_COOKIE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedSettingsPayload>;
    return {
      provider: parsed.provider === 'openai' ? parsed.provider : 'openai',
      model: typeof parsed.model === 'string' ? parsed.model : 'gpt-4o-mini',
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
  const match = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith(prefix));
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
