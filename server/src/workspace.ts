/**
 * Workspace persistence.
 *
 * Legacy mode stored one JSON file per workspace. The current frontend persists
 * the full workspace collection, including the active workspace id, in a single
 * aggregate file so a wiped browser can recover every workspace.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), 'data');
const WS_DIR = join(DATA_DIR, 'workspaces');
const WORKSPACE_STORE_FILE = join(DATA_DIR, 'workspace-store.json');

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
export function loadWorkspaceStore(): unknown | null {
  ensureDir();
  if (existsSync(WORKSPACE_STORE_FILE)) {
    try {
      return JSON.parse(readFileSync(WORKSPACE_STORE_FILE, 'utf8'));
    } catch {
      return null;
    }
  }

  const workspaceIds = listWorkspaceIds();
  if (workspaceIds.length === 0) return null;

  const workspaces: Array<{ id: string; state: unknown }> = [];
  for (const id of workspaceIds) {
    const state = loadWorkspace(id);
    if (state === null) continue;
    workspaces.push({ id, state });
  }

  const firstWorkspace = workspaces[0];
  if (!firstWorkspace) return null;
  return {
    activeWorkspaceId: firstWorkspace.id,
    workspaces,
  };
}

/** Persist the full workspace collection. */
export function saveWorkspaceStore(payload: unknown): void {
  ensureDir();
  writeFileSync(WORKSPACE_STORE_FILE, JSON.stringify(payload, null, 2), 'utf8');
}
