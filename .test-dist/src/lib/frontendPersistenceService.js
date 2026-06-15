"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FrontendPersistenceService = void 0;
const api_1 = require("./api");
const store_1 = require("./store");
class FrontendPersistenceService {
    settingsMapper;
    pendingWrite = null;
    constructor(settingsMapper) {
        this.settingsMapper = settingsMapper;
    }
    async bootstrap() {
        try {
            const [remoteWorkspaceStore, remoteSettings] = await Promise.all([
                (0, api_1.apiLoadWorkspaceStore)(),
                (0, api_1.apiLoadSettings)(),
            ]);
            return {
                workspaceStore: remoteWorkspaceStore ?? (0, store_1.defaultWorkspaceStore)(),
                settings: remoteSettings ? this.settingsMapper.hydrate(remoteSettings) : (0, store_1.defaultSettings)(),
                notice: null,
            };
        }
        catch {
            return {
                workspaceStore: (0, store_1.defaultWorkspaceStore)(),
                settings: (0, store_1.defaultSettings)(),
                notice: 'Backend unavailable — data will sync once the server is reachable.',
            };
        }
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
