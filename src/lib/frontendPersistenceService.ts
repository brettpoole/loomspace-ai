import {
  apiLoadSettings,
  apiLoadWorkspaceStore,
  apiSaveSettingsWithSync,
  apiSaveWorkspaceStoreWithSync,
  type SaveServerSettingsPayload,
  type ServerConflictError,
} from './api';
import { defaultSettings, defaultWorkspaceStore } from './store';
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

  async bootstrap(): Promise<BootstrapResult> {
    try {
      const [remoteWorkspaceStore, remoteSettings] = await Promise.all([
        apiLoadWorkspaceStore(),
        apiLoadSettings(),
      ]);

      return {
        workspaceStore: remoteWorkspaceStore ?? defaultWorkspaceStore(),
        settings: remoteSettings ? this.settingsMapper.hydrate(remoteSettings) : defaultSettings(),
        notice: null,
      };
    } catch {
      return {
        workspaceStore: defaultWorkspaceStore(),
        settings: defaultSettings(),
        notice: 'Backend unavailable — data will sync once the server is reachable.',
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
