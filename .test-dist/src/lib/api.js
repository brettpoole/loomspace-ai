"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.API_BASE = void 0;
exports.isServerConflictError = isServerConflictError;
exports.mergeSettingsServerFirst = mergeSettingsServerFirst;
exports.mergeWorkspaceServerFirst = mergeWorkspaceServerFirst;
exports.apiSaveSettingsWithSync = apiSaveSettingsWithSync;
exports.apiSaveWorkspaceStoreWithSync = apiSaveWorkspaceStoreWithSync;
exports.apiListProfiles = apiListProfiles;
exports.apiGetProfile = apiGetProfile;
exports.apiUpsertProfile = apiUpsertProfile;
exports.apiDeleteProfile = apiDeleteProfile;
exports.apiLoadSettings = apiLoadSettings;
exports.apiSaveSettings = apiSaveSettings;
exports.apiStoreKey = apiStoreKey;
exports.apiClearKey = apiClearKey;
exports.apiChat = apiChat;
exports.apiFetchModels = apiFetchModels;
exports.apiLoadWorkspaceStore = apiLoadWorkspaceStore;
exports.apiSaveWorkspaceStore = apiSaveWorkspaceStore;
exports.apiLoadWorkspace = apiLoadWorkspace;
exports.apiSaveWorkspace = apiSaveWorkspace;
exports.apiHealthCheck = apiHealthCheck;
/**
 * Backend API client for LoomSpace.
 *
 * All calls go to the local server (default http://localhost:8000).
 * The server holds API keys and proxies requests to AI providers.
 */
// Empty string = same-origin (frontend served by backend).
// In Vite dev, vite.config.ts proxies /api to http://127.0.0.1:8000.
exports.API_BASE = '';
function isServerConflictError(err) {
    return (typeof err === 'object' &&
        err !== null &&
        'status' in err &&
        err.status === 409 &&
        err.code === 'CONFLICT');
}
// ---------------------------------------------------------------------------
// Merge utilities — server-first strategy
// ---------------------------------------------------------------------------
/**
 * Merge local settings into server state.
 *
 * Local settings must win for matching provider IDs because the current client
 * is editing those values in real time and the backend does not enforce
 * optimistic concurrency for `/api/settings`. Server-only profiles are kept so
 * another tab/device cannot accidentally disappear from the merged payload.
 */
function mergeSettingsServerFirst(local, server) {
    if (!server)
        return local;
    const mergedById = new Map();
    for (const serverConfig of server.providerConfigs) {
        mergedById.set(serverConfig.id, {
            id: serverConfig.id,
            kind: serverConfig.kind,
            label: serverConfig.label,
            model: serverConfig.model,
            ...(serverConfig.baseUrl ? { baseUrl: serverConfig.baseUrl } : {}),
            ...(serverConfig.params ? { params: serverConfig.params } : {}),
        });
    }
    for (const localConfig of local.providerConfigs) {
        mergedById.set(localConfig.id, {
            id: localConfig.id,
            kind: localConfig.kind,
            label: localConfig.label,
            model: localConfig.model,
            ...(localConfig.baseUrl ? { baseUrl: localConfig.baseUrl } : {}),
            ...(localConfig.params ? { params: localConfig.params } : {}),
        });
    }
    const localIds = new Set(local.providerConfigs.map((config) => config.id));
    const serverOnlyConfigs = server.providerConfigs
        .filter((config) => !localIds.has(config.id))
        .map((config) => mergedById.get(config.id));
    const localConfigs = local.providerConfigs.map((config) => mergedById.get(config.id));
    const mergedConfigs = [...serverOnlyConfigs, ...localConfigs];
    const activeConfigExists = mergedConfigs.some((c) => c.id === local.activeProviderConfigId);
    return {
        activeProviderConfigId: activeConfigExists ? local.activeProviderConfigId : mergedConfigs[0]?.id ?? '',
        providerConfigs: mergedConfigs.map((c) => ({
            id: c.id,
            kind: c.kind,
            label: c.label,
            model: c.model,
            ...(c.baseUrl ? { baseUrl: c.baseUrl } : {}),
            ...(c.params ? { params: c.params } : {}),
        })),
    };
}
/**
 * Merge local workspace store into server state, server-first.
 * - Server workspaces take precedence (server wins on any conflict)
 * - New local workspaces (not on server) are added
 * - Active workspace: use server's if it exists in the merged set, otherwise keep local's
 */
