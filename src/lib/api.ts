import type { GenerationParams, PersistedWorkspaceEntry, PersistedWorkspaceStore, ThreadModelSettings } from './types';

/**
 * Backend API client for LoomSpace.
 *
 * All calls go to the local server (default http://localhost:8000).
 * The server holds API keys and proxies requests to AI providers.
 */

// Empty string = same-origin (frontend served by backend).
// In Vite dev, vite.config.ts proxies /api to http://127.0.0.1:8000.
export const API_BASE = '';

// ---------------------------------------------------------------------------
// Types mirrored from server
// ---------------------------------------------------------------------------

export type AIProvider = 'openai' | 'anthropic' | 'openrouter' | 'openai-compatible-custom';

export interface ServerProfile {
  id: string;
  kind: AIProvider;
  label: string;
  model: string;
  baseUrl?: string;
  params?: GenerationParams;
  /** true when an API key is stored on the server */
  hasKey: boolean;
}

export interface SaveServerProfile {
  id: string;
  kind: AIProvider;
  label: string;
  model: string;
  baseUrl?: string;
  params?: GenerationParams;
}

export interface ServerSettingsPayload {
  activeProviderConfigId: string;
  providerConfigs: ServerProfile[];
}

export interface SaveServerSettingsPayload {
  activeProviderConfigId: string;
  providerConfigs: SaveServerProfile[];
}

export interface UpsertProfilePayload {
  id?: string;
  kind: AIProvider;
  label: string;
  model: string;
  baseUrl?: string;
  params?: GenerationParams;
  /** When provided, the server encrypts and stores this key. */
  apiKey?: string;
}

export interface ChatRequestPayload {
  profileId: string;
  messages: Array<{ role: string; content: unknown }>;
  systemPrompt?: string;
  threadModelSettings?: ThreadModelSettings;
}

export interface ChatResponsePayload {
  assistantText: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

// ---------------------------------------------------------------------------
// Sync / conflict types
// ---------------------------------------------------------------------------

export interface ServerConflictError extends Error {
  status: number;
  code: string;
  serverUpdatedAt: string;
  serverWorkspaceStore?: PersistedWorkspaceStore;
  serverSettingsSnapshot?: ServerSettingsPayload;
}

export function isServerConflictError(err: unknown): err is ServerConflictError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    (err as ServerConflictError).status === 409 &&
    (err as ServerConflictError).code === 'CONFLICT'
  );
}

export type SyncBeforeWriteOptions = {
  /** Called when a conflict is detected. Return true to abort the write, false to retry after merge. */
  onConflict?: (conflict: ServerConflictError) => boolean | Promise<boolean>;
};

// ---------------------------------------------------------------------------
// Merge utilities — server-first strategy
// ---------------------------------------------------------------------------

/**
 * Merge local settings into server state. Server state wins for any shared
 * fields (like providerConfigs) since the server is the source of truth.
 * Local changes to activeProviderConfigId are preserved if the config still exists.
 */
