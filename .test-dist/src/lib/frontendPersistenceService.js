"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FrontendPersistenceService = void 0;
const api_1 = require("./api");
class FrontendPersistenceService {
    settingsMapper;
    pendingWrite = null;
    constructor(settingsMapper) {
        this.settingsMapper = settingsMapper;
    }
    async bootstrap(localWorkspaceStore, localSettings) {
        let remoteWorkspaceStore;
        let remoteSettings;
        try {
            [remoteWorkspaceStore, remoteSettings] = await Promise.all([
                (0, api_1.apiLoadWorkspaceStore)(),
                (0, api_1.apiLoadSettings)(),
            ]);
        }
        catch {
            return {
                workspaceStore: localWorkspaceStore,
                settings: localSettings,
                notice: 'Backend unavailable — using the browser cache until the server is reachable again.',
            };
        }
        const nextWorkspaceStore = remoteWorkspaceStore ?? localWorkspaceStore;
        const nextSettings = remoteSettings ? this.settingsMapper.hydrate(remoteSettings) : localSettings;
        if (!remoteWorkspaceStore) {
            await (0, api_1.apiSaveWorkspaceStoreWithSync)(localWorkspaceStore);
        }
        let notice = null;
        if (!remoteSettings) {
            await (0, api_1.apiSaveSettingsWithSync)(this.settingsMapper.serialize(localSettings));
            const localPlaintextKeys = localSettings.providerConfigs.filter((config) => config.apiKey.trim());
            await Promise.all(localPlaintextKeys.map((config) => (0, api_1.apiStoreKey)(config.id, config.apiKey.trim())));
            if (localSettings.providerConfigs.some((config) => config.hasEncryptedApiKey && !config.apiKey.trim())) {
                notice = 'Legacy browser-only keys need one manual re-save to move them to the backend.';
            }
        }
        return {
            workspaceStore: nextWorkspaceStore,
            settings: nextSettings,
            notice,
        };
    }
    async saveWorkspaceStore(store) {
        const ok = await (0, api_1.apiSaveWorkspaceStoreWithSync)(store);
        if (ok)
            return null;
        this.pendingWrite = { ...(this.pendingWrite ?? {}), workspace: store };
        return this.createConflictError('Sync conflict detected — another tab or device may have updated the workspace');
    }
    async saveSettings(settings) {
        const payload = this.settingsMapper.serialize(settings);
        const result = await (0, api_1.apiSaveSettingsWithSync)(payload);
        if (result !== null)
            return null;
        this.pendingWrite = { ...(this.pendingWrite ?? {}), settings: payload };
        return this.createConflictError('Sync conflict detected — another tab or device may have updated settings');
    }
    async resolveConflict() {
        const pending = this.pendingWrite ? { ...this.pendingWrite } : null;
        this.pendingWrite = null;
        const [remoteSettings, remoteWorkspaceStore] = await Promise.all([
            (0, api_1.apiLoadSettings)(),
            (0, api_1.apiLoadWorkspaceStore)(),
        ]);
        if (pending?.settings) {
            const settingsResult = await (0, api_1.apiSaveSettingsWithSync)(pending.settings);
            if (settingsResult === null) {
                this.pendingWrite = { ...(this.pendingWrite ?? {}), settings: pending.settings };
            }
        }
        if (pending?.workspace) {
            const ok = await (0, api_1.apiSaveWorkspaceStoreWithSync)(pending.workspace);
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
    createConflictError(message) {
        const error = new Error(message);
        error.status = 409;
        error.code = 'CONFLICT';
        error.serverUpdatedAt = new Date().toISOString();
        return error;
    }
}
exports.FrontendPersistenceService = FrontendPersistenceService;
