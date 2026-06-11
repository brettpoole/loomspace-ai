import type { GenerationParams, PersistedWorkspaceStore } from './types';

/**
 * Backend API client for LoomSpace.
 *
 * All calls go to the local server (default http://localhost:3001).
 * The server holds API keys and proxies requests to AI providers.
 */

// Empty string = same-origin (frontend served by backend).
// For standalone Vite dev without an explicit VITE_API_BASE, vite.config.ts proxies /api to http://127.0.0.1:8000.
export const API_BASE = import.meta.env.VITE_API_BASE ?? '';

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
    try {
      const body = (await res.json()) as { error?: string; detail?: string };
      if (body.detail) message = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
      else if (body.error) message = body.error;
    } catch {
      // ignore parse errors
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
    // Treat all errors (404, 500, network, CORS, etc.) the same: no remote settings.
    // The bootstrap caller will gracefully fall back to local (cookie-based) settings.
    return null;
  }
}

export async function apiSaveSettings(payload: SaveServerSettingsPayload): Promise<ServerSettingsPayload> {
  return apiFetch<ServerSettingsPayload>('/api/settings', {
    method: 'PUT',
    body: JSON.stringify(payload),
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

export async function apiSaveWorkspaceStore(store: PersistedWorkspaceStore): Promise<void> {
  await apiFetch<{ ok: boolean }>('/api/workspaces', {
    method: 'PUT',
    body: JSON.stringify(store),
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


