import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import {
  apiClearKey,
  apiFetchModels,
  apiGetProfile,
  apiSaveSettingsWithSync,
  apiStoreKey,
  type ServerConflictError,
} from './api';
import { providerInfo, clearProviderSecret, createProviderConfig, fetchProviderModels, deleteProviderConfig } from './store';
import type {
  AIProvider,
  AIProviderConfig,
  AISettings,
  GenerationParams,
  MediaAttachment,
  ThreadLane,
  ThreadModelSettings,
} from './types';
import type { SettingsSnapshotMapper } from './settingsSnapshotMapper';
import type { ThreadReplyService } from './threadReplyService';
import type { ComposerState } from './threadChat';

export type ModelCache = Record<string, string[]>;

function cloneGenerationParams(params: GenerationParams | undefined): GenerationParams | undefined {
  if (!params) return undefined;
  const next: GenerationParams = { ...params };
  if (params.stop) next.stop = [...params.stop];
  return Object.keys(next).length > 0 ? next : undefined;
}

export function snapshotThreadModelSettings(
  config: AIProviderConfig | null | undefined,
  overrides: Partial<ThreadModelSettings> = {},
): ThreadModelSettings {
  return {
    providerConfigId: overrides.providerConfigId ?? config?.id ?? null,
    model: overrides.model ?? config?.model ?? '',
    params: overrides.params !== undefined ? cloneGenerationParams(overrides.params) : cloneGenerationParams(config?.params),
  };
}

export function providerModelCacheKey(config: AIProviderConfig): string {
  const baseUrl = config.baseUrl?.trim().toLowerCase() ?? '';
  return `provider:${config.kind}:${baseUrl}`;
}

export function sameProviderModelSource(left: AIProviderConfig, right: AIProviderConfig): boolean {
  const leftBaseUrl = left.baseUrl?.trim().toLowerCase() ?? '';
  const rightBaseUrl = right.baseUrl?.trim().toLowerCase() ?? '';
  return left.kind === right.kind && leftBaseUrl === rightBaseUrl;
}

interface ProviderRuntime {
  configId: string;
  settings: AISettings;
  modelCache: ModelCache;
  modelsLoadingConfigId: string | null;
  settingsRef: MutableRefObject<AISettings>;
  setSettings: Dispatch<SetStateAction<AISettings>>;
  setModelCache: Dispatch<SetStateAction<ModelCache>>;
  setProviderError: (message: string | null) => void;
  setSettingsNotice: (message: string | null) => void;
  setSavingSettings: (saving: boolean) => void;
  clearProviderSecret: (configId: string) => void;
  handleSyncConflict: (conflict: ServerConflictError) => Promise<void>;
  settingsSnapshotMapper: SettingsSnapshotMapper;
  setModelsLoadingConfigId: (configId: string | null | ((current: string | null) => string | null)) => void;
  openProviderSetup: (configId?: string) => void;
  setSettingsEditorConfigId: (configId: string | null) => void;
  setLeftPanelOpen: (open: boolean) => void;
  setProviderMenuOpen: (open: boolean) => void;
  setAiSettingsModalOpen: (open: boolean) => void;
  setError: (message: string | null) => void;
}

