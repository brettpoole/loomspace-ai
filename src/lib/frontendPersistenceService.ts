import {
  apiLoadSettings,
  apiLoadWorkspaceStore,
  apiSaveSettingsWithSync,
  apiSaveWorkspaceStoreWithSync,
  apiStoreKey,
  type SaveServerSettingsPayload,
  type ServerConflictError,
} from './api';
import { SettingsSnapshotMapper } from './settingsSnapshotMapper';
import type { AISettings, PersistedWorkspaceStore } from './types';

interface PendingWrite {
  settings?: SaveServerSettingsPayload;
  workspace?: PersistedWorkspaceStore;
}

export interface BootstrapResult {
  workspaceStore: PersistedWorkspaceStore;
  settings: AISettings;
  notice: string | null;
}

export interface ConflictResolutionResult {
  workspaceStore?: PersistedWorkspaceStore;
  settings?: AISettings;
}

export class FrontendPersistenceService {
  private pendingWrite: PendingWrite | null = null;

  constructor(private readonly settingsMapper: SettingsSnapshotMapper) {}

  async bootstrap(localWorkspaceStore: PersistedWorkspaceStore, localSettings: AISettings): Promise<BootstrapResult> {
    try {
      const [remoteWorkspaceStore, remoteSettings] = await Promise.all([
        apiLoadWorkspaceStore(),
        apiLoadSettings(),
      ]);

      const nextWorkspaceStore = remoteWorkspaceStore ?? localWorkspaceStore;
      const nextSettings = remoteSettings ? this.settingsMapper.hydrate(remoteSettings) : localSettings;

      if (!remoteWorkspaceStore) {
        await apiSaveWorkspaceStoreWithSync(localWorkspaceStore);
      }

      let notice: string | null = null;
      if (!remoteSettings) {
        await apiSaveSettingsWithSync(this.settingsMapper.serialize(localSettings));
        const localPlaintextKeys = localSettings.providerConfigs.filter((config) => config.apiKey.trim());
        await Promise.all(localPlaintextKeys.map((config) => apiStoreKey(config.id, config.apiKey.trim())));
        if (localSettings.providerConfigs.some((config) => config.hasEncryptedApiKey && !config.apiKey.trim())) {
          notice = 'Legacy browser-only keys need one manual re-save to move them to the backend.';
        }
      }

      return {
        workspaceStore: nextWorkspaceStore,
        settings: nextSettings,
        notice,
      };
    } catch {
      return {
        workspaceStore: localWorkspaceStore,
        settings: localSettings,
        notice: 'Backend unavailable — using the browser cache until the server is reachable again.',
      };
    }
  }

  async saveWorkspaceStore(store: PersistedWorkspaceStore): Promise<ServerConflictError | null> {
    const ok = await apiSaveWorkspaceStoreWithSync(store);
    if (ok) return null;
    this.pendingWrite = { ...(this.pendingWrite ?? {}), workspace: store };
    return this.createConflictError('Sync conflict detected — another tab or device may have updated the workspace');
  }

  async saveSettings(settings: AISettings): Promise<ServerConflictError | null> {
    const payload = this.settingsMapper.serialize(settings);
    const result = await apiSaveSettingsWithSync(payload);
    if (result !== null) return null;
    this.pendingWrite = { ...(this.pendingWrite ?? {}), settings: payload };
    return this.createConflictError('Sync conflict detected — another tab or device may have updated settings');
  }

  async resolveConflict(): Promise<ConflictResolutionResult> {
    const pending = this.pendingWrite ? { ...this.pendingWrite } : null;
    this.pendingWrite = null;

    const [remoteSettings, remoteWorkspaceStore] = await Promise.all([
      apiLoadSettings(),
      apiLoadWorkspaceStore(),
    ]);

    if (pending?.settings) {
      const settingsResult = await apiSaveSettingsWithSync(pending.settings);
      if (settingsResult === null) {
        this.pendingWrite = { ...(this.pendingWrite ?? {}), settings: pending.settings };
      }
    }

    if (pending?.workspace) {
      const ok = await apiSaveWorkspaceStoreWithSync(pending.workspace);
      if (!ok) {
        this.pendingWrite = { ...(this.pendingWrite ?? {}), workspace: pending.workspace };
      }
    }

    return {
      settings: remoteSettings ? this.settingsMapper.hydrate(remoteSettings) : undefined,
      workspaceStore: remoteWorkspaceStore ?? undefined,
    };
  }

  clearPendingWrites() {
    this.pendingWrite = null;
  }

  private createConflictError(message: string): ServerConflictError {
    const error = new Error(message) as ServerConflictError;
    error.status = 409;
    error.code = 'CONFLICT';
    error.serverUpdatedAt = new Date().toISOString();
    return error;
  }
}