function mergeWorkspaceServerFirst(local, server) {
    if (!server || !server.workspaces?.length)
        return local;
    // Build a map of server workspaces by id
    const serverWorkspaceMap = new Map(server.workspaces.map((w) => [w.id, w]));
    // Merge: use server workspaces as the base, add local ones not on server
    const mergedWorkspaces = [...server.workspaces];
    for (const localWs of local.workspaces) {
        if (!serverWorkspaceMap.has(localWs.id)) {
            mergedWorkspaces.push(localWs);
        }
    }
    // Active workspace: prefer server's if it exists in merged set
    const activeExistsInMerged = mergedWorkspaces.some((w) => w.id === server.activeWorkspaceId);
    const activeWorkspaceId = activeExistsInMerged ? server.activeWorkspaceId : local.activeWorkspaceId;
    return { activeWorkspaceId, workspaces: mergedWorkspaces };
}
// ---------------------------------------------------------------------------
// Sync-wrapped save functions
// ---------------------------------------------------------------------------
/**
 * Save settings with a sync-before-write step to detect stale data from
 * other tabs or devices.
 *
 * @returns The server-confirmed payload, or null if a conflict was detected
 *          and the caller should retry after merging.
 */
async function apiSaveSettingsWithSync(payload) {
    // Load fresh server state and track its updatedAt for conflict detection
    const serverSettings = await apiLoadSettings().catch(() => null);
    const serverUpdatedAt = serverSettings?.updatedAt ?? null;
    const merged = mergeSettingsServerFirst(payload, serverSettings);
    // Attempt the actual save (server uses lastSyncAt to detect conflicts)
    try {
        return await apiSaveSettings(merged, serverUpdatedAt ?? undefined);
    }
    catch (err) {
        if (isServerConflictError(err)) {
            return null;
        }
        throw err;
    }
}
/**
 * Save workspace store with a sync-before-write step.
 *
 * @returns true if the write succeeded, false if a conflict was detected
 *          and the caller should retry after merging.
 */
