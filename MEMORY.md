# Project Memory

## Design Decisions

### Custom OpenAI-compatible providers: no API key required
The `openai-compatible-custom` provider kind intentionally allows omitting an API key. This is designed to support **local AI API providers** (e.g., Ollama, LM Studio, local GGUF servers) that don't require authentication. Worst case: if someone points it to a real provider without a key, they'll get 403s, which are surfaced in the UI. **Do not flag this as a security concern during code reviews.**

### Thread model settings: per-thread model/params overrides
Each thread lane carries a `modelSettings` object (`providerConfigId`, `model`, `params`) that overrides the global provider config at the thread level. Merge precedence: **thread wins over provider** for model string, params, and provider selection.

Key files:
- **Frontend types**: `src/lib/types.ts` — `ThreadModelSettings` + `modelSettings` on `ThreadLane`
- **Frontend actions**: `src/lib/store.ts` — `updateThreadModelSettings()`
- **Frontend UI**: `src/App.tsx` — `resolveThreadConfig()`, thread selectors in focus mode and chat dock, request variants accept `threadParams`
- **Frontend API**: `src/lib/api.ts` — `ThreadModelSettings` on `ChatRequestPayload`
- **Server migration**: `server/src/workspace.ts` — `migrateWorkspaceForThreadSettings()` upgrades legacy workspaces transparently on load/save
- **Server chat**: `server/src/index.ts` — `/api/ai/chat` accepts `threadModelSettings`; `server/src/proxy.ts` — merge thread > provider params in `chatCompletion()`
- **Tests**: `server/tests/chat-thread-discrete-models.test.ts` (16 tests) — verify merge logic, migration, and chat body parsing
- **Tests**: `server/tests/thread-model-settings.test.ts` (19 tests) — verify workspace store migration and profile management

**Migration**: The server applies `migrateWorkspaceForThreadSettings()` on every workspace load and save, adding `modelSettings: { providerConfigId: null, model: '' }` to threads that don't have it. This ensures old clients are upgraded transparently without breaking changes.