export function mergeSettingsServerFirst(
  local: SaveServerSettingsPayload,
  server: ServerSettingsPayload | null,
): SaveServerSettingsPayload {
  if (!server) return local;

  // Build a map of server configs by id
  const serverConfigMap = new Map<string, ServerProfile>(server.providerConfigs.map((c) => [c.id, c]));

  // Merge: use server configs for any that exist, add local ones that don't exist on server
  const mergedConfigs: SaveServerProfile[] = [...server.providerConfigs].map((c) => ({
    id: c.id,
    kind: c.kind,
    label: c.label,
    model: c.model,
    ...(c.baseUrl ? { baseUrl: c.baseUrl } : {}),
    ...(c.params ? { params: c.params } : {}),
  }));
  for (const localConfig of local.providerConfigs) {
    if (!serverConfigMap.has(localConfig.id)) {
      mergedConfigs.push({
        id: localConfig.id,
        kind: localConfig.kind,
        label: localConfig.label,
        model: localConfig.model,
        ...(localConfig.baseUrl ? { baseUrl: localConfig.baseUrl } : {}),
        ...(localConfig.params ? { params: localConfig.params } : {}),
      });
    }
  }

  // Active config: prefer server's if it still exists in merged configs
  const activeConfigExists = mergedConfigs.some((c) => c.id === server.activeProviderConfigId);
  return {
    activeProviderConfigId: activeConfigExists ? server.activeProviderConfigId : local.activeProviderConfigId,
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
export function mergeWorkspaceServerFirst(
  local: PersistedWorkspaceStore,
  server: PersistedWorkspaceStore | null,
): PersistedWorkspaceStore {
  if (!server || !server.workspaces?.length) return local;

  // Build a map of server workspaces by id
  const serverWorkspaceMap = new Map<string, typeof server.workspaces[number]>(server.workspaces.map((w) => [w.id, w]));

  // Merge: use server workspaces as the base, add local ones not on server
  const mergedWorkspaces = [...server.workspaces] as PersistedWorkspaceEntry[];
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
export async function apiSaveSettingsWithSync(payload: SaveServerSettingsPayload): Promise<ServerSettingsPayload | null> {
  // Load fresh server state and track its updatedAt for conflict detection
  const serverSettings = await apiLoadSettings().catch(() => null);
  const serverUpdatedAt = (serverSettings as { updatedAt?: string } | null)?.updatedAt ?? null;
  const merged = mergeSettingsServerFirst(payload, serverSettings);

  // Attempt the actual save (server uses lastSyncAt to detect conflicts)
  try {
    return await apiSaveSettings(merged, serverUpdatedAt ?? undefined);
  } catch (err) {
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
export async function apiSaveWorkspaceStoreWithSync(store: PersistedWorkspaceStore): Promise<boolean> {
  try {
    // Load fresh server state and track its updatedAt for conflict detection
    const serverStore = await apiLoadWorkspaceStore().catch(() => null);
    const serverUpdatedAt = (serverStore as { updatedAt?: string } | null)?.updatedAt ?? null;
    const merged = mergeWorkspaceServerFirst(store, serverStore);
    // Send lastSyncAt so server can detect conflicts in the TOCTOU window
    await apiSaveWorkspaceStore(merged, serverUpdatedAt ?? undefined);
    return true;
  } catch (err) {
    if (isServerConflictError(err)) {
      return false;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Internal fetch helper
// ---------------------------------------------------------------------------

type ApiError = Error & { status?: number };

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  if (!res.ok) {
    let message = `Server error ${res.status}`;
    let parsedBody: Record<string, unknown> | null = null;
    try {
      parsedBody = await res.json() as Record<string, unknown>;
      if (parsedBody.detail && typeof parsedBody.detail === 'string') {
        message = parsedBody.detail;
      } else if (parsedBody.error && typeof parsedBody.error === 'string') {
        message = parsedBody.error;
      } else if (parsedBody.detail && typeof parsedBody.detail === 'object') {
        message = JSON.stringify(parsedBody.detail);
      } else if (parsedBody.detail && typeof parsedBody.detail === 'string') {
        message = parsedBody.detail;
      }
    } catch {
      // ignore parse errors
    }

    // Convert 409 conflicts into typed ServerConflictError
    if (res.status === 409 && parsedBody) {
      const conflictError: ServerConflictError = Object.assign(new Error(message), {
        status: 409,
        code: (parsedBody.code as string) || 'CONFLICT',
        serverUpdatedAt: parsedBody.serverUpdatedAt as string || '',
        serverWorkspaceStore: parsedBody.serverWorkspaceStore as PersistedWorkspaceStore | undefined,
        serverSettingsSnapshot: parsedBody.serverSettingsSnapshot as ServerSettingsPayload | undefined,
      });
      throw conflictError;
    }

    const error = new Error(message) as ApiError;
    error.status = res.status;
    throw error;
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Profiles and durable provider settings
// ---------------------------------------------------------------------------

export async function apiListProfiles(): Promise<ServerProfile[]> {
  return apiFetch<ServerProfile[]>('/api/profiles');
}

export async function apiGetProfile(id: string): Promise<ServerProfile> {
  return apiFetch<ServerProfile>(`/api/profiles/${id}`);
}

export async function apiUpsertProfile(payload: UpsertProfilePayload): Promise<ServerProfile> {
  const method = payload.id ? 'PUT' : 'POST';
  const url = payload.id ? `/api/profiles/${payload.id}` : '/api/profiles';
  return apiFetch<ServerProfile>(url, { method, body: JSON.stringify(payload) });
}

export async function apiDeleteProfile(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/profiles/${id}`, { method: 'DELETE' });
}

export async function apiLoadSettings(): Promise<ServerSettingsPayload | null> {
  try {
    return await apiFetch<ServerSettingsPayload>('/api/settings');
  } catch (err) {
    if ((err as ApiError).status === 404) return null;
    throw err;
  }
}

export async function apiSaveSettings(payload: SaveServerSettingsPayload, lastSyncAt?: string): Promise<ServerSettingsPayload> {
  const body: Record<string, unknown> = { ...payload };
  if (lastSyncAt) {
    body.lastSyncAt = lastSyncAt;
  }
  return apiFetch<ServerSettingsPayload>('/api/settings', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export async function apiStoreKey(profileId: string, apiKey: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/profiles/${profileId}/key`, {
    method: 'POST',
    body: JSON.stringify({ apiKey }),
  });
}

export async function apiClearKey(profileId: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/profiles/${profileId}/key`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// AI proxy
// ---------------------------------------------------------------------------

export async function apiChat(payload: ChatRequestPayload): Promise<ChatResponsePayload> {
  return apiFetch<ChatResponsePayload>('/api/ai/chat', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function apiFetchModels(profileId: string): Promise<string[]> {
  const res = await apiFetch<{ models: string[] }>(`/api/ai/models/${profileId}`);
  return res.models;
}

// ---------------------------------------------------------------------------
// Workspace collection
// ---------------------------------------------------------------------------

export async function apiLoadWorkspaceStore(): Promise<PersistedWorkspaceStore | null> {
  try {
    return await apiFetch<PersistedWorkspaceStore>('/api/workspaces');
  } catch (err) {
    if ((err as ApiError).status === 404) return null;
    throw err;
  }
}

export async function apiSaveWorkspaceStore(store: PersistedWorkspaceStore, lastSyncAt?: string): Promise<void> {
  const body: Record<string, unknown> = { ...store };
  if (lastSyncAt) {
    body.lastSyncAt = lastSyncAt;
  }
  await apiFetch<{ ok: boolean }>('/api/workspaces', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Legacy single-workspace endpoints
// ---------------------------------------------------------------------------

export async function apiLoadWorkspace(workspaceId: string): Promise<unknown | null> {
  try {
    return await apiFetch<unknown>(`/api/workspace/${workspaceId}`);
  } catch (err) {
    if ((err as ApiError).status === 404) return null;
    throw err;
  }
}

export async function apiSaveWorkspace(workspaceId: string, data: unknown): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/workspace/${workspaceId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

// ---------------------------------------------------------------------------
// Health check — use to detect if backend is reachable
// ---------------------------------------------------------------------------

export async function apiHealthCheck(): Promise<boolean> {
  try {
    await apiFetch<{ status: string }>('/api/health');
    return true;
  } catch {
    return false;
  }
}

