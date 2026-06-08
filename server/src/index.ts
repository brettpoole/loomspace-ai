/**
 * LoomSpace AI backend
 *
 * Endpoints
 * ─────────
 * Profiles
 *   GET    /api/profiles              — list profiles (no keys)
 *   GET    /api/profiles/:id          — single profile
 *   POST   /api/profiles              — create/update profile; body may include apiKey
 *   PUT    /api/profiles/:id          — full update (same as POST with id)
 *   DELETE /api/profiles/:id          — remove profile and stored key
 *   POST   /api/profiles/:id/key      — store / replace API key for profile
 *   DELETE /api/profiles/:id/key      — remove stored key
 *
 * AI proxy
 *   POST   /api/ai/chat               — chat completion  { profileId, messages, systemPrompt? }
 *   GET    /api/ai/models/:profileId  — list models for a profile
 *
 * Workspace
 *   GET    /api/workspace/:id         — load workspace JSON
 *   PUT    /api/workspace/:id         — save workspace JSON
 */

import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  clearKey,
  deleteProfile,
  getProfile,
  listProfiles,
  orphanedKeyIds,
  storeKey,
  upsertProfile,
  type UpsertProfileInput,
} from './profiles.js';
import { chatCompletion, fetchModels } from './proxy.js';
import { loadWorkspace, saveWorkspace } from './workspace.js';

// ---------------------------------------------------------------------------
// Startup checks
// ---------------------------------------------------------------------------

if (!process.env.DATA_SECRET) {
  console.error('[loomspace] FATAL: DATA_SECRET environment variable is not set.');
  console.error('[loomspace] Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}

// Warn about orphaned key files (profile deleted but key file left behind)
const orphans = orphanedKeyIds();
if (orphans.length) {
  console.warn(`[loomspace] Warning: ${orphans.length} orphaned key file(s) found in data/keys/. Run cleanup if needed.`);
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = new Hono();

// Allow requests from the dev Vite server (localhost:5173) and production
app.use(
  '/api/*',
  cors({
    origin: (origin) => {
      if (!origin) return null;
      if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) return origin;
      return null;
    },
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
    credentials: false,
  }),
);

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

app.get('/api/health', (c) => c.json({ status: 'ok', ts: Date.now() }));

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

app.get('/api/profiles', (c) => {
  return c.json(listProfiles());
});

app.get('/api/profiles/:id', (c) => {
  const profile = getProfile(c.req.param('id'));
  if (!profile) return c.json({ error: 'Not found' }, 404);
  return c.json(profile);
});

async function handleUpsert(c: Parameters<Parameters<typeof app.post>[1]>[0], idFromParam?: string) {
  let body: Partial<UpsertProfileInput>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const { kind, label, model, baseUrl, apiKey } = body;
  if (!kind || !label || !model) {
    return c.json({ error: 'kind, label, and model are required' }, 400);
  }

  try {
    const profile = upsertProfile({
      id: idFromParam ?? body.id,
      kind,
      label,
      model,
      baseUrl: baseUrl ?? undefined,
      apiKey: apiKey ?? undefined,
    });
    return c.json(profile, idFromParam ? 200 : 201);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
}

app.post('/api/profiles', (c) => handleUpsert(c));
app.put('/api/profiles/:id', (c) => handleUpsert(c, c.req.param('id')));

app.delete('/api/profiles/:id', (c) => {
  const ok = deleteProfile(c.req.param('id'));
  if (!ok) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true });
});

app.post('/api/profiles/:id/key', async (c) => {
  let body: { apiKey?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }
  if (!body.apiKey) return c.json({ error: 'apiKey is required' }, 400);
  try {
    storeKey(c.req.param('id'), body.apiKey);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: String(err) }, 400);
  }
});

app.delete('/api/profiles/:id/key', (c) => {
  clearKey(c.req.param('id'));
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// AI proxy
// ---------------------------------------------------------------------------

app.post('/api/ai/chat', async (c) => {
  let body: { profileId?: string; messages?: unknown; systemPrompt?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const { profileId, messages, systemPrompt } = body;
  if (!profileId) return c.json({ error: 'profileId is required' }, 400);
  if (!Array.isArray(messages)) return c.json({ error: 'messages must be an array' }, 400);

  const profile = getProfile(profileId);
  if (!profile) return c.json({ error: `Profile ${profileId} not found` }, 404);
  if (!profile.hasKey) return c.json({ error: `No API key stored for profile ${profileId}` }, 400);

  try {
    const result = await chatCompletion(profile, {
      messages: messages as Array<{ role: string; content: unknown }>,
      systemPrompt,
    });
    return c.json(result);
  } catch (err) {
    return c.json({ error: String(err) }, 502);
  }
});

app.get('/api/ai/models/:profileId', async (c) => {
  const profile = getProfile(c.req.param('profileId'));
  if (!profile) return c.json({ error: 'Profile not found' }, 404);
  if (!profile.hasKey) return c.json({ error: 'No API key stored for this profile' }, 400);

  try {
    const models = await fetchModels(profile);
    return c.json({ models });
  } catch (err) {
    return c.json({ error: String(err) }, 502);
  }
});

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

app.get('/api/workspace/:id', (c) => {
  const data = loadWorkspace(c.req.param('id'));
  if (!data) return c.json({ error: 'Workspace not found' }, 404);
  return c.json(data);
});

app.put('/api/workspace/:id', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }
  saveWorkspace(c.req.param('id'), body);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Static frontend (production mode)
// ---------------------------------------------------------------------------

const DIST_DIR = join(process.cwd(), '..', 'dist');

if (existsSync(DIST_DIR)) {
  app.use('/*', serveStatic({ root: '../dist' }));
  // SPA fallback
  app.get('*', serveStatic({ path: '../dist/index.html' }));
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const PORT = Number(process.env.PORT ?? 3001);

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`[loomspace] Server running on http://localhost:${PORT}`);
  console.log(`[loomspace] Data directory: ${process.env.DATA_DIR ?? join(process.cwd(), 'data')}`);
});
