"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatProvider = exports.Provider = void 0;
exports.snapshotThreadModelSettings = snapshotThreadModelSettings;
exports.providerModelCacheKey = providerModelCacheKey;
exports.sameProviderModelSource = sameProviderModelSource;
const api_1 = require("./api");
const store_1 = require("./store");
function cloneGenerationParams(params) {
    if (!params)
        return undefined;
    const next = { ...params };
    if (params.stop)
        next.stop = [...params.stop];
    return Object.keys(next).length > 0 ? next : undefined;
}
function snapshotThreadModelSettings(config, overrides = {}) {
    return {
        providerConfigId: overrides.providerConfigId ?? config?.id ?? null,
        model: overrides.model ?? config?.model ?? '',
        params: overrides.params !== undefined ? cloneGenerationParams(overrides.params) : cloneGenerationParams(config?.params),
    };
}
function providerModelCacheKey(config) {
    const baseUrl = config.baseUrl?.trim().toLowerCase() ?? '';
    return `provider:${config.kind}:${baseUrl}`;
}
function sameProviderModelSource(left, right) {
    const leftBaseUrl = left.baseUrl?.trim().toLowerCase() ?? '';
    const rightBaseUrl = right.baseUrl?.trim().toLowerCase() ?? '';
    return left.kind === right.kind && leftBaseUrl === rightBaseUrl;
}
class Provider {
    runtime;
    constructor(runtime) {
        this.runtime = runtime;
    }
    get config() {
        return this.runtime.settings.providerConfigs.find((config) => config.id === this.runtime.configId) ?? null;
    }
    get id() {
        return this.config?.id ?? null;
    }
    get label() {
        return this.config?.label ?? '';
    }
    get model() {
        return this.config?.model ?? '';
    }
    get models() {
        const config = this.config;
        if (!config)
            return [];
        return this.runtime.modelCache[config.id] ?? this.runtime.modelCache[providerModelCacheKey(config)] ?? [];
    }
    get isLoadingModels() {
        return this.config?.id === this.runtime.modelsLoadingConfigId;
    }
    get hasCachedModels() {
        return this.models.length > 0;
    }
    patch(patch) {
        const config = this.config;
        if (!config)
            return;
        this.runtime.setProviderError(null);
        this.runtime.setSettingsNotice(null);
        this.runtime.setSettings((current) => ({
            ...current,
            providerConfigs: current.providerConfigs.map((entry) => (entry.id === config.id ? { ...entry, ...patch } : entry)),
        }));
    }
    patchParams(patch) {
        const config = this.config;
        if (!config)
            return;
        const next = { ...(config.params ?? {}), ...patch };
        Object.keys(next).forEach((key) => {
            if (next[key] === undefined)
                delete next[key];
        });
        this.patch({ params: next });
    }
    setActive() {
        const config = this.config;
        if (!config)
            return;
        const cached = this.runtime.modelCache[config.id] ?? this.runtime.modelCache[providerModelCacheKey(config)];
        const nextModel = cached?.[0] ?? config.model ?? (0, store_1.providerInfo)(config.kind).defaultModel;
        this.runtime.setSettings((current) => ({
            ...current,
            activeProviderConfigId: config.id,
            providerConfigs: current.providerConfigs.map((entry) => entry.id === config.id ? { ...entry, model: nextModel } : entry),
        }));
    }
    async saveKey() {
        const targetConfig = this.config;
        const candidate = targetConfig?.apiKey.trim() ?? '';
        if (!targetConfig) {
            const message = 'No profile found.';
            this.runtime.setProviderError(message);
            this.runtime.setSettingsNotice(message);
            return;
        }
        if (!candidate && targetConfig.kind !== 'openai-compatible-custom') {
            const message = 'Enter your API key first.';
            this.runtime.setProviderError(message);
            this.runtime.setSettingsNotice(message);
            return;
        }
        if (targetConfig.kind === 'openai-compatible-custom' && !candidate && !targetConfig.hasEncryptedApiKey) {
            this.runtime.setSettingsNotice('No API key to save. The profile can be used without a key.');
            return;
        }
        this.runtime.setSavingSettings(true);
        this.runtime.setProviderError(null);
        this.runtime.setSettingsNotice(null);
        try {
            const settingsResult = await (0, api_1.apiSaveSettingsWithSync)(this.runtime.settingsSnapshotMapper.serialize(this.runtime.settingsRef.current));
            if (settingsResult === null) {
                this.runtime.setSettingsNotice('Settings save conflict — retrying after merge.');
                await this.runtime.handleSyncConflict({
                    status: 409,
                    code: 'CONFLICT',
                    serverUpdatedAt: new Date().toISOString(),
                    name: 'ConflictError',
                    message: 'Settings save conflict — retrying after merge.',
                });
                const retryResult = await (0, api_1.apiSaveSettingsWithSync)(this.runtime.settingsSnapshotMapper.serialize(this.runtime.settingsRef.current));
                if (retryResult === null) {
                    this.runtime.setProviderError('Could not save settings. Please refresh and try again.');
                    return;
                }
            }
            await (0, api_1.apiStoreKey)(targetConfig.id, candidate);
            this.runtime.clearProviderSecret(targetConfig.id);
            const refreshed = await (0, api_1.apiGetProfile)(targetConfig.id);
            this.patch({ apiKey: '', hasEncryptedApiKey: refreshed.hasKey });
            const nextConfig = this.runtime.settingsRef.current.providerConfigs.find((config) => config.id === targetConfig.id) ?? null;
            this.runtime.setSettingsNotice(refreshed.hasKey ? 'Key saved to the backend.' : 'Key save did not persist.');
            if (nextConfig) {
                await this.refreshModels({ ...nextConfig, apiKey: '', hasEncryptedApiKey: refreshed.hasKey }, { requireKey: false, updateSelectedModel: true });
            }
        }
        catch (err) {
            const message = err instanceof Error ? err.message : 'Saving the key failed.';
            this.runtime.setProviderError(message);
            this.runtime.setSettingsNotice(message);
        }
        finally {
            this.runtime.setSavingSettings(false);
        }
    }
    async deleteSavedKey() {
        const targetConfig = this.config;
        if (!targetConfig)
            return;
        const confirmed = targetConfig.hasEncryptedApiKey ? window.confirm('Delete the saved key from the backend?') : true;
        if (!confirmed)
            return;
        this.runtime.setSavingSettings(true);
        this.runtime.setProviderError(null);
        this.runtime.setSettingsNotice(null);
        try {
            await (0, api_1.apiClearKey)(targetConfig.id);
            this.runtime.clearProviderSecret(targetConfig.id);
            this.patch({ apiKey: '', hasEncryptedApiKey: false });
            this.runtime.setSettingsNotice('Saved key deleted from the backend.');
        }
        catch (err) {
            const message = err instanceof Error ? err.message : 'Deleting the saved key failed.';
            this.runtime.setProviderError(message);
            this.runtime.setSettingsNotice(message);
        }
        finally {
            this.runtime.setSavingSettings(false);
        }
    }
    async refreshModels(configOverride, options = {}) {
        const config = configOverride ?? this.config;
        if (!config)
            return false;
        const typedApiKey = config.apiKey.trim();
        if (!typedApiKey && !config.hasEncryptedApiKey && config.kind !== 'openai-compatible-custom') {
            if (options.requireKey !== false)
                this.runtime.setProviderError('Add your API key to list models.');
            return false;
        }
        this.runtime.setModelsLoadingConfigId(config.id);
        this.runtime.setProviderError(null);
        this.runtime.setSettingsNotice(null);
        try {
            const ids = typedApiKey ? await (0, store_1.fetchProviderModels)(config) : await (0, api_1.apiFetchModels)(config.id);
            const currentConfig = this.runtime.settingsRef.current.providerConfigs.find((entry) => entry.id === config.id) ?? null;
            if (!currentConfig || !sameProviderModelSource(currentConfig, config))
                return false;
            const providerKey = providerModelCacheKey(config);
            const sourceConfigIds = this.runtime.settingsRef.current.providerConfigs
                .filter((entry) => sameProviderModelSource(entry, config))
                .map((entry) => entry.id);
            this.runtime.setModelCache((current) => {
                const next = { ...current };
                for (const id of sourceConfigIds)
                    delete next[id];
                delete next[providerKey];
                if (ids.length > 0) {
                    next[config.id] = ids;
                    next[providerKey] = ids;
                }
                return next;
            });
            if (options.updateSelectedModel !== false) {
                this.runtime.setSettings((current) => {
                    let changed = false;
                    const providerConfigs = current.providerConfigs.map((entry) => {
                        if (!sameProviderModelSource(entry, config))
                            return entry;
                        if (ids.length === 0) {
                            if (!entry.model)
                                return entry;
                            changed = true;
                            return { ...entry, model: '' };
                        }
                        if (ids.includes(entry.model))
                            return entry;
                        changed = true;
                        return { ...entry, model: ids[0] };
                    });
                    return changed ? { ...current, providerConfigs } : current;
                });
            }
            this.runtime.setSettingsNotice(ids.length === 0 ? `No models returned for ${config.label}.` : `Loaded ${ids.length} models for ${config.label}.`);
            return true;
        }
        catch (err) {
            this.runtime.setProviderError(err instanceof Error ? err.message : `Failed to list models for ${config.label}`);
            return false;
        }
        finally {
            this.runtime.setModelsLoadingConfigId((current) => (current === config.id ? null : current));
        }
    }
    openSetup() {
        const configs = this.runtime.settings.providerConfigs;
        this.runtime.setLeftPanelOpen(false);
        this.runtime.setProviderMenuOpen(false);
        if (configs.length === 0) {
            const next = (0, store_1.createProviderConfig)('openai');
            this.runtime.setSettings((current) => ({
                ...current,
                providerConfigs: [...current.providerConfigs, next],
            }));
            this.runtime.setSettingsEditorConfigId(next.id);
            this.runtime.setAiSettingsModalOpen(true);
            this.runtime.setSettingsNotice(null);
            this.runtime.setProviderError(null);
            return;
        }
        this.runtime.setSettingsEditorConfigId(this.id ?? this.runtime.settings.activeProviderConfigId ?? configs[0]?.id ?? null);
        this.runtime.setAiSettingsModalOpen(true);
    }
    deleteProfile() {
        const target = this.config;
        if (!target)
            return;
        const confirmed = window.confirm(`Delete AI profile "${target.label}"? Its saved key will be removed from the backend.`);
        if (!confirmed)
            return;
        this.runtime.clearProviderSecret(target.id);
        this.runtime.setSettings((0, store_1.deleteProviderConfig)(this.runtime.settings, target.id));
        this.runtime.setModelCache((current) => {
            const copy = { ...current };
            delete copy[target.id];
            return copy;
        });
        this.runtime.setSettingsNotice(`Deleted AI profile "${target.label}".`);
        this.runtime.setProviderError(null);
        this.runtime.setError(null);
    }
}
exports.Provider = Provider;
class ChatProvider {
    runtime;
    constructor(runtime) {
        this.runtime = runtime;
    }
    get thread() {
        return this.runtime.thread;
    }
    get composerKey() {
        return this.runtime.composerKey;
    }
    get composer() {
        return this.runtime.composerState;
    }
    get draft() {
        return this.runtime.composerState.draft;
    }
    get attachments() {
        return this.runtime.composerState.attachments;
    }
    get threadError() {
        return this.runtime.threadError;
    }
    get isBusy() {
        return this.runtime.threadBusy;
    }
    get providerConfigId() {
        return this.runtime.thread?.modelSettings?.providerConfigId ?? this.runtime.activeProviderConfig?.id ?? null;
    }
    get providerConfig() {
        if (!this.runtime.thread)
            return this.runtime.activeProviderConfig;
        const configId = this.providerConfigId;
        if (!configId)
            return this.runtime.activeProviderConfig;
        return this.runtime.settings.providerConfigs.find((config) => config.id === configId) ?? this.runtime.activeProviderConfig;
    }
    get model() {
        return this.runtime.thread?.modelSettings?.model || this.providerConfig?.model || '';
    }
    get threadParams() {
        return this.runtime.thread?.modelSettings?.params;
    }
    get models() {
        const config = this.providerConfig;
        if (!config)
            return [];
        return this.runtime.modelCache[config.id] ?? this.runtime.modelCache[providerModelCacheKey(config)] ?? [];
    }
    ensureSendableConfig(verb) {
        const config = this.providerConfig;
        if (!config) {
            this.runtime.setError(verb === 'send' ? 'Add an AI profile to start chatting.' : 'Pick an AI profile first.');
            if (verb === 'send')
                this.runtime.openProviderSetup();
            return null;
        }
        if (!config.apiKey.trim() &&
            !config.hasEncryptedApiKey &&
            config.kind !== 'openai-compatible-custom') {
            const message = 'Add your API key to this profile first.';
            this.runtime.setError(message);
            this.runtime.setProviderError(message);
            this.runtime.openProviderSetup(config.id);
            return null;
        }
        if (!this.model.trim()) {
            const message = `Select a model for this AI profile before ${verb === 'send' ? 'sending' : 'retrying'}.`;
            this.runtime.setError(message);
            this.runtime.setProviderError(message);
            this.runtime.openProviderSetup(config.id);
            return null;
        }
        return config;
    }
    setThreadModelSettings(modelSettings) {
        const thread = this.runtime.thread;
        if (!thread)
            return;
        this.runtime.setThreadState((threads) => threads.map((entry) => (entry.id === thread.id ? { ...entry, modelSettings: { ...modelSettings } } : entry)));
    }
    patchThreadParams(patch) {
        const thread = this.runtime.thread;
        if (!thread)
            return;
        const ts = thread.modelSettings ?? snapshotThreadModelSettings(this.providerConfig);
        const currentParams = { ...(ts.params ?? {}) };
        const next = { ...currentParams, ...patch };
        Object.keys(next).forEach((key) => {
            if (next[key] === undefined)
                delete next[key];
        });
        this.setThreadModelSettings(snapshotThreadModelSettings(this.providerConfig, {
            providerConfigId: ts.providerConfigId,
            model: ts.model,
            params: Object.keys(next).length > 0 ? next : undefined,
        }));
    }
    setProviderConfigId(providerConfigId) {
        const thread = this.runtime.thread;
        if (!thread)
            return;
        const config = this.runtime.settings.providerConfigs.find((entry) => entry.id === providerConfigId) ?? null;
        this.setThreadModelSettings(snapshotThreadModelSettings(config));
    }
    setModel(model) {
        const thread = this.runtime.thread;
        if (!thread)
            return;
        const ts = thread.modelSettings ?? snapshotThreadModelSettings(this.providerConfig);
        this.setThreadModelSettings(snapshotThreadModelSettings(this.providerConfig, {
            providerConfigId: ts.providerConfigId,
            model,
            params: ts.params,
        }));
    }
    resetThreadParams() {
        const thread = this.runtime.thread;
        if (!thread)
            return;
        const config = this.providerConfig;
        const ts = thread.modelSettings ?? snapshotThreadModelSettings(config);
        this.setThreadModelSettings(snapshotThreadModelSettings(config, {
            providerConfigId: ts.providerConfigId,
            model: ts.model,
            params: undefined,
        }));
    }
    setDraft(draft) {
        this.runtime.updateComposerState(this.runtime.composerKey, (current) => ({ ...current, draft }));
    }
    removeAttachment(attachmentId) {
        this.runtime.updateComposerState(this.runtime.composerKey, (current) => ({
            ...current,
            attachments: current.attachments.filter((attachment) => attachment.id !== attachmentId),
        }));
    }
    appendAttachments(attachments) {
        this.runtime.updateComposerState(this.runtime.composerKey, (current) => ({ ...current, attachments: [...current.attachments, ...attachments] }));
    }
    clearComposer() {
        this.runtime.updateComposerState(this.runtime.composerKey, () => ({ draft: '', attachments: [] }));
    }
    reportThreadError(message) {
        if (!this.runtime.thread) {
            this.runtime.setError(message);
            return;
        }
        this.runtime.setThreadChatError(this.runtime.thread.id, message);
    }
    async requestReply(messages) {
        const config = this.providerConfig;
        const thread = this.runtime.thread;
        if (!config || !thread)
            throw new Error('Missing thread provider configuration.');
        return this.runtime.replyService.requestReply(config, thread, messages);
    }
}
exports.ChatProvider = ChatProvider;
