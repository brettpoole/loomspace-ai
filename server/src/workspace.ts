/**
 * Workspace persistence.
 * Workspaces are stored as JSON files on disk, keyed by workspaceId.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), 'data');
const WS_DIR = join(DATA_DIR, 'workspaces');

function ensureDir() {
  mkdirSync(WS_DIR, { recursive: true });
}

function workspacePath(id: string) {
  // Sanitize: workspace ids are UUIDs so this is mostly defensive
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, '_');
  return join(WS_DIR, `${safe}.json`);
}

/** Load a workspace by id. Returns null when not found. */
export function loadWorkspace(id: string): unknown | null {
  ensureDir();
  const p = workspacePath(id);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/** Persist a workspace. id must match the id inside the payload. */
export function saveWorkspace(id: string, payload: unknown): void {
  ensureDir();
  writeFileSync(workspacePath(id), JSON.stringify(payload), 'utf8');
}

/** List workspace ids. */
export function listWorkspaceIds(): string[] {
  ensureDir();
  return readdirSync(WS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''));
}
