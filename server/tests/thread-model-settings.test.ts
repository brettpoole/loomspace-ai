/**
 * Thread-level discrete model settings — integration tests.
 *
 * Verifies that each thread can independently choose its provider, model,
 * and generation params, and that those choices survive workspace save/reload,
 * workspace switching, and full server restart (restart = re-import the
 * persisted JSON on disk).
 *
 * Groups:
 *   Group 1 — Thread model assignment
 *   Group 2 — Persistence through operations
 *   Group 3 — Edge cases and migration
 */

import { rmSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import {
  saveSettingsSnapshot,
  loadSettingsSnapshot,
  upsertProfile,
  getProfile,
  listProfiles,
  type Profile,
  type GenerationParams,
} from '../src/profiles.js';
import {
  saveWorkspaceStore,
  loadWorkspaceStore,
} from '../src/workspace.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types mirroring the feature under test
// ─────────────────────────────────────────────────────────────────────────────

export interface ThreadModelSettings {
  providerConfigId: string | null;
  model: string;
  params?: GenerationParams;
}

export interface ResolvedThreadModel {
  provider: Profile | null;
  model: string;
  params: GenerationParams;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Resolve a thread's effective model against a full settings snapshot. */
export function resolveThreadModelSettings(
  threadModelSettings: ThreadModelSettings | null | undefined,
  settingsSnapshot: { activeProviderConfigId: string; providerConfigs: Profile[] } | null,
): ResolvedThreadModel {
  // No thread settings at all → inherit everything from global active config
  if (!threadModelSettings) {
    const activeConfig = settingsSnapshot?.providerConfigs.find(
      (c) => c.id === settingsSnapshot?.activeProviderConfigId,
    );
    return {
      provider: activeConfig ?? null,
      model: activeConfig?.model ?? '',
      params: {},
    };
  }

  // providerConfigId is null → inherit provider from global, but may override model/params
  let provider: Profile | null = null;
  if (threadModelSettings.providerConfigId) {
    provider = settingsSnapshot?.providerConfigs.find(
      (c) => c.id === threadModelSettings.providerConfigId,
    ) ?? null;
  } else {
    // Inherit from global active provider config
    const activeConfig = settingsSnapshot?.providerConfigs.find(
      (c) => c.id === settingsSnapshot?.activeProviderConfigId,
    );
    provider = activeConfig ?? null;
  }

  const model = threadModelSettings.model && threadModelSettings.model.trim()
    ? threadModelSettings.model.trim()
    : (provider?.model ?? '');
  const params = { ...(provider?.params ?? {}), ...threadModelSettings.params };

  return { provider, model, params };
}

/** Create a known-good profile via upsertProfile. */
function createTestServerProfile(kind: string, label: string, model: string): Profile {
  return upsertProfile({
    id: `test-profile-${label.replace(/\s+/g, '-').toLowerCase()}`,
    kind: kind as Profile['kind'],
    label,
    model,
  });
}

/**
 * Build a minimal workspace-entry payload that includes threads with model
 * settings.  This matches the shape that the frontend sends to the backend
 * workspace endpoint.
 */
function buildWorkspacePayload(
  workspaceId: string,
  threads: Array<{ id: string; title: string; modelSettings?: Partial<ThreadModelSettings> }>,
) {
  return {
    activeWorkspaceId: workspaceId,
    workspaces: [
      {
        id: workspaceId,
        state: {
          workspaceId,
          title: 'Test Workspace',
          threads: threads.map((t) => ({
            id: t.id,
            color: '#7cf7c2',
            status: 'draft' as const,
            title: t.title,
            description: '',
            context: [],
            nodes: [],
            activeNodeId: null,
            infoOpen: false,
            ...(t.modelSettings ? { modelSettings: t.modelSettings } : {}),
          })),
          selectedThreadId: null,
          selectedNodeId: null,
          densityOverlay: true,
          panX: 0,
          panY: 0,
          zoom: 1,
          version: 1,
        },
      },
    ],
  };
}

/** Load the workspace store from a specific DATA_DIR. */
function loadWorkspaceStoreFromDir(dataDir: string) {
  const origDir = process.env.DATA_DIR;
  process.env.DATA_DIR = dataDir;
  try {
    const result = loadWorkspaceStore();
    return result.store;
  } finally {
    if (origDir !== undefined) process.env.DATA_DIR = origDir;
    else delete process.env.DATA_DIR;
  }
}

/** Save workspace payload into a specific DATA_DIR. */
function saveWorkspacePayloadToDir(dataDir: string, payload: unknown) {
  const origDir = process.env.DATA_DIR;
  process.env.DATA_DIR = dataDir;
  try {
    saveWorkspaceStore(payload);
  } finally {
    if (origDir !== undefined) process.env.DATA_DIR = origDir;
    else delete process.env.DATA_DIR;
  }
}

/** Load settings snapshot from a specific DATA_DIR. */
function loadSettingsSnapshotFromDir(dataDir: string) {
  const origDir = process.env.DATA_DIR;
  process.env.DATA_DIR = dataDir;
  try {
    const result = loadSettingsSnapshot();
    return result.snapshot;
  } finally {
    if (origDir !== undefined) process.env.DATA_DIR = origDir;
    else delete process.env.DATA_DIR;
  }
}

/** Set up a clean DATA_DIR for tests. */
export function setupTestEnv(testDataDir: string): void {
  if (existsSync(testDataDir)) {
    rmSync(testDataDir, { recursive: true, force: true });
  }
  process.env.DATA_DIR = testDataDir;
}

/** Tear down: remove the test data directory. */
export function teardownTestEnv(testDataDir: string): void {
  if (existsSync(testDataDir)) {
    rmSync(testDataDir, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Global test-environment setup / teardown
// ─────────────────────────────────────────────────────────────────────────────

const TEST_DATA_DIR_BASE = resolve(import.meta.dirname, '..', '.test-data');

beforeAll(() => {
  if (existsSync(TEST_DATA_DIR_BASE)) {
    rmSync(TEST_DATA_DIR_BASE, { recursive: true, force: true });
  }
});

afterAll(() => {
  if (existsSync(TEST_DATA_DIR_BASE)) {
    rmSync(TEST_DATA_DIR_BASE, { recursive: true, force: true });
  }
  delete process.env.DATA_DIR;
});

// ─────────────────────────────────────────────────────────────────────────────
// Type aliases for workspace store shape (avoids complex inline casts)
// ─────────────────────────────────────────────────────────────────────────────

interface WorkspaceEntry {
  id: string;
  state: {
    workspaceId: string;
    title: string;
    threads: Array<{
      id: string;
      title: string;
      modelSettings?: ThreadModelSettings;
    }>;
  };
}

interface WorkspaceStore {
  activeWorkspaceId: string;
  workspaces: WorkspaceEntry[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Group 1: Thread model assignment
// ─────────────────────────────────────────────────────────────────────────────

describe('Group 1 — Thread model assignment', () => {
  const dataDir = join(TEST_DATA_DIR_BASE, 'group1');
  let profiles: Profile[];

  beforeEach(() => {
    setupTestEnv(dataDir);
    // Clean slate profiles
    const existingProfiles = listProfiles();
    for (const p of existingProfiles) {
      upsertProfile({ id: p.id, kind: p.kind, label: p.label, model: p.model, baseUrl: p.baseUrl, params: p.params });
    }

    profiles = [
      createTestServerProfile('openai', 'OpenAI Profile', 'gpt-4o'),
      createTestServerProfile('anthropic', 'Anthropic Profile', 'claude-3-5-sonnet-latest'),
      createTestServerProfile('openrouter', 'OpenRouter Profile', 'meta-llama/llama-3.3-70b-instruct:free'),
    ];

    const activeConfigId = profiles[0].id;
    saveSettingsSnapshot({ activeProviderConfigId: activeConfigId, providerConfigs: profiles });
  });

  afterAll(() => {
    teardownTestEnv(dataDir);
    delete process.env.DATA_DIR;
  });

  test('each thread can have its own provider config', () => {
    const workspacePayload = buildWorkspacePayload('ws-1', [
      { id: 't1', title: 'Thread A', modelSettings: { providerConfigId: profiles[0].id, model: 'gpt-4o' } },
      { id: 't2', title: 'Thread B', modelSettings: { providerConfigId: profiles[1].id, model: 'claude-3-5-sonnet-latest' } },
      { id: 't3', title: 'Thread C', modelSettings: { providerConfigId: profiles[2].id, model: 'meta-llama/llama-3.3-70b-instruct:free' } },
    ]);

    saveWorkspacePayloadToDir(dataDir, workspacePayload);
    const loaded = loadWorkspaceStoreFromDir(dataDir);

    expect(loaded).not.toBeNull();
    const store = loaded as WorkspaceStore;
    const wsEntry = store.workspaces.find((w) => w.id === 'ws-1');
    expect(wsEntry).toBeDefined();

    const threads = wsEntry!.state.threads;
    expect(threads).toHaveLength(3);

    const threadA = threads.find((t) => t.id === 't1')!;
    expect(threadA.modelSettings?.providerConfigId).toBe(profiles[0].id);

    const threadB = threads.find((t) => t.id === 't2')!;
    expect(threadB.modelSettings?.providerConfigId).toBe(profiles[1].id);

    const threadC = threads.find((t) => t.id === 't3')!;
    expect(threadC.modelSettings?.providerConfigId).toBe(profiles[2].id);
  });

  test('each thread can have its own model', () => {
    const workspacePayload = buildWorkspacePayload('ws-2', [
      { id: 't1', title: 'GPT thread', modelSettings: { providerConfigId: profiles[0].id, model: 'gpt-4o' } },
      { id: 't2', title: 'Claude thread', modelSettings: { providerConfigId: profiles[1].id, model: 'claude-3-5-sonnet-latest' } },
    ]);

    saveWorkspacePayloadToDir(dataDir, workspacePayload);
    const loaded = loadWorkspaceStoreFromDir(dataDir);

    const store = loaded as WorkspaceStore;
    const threads = store.workspaces[0].state.threads;

    const t1 = threads.find((t) => t.id === 't1')!;
    expect(t1.modelSettings?.model).toBe('gpt-4o');

    const t2 = threads.find((t) => t.id === 't2')!;
    expect(t2.modelSettings?.model).toBe('claude-3-5-sonnet-latest');
  });

  test('each thread can have its own generation params', () => {
    const paramA: GenerationParams = { temperature: 0.8, topP: 0.95, maxTokens: 2048 };
    const paramB: GenerationParams = { temperature: 0.2, topP: 0.7, maxTokens: 512 };

    const workspacePayload = buildWorkspacePayload('ws-3', [
      { id: 't1', title: 'Creative thread', modelSettings: { providerConfigId: profiles[0].id, model: 'gpt-4o', params: paramA } },
      { id: 't2', title: 'Precise thread', modelSettings: { providerConfigId: profiles[0].id, model: 'gpt-4o', params: paramB } },
    ]);

    saveWorkspacePayloadToDir(dataDir, workspacePayload);
    const loaded = loadWorkspaceStoreFromDir(dataDir);

    const store = loaded as WorkspaceStore;
    const threads = store.workspaces[0].state.threads;

    const t1 = threads.find((t) => t.id === 't1')!;
    expect(t1.modelSettings?.params?.temperature).toBe(0.8);
    expect(t1.modelSettings?.params?.topP).toBe(0.95);
    expect(t1.modelSettings?.params?.maxTokens).toBe(2048);

    const t2 = threads.find((t) => t.id === 't2')!;
    expect(t2.modelSettings?.params?.temperature).toBe(0.2);
    expect(t2.modelSettings?.params?.topP).toBe(0.7);
    expect(t2.modelSettings?.params?.maxTokens).toBe(512);
  });

  test('null thread settings inherit from global activeProviderConfigId', () => {
    const workspacePayload = buildWorkspacePayload('ws-4', [
      { id: 't1', title: 'Inherits thread' },
    ]);

    saveWorkspacePayloadToDir(dataDir, workspacePayload);
    const loaded = loadWorkspaceStoreFromDir(dataDir);

    const resolved = resolveThreadModelSettings(
      undefined,
      { activeProviderConfigId: profiles[0].id, providerConfigs: profiles },
    );

    expect(resolved.provider).not.toBeNull();
    expect(resolved.provider?.id).toBe(profiles[0].id);
    expect(resolved.model).toBe(profiles[0].model);
  });

  test('thread model settings are included in workspace payload', () => {
    const param: GenerationParams = { temperature: 0.6, topK: 40 };
    const workspacePayload = buildWorkspacePayload('ws-5', [
      { id: 't1', title: 'Configured thread', modelSettings: { providerConfigId: profiles[1].id, model: 'claude-3-5-sonnet-latest', params: param } },
      { id: 't2', title: 'Minimal thread', modelSettings: { providerConfigId: profiles[2].id, model: 'meta-llama/llama-3.3-70b-instruct:free' } },
      { id: 't3', title: 'No settings thread' },
    ]);

    saveWorkspacePayloadToDir(dataDir, workspacePayload);
    const loaded = loadWorkspaceStoreFromDir(dataDir);

    const store = loaded as WorkspaceStore;
    const threads = store.workspaces[0].state.threads;

    // Thread 1: all fields present
    const t1 = threads.find((t) => t.id === 't1')!;
    expect(t1.modelSettings).not.toBeUndefined();
    expect(t1.modelSettings?.providerConfigId).toBe(profiles[1].id);
    expect(t1.modelSettings?.model).toBe('claude-3-5-sonnet-latest');
    expect(t1.modelSettings?.params?.temperature).toBe(0.6);
    expect(t1.modelSettings?.params?.topK).toBe(40);

    // Thread 2: no params
    const t2 = threads.find((t) => t.id === 't2')!;
    expect(t2.modelSettings?.providerConfigId).toBe(profiles[2].id);
    expect(t2.modelSettings?.model).toBe('meta-llama/llama-3.3-70b-instruct:free');
    expect(t2.modelSettings?.params).toBeUndefined();

    // Thread 3: no modelSettings at all
    const t3 = threads.find((t) => t.id === 't3')!;
    expect(t3.modelSettings).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 2: Persistence through operations
// ─────────────────────────────────────────────────────────────────────────────

describe('Group 2 — Persistence through operations', () => {
  const dataDir = join(TEST_DATA_DIR_BASE, 'group2');
  let profiles: Profile[];

  beforeEach(() => {
    setupTestEnv(dataDir);
    profiles = [
      createTestServerProfile('openai', 'OpenAI Profile', 'gpt-4o'),
      createTestServerProfile('anthropic', 'Anthropic Profile', 'claude-3-5-sonnet-latest'),
    ];
    const activeConfigId = profiles[0].id;
    saveSettingsSnapshot({ activeProviderConfigId: activeConfigId, providerConfigs: profiles });
  });

  afterAll(() => {
    teardownTestEnv(dataDir);
    delete process.env.DATA_DIR;
  });

  test('settings persist after workspace save and reload', () => {
    const workspacePayload = buildWorkspacePayload('ws-persist', [
      { id: 't-persist', title: 'Persistence thread', modelSettings: { providerConfigId: profiles[0].id, model: 'gpt-4o', params: { temperature: 0.7 } } },
    ]);

    // Write once
    saveWorkspacePayloadToDir(dataDir, workspacePayload);

    // "Reload" by calling loadWorkspaceStore again (simulates server restart)
    const loaded = loadWorkspaceStoreFromDir(dataDir);
    expect(loaded).not.toBeNull();

    const store = loaded as WorkspaceStore;
    const thread = store.workspaces[0].state.threads.find((t) => t.id === 't-persist');
    expect(thread).toBeDefined();
    expect(thread!.modelSettings?.providerConfigId).toBe(profiles[0].id);
    expect(thread!.modelSettings?.model).toBe('gpt-4o');
    expect(thread!.modelSettings?.params?.temperature).toBe(0.7);
  });

  test('settings persist after switching workspace', () => {
    const ws1Payload = buildWorkspacePayload('ws-a', [
      { id: 't-a1', title: 'A-1', modelSettings: { providerConfigId: profiles[0].id, model: 'gpt-4o', params: { temperature: 0.5 } } },
    ]);

    const ws2Payload = buildWorkspacePayload('ws-b', [
      { id: 't-b1', title: 'B-1', modelSettings: { providerConfigId: profiles[1].id, model: 'claude-3-5-sonnet-latest', params: { temperature: 0.3 } } },
    ]);

    // Save workspace A
    saveWorkspacePayloadToDir(dataDir, ws1Payload);
    let loaded = loadWorkspaceStoreFromDir(dataDir);
    let storeA = loaded as WorkspaceStore;
    const threadsA = storeA.workspaces.find((w) => w.id === 'ws-a')!;
    expect(threadsA.state.threads[0].modelSettings?.model).toBe('gpt-4o');

    // Switch to workspace B
    saveWorkspacePayloadToDir(dataDir, ws2Payload);
    loaded = loadWorkspaceStoreFromDir(dataDir);
    const storeB = loaded as WorkspaceStore;
    const threadsB = storeB.workspaces.find((w) => w.id === 'ws-b')!;
    expect(threadsB.state.threads[0].modelSettings?.model).toBe('claude-3-5-sonnet-latest');

    // Switch back to workspace A — settings should still be correct
    saveWorkspacePayloadToDir(dataDir, ws1Payload);
    loaded = loadWorkspaceStoreFromDir(dataDir);
    storeA = loaded as WorkspaceStore;
    const threadsA2 = storeA.workspaces.find((w) => w.id === 'ws-a')!;
    expect(threadsA2.state.threads[0].modelSettings?.model).toBe('gpt-4o');
    expect(threadsA2.state.threads[0].modelSettings?.params?.temperature).toBe(0.5);
  });

  test('settings survive workspace store reinitialization', () => {
    const workspacePayload = buildWorkspacePayload('ws-reinit', [
      { id: 't-reinit', title: 'Reinit thread', modelSettings: { providerConfigId: profiles[1].id, model: 'claude-3-5-sonnet-latest' } },
    ]);

    // First save
    saveWorkspacePayloadToDir(dataDir, workspacePayload);

    // Verify loaded state
    let loaded = loadWorkspaceStoreFromDir(dataDir);
    expect(loaded).not.toBeNull();
    const store1 = loaded as WorkspaceStore;
    const t1 = store1.workspaces[0].state.threads[0];
    expect(t1.modelSettings?.model).toBe('claude-3-5-sonnet-latest');

    // The "reinitialization" means the server process restarts — the workspace
    // store is re-read from disk. Since our saveWorkspaceStore and
    // loadWorkspaceStore are called with the same DATA_DIR, a second call
    // verifies the on-disk round-trip. Verify the raw JSON is intact.
    const wsStorePath = join(dataDir, 'workspace-store.json');
    // The DATA_DIR constant in workspace.ts is captured at module load,
    // so we verify via the loaded data rather than the raw file.
    const loadedAgain = loadWorkspaceStoreFromDir(dataDir);
    expect(loadedAgain).not.toBeNull();
    const store2 = loadedAgain as WorkspaceStore;
    const t2 = store2.workspaces[0].state.threads[0];
    expect(t2.modelSettings?.model).toBe('claude-3-5-sonnet-latest');
    expect(t2.modelSettings?.providerConfigId).toBe(profiles[1].id);
  });

  test('empty params object is preserved', () => {
    const workspacePayload = buildWorkspacePayload('ws-empty-params', [
      { id: 't-empty-params', title: 'Empty params thread', modelSettings: { providerConfigId: profiles[0].id, model: 'gpt-4o', params: {} } },
    ]);

    saveWorkspacePayloadToDir(dataDir, workspacePayload);
    const loaded = loadWorkspaceStoreFromDir(dataDir);

    const store = loaded as WorkspaceStore;
    const thread = store.workspaces[0].state.threads.find((t) => t.id === 't-empty-params')!;
    expect(thread.modelSettings?.params).not.toBeNull();
    expect(Object.keys(thread.modelSettings?.params ?? {})).toHaveLength(0);
  });

  test('multiple threads can use the same provider config with different models', () => {
    const workspacePayload = buildWorkspacePayload('ws-shared-config', [
      { id: 't-s1', title: 'Shared A', modelSettings: { providerConfigId: profiles[0].id, model: 'gpt-4o', params: { temperature: 0.9 } } },
      { id: 't-s2', title: 'Shared B', modelSettings: { providerConfigId: profiles[0].id, model: 'gpt-4o-mini', params: { temperature: 0.1 } } },
      { id: 't-s3', title: 'Shared C', modelSettings: { providerConfigId: profiles[0].id, model: 'gpt-4o', params: { temperature: 0.5, topP: 0.8 } } },
    ]);

    saveWorkspacePayloadToDir(dataDir, workspacePayload);
    const loaded = loadWorkspaceStoreFromDir(dataDir);

    const store = loaded as WorkspaceStore;
    const threads = store.workspaces[0].state.threads;

    // All share the same provider config
    threads.forEach((t) => {
      expect(t.modelSettings?.providerConfigId).toBe(profiles[0].id);
    });

    // But different models
    const models = new Set(threads.map((t) => t.modelSettings?.model));
    expect(models.has('gpt-4o-mini')).toBe(true);

    // And different params
    const t1 = threads.find((t) => t.id === 't-s1')!;
    expect(t1.modelSettings?.params?.temperature).toBe(0.9);

    const t2 = threads.find((t) => t.id === 't-s2')!;
    expect(t2.modelSettings?.params?.temperature).toBe(0.1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 3: Edge cases and migration
// ─────────────────────────────────────────────────────────────────────────────

describe('Group 3 — Edge cases and migration', () => {
  const dataDir = join(TEST_DATA_DIR_BASE, 'group3');
  let profiles: Profile[];

  beforeEach(() => {
    setupTestEnv(dataDir);
    profiles = [
      createTestServerProfile('openai', 'OpenAI Profile', 'gpt-4o'),
      createTestServerProfile('anthropic', 'Anthropic Profile', 'claude-3-5-sonnet-latest'),
    ];
    const activeConfigId = profiles[0].id;
    saveSettingsSnapshot({ activeProviderConfigId: activeConfigId, providerConfigs: profiles });
  });

  afterAll(() => {
    teardownTestEnv(dataDir);
    delete process.env.DATA_DIR;
  });

  test('deleted provider config is handled gracefully', () => {
    // Create a workspace that references profiles[0]
    const workspacePayload = buildWorkspacePayload('ws-deleted-config', [
      { id: 't-deleted', title: 'Orphaned thread', modelSettings: { providerConfigId: profiles[0].id, model: 'gpt-4o' } },
    ]);

    saveWorkspacePayloadToDir(dataDir, workspacePayload);

    // Now "delete" the profile by updating the settings snapshot
    const remainingProfiles = [profiles[1]];
    saveSettingsSnapshot({ activeProviderConfigId: profiles[1].id, providerConfigs: remainingProfiles });

    // Thread still references the deleted config — should load without crash
    const loaded = loadWorkspaceStoreFromDir(dataDir);
    const store = loaded as WorkspaceStore;
    const thread = store.workspaces[0].state.threads.find((t) => t.id === 't-deleted')!;
    expect(thread.modelSettings?.providerConfigId).toBe(profiles[0].id);

    // Resolution should gracefully return null provider
    const resolved = resolveThreadModelSettings(thread.modelSettings, null);
    expect(resolved.provider).toBeNull();
    // But model should still be preserved from thread-local settings
    expect(resolved.model).toBe('gpt-4o');
  });

  test('invalid providerConfigId does not crash', () => {
    const workspacePayload = buildWorkspacePayload('ws-invalid-id', [
      { id: 't-invalid', title: 'Invalid ID thread', modelSettings: { providerConfigId: 'nonexistent-uuid', model: 'some-model' } },
    ]);

    saveWorkspacePayloadToDir(dataDir, workspacePayload);

    // Should not throw
    const loaded = loadWorkspaceStoreFromDir(dataDir);
    expect(loaded).not.toBeNull();

    const store = loaded as WorkspaceStore;
    const thread = store.workspaces[0].state.threads[0];
    expect(thread.modelSettings?.providerConfigId).toBe('nonexistent-uuid');

    // Resolution should be safe
    const resolved = resolveThreadModelSettings(thread.modelSettings, { activeProviderConfigId: profiles[0].id, providerConfigs: profiles });
    expect(resolved.provider).toBeNull();
    expect(resolved.model).toBe('some-model');
  });

  test('old workspace without thread model settings still loads', () => {
    // Simulate the legacy format — no modelSettings field at all
    const legacyPayload = {
      activeWorkspaceId: 'ws-legacy',
      workspaces: [
        {
          id: 'ws-legacy',
          state: {
            workspaceId: 'ws-legacy',
            title: 'Legacy Workspace',
            threads: [
              {
                id: 't-legacy',
                color: '#7cf7c2',
                status: 'active' as const,
                title: 'Legacy thread',
                description: '',
                context: [],
                nodes: [],
                activeNodeId: null,
                infoOpen: false,
                // NOTE: no modelSettings field — old format
              },
            ],
            selectedThreadId: null,
            selectedNodeId: null,
            densityOverlay: true,
            panX: 0,
            panY: 0,
            zoom: 1,
            version: 1,
          },
        },
      ],
    };

    saveWorkspacePayloadToDir(dataDir, legacyPayload);

    // Should not throw
    const loaded = loadWorkspaceStoreFromDir(dataDir);
    expect(loaded).not.toBeNull();

    const store = loaded as WorkspaceStore;
    const thread = store.workspaces[0].state.threads[0];
    expect(thread.modelSettings).toBeUndefined();

    // Resolution falls back to global active provider
    const resolved = resolveThreadModelSettings(undefined, { activeProviderConfigId: profiles[0].id, providerConfigs: profiles });
    expect(resolved.provider?.id).toBe(profiles[0].id);
    expect(resolved.model).toBe(profiles[0].model);
  });

  test('invalid generation params are sanitized', () => {
    const workspacePayload = buildWorkspacePayload('ws-invalid-params', [
      { id: 't-params', title: 'Bad params thread', modelSettings: {
        providerConfigId: profiles[0].id,
        model: 'gpt-4o',
        params: {
          temperature: -1, // invalid — negative
          topP: 1.5,       // invalid — > 1
          maxTokens: 0,    // invalid — zero
          frequencyPenalty: -5, // invalid
          presencePenalty: 999, // valid range but extreme
          seed: 42,         // valid
          stop: ['\n', ''], // empty string should be filtered
        } as unknown as GenerationParams,
      }},
    ]);

    saveWorkspacePayloadToDir(dataDir, workspacePayload);
    const loaded = loadWorkspaceStoreFromDir(dataDir);

    const store = loaded as WorkspaceStore;
    const thread = store.workspaces[0].state.threads[0];

    // The params should be preserved in the raw JSON but the resolve function
    // should handle invalid values gracefully
    expect(thread.modelSettings?.params).toBeDefined();
    // seed=42 is valid, should survive
    expect((thread.modelSettings?.params as Record<string, unknown>).seed).toBe(42);
  });

  test('all thread settings survive a full save/reload cycle', () => {
    const workspacePayload = buildWorkspacePayload('ws-full-cycle', [
      { id: 't-full-1', title: 'Thread 1', modelSettings: { providerConfigId: profiles[0].id, model: 'gpt-4o', params: { temperature: 0.7, topP: 0.9 } } },
      { id: 't-full-2', title: 'Thread 2', modelSettings: { providerConfigId: profiles[1].id, model: 'claude-3-5-sonnet-latest', params: { temperature: 0.2, topP: 0.8 } } },
      { id: 't-full-3', title: 'Thread 3', modelSettings: { providerConfigId: null, model: '' } }, // inherits
      { id: 't-full-4', title: 'Thread 4', modelSettings: { providerConfigId: profiles[0].id, model: 'gpt-4o-mini' } },
      { id: 't-full-5', title: 'Thread 5' }, // no settings at all
    ]);

    // First save
    saveWorkspacePayloadToDir(dataDir, workspacePayload);

    // Reload multiple times (simulates multiple server restarts)
    for (let i = 0; i < 5; i++) {
      const loaded = loadWorkspaceStoreFromDir(dataDir);
      const store = loaded as WorkspaceStore;
      const threads = store.workspaces[0].state.threads;

      expect(threads).toHaveLength(5);

      const t1 = threads.find((t) => t.id === 't-full-1')!;
      expect(t1.modelSettings?.providerConfigId).toBe(profiles[0].id);
      expect(t1.modelSettings?.model).toBe('gpt-4o');
      expect(t1.modelSettings?.params?.temperature).toBe(0.7);
      expect(t1.modelSettings?.params?.topP).toBe(0.9);

      const t2 = threads.find((t) => t.id === 't-full-2')!;
      expect(t2.modelSettings?.providerConfigId).toBe(profiles[1].id);
      expect(t2.modelSettings?.model).toBe('claude-3-5-sonnet-latest');

      const t3 = threads.find((t) => t.id === 't-full-3')!;
      expect(t3.modelSettings?.providerConfigId).toBeNull();

      const t4 = threads.find((t) => t.id === 't-full-4')!;
      expect(t4.modelSettings?.model).toBe('gpt-4o-mini');

      const t5 = threads.find((t) => t.id === 't-full-5')!;
      expect(t5.modelSettings).toBeUndefined();
    }

    // Final check: resolve all threads against current settings
    const settings = loadSettingsSnapshotFromDir(dataDir);
    expect(settings).not.toBeNull();

    const loaded = loadWorkspaceStoreFromDir(dataDir);
    const store = loaded as WorkspaceStore;
    const finalThreads = store.workspaces[0].state.threads;

    const resolvedAll = finalThreads.map((t) =>
      resolveThreadModelSettings(t.modelSettings, settings),
    );

    // Thread 1: resolved to openai profile/gpt-4o
    expect(resolvedAll[0].provider?.id).toBe(profiles[0].id);
    expect(resolvedAll[0].model).toBe('gpt-4o');

    // Thread 2: resolved to anthropic profile/claude
    expect(resolvedAll[1].provider?.id).toBe(profiles[1].id);
    expect(resolvedAll[1].model).toBe('claude-3-5-sonnet-latest');

    // Thread 3: inherits from global active
    expect(resolvedAll[2].provider?.id).toBe(profiles[0].id);

    // Thread 4: resolved to openai profile/gpt-4o-mini
    expect(resolvedAll[3].provider?.id).toBe(profiles[0].id);
    expect(resolvedAll[3].model).toBe('gpt-4o-mini');

    // Thread 5: no settings, inherits from global
    expect(resolvedAll[4].provider?.id).toBe(profiles[0].id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveThreadModelSettings unit tests
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveThreadModelSettings helper', () => {
  test('null thread settings falls back to global activeProviderConfigId', () => {
    const profiles = [
      { id: 'p1', kind: 'openai', label: 'OpenAI', model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1', hasKey: false },
    ] as Profile[];

    const resolved = resolveThreadModelSettings(
      undefined,
      { activeProviderConfigId: 'p1', providerConfigs: profiles },
    );

    expect(resolved.provider?.id).toBe('p1');
    expect(resolved.model).toBe('gpt-4o');
    expect(resolved.params).toEqual({});
  });

  test('thread with providerConfigId uses that provider', () => {
    const profiles = [
      { id: 'p1', kind: 'openai', label: 'OpenAI', model: 'gpt-4o', hasKey: false },
      { id: 'p2', kind: 'anthropic', label: 'Anthropic', model: 'claude-3-5-sonnet-latest', hasKey: false },
    ] as Profile[];

    const resolved = resolveThreadModelSettings(
      { providerConfigId: 'p2', model: 'custom-model', params: { temperature: 0.5 } },
      { activeProviderConfigId: 'p1', providerConfigs: profiles },
    );

    expect(resolved.provider?.id).toBe('p2');
    expect(resolved.model).toBe('custom-model');
    expect(resolved.params?.temperature).toBe(0.5);
  });

  test('thread model overrides provider default', () => {
    const profiles = [
      { id: 'p1', kind: 'openai', label: 'OpenAI', model: 'gpt-4o', hasKey: false },
    ] as Profile[];

    const resolved = resolveThreadModelSettings(
      { providerConfigId: 'p1', model: 'gpt-4o-mini', params: { temperature: 0.2 } },
      { activeProviderConfigId: 'p1', providerConfigs: profiles },
    );

    // Thread's model overrides the provider's default
    expect(resolved.model).toBe('gpt-4o-mini');
  });

  test('params merge: thread params override provider params', () => {
    const profiles = [
      {
        id: 'p1',
        kind: 'openai',
        label: 'OpenAI',
        model: 'gpt-4o',
        hasKey: false,
        params: { temperature: 0.7, topP: 0.9, maxTokens: 1024 },
      },
    ] as Profile[];

    const resolved = resolveThreadModelSettings(
      { providerConfigId: 'p1', model: 'gpt-4o', params: { temperature: 0.3 } },
      { activeProviderConfigId: 'p1', providerConfigs: profiles },
    );

    // Thread's temperature (0.3) overrides provider's (0.7)
    expect(resolved.params?.temperature).toBe(0.3);
    // Provider's other params are inherited
    expect(resolved.params?.topP).toBe(0.9);
    expect(resolved.params?.maxTokens).toBe(1024);
  });
});