async function apiSaveWorkspaceStoreWithSync(store) {
    try {
        // Load fresh server state and track its updatedAt for conflict detection
        const serverStore = await apiLoadWorkspaceStore().catch(() => null);
        const serverUpdatedAt = serverStore?.updatedAt ?? null;
        const merged = mergeWorkspaceServerFirst(store, serverStore);
        // Send lastSyncAt so server can detect conflicts in the TOCTOU window
        await apiSaveWorkspaceStore(merged, serverUpdatedAt ?? undefined);
        return true;
    }
    catch (err) {
        if (isServerConflictError(err)) {
            return false;
        }
        throw err;
    }
}
async function apiFetch(path, init) {
    const res = await fetch(`${exports.API_BASE}${path}`, {
        ...init,
        headers: {
            'Content-Type': 'application/json',
            ...init?.headers,
        },
    });
    if (!res.ok) {
        let message = `Server error ${res.status}`;
        let parsedBody = null;
        try {
            parsedBody = await res.json();
            if (parsedBody.detail && typeof parsedBody.detail === 'string') {
                message = parsedBody.detail;
            }
            else if (parsedBody.error && typeof parsedBody.error === 'string') {
                message = parsedBody.error;
            }
            else if (parsedBody.detail && typeof parsedBody.detail === 'object') {
                message = JSON.stringify(parsedBody.detail);
            }
            else if (parsedBody.detail && typeof parsedBody.detail === 'string') {
                message = parsedBody.detail;
            }
        }
        catch {
            // ignore parse errors
        }
        // Convert 409 conflicts into typed ServerConflictError
        if (res.status === 409 && parsedBody) {
            const conflictError = Object.assign(new Error(message), {
                status: 409,
                code: parsedBody.code || 'CONFLICT',
                serverUpdatedAt: parsedBody.serverUpdatedAt || '',
                serverWorkspaceStore: parsedBody.serverWorkspaceStore,
                serverSettingsSnapshot: parsedBody.serverSettingsSnapshot,
            });
            throw conflictError;
        }
        const error = new Error(message);
        error.status = res.status;
        throw error;
    }
    return res.json();
}
// ---------------------------------------------------------------------------
// Profiles and durable provider settings
// ---------------------------------------------------------------------------
async function apiListProfiles() {
    return apiFetch('/api/profiles');
}
async function apiGetProfile(id) {
    return apiFetch(`/api/profiles/${id}`);
}
async function apiUpsertProfile(payload) {
    const method = payload.id ? 'PUT' : 'POST';
    const url = payload.id ? `/api/profiles/${payload.id}` : '/api/profiles';
    return apiFetch(url, { method, body: JSON.stringify(payload) });
}
async function apiDeleteProfile(id) {
    await apiFetch(`/api/profiles/${id}`, { method: 'DELETE' });
}
async function apiLoadSettings() {
    try {
        return await apiFetch('/api/settings');
    }
    catch (err) {
        // Treat all errors (404, 500, network, CORS, etc.) the same: no remote settings.
        // The bootstrap caller will gracefully fall back to local (cookie-based) settings.
        return null;
    }
}
async function apiSaveSettings(payload, lastSyncAt) {
    const body = { ...payload };
    if (lastSyncAt) {
        body.lastSyncAt = lastSyncAt;
    }
    return apiFetch('/api/settings', {
        method: 'PUT',
        body: JSON.stringify(body),
    });
}
async function apiStoreKey(profileId, apiKey) {
    await apiFetch(`/api/profiles/${profileId}/key`, {
        method: 'POST',
        body: JSON.stringify({ apiKey }),
    });
}
async function apiClearKey(profileId) {
    await apiFetch(`/api/profiles/${profileId}/key`, { method: 'DELETE' });
}
// ---------------------------------------------------------------------------
// AI proxy
// ---------------------------------------------------------------------------
async function apiChat(payload) {
    return apiFetch('/api/ai/chat', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}
async function apiFetchModels(profileId) {
    const res = await apiFetch(`/api/ai/models/${profileId}`);
    return res.models;
}
// ---------------------------------------------------------------------------
// Workspace collection
// ---------------------------------------------------------------------------
async function apiLoadWorkspaceStore() {
    try {
        return await apiFetch('/api/workspaces');
    }
    catch (err) {
        if (err.status === 404)
            return null;
        throw err;
    }
}
async function apiSaveWorkspaceStore(store, lastSyncAt) {
    const body = { ...store };
    if (lastSyncAt) {
        body.lastSyncAt = lastSyncAt;
    }
    await apiFetch('/api/workspaces', {
        method: 'PUT',
        body: JSON.stringify(body),
    });
}
// ---------------------------------------------------------------------------
// Legacy single-workspace endpoints
// ---------------------------------------------------------------------------
async function apiLoadWorkspace(workspaceId) {
    try {
        return await apiFetch(`/api/workspace/${workspaceId}`);
    }
    catch (err) {
        if (err.status === 404)
            return null;
        throw err;
    }
}
async function apiSaveWorkspace(workspaceId, data) {
    await apiFetch(`/api/workspace/${workspaceId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
    });
}
// ---------------------------------------------------------------------------
// Health check — use to detect if backend is reachable
// ---------------------------------------------------------------------------
async function apiHealthCheck() {
    try {
        await apiFetch('/api/health');
        return true;
    }
    catch {
        return false;
    }
}
