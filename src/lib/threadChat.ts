import type {
  AIProviderConfig,
  AISettings,
  GenerationParams,
  MediaAttachment,
  ThreadLane,
} from './types';

export interface ComposerState {
  draft: string;
  attachments: MediaAttachment[];
}

export const EMPTY_COMPOSER_STATE: ComposerState = { draft: '', attachments: [] };

type ChatVerb = 'send' | 'retry';

interface ThreadChatRuntime {
  thread: ThreadLane | null;
  settings: AISettings;
  activeProviderConfig: AIProviderConfig | null;
  composerKey: string | null;
  composerState: ComposerState;
  threadError: string | null;
  threadBusy: boolean;
  updateComposerState: (key: string | null, updater: (current: ComposerState) => ComposerState) => void;
  setThreadChatError: (threadId: string, message: string) => void;
  setProviderError: (message: string) => void;
  setError: (message: string) => void;
  openProviderSetup: (configId?: string) => void;
}

export class ThreadChat {
  constructor(private readonly runtime: ThreadChatRuntime) {}

  get thread() {
    return this.runtime.thread;
  }

  get id() {
    return this.runtime.thread?.id ?? null;
  }

  get history() {
    return this.runtime.thread?.context ?? [];
  }

  get nodes() {
    return this.runtime.thread?.nodes ?? [];
  }

  get modelSettings() {
    return this.runtime.thread?.modelSettings;
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

  get threadParams(): GenerationParams | undefined {
    return this.runtime.thread?.modelSettings?.params;
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
    this.runtime.updateComposerState(this.runtime.composerKey, () => EMPTY_COMPOSER_STATE);
  }

  reportThreadError(message: string) {
    if (!this.runtime.thread) {
      this.runtime.setError(message);
      return;
    }
    this.runtime.setThreadChatError(this.runtime.thread.id, message);
  }

  ensureSendableConfig(verb: ChatVerb): AIProviderConfig | null {
    const activeConfig = this.runtime.activeProviderConfig;
    if (!activeConfig) {
      if (verb === 'send') {
        this.runtime.setError('Add an AI profile to start chatting.');
        this.runtime.openProviderSetup();
      } else {
        this.runtime.setError('Pick an AI profile first.');
      }
      return null;
    }
    if (
      !activeConfig.apiKey.trim() &&
      !activeConfig.hasEncryptedApiKey &&
      activeConfig.kind !== 'openai-compatible-custom'
    ) {
      const message = 'Add your API key to this profile first.';
      this.runtime.setError(message);
      this.runtime.setProviderError(message);
      this.runtime.openProviderSetup(activeConfig.id);
      return null;
    }
    if (!activeConfig.model.trim()) {
      const message = `Select a model for this AI profile before ${verb === 'send' ? 'sending' : 'retrying'}.`;
      this.runtime.setError(message);
      this.runtime.setProviderError(message);
      this.runtime.openProviderSetup(activeConfig.id);
      return null;
    }
    return activeConfig;
  }
}
