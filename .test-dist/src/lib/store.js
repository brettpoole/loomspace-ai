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
exports.defaultWorkspaceStore = defaultWorkspaceStore;
exports.defaultSettings = defaultSettings;
exports.loadModelCache = loadModelCache;
exports.saveModelCache = saveModelCache;
exports.deleteProviderConfig = deleteProviderConfig;
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
const sample_1 = require("./sample");
const mediaUtils_1 = require("./mediaUtils");
const MODEL_CACHE_KEY = 'loomspace.model-cache.v1';
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
    const nextTitle = typeof title === 'string' && title.trim() ? title.trim() : sample_1.sampleState.title;
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
function defaultSettings() {
    return { activeProviderConfigId: '', providerConfigs: [] };
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
function deleteProviderConfig(settings, configId) {
    const providerConfigs = settings.providerConfigs.filter((config) => config.id !== configId);
    const activeProviderConfigId = settings.activeProviderConfigId === configId
        ? providerConfigs[0]?.id ?? 'openai'
        : settings.activeProviderConfigId;
    return { activeProviderConfigId, providerConfigs };
}
function computeMetrics(state) {
    const threads = Array.isArray(state.threads) ? state.threads : [];
    const chatCount = threads.reduce((sum, thread) => sum + (Array.isArray(thread.nodes) ? thread.nodes.filter((node) => node.kind === 'chat').length : 0), 0);
    const nodeCount = threads.reduce((sum, thread) => sum + (Array.isArray(thread.nodes) ? thread.nodes.length : 0), 0);
    const density = chatCount / Math.max(threads.length || 1, 1);
    const saturation = Math.min(1, nodeCount / Math.max(threads.length * 6 || 1, 1));
    return { threadCount: threads.length, nodeCount, chatCount, density, saturation };
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
