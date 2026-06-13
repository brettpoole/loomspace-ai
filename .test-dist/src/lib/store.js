"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PARAM_SUPPORT = exports.PROVIDERS = void 0;
exports.isProvider = isProvider;
exports.providerInfo = providerInfo;
exports.defaultProviderConfigId = defaultProviderConfigId;
exports.createProviderConfig = createProviderConfig;
exports.sanitizeGenerationParams = sanitizeGenerationParams;
exports.createWorkspaceState = createWorkspaceState;
exports.createWorkspaceEntry = createWorkspaceEntry;
exports.resetWorkspaceState = resetWorkspaceState;
exports.loadWorkspaceStore = loadWorkspaceStore;
exports.saveWorkspaceStore = saveWorkspaceStore;
exports.loadSettings = loadSettings;
exports.saveSettings = saveSettings;
exports.loadModelCache = loadModelCache;
exports.saveModelCache = saveModelCache;
exports.saveProviderSecret = saveProviderSecret;
exports.unlockProviderSecret = unlockProviderSecret;
exports.clearProviderSecret = clearProviderSecret;
exports.deleteProviderConfig = deleteProviderConfig;
exports.clearSettingsCookies = clearSettingsCookies;
exports.computeMetrics = computeMetrics;
exports.summarize = summarize;
exports.createThread = createThread;
exports.createChatNode = createChatNode;
exports.updateThreadDetails = updateThreadDetails;
exports.updateThreadTitle = updateThreadTitle;
exports.updateThreadDescription = updateThreadDescription;
exports.updateThreadModelSettings = updateThreadModelSettings;
exports.createContextNode = createContextNode;
exports.appendContextInjection = appendContextInjection;
exports.appendChatToThread = appendChatToThread;
exports.threadWithInfo = threadWithInfo;
exports.threadWithActiveNode = threadWithActiveNode;
exports.pickColor = pickColor;
exports.summarizeThreadUsage = summarizeThreadUsage;
exports.getModelWindow = getModelWindow;
exports.estimateCost = estimateCost;
exports.fetchProviderModels = fetchProviderModels;
exports.resolveBaseUrl = resolveBaseUrl;
const sample_1 = require("./sample");
const mediaUtils_1 = require("./mediaUtils");
const WORKSPACE_KEY = 'loomspace.workspace.v7';
const SETTINGS_COOKIE = 'loomspace.settings.v4';
const MODEL_CACHE_KEY = 'loomspace.model-cache.v1';
const LEGACY_SETTINGS_COOKIE = 'loomspace.settings.v3';
const LEGACY_SECRET_COOKIE = 'loomspace.settings.secret.v1';
const SECRET_COOKIE_PREFIX = 'loomspace.settings.secret.';
const PBKDF2_ITERATIONS = 310_000;
let legacySecretConfigId = null;
exports.PROVIDERS = [
    { id: 'openai', label: 'OpenAI', defaultModel: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1' },
    { id: 'anthropic', label: 'Anthropic', defaultModel: 'claude-3-5-sonnet-latest', baseUrl: 'https://api.anthropic.com/v1' },
    { id: 'openrouter', label: 'OpenRouter (free)', defaultModel: 'meta-llama/llama-3.3-70b-instruct:free', baseUrl: 'https://openrouter.ai/api/v1' },
    { id: 'openai-compatible-custom', label: 'OpenAI Compatible (custom)', defaultModel: 'gpt-4o-mini' },
];
function isProvider(value) {
    return exports.PROVIDERS.some((entry) => entry.id === value);
}
function providerInfo(provider) {
    return exports.PROVIDERS.find((entry) => entry.id === provider) ?? exports.PROVIDERS[0];
}
function defaultProviderConfigId(kind) {
    return kind === 'openai-compatible-custom' ? 'openai-compatible-custom' : kind;
}
function createProviderConfig(kind = 'openai-compatible-custom', overrides = {}) {
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
exports.PARAM_SUPPORT = {
    openai: ['temperature', 'topP', 'maxTokens', 'frequencyPenalty', 'presencePenalty', 'seed', 'stop'],
    openrouter: ['temperature', 'topP', 'topK', 'maxTokens', 'frequencyPenalty', 'presencePenalty', 'seed', 'stop'],
    'openai-compatible-custom': ['temperature', 'topP', 'topK', 'maxTokens', 'frequencyPenalty', 'presencePenalty', 'seed', 'stop'],
    anthropic: ['temperature', 'topP', 'topK', 'maxTokens', 'stop'],
};
function sanitizeGenerationParams(raw) {
    if (!raw || typeof raw !== 'object')
        return {};
    const record = raw;
    const params = {};
    const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
    const numericKeys = ['temperature', 'topP', 'topK', 'maxTokens', 'frequencyPenalty', 'presencePenalty', 'seed'];
    for (const key of numericKeys) {
        const value = num(record[key]);
        if (value !== undefined)
            params[key] = value;
    }
    if (Array.isArray(record.stop)) {
        const stop = record.stop.filter((entry) => typeof entry === 'string' && entry.length > 0);
        if (stop.length > 0)
            params.stop = stop;
    }
    return params;
}
const MODEL_WINDOWS = {
    'gpt-4o-mini': 128_000,
    'gpt-4o': 128_000,
    'gpt-5': 256_000,
    'claude-3-5-sonnet-latest': 200_000,
    'claude-3-5-haiku-latest': 200_000,
    'claude-3-opus-latest': 200_000,
};
const MODEL_PRICING = {
    'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
    'gpt-4o': { inputPerMillion: 5, outputPerMillion: 15 },
    'gpt-5': { inputPerMillion: 1.25, outputPerMillion: 10 },
    'claude-3-5-sonnet-latest': { inputPerMillion: 3, outputPerMillion: 15 },
    'claude-3-5-haiku-latest': { inputPerMillion: 0.8, outputPerMillion: 4 },
    'claude-3-opus-latest': { inputPerMillion: 15, outputPerMillion: 75 },
};
function newWorkspaceId() {
    return `workspace-${crypto.randomUUID().slice(0, 8)}`;
}
function createWorkspaceState(title = sample_1.sampleState.title, workspaceId = newWorkspaceId()) {
    const nextTitle = title.trim() || sample_1.sampleState.title;
    return {
        ...structuredClone(sample_1.sampleState),
        workspaceId,
        title: nextTitle,
    };
}
function createWorkspaceEntry(title = sample_1.sampleState.title) {
    const state = createWorkspaceState(title);
    return { id: state.workspaceId, state };
}
function resetWorkspaceState(state) {
    return createWorkspaceState(state.title, state.workspaceId);
}
function defaultWorkspaceStore() {
    const workspace = createWorkspaceEntry(sample_1.sampleState.title);
    return {
        activeWorkspaceId: workspace.id,
        workspaces: [workspace],
    };
}
function loadWorkspaceStore() {
    try {
        const raw = localStorage.getItem(WORKSPACE_KEY);
        if (!raw)
            return defaultWorkspaceStore();
        const parsed = JSON.parse(raw);
        const collection = parsed;
        if (Array.isArray(collection.workspaces)) {
            const workspaces = collection.workspaces
                .map((entry) => {
                if (!entry?.state)
                    return null;
                const state = migrateWorkspaceState(entry.state);
                return {
                    id: state.workspaceId,
                    state,
                };
            })
                .filter((entry) => entry !== null);
            if (workspaces.length === 0)
                return defaultWorkspaceStore();
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
    }
    catch {
        // Ignore storage failures and fall back to a blank local workspace.
    }
    return defaultWorkspaceStore();
}
function saveWorkspaceStore(store) {
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(store));
}
function loadSettings() {
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
function saveSettings(settings) {
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
function loadModelCache() {
    try {
        const raw = localStorage.getItem(MODEL_CACHE_KEY);
        if (!raw)
            return {};
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object')
            return {};
        const sanitized = {};
        Object.entries(parsed).forEach(([configId, models]) => {
            if (!Array.isArray(models))
                return;
            const ids = models.filter((entry) => typeof entry === 'string' && entry.trim().length > 0);
            if (ids.length > 0)
                sanitized[configId] = ids;
        });
        return sanitized;
    }
    catch {
        return {};
    }
}
function saveModelCache(cache) {
    try {
        localStorage.setItem(MODEL_CACHE_KEY, JSON.stringify(cache));
    }
    catch {
        // Ignore storage write failures; model listing still works without persistence.
    }
}
async function saveProviderSecret(configId, apiKey, passphrase) {
    if (!apiKey.trim())
        throw new Error('No API key to save.');
    if (!passphrase.trim())
        throw new Error('Enter a passphrase before saving the API key.');
    const payload = await encryptSecret(apiKey.trim(), passphrase);
    writeCookie(secretCookieName(configId), JSON.stringify(payload));
    if (legacySecretConfigId === configId) {
        deleteCookie(LEGACY_SECRET_COOKIE);
        legacySecretConfigId = null;
    }
}
async function unlockProviderSecret(configId, passphrase) {
    const payload = readConfigSecretPayload(configId) ?? (legacySecretConfigId === configId ? readLegacySecretPayload() : null);
    if (!payload)
        throw new Error('No encrypted API key is stored for this provider yet.');
    if (!passphrase.trim())
        throw new Error('Enter your passphrase to unlock the API key.');
    return decryptSecret(payload, passphrase);
}
function clearProviderSecret(configId) {
    deleteCookie(secretCookieName(configId));
    if (legacySecretConfigId === configId) {
        deleteCookie(LEGACY_SECRET_COOKIE);
        legacySecretConfigId = null;
    }
}
function deleteProviderConfig(settings, configId) {
    clearProviderSecret(configId);
    const providerConfigs = settings.providerConfigs.filter((config) => config.id !== configId);
    const activeProviderConfigId = settings.activeProviderConfigId === configId
        ? providerConfigs[0]?.id ?? 'openai'
        : settings.activeProviderConfigId;
    return { activeProviderConfigId, providerConfigs };
}
function clearSettingsCookies() {
    deleteCookie(SETTINGS_COOKIE);
    deleteCookie(LEGACY_SETTINGS_COOKIE);
    deleteCookie(LEGACY_SECRET_COOKIE);
}
function computeMetrics(state) {
    const chatCount = state.threads.reduce((sum, thread) => sum + thread.nodes.filter((node) => node.kind === 'chat').length, 0);
    const nodeCount = state.threads.reduce((sum, thread) => sum + thread.nodes.length, 0);
    const density = chatCount / Math.max(state.threads.length || 1, 1);
    const saturation = Math.min(1, nodeCount / Math.max(state.threads.length * 6 || 1, 1));
    return { threadCount: state.threads.length, nodeCount, chatCount, density, saturation };
}
function summarize(text, limit = 60) {
    const compact = text.replace(/\s+/g, ' ').trim();
    return compact.length > limit ? `${compact.slice(0, limit - 1)}…` : compact;
}
function createThread(title, description, index) {
    const threadId = `thread-${crypto.randomUUID().slice(0, 8)}`;
    const titleNode = {
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
function createChatNode(summarySource, messages = [], model = '', usage, status) {
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
function updateThreadDetails(thread, next) {
    return {
        ...thread,
        title: next.title,
        description: next.description,
        nodes: thread.nodes.map((node) => (node.kind === 'title' ? { ...node, title: next.title, description: next.description } : node)),
    };
}
function updateThreadTitle(thread, title) {
    return updateThreadDetails(thread, { title, description: thread.description });
}
function updateThreadDescription(thread, description) {
    return updateThreadDetails(thread, { title: thread.title, description });
}
function updateThreadModelSettings(thread, modelSettings) {
    return {
        ...thread,
        modelSettings: { ...modelSettings },
    };
}
function createContextNode(source, sourceNodeIds, messages) {
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
function appendContextInjection(thread, contextNode, injectedMessages) {
    return {
        ...thread,
        status: 'active',
        nodes: [...thread.nodes, contextNode],
        context: [...thread.context, ...injectedMessages],
        activeNodeId: contextNode.id,
    };
}
function appendChatToThread(thread, chat, messages) {
    return {
        ...thread,
        status: 'active',
        context: [...thread.context, ...messages],
        nodes: [...thread.nodes, chat],
        activeNodeId: chat.id,
    };
}
function threadWithInfo(thread, infoOpen) {
    return { ...thread, infoOpen };
}
function threadWithActiveNode(thread, nodeId) {
    return { ...thread, activeNodeId: nodeId };
}
function pickColor(index) {
    const palette = ['#7cf7c2', '#7ea8ff', '#d48bff', '#ffd166', '#ff8f70'];
    return palette[index % palette.length];
}
function summarizeThreadUsage(thread) {
    const usage = thread.nodes.reduce((acc, node) => {
        if (node.kind !== 'chat' || !node.usage)
            return acc;
        acc.inputTokens += node.usage.inputTokens;
        acc.outputTokens += node.usage.outputTokens;
        acc.totalTokens += node.usage.totalTokens;
        acc.estimatedCostUsd += node.usage.estimatedCostUsd ?? estimateCost(node.model, node.usage);
        return acc;
    }, { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 });
    return usage;
}
function getModelWindow(model) {
    return MODEL_WINDOWS[model] ?? 128_000;
}
function estimateCost(model, usage) {
    const pricing = MODEL_PRICING[model] ?? MODEL_PRICING['gpt-4o-mini'];
    return (usage.inputTokens / 1_000_000) * pricing.inputPerMillion + (usage.outputTokens / 1_000_000) * pricing.outputPerMillion;
}
async function fetchProviderModels(config) {
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
        if (!response.ok)
            throw new Error((await response.text()) || 'Anthropic /models request failed');
        const data = (await response.json());
        return (data.data ?? []).map((entry) => entry.id ?? '').filter(Boolean).sort();
    }
    const headers = {};
    if (apiKey)
        headers.Authorization = `Bearer ${apiKey}`;
    const response = await fetch(resolveBaseUrl(config.baseUrl, config.kind) + '/models', {
        headers,
    });
    if (!response.ok)
        throw new Error((await response.text()) || `${providerInfo(config.kind).label} /models request failed`);
    const data = (await response.json());
    if (config.kind === 'openrouter') {
        return (data.data ?? [])
            .filter((entry) => {
            const id = entry.id ?? '';
            if (!id)
                return false;
            if (id.endsWith(':free'))
                return true;
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
function resolveBaseUrl(baseUrl, kind) {
    if (kind === 'anthropic')
        return baseUrl?.trim().replace(/\/+$/, '') || 'https://api.anthropic.com/v1';
    if (kind === 'openrouter')
        return baseUrl?.trim().replace(/\/+$/, '') || 'https://openrouter.ai/api/v1';
    if (kind === 'openai')
        return baseUrl?.trim().replace(/\/+$/, '') || 'https://api.openai.com/v1';
    if (!baseUrl?.trim())
        throw new Error('Enter a Base URL for the custom OpenAI-compatible provider.');
    return baseUrl.trim().replace(/\/+$/, '');
}
function secretCookieName(configId) {
    return `${SECRET_COOKIE_PREFIX}${configId}`;
}
function readSettingsPayload() {
    const raw = readCookie(SETTINGS_COOKIE) ?? readCookie(LEGACY_SETTINGS_COOKIE);
    if (!raw)
        return null;
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.providerConfigs)) {
            return {
                activeProviderConfigId: typeof parsed.activeProviderConfigId === 'string' ? parsed.activeProviderConfigId : 'openai',
                providerConfigs: parsed.providerConfigs
                    .filter((entry) => Boolean(entry && typeof entry.id === 'string' && isProvider(entry.kind) && typeof entry.label === 'string'))
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
        const provider = typeof parsed.provider === 'string' && isProvider(parsed.provider) ? parsed.provider : 'openai';
        return {
            activeProviderConfigId: defaultProviderConfigId(provider),
            providerConfigs: [],
        };
    }
    catch {
        return null;
    }
}
function readLegacySettingsPayload() {
    try {
        const raw = readCookie(LEGACY_SETTINGS_COOKIE);
        if (!raw)
            return null;
        const parsed = JSON.parse(raw);
        return {
            provider: typeof parsed.provider === 'string' && isProvider(parsed.provider) ? parsed.provider : 'openai',
            model: typeof parsed.model === 'string' ? parsed.model : '',
        };
    }
    catch {
        return null;
    }
}
function writeSettingsPayload(payload) {
    writeCookie(SETTINGS_COOKIE, JSON.stringify(payload));
}
function parseSecretPayload(raw) {
    if (!raw)
        return null;
    try {
        const parsed = JSON.parse(raw);
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
    }
    catch {
        return null;
    }
}
function readConfigSecretPayload(configId) {
    return parseSecretPayload(readCookie(secretCookieName(configId)));
}
function readLegacySecretPayload() {
    return parseSecretPayload(readCookie(LEGACY_SECRET_COOKIE));
}
function migrateWorkspaceState(state) {
    const workspaceId = typeof state.workspaceId === 'string' && state.workspaceId ? state.workspaceId : newWorkspaceId();
    const title = typeof state.title === 'string' && state.title.trim() ? state.title : sample_1.sampleState.title;
    const threads = Array.isArray(state.threads) ? state.threads : [];
    return {
        ...createWorkspaceState(title, workspaceId),
        ...state,
        workspaceId,
        title,
        threads: threads.map((thread) => {
            const stripped = { ...thread };
            delete stripped.provider;
            delete stripped.providerConfigId;
            delete stripped.model;
            return {
                ...stripped,
                context: Array.isArray(stripped.context) ? stripped.context.map((msg) => (0, mediaUtils_1.migrateMessage)(msg)) : [],
                nodes: Array.isArray(stripped.nodes)
                    ? stripped.nodes.map((node) => {
                        if (node.kind === 'chat') {
                            return {
                                ...node,
                                messages: Array.isArray(node.messages) ? node.messages.map((msg) => (0, mediaUtils_1.migrateMessage)(msg)) : [],
                            };
                        }
                        return node;
                    })
                    : [],
            };
        }),
        selectedThreadId: typeof state.selectedThreadId === 'string' ? state.selectedThreadId : null,
        selectedNodeId: typeof state.selectedNodeId === 'string' ? state.selectedNodeId : null,
        densityOverlay: typeof state.densityOverlay === 'boolean' ? state.densityOverlay : sample_1.sampleState.densityOverlay,
        panX: typeof state.panX === 'number' && Number.isFinite(state.panX) ? state.panX : sample_1.sampleState.panX,
        panY: typeof state.panY === 'number' && Number.isFinite(state.panY) ? state.panY : sample_1.sampleState.panY,
        zoom: typeof state.zoom === 'number' && Number.isFinite(state.zoom) ? state.zoom : sample_1.sampleState.zoom,
        version: typeof state.version === 'number' && Number.isFinite(state.version) ? state.version : sample_1.sampleState.version,
    };
}
async function encryptSecret(secret, passphrase) {
    const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await crypto.subtle.deriveKey({
        name: 'PBKDF2',
        hash: 'SHA-256',
        salt,
        iterations: PBKDF2_ITERATIONS,
    }, keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(secret));
    return {
        version: 1,
        iterations: PBKDF2_ITERATIONS,
        salt: toBase64(salt),
        iv: toBase64(iv),
        ciphertext: toBase64(new Uint8Array(ciphertext)),
    };
}
async function decryptSecret(payload, passphrase) {
    const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({
        name: 'PBKDF2',
        hash: 'SHA-256',
        salt: fromBase64(payload.salt),
        iterations: payload.iterations,
    }, keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(payload.iv) }, key, fromBase64(payload.ciphertext));
    return new TextDecoder().decode(plaintext);
}
function readCookie(name) {
    const prefix = `${encodeURIComponent(name)}=`;
    const entry = document.cookie.split('; ').find((part) => part.startsWith(prefix));
    return entry ? decodeURIComponent(entry.slice(prefix.length)) : null;
}
function writeCookie(name, value) {
    const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Strict${secure}`;
}
function deleteCookie(name) {
    document.cookie = `${encodeURIComponent(name)}=; path=/; max-age=0`;
}
function toBase64(bytes) {
    let binary = '';
    for (const byte of bytes)
        binary += String.fromCharCode(byte);
    return btoa(binary);
}
function fromBase64(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1)
        bytes[index] = binary.charCodeAt(index);
    return bytes;
}
