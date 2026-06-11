/**
 * Workspace persistence.
 *
 * Legacy mode stored one JSON file per workspace. The current frontend persists
 * the full workspace collection, including the active workspace id, in a single
 * aggregate file so a wiped browser can recover every workspace.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GenerationParams, ThreadModelSettings } from './profiles.js';

const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), 'data');
const WS_DIR = join(DATA_DIR, 'workspaces');
const WORKSPACE_STORE_FILE = join(DATA_DIR, 'workspace-store.json');
const WORKSPACE_STORE_UPDATED_AT_FILE = join(DATA_DIR, 'workspace-store-updated-at.json');

function ensureDir() {
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(WS_DIR, { recursive: true });
}

function workspacePath(id: string) {
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, '_');
  return join(WS_DIR, `${safe}.json`);
}

/** Load a workspace by id. Returns null when not found. */
export function loadWorkspace(id: string): unknown | null {
  ensureDir();
  const path = workspacePath(id);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** Persist a workspace. id must match the id inside the payload. */
export function saveWorkspace(id: string, payload: unknown): void {
  ensureDir();
  writeFileSync(workspacePath(id), JSON.stringify(payload, null, 2), 'utf8');
}

/** List workspace ids from the legacy per-workspace file store. */
export function listWorkspaceIds(): string[] {
  ensureDir();
  return readdirSync(WS_DIR)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => entry.replace(/\.json$/, ''));
}

/** Load the full workspace collection. Falls back to the legacy file-per-workspace layout. */
export function loadWorkspaceStore(): { store: unknown | null; updatedAt: string | null } {
  ensureDir();
  let store: unknown | null = null;

  if (existsSync(WORKSPACE_STORE_FILE)) {
    try {
      store = JSON.parse(readFileSync(WORKSPACE_STORE_FILE, 'utf8'));
    } catch {
      // leave store as null
    }
  }

  if (store === null) {
    const workspaceIds = listWorkspaceIds();
    if (workspaceIds.length === 0) return { store: null, updatedAt: loadWorkspaceStoreUpdatedAt() };

    const workspaces: Array<{ id: string; state: unknown }> = [];
    for (const id of workspaceIds) {
      const state = loadWorkspace(id);
      if (state === null) continue;
      workspaces.push({ id, state });
    }

    const firstWorkspace = workspaces[0];
    if (firstWorkspace) {
      store = {
        activeWorkspaceId: firstWorkspace.id,
        workspaces,
      };
    }
  }

  return { store, updatedAt: loadWorkspaceStoreUpdatedAt() };
}

/** Persist the full workspace collection. */
export function saveWorkspaceStore(payload: unknown): void {
  ensureDir();
  writeFileSync(WORKSPACE_STORE_FILE, JSON.stringify(payload, null, 2), 'utf8');
  saveWorkspaceStoreUpdatedAt(new Date().toISOString());
}

export function saveWorkspaceStoreUpdatedAt(ts: string): void {
  ensureDir();
  writeFileSync(WORKSPACE_STORE_UPDATED_AT_FILE, JSON.stringify({ updatedAt: ts }, null, 2), 'utf8');
}

export function loadWorkspaceStoreUpdatedAt(): string | null {
  ensureDir();
  if (!existsSync(WORKSPACE_STORE_UPDATED_AT_FILE)) return null;
  try {
    const parsed = JSON.parse(readFileSync(WORKSPACE_STORE_UPDATED_AT_FILE, 'utf8')) as { updatedAt?: string };
    return parsed.updatedAt ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Thread-level model settings helpers
// ---------------------------------------------------------------------------

/**
 * Resolve thread-level model settings to the concrete profile + model + params
 * to use for an AI request.
 *
 * - If providerConfigId is set, looks up that profile by id
 * - Falls back to the workspace's activeProviderConfigId if thread's is null
 * - Uses thread's model override if provided, otherwise profile's model
 * - Merges thread params over profile params (thread takes priority)
 *
 * Returns null if no valid configuration can be resolved.
 */
export function resolveThreadModelSettings(
  threadSettings: ThreadModelSettings | undefined | null,
  globalActiveProviderConfigId: string | undefined,
  profiles: Array<{ id: string; model: string; params?: GenerationParams; kind: string; label: string; baseUrl?: string }>,
  profileKeyFn: (id: string) => { model: string; params?: GenerationParams } | null,
): { profile: { model: string; params?: GenerationParams }; profileId: string } | null {
  const configId = threadSettings?.providerConfigId ?? globalActiveProviderConfigId ?? null;
  if (!configId) return null;

  const profile = profileKeyFn(configId);
  if (!profile) return null;

  const model = threadSettings?.model && threadSettings.model.trim()
    ? threadSettings.model.trim()
    : profile.model;

  const mergedParams: Record<string, unknown> = {};
  if (profile.params) {
    Object.assign(mergedParams, profile.params);
  }
  if (threadSettings?.params) {
    Object.assign(mergedParams, threadSettings.params);
  }

  return {
    profile: { model, params: Object.keys(mergedParams).length > 0 ? (mergedParams as GenerationParams) : undefined },
    profileId: configId,
  };
}

/**
 * Ensure a workspace payload has modelSettings on all thread lanes.
 * Missing modelSettings are initialized to { providerConfigId: null, model: '' }.
 */
export function migrateWorkspaceForThreadSettings(
  payload: unknown,
): { state: { threads: Array<Record<string, unknown>> } } | null {
  if (!payload || typeof payload !== 'object') return null;
  const workspace = payload as Record<string, unknown>;
  const state = workspace.state as Record<string, unknown> | undefined;
  if (!state || typeof state !== 'object') return null;

  const threads = state.threads as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(threads)) return null;

  const migrated = threads.map((thread) => {
    const ts = thread.modelSettings as Record<string, unknown> | undefined;
    if (ts && typeof ts === 'object' && 'providerConfigId' in ts && 'model' in ts) {
      return { ...thread };
    }
    return {
      ...thread,
      modelSettings: { providerConfigId: null, model: '' } as Record<string, unknown>,
    };
  });

  return { state: { ...state, threads: migrated } };
}