export class Provider {
  constructor(private readonly runtime: ProviderRuntime) {}

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
    if (!config) return [];
    return this.runtime.modelCache[config.id] ?? this.runtime.modelCache[providerModelCacheKey(config)] ?? [];
  }

  get isLoadingModels() {
    return this.config?.id === this.runtime.modelsLoadingConfigId;
  }

  get hasCachedModels() {
    return this.models.length > 0;
  }

  patch(patch: Partial<AIProviderConfig>) {
    const config = this.config;
    if (!config) return;
    this.runtime.setProviderError(null);
    this.runtime.setSettingsNotice(null);
    this.runtime.setSettings((current) => ({
      ...current,
      providerConfigs: current.providerConfigs.map((entry) => (entry.id === config.id ? { ...entry, ...patch } : entry)),
    }));
  }

  patchParams(patch: Partial<GenerationParams>) {
    const config = this.config;
    if (!config) return;
    const next: GenerationParams = { ...(config.params ?? {}), ...patch };
    (Object.keys(next) as Array<keyof GenerationParams>).forEach((key) => {
      if (next[key] === undefined) delete next[key];
    });
    this.patch({ params: next });
  }

  setActive() {
    const config = this.config;
    if (!config) return;
    const cached = this.runtime.modelCache[config.id] ?? this.runtime.modelCache[providerModelCacheKey(config)];
    const nextModel = cached?.[0] ?? config.model ?? providerInfo(config.kind).defaultModel;
    this.runtime.setSettings((current) => ({
      ...current,
      activeProviderConfigId: config.id,
      providerConfigs: current.providerConfigs.map((entry) =>
        entry.id === config.id ? { ...entry, model: nextModel } : entry,
      ),
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
      const settingsResult = await apiSaveSettingsWithSync(this.runtime.settingsSnapshotMapper.serialize(this.runtime.settingsRef.current));
      if (settingsResult === null) {
        this.runtime.setSettingsNotice('Settings save conflict — retrying after merge.');
        await this.runtime.handleSyncConflict({
          status: 409,
          code: 'CONFLICT',
          serverUpdatedAt: new Date().toISOString(),
          name: 'ConflictError',
          message: 'Settings save conflict — retrying after merge.',
        } as ServerConflictError);
        const retryResult = await apiSaveSettingsWithSync(this.runtime.settingsSnapshotMapper.serialize(this.runtime.settingsRef.current));
        if (retryResult === null) {
          this.runtime.setProviderError('Could not save settings. Please refresh and try again.');
          return;
        }
      }
      await apiStoreKey(targetConfig.id, candidate);
      this.runtime.clearProviderSecret(targetConfig.id);
      const refreshed = await apiGetProfile(targetConfig.id);
      this.patch({ apiKey: '', hasEncryptedApiKey: refreshed.hasKey });
      const nextConfig = this.runtime.settingsRef.current.providerConfigs.find((config) => config.id === targetConfig.id) ?? null;
      this.runtime.setSettingsNotice(refreshed.hasKey ? 'Key saved to the backend.' : 'Key save did not persist.');
      if (nextConfig) {
        await this.refreshModels({ ...nextConfig, apiKey: '', hasEncryptedApiKey: refreshed.hasKey }, { requireKey: false, updateSelectedModel: true });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Saving the key failed.';
      this.runtime.setProviderError(message);
      this.runtime.setSettingsNotice(message);
    } finally {
      this.runtime.setSavingSettings(false);
    }
  }

  async deleteSavedKey() {
    const targetConfig = this.config;
    if (!targetConfig) return;
    const confirmed = targetConfig.hasEncryptedApiKey ? window.confirm('Delete the saved key from the backend?') : true;
    if (!confirmed) return;

    this.runtime.setSavingSettings(true);
    this.runtime.setProviderError(null);
    this.runtime.setSettingsNotice(null);
    try {
      await apiClearKey(targetConfig.id);
      this.runtime.clearProviderSecret(targetConfig.id);
      this.patch({ apiKey: '', hasEncryptedApiKey: false });
      this.runtime.setSettingsNotice('Saved key deleted from the backend.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Deleting the saved key failed.';
      this.runtime.setProviderError(message);
      this.runtime.setSettingsNotice(message);
    } finally {
      this.runtime.setSavingSettings(false);
    }
  }

  async refreshModels(configOverride?: AIProviderConfig, options: { requireKey?: boolean; updateSelectedModel?: boolean } = {}) {
    const config = configOverride ?? this.config;
    if (!config) return false;
    const typedApiKey = config.apiKey.trim();
    if (!typedApiKey && !config.hasEncryptedApiKey && config.kind !== 'openai-compatible-custom') {
      if (options.requireKey !== false) this.runtime.setProviderError('Add your API key to list models.');
      return false;
    }

    this.runtime.setModelsLoadingConfigId(config.id);
    this.runtime.setProviderError(null);
    this.runtime.setSettingsNotice(null);
    try {
      const ids = typedApiKey ? await fetchProviderModels(config) : await apiFetchModels(config.id);
      const currentConfig = this.runtime.settingsRef.current.providerConfigs.find((entry) => entry.id === config.id) ?? null;
      if (!currentConfig || !sameProviderModelSource(currentConfig, config)) return false;

      const providerKey = providerModelCacheKey(config);
      const sourceConfigIds = this.runtime.settingsRef.current.providerConfigs
        .filter((entry) => sameProviderModelSource(entry, config))
        .map((entry) => entry.id);

      this.runtime.setModelCache((current) => {
        const next = { ...current };
        for (const id of sourceConfigIds) delete next[id];
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
            if (!sameProviderModelSource(entry, config)) return entry;
            if (ids.length === 0) {
              if (!entry.model) return entry;
              changed = true;
              return { ...entry, model: '' };
            }
            if (ids.includes(entry.model)) return entry;
            changed = true;
            return { ...entry, model: ids[0] };
          });
          return changed ? { ...current, providerConfigs } : current;
        });
      }

      this.runtime.setSettingsNotice(ids.length === 0 ? `No models returned for ${config.label}.` : `Loaded ${ids.length} models for ${config.label}.`);
      return true;
    } catch (err) {
      this.runtime.setProviderError(err instanceof Error ? err.message : `Failed to list models for ${config.label}`);
      return false;
    } finally {
      this.runtime.setModelsLoadingConfigId((current) => (current === config.id ? null : current));
    }
  }

  openSetup() {
    const configs = this.runtime.settings.providerConfigs;
    this.runtime.setLeftPanelOpen(false);
    this.runtime.setProviderMenuOpen(false);
    if (configs.length === 0) {
      const next = createProviderConfig('openai');
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
    if (!target) return;
    const confirmed = window.confirm(`Delete AI profile "${target.label}"? Its saved key will be removed from the backend.`);
    if (!confirmed) return;
    this.runtime.clearProviderSecret(target.id);
    this.runtime.setSettings(deleteProviderConfig(this.runtime.settings, target.id));
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

interface ChatProviderRuntime {
  thread: ThreadLane | null;
  settings: AISettings;
  activeProviderConfigId: string;
  modelCache: ModelCache;
  composerKey: string | null;
  composerState: ComposerState;
  threadError: string | null;
  threadBusy: boolean;
  updateComposerState: (key: string | null, updater: (current: ComposerState) => ComposerState) => void;
  setThreadChatError: (threadId: string, message: string) => void;
  setThreadState: (updater: (threads: ThreadLane[]) => ThreadLane[]) => void;
  setProviderError: (message: string | null) => void;
  setError: (message: string | null) => void;
  openProviderSetup: (configId?: string) => void;
  replyService: ThreadReplyService;
  activeProviderConfig: AIProviderConfig | null;
}

export class ChatProvider {
  constructor(private readonly runtime: ChatProviderRuntime) {}

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
    if (!this.runtime.thread) return this.runtime.activeProviderConfig;
    const configId = this.providerConfigId;
    if (!configId) return this.runtime.activeProviderConfig;
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
    if (!config) return [];
    return this.runtime.modelCache[config.id] ?? this.runtime.modelCache[providerModelCacheKey(config)] ?? [];
  }

  ensureSendableConfig(verb: 'send' | 'retry') {
    const config = this.providerConfig;
    if (!config) {
      this.runtime.setError(verb === 'send' ? 'Add an AI profile to start chatting.' : 'Pick an AI profile first.');
      if (verb === 'send') this.runtime.openProviderSetup();
      return null;
    }
    if (
      !config.apiKey.trim() &&
      !config.hasEncryptedApiKey &&
      config.kind !== 'openai-compatible-custom'
    ) {
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

  setThreadModelSettings(modelSettings: ThreadModelSettings) {
    const thread = this.runtime.thread;
    if (!thread) return;
    this.runtime.setThreadState((threads) =>
      threads.map((entry) => (entry.id === thread.id ? { ...entry, modelSettings: { ...modelSettings } } : entry)),
    );
  }

  patchThreadParams(patch: Partial<GenerationParams>) {
    const thread = this.runtime.thread;
    if (!thread) return;
    const ts = thread.modelSettings ?? snapshotThreadModelSettings(this.providerConfig);
    const currentParams: GenerationParams = { ...(ts.params ?? {}) };
    const next: GenerationParams = { ...currentParams, ...patch };
    (Object.keys(next) as Array<keyof GenerationParams>).forEach((key) => {
      if (next[key] === undefined) delete next[key];
    });
    this.setThreadModelSettings(snapshotThreadModelSettings(this.providerConfig, {
      providerConfigId: ts.providerConfigId,
      model: ts.model,
      params: Object.keys(next).length > 0 ? next : undefined,
    }));
  }

  setProviderConfigId(providerConfigId: string) {
    const thread = this.runtime.thread;
    if (!thread) return;
    const config = this.runtime.settings.providerConfigs.find((entry) => entry.id === providerConfigId) ?? null;
    this.setThreadModelSettings(snapshotThreadModelSettings(config));
  }

  setModel(model: string) {
    const thread = this.runtime.thread;
    if (!thread) return;
    const ts = thread.modelSettings ?? snapshotThreadModelSettings(this.providerConfig);
    this.setThreadModelSettings(snapshotThreadModelSettings(this.providerConfig, {
      providerConfigId: ts.providerConfigId,
      model,
      params: ts.params,
    }));
  }

  resetThreadParams() {
    const thread = this.runtime.thread;
    if (!thread) return;
    const config = this.providerConfig;
    const ts = thread.modelSettings ?? snapshotThreadModelSettings(config);
    this.setThreadModelSettings(snapshotThreadModelSettings(config, {
      providerConfigId: ts.providerConfigId,
      model: ts.model,
      params: undefined,
    }));
  }

  setDraft(draft: string) {
    this.runtime.updateComposerState(this.runtime.composerKey, (current) => ({ ...current, draft }));
  }

  removeAttachment(attachmentId: string) {
    this.runtime.updateComposerState(
      this.runtime.composerKey,
      (current) => ({
        ...current,
        attachments: current.attachments.filter((attachment) => attachment.id !== attachmentId),
      }),
    );
  }

  appendAttachments(attachments: MediaAttachment[]) {
    this.runtime.updateComposerState(
      this.runtime.composerKey,
      (current) => ({ ...current, attachments: [...current.attachments, ...attachments] }),
    );
  }

  clearComposer() {
    this.runtime.updateComposerState(this.runtime.composerKey, () => ({ draft: '', attachments: [] }));
  }

  reportThreadError(message: string) {
    if (!this.runtime.thread) {
      this.runtime.setError(message);
      return;
    }
    this.runtime.setThreadChatError(this.runtime.thread.id, message);
  }

  async requestReply(messages: ThreadLane['context']) {
    const config = this.providerConfig;
    const thread = this.runtime.thread;
    if (!config || !thread) throw new Error('Missing thread provider configuration.');
    return this.runtime.replyService.requestReply(config, thread, messages);
  }
}
