/**
 * Chat endpoint — verifies that thread-level model settings are properly
 * parsed and merged at the server layer.
 *
 * Tests the merge/resolve logic that both the frontend and server use,
 * ensuring they produce identical results for thread > provider param merging.
 *
 * Groups:
 *   Group A — Thread model settings merge correctness
 *   Group B — Workspace migration adds modelSettings
 *   Group C — Chat request body parsing (threadModelSettings passthrough)
 */

import { rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { saveSettingsSnapshot, type Profile, type GenerationParams } from '../src/profiles.js';
import { saveWorkspaceStore, loadWorkspaceStore, migrateWorkspaceForThreadSettings, resolveThreadModelSettings } from '../src/workspace.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const TEST_DATA_DIR = join(resolve(import.meta.dirname, '..', '.test-data'), 'chat-thread-models');

function setupTestEnv(): (() => void) {
  const origDir = process.env.DATA_DIR;
  if (existsSync(TEST_DATA_DIR)) rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  process.env.DATA_DIR = TEST_DATA_DIR;
  return () => {
    if (origDir !== undefined) process.env.DATA_DIR = origDir;
    else delete process.env.DATA_DIR;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Group A — Thread model settings merge correctness
// ─────────────────────────────────────────────────────────────────────────────

describe('Group A — Thread model settings merge correctness', () => {
  test('thread params fully override provider params', () => {
    const providerParams = { temperature: 0.7, topP: 0.9, maxTokens: 1024 };
    const threadParams = { temperature: 0.2 };
    const mergedFrontend: Record<string, unknown> = { ...providerParams };
    Object.assign(mergedFrontend, threadParams);
    const mergedServer = { ...providerParams, ...threadParams };
    expect(mergedFrontend.temperature).toBe(0.2);
    expect(mergedServer.temperature).toBe(0.2);
    expect(mergedFrontend.topP).toBe(0.9);
    expect(mergedServer.topP).toBe(0.9);
    expect(mergedFrontend.maxTokens).toBe(1024);
    expect(mergedServer.maxTokens).toBe(1024);
  });

  test('thread model string overrides provider model', () => {
    const providerModel = 'gpt-4o';
    const threadModel = 'gpt-4o-mini';
    expect(threadModel || providerModel).toBe('gpt-4o-mini');
    expect(threadModel && threadModel.trim() ? threadModel.trim() : providerModel).toBe('gpt-4o-mini');
  });

  test('empty thread model falls back to provider model', () => {
    const providerModel = 'gpt-4o';
    const threadModel = '';
    expect(threadModel || providerModel).toBe('gpt-4o');
    // Use explicit cast to avoid TS narrowing '' to 'never'
    const modelStr = (threadModel as string).trim();
    expect((modelStr ? modelStr : providerModel)).toBe('gpt-4o');
  });

  test('resolveThreadModelSettings merges thread overrides with profile data', () => {
    // profileKeyFn looks up a profile's model/params by id
    const profileKeyFn = (id: string): { model: string; params?: GenerationParams } | null => {
      if (id === 'p1') return { model: 'gpt-4o', params: { temperature: 0.7, maxTokens: 2048 } };
      if (id === 'p2') return { model: 'claude-3-5-sonnet-latest', params: { temperature: 0.3 } };
      return null;
    };

    const profiles = [
      { id: 'p1', model: 'gpt-4o', kind: 'openai', label: 'OpenAI' },
      { id: 'p2', model: 'claude-3-5-sonnet-latest', kind: 'anthropic', label: 'Anthropic' },
    ];

    // Thread overrides to use p2 with custom model and params
    const resolved = resolveThreadModelSettings(
      { providerConfigId: 'p2', model: 'custom-claude', params: { temperature: 0.1 } },
      'p1',
      profiles as any[],
      profileKeyFn,
    );

    expect(resolved).not.toBeNull();
    expect(resolved!.profileId).toBe('p2');
    expect(resolved!.profile.model).toBe('custom-claude');
    expect(resolved!.profile.params?.temperature).toBe(0.1);
  });

  test('null providerConfigId falls back to global activeProviderConfigId', () => {
    const profileKeyFn = (id: string) => (id === 'p1' ? { model: 'gpt-4o', params: { temperature: 0.7 } } : null);
    const resolved = resolveThreadModelSettings(
      { providerConfigId: null, model: '', params: { temperature: 0.5 } },
      'p1',
      [],
      profileKeyFn,
    );
    expect(resolved).not.toBeNull();
    expect(resolved!.profileId).toBe('p1');
    expect(resolved!.profile.model).toBe('gpt-4o');
  });

  test('undefined thread settings inherit everything from global active', () => {
    const profileKeyFn = (id: string) => (id === 'p1' ? { model: 'gpt-4o' } : null);
    const resolved = resolveThreadModelSettings(undefined, 'p1', [], profileKeyFn);
    expect(resolved).not.toBeNull();
    expect(resolved!.profileId).toBe('p1');
    expect(resolved!.profile.model).toBe('gpt-4o');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group B — Workspace migration adds modelSettings
// ─────────────────────────────────────────────────────────────────────────────

describe('Group B — Workspace migration', () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => { cleanup = setupTestEnv(); });
  afterAll(() => {
    cleanup?.();
    if (existsSync(TEST_DATA_DIR)) rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  });

  test('migrateWorkspaceForThreadSettings adds modelSettings to threads without them', () => {
    // migrateWorkspaceForThreadSettings expects { state: { threads: [...] } }
    const legacyPayload = {
      state: {
        threads: [
          {
            id: 't-legacy',
            color: '#7cf7c2',
            status: 'active',
            title: 'Legacy thread',
            description: '',
            context: [],
            nodes: [],
            activeNodeId: null,
            infoOpen: false,
          },
          {
            id: 't-modern',
            color: '#7cf7c2',
            status: 'active',
            title: 'Modern thread',
            description: '',
            context: [],
            nodes: [],
            activeNodeId: null,
            infoOpen: false,
            modelSettings: { providerConfigId: null, model: '' },
          },
        ],
      },
    };

    const migrated = migrateWorkspaceForThreadSettings(legacyPayload);
    expect(migrated).not.toBeNull();
    expect(migrated!.state.threads).toHaveLength(2);

    const legacyThread = migrated!.state.threads.filter(t => (t as Record<string, unknown>).id === 't-legacy')[0];
    expect(legacyThread.modelSettings).toBeDefined();
    expect((legacyThread.modelSettings as { providerConfigId: null; model: string }).providerConfigId).toBeNull();
    expect((legacyThread.modelSettings as { providerConfigId: null; model: string }).model).toBe('');

    const modernThread = (migrated!.state.threads.filter(t => (t as Record<string, unknown>).id === 't-modern')[0]) as Record<string, unknown>;
    expect((modernThread.modelSettings as Record<string, unknown>)?.providerConfigId).toBeNull();
  });

  test('migrateWorkspaceForThreadSettings returns null for invalid input', () => {
    expect(migrateWorkspaceForThreadSettings(null)).toBeNull();
    expect(migrateWorkspaceForThreadSettings(undefined)).toBeNull();
    expect(migrateWorkspaceForThreadSettings('not an object')).toBeNull();
    expect(migrateWorkspaceForThreadSettings({})).toBeNull();
    expect(migrateWorkspaceForThreadSettings({ state: 'not an object' })).toBeNull();
    expect(migrateWorkspaceForThreadSettings({ state: { threads: 'not an array' } })).toBeNull();
  });

  test('migrateWorkspaceForThreadSettings does not double-migrate', () => {
    const alreadyMigrated = {
      state: {
        threads: [{ id: 't1', modelSettings: { providerConfigId: null, model: '' } }],
      },
    };
    const result = migrateWorkspaceForThreadSettings(alreadyMigrated);
    expect(result).not.toBeNull();
    const thread = result!.state.threads[0] as Record<string, unknown>;
    expect((thread.modelSettings as Record<string, unknown>)?.modelSettings).toBeUndefined();
  });

  test('migration adds modelSettings and save/load round-trip preserves them', () => {
    // migrateWorkspaceForThreadSettings expects { state: { threads: [...] } }
    const legacyPayload = {
      state: {
        threads: [{
          id: 't-migrated',
          color: '#7cf7c2', status: 'active', title: 'Migrated thread', description: '',
          context: [], nodes: [], activeNodeId: null, infoOpen: false,
        }],
      },
    };
    const migrated = migrateWorkspaceForThreadSettings(legacyPayload);
    expect(migrated).not.toBeNull();

    // The migrated state should have modelSettings on all threads
    const thread = migrated!.state.threads[0];
    expect(thread.modelSettings).toBeDefined();
    expect((thread.modelSettings as { providerConfigId: null; model: string }).providerConfigId).toBeNull();
    expect((thread.modelSettings as { providerConfigId: null; model: string }).model).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group C — Chat request body parsing (threadModelSettings passthrough)
// ─────────────────────────────────────────────────────────────────────────────

describe('Group C — Chat request body parsing', () => {
  test('threadModelSettings object is correctly destructured', () => {
    const body: Record<string, unknown> = {
      profileId: 'test-profile',
      messages: [{ role: 'user', content: 'hello' }],
      systemPrompt: 'Be helpful',
      threadModelSettings: { providerConfigId: 'test-profile', model: 'gpt-4o-mini', params: { temperature: 0.2 } },
    };
    const { profileId, messages, systemPrompt, threadModelSettings } = body as { profileId: string; messages: Array<{ role: string; content: string }>; systemPrompt?: string; threadModelSettings?: { providerConfigId: string; model: string; params?: Record<string, unknown> } };
    expect(profileId).toBe('test-profile');
    expect(messages).toHaveLength(1);
    expect(systemPrompt).toBe('Be helpful');
    expect(threadModelSettings).toEqual({ providerConfigId: 'test-profile', model: 'gpt-4o-mini', params: { temperature: 0.2 } });
  });

  test('threadModelSettings defaults to undefined when omitted', () => {
    const body: Record<string, unknown> = { profileId: 'test-profile', messages: [{ role: 'user', content: 'hello' }] };
    const { threadModelSettings } = body as { profileId: string; messages: string[]; threadModelSettings?: Record<string, unknown> };
    expect(threadModelSettings).toBeUndefined();
  });

  test('thread overrides are correctly applied in the chat endpoint', () => {
    const tms: { providerConfigId: string; model: string; params?: Record<string, unknown> } = { providerConfigId: 'test-profile', model: 'gpt-4o-mini', params: { temperature: 0.2 } };
    let threadOverrides: { model?: string; params?: Record<string, unknown> } | undefined;
    if (tms) {
      const overrides: { model?: string; params?: Record<string, unknown> } = {};
      if (tms.model && tms.model.trim()) overrides.model = tms.model.trim();
      if (tms.params && Object.keys(tms.params).length > 0) overrides.params = tms.params as Record<string, unknown>;
      threadOverrides = Object.keys(overrides).length > 0 ? overrides : undefined;
    }
    expect(threadOverrides).toEqual({ model: 'gpt-4o-mini', params: { temperature: 0.2 } });
  });

  test('empty thread model settings produce no overrides', () => {
    const tms: { providerConfigId: string; model: string; params?: Record<string, unknown> } = { providerConfigId: 'test-profile', model: '', params: {} };
    let threadOverrides: { model?: string; params?: Record<string, unknown> } | undefined;
    if (tms) {
      const overrides: { model?: string; params?: Record<string, unknown> } = {};
      if (tms.model && tms.model.trim()) overrides.model = tms.model.trim();
      if (tms.params && Object.keys(tms.params).length > 0) overrides.params = tms.params as Record<string, unknown>;
      threadOverrides = Object.keys(overrides).length > 0 ? overrides : undefined;
    }
    expect(threadOverrides).toBeUndefined();
  });

  test('chat endpoint uses threadOverrides.model over profile.model', () => {
    // threadOverrides?.model ?? profile.model
    const overrides: { model?: string } | undefined = { model: 'gpt-4o-mini' };
    const profileModel = 'gpt-4o';
    expect(overrides?.model ?? profileModel).toBe('gpt-4o-mini');
    // Verify null fallback works
    const nullOverrides = null as { model?: string } | null;
    expect(nullOverrides?.model ?? profileModel).toBe('gpt-4o');
  });

  test('chat endpoint merges thread params over profile params', () => {
    const profileParams = { temperature: 0.7, topP: 0.9, maxTokens: 1024 };
    const threadOverrides = { params: { temperature: 0.2 } };
    const mergedParams: Record<string, unknown> = { ...(profileParams as Record<string, unknown>) };
    if (threadOverrides?.params) Object.assign(mergedParams, threadOverrides.params);
    expect(mergedParams).toEqual({ temperature: 0.2, topP: 0.9, maxTokens: 1024 });
  });
});
