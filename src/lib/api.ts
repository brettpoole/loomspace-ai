/**
 * Backend API client for LoomSpace.
 *
 * All calls go to the local server (default http://localhost:3001).
 * The server holds API keys and proxies requests to AI providers.
 */

// Empty string = same-origin (frontend served by backend).
// For standalone Vite dev: set VITE_API_BASE=http://localhost:8000
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
  /** true when an API key is stored on the server */
  hasKey: boolean;
}

export interface UpsertProfilePayload {
  id?: string;
  kind: AIProvider;
  label: string;
  model: string;
  baseUrl?: string;
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

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem('loomspace.auth.token');
  const authHeader: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...authHeader,
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
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Profiles
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
// Workspace
// ---------------------------------------------------------------------------

export async function apiLoadWorkspace(workspaceId: string): Promise<unknown | null> {
  try {
    return await apiFetch<unknown>(`/api/workspace/${workspaceId}`);
  } catch (err) {
    if (err instanceof Error && err.message.includes('404')) return null;
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

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface AuthTokenResponse {
  access_token: string;
  token_type: string;
}

export interface AuthUser {
  id: string;
  username: string;
  created_at: string;
}

export async function apiRegister(username: string, password: string): Promise<AuthTokenResponse> {
  return apiFetch<AuthTokenResponse>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export async function apiLogin(username: string, password: string): Promise<AuthTokenResponse> {
  return apiFetch<AuthTokenResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export async function apiGetMe(): Promise<AuthUser> {
  return apiFetch<AuthUser>('/api/auth/me');
}

/** Store the auth token in localStorage so apiFetch sends it automatically. */
export function setAuthToken(token: string): void {
  localStorage.setItem('loomspace.auth.token', token);
}

/** Clear the stored auth token (logout). */
export function clearAuthToken(): void {
  localStorage.removeItem('loomspace.auth.token');
}

/** Returns true when a token is currently stored. Does not validate expiry. */
export function hasAuthToken(): boolean {
  return localStorage.getItem('loomspace.auth.token') !== null;
}
