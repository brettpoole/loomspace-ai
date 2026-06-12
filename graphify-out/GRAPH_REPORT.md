# Graph Report - .  (2026-06-11)

## Corpus Check
- Corpus is ~44,047 words - fits in a single context window. You may not need a graph.

## Summary
- 579 nodes · 1350 edges · 34 communities (32 shown, 2 thin omitted)
- Extraction: 86% EXTRACTED · 14% INFERRED · 0% AMBIGUOUS · INFERRED: 195 edges (avg confidence: 0.56)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Python Backend Data Layer|Python Backend Data Layer]]
- [[_COMMUNITY_Frontend API & Deployment|Frontend API & Deployment]]
- [[_COMMUNITY_Frontend State Store|Frontend State Store]]
- [[_COMMUNITY_Profile & Settings Schemas|Profile & Settings Schemas]]
- [[_COMMUNITY_Chat UI & Provider Logic|Chat UI & Provider Logic]]
- [[_COMMUNITY_FastAPI App & Auth Schemas|FastAPI App & Auth Schemas]]
- [[_COMMUNITY_AI Proxy & Chat Routes|AI Proxy & Chat Routes]]
- [[_COMMUNITY_Frontend Types & Model Settings|Frontend Types & Model Settings]]
- [[_COMMUNITY_Node Profile & Key Encryption|Node Profile & Key Encryption]]
- [[_COMMUNITY_Thread Settings Test Suite|Thread Settings Test Suite]]
- [[_COMMUNITY_Frontend Package Config|Frontend Package Config]]
- [[_COMMUNITY_Server Package Config|Server Package Config]]
- [[_COMMUNITY_Frontend TypeScript Config|Frontend TypeScript Config]]
- [[_COMMUNITY_Node Workspace Persistence|Node Workspace Persistence]]
- [[_COMMUNITY_Media Utilities|Media Utilities]]
- [[_COMMUNITY_Server TypeScript Config|Server TypeScript Config]]
- [[_COMMUNITY_Node HTTP Server Entry|Node HTTP Server Entry]]
- [[_COMMUNITY_Node Profile CRUD|Node Profile CRUD]]
- [[_COMMUNITY_Thread Model Override Concepts|Thread Model Override Concepts]]
- [[_COMMUNITY_AI Request Dispatch|AI Request Dispatch]]
- [[_COMMUNITY_Node AI Proxy|Node AI Proxy]]
- [[_COMMUNITY_Media Feature Design Docs|Media Feature Design Docs]]
- [[_COMMUNITY_Workspace State Management|Workspace State Management]]
- [[_COMMUNITY_Node TypeScript Config|Node TypeScript Config]]
- [[_COMMUNITY_Settings Loading|Settings Loading]]
- [[_COMMUNITY_Database Migrations|Database Migrations]]
- [[_COMMUNITY_Script Utilities|Script Utilities]]
- [[_COMMUNITY_Sample Data|Sample Data]]

## God Nodes (most connected - your core abstractions)
1. `User` - 39 edges
2. `Profile` - 26 edges
3. `Workspace` - 21 edges
4. `User` - 20 edges
5. `AsyncSession` - 20 edges
6. `compilerOptions` - 17 edges
7. `save_settings()` - 15 edges
8. `CamelModel` - 14 edges
9. `sync_node_to_fastapi()` - 14 edges
10. `GenerationParams` - 13 edges

## Surprising Connections (you probably didn't know these)
- `sanitizeGenerationParams()` --semantically_similar_to--> `sanitizeGenerationParams triplication (frontend/Node/Python)`  [INFERRED] [semantically similar]
  src/lib/store.ts → /home/user/Development/loomspace-ai/review-backend.yaml
- `AES-256-GCM Key Encryption (Node)` --semantically_similar_to--> `_fernet()`  [INFERRED] [semantically similar]
  /home/user/Development/loomspace-ai/server/src/profiles.ts → backend/app/security.py
- `_anthropic_chat()` --semantically_similar_to--> `_openai_compatible_chat Function`  [INFERRED] [semantically similar]
  backend/app/routers/proxy.py → /home/user/Development/loomspace-ai/backend/app/routers/proxy.py
- `GenerationParams Interface (Node)` --semantically_similar_to--> `GenerationParams`  [INFERRED] [semantically similar]
  /home/user/Development/loomspace-ai/server/src/profiles.ts → backend/app/schemas.py
- `Phase 2: File Upload Infrastructure` --rationale_for--> `processFile()`  [INFERRED]
  /home/user/Development/loomspace-ai/IMPLEMENTATION_PLAN.md → src/lib/mediaUtils.ts

## Import Cycles
- 1-file cycle: `backend/app/models.py -> backend/app/models.py`
- 1-file cycle: `backend/app/main.py -> backend/app/main.py`

## Communities (34 total, 2 thin omitted)

### Community 0 - "Python Backend Data Layer"
Cohesion: 0.10
Nodes (53): Alembic Migration Runner, Base, get_db(), User, utcnow(), Workspace, load_reserved_json(), load_updated_at() (+45 more)

### Community 1 - "Frontend API & Deployment"
Cohesion: 0.06
Nodes (42): app.yaml (DigitalOcean App Platform), App.tsx monolith (3000+ lines), sanitizeGenerationParams triplication (frontend/Node/Python), AIProvider, apiClearKey(), ApiError, apiFetch(), apiFetchModels() (+34 more)

### Community 2 - "Frontend State Store"
Cohesion: 0.07
Nodes (41): appendContextInjection(), clearProviderSecret(), clearSettingsCookies(), computeMetrics(), createContextNode(), createThread(), decryptSecret(), deleteCookie() (+33 more)

### Community 3 - "Profile & Settings Schemas"
Cohesion: 0.21
Nodes (38): Profile, load_settings_blob(), params_by_profile_id(), CamelModel, GenerationParams, ProfileOut, Base model that serializes to camelCase and accepts both snake and camel on inpu, SaveSettingsRequest (+30 more)

### Community 4 - "Chat UI & Provider Logic"
Cohesion: 0.07
Nodes (26): createChatNode(), createProviderConfig(), fetchProviderModels(), getModelWindow(), providerInfo(), summarize(), summarizeThreadUsage(), apiKeyPlaceholder() (+18 more)

### Community 5 - "FastAPI App & Auth Schemas"
Cohesion: 0.11
Nodes (30): Config, Settings, Async SQLAlchemy Engine & Session, lifespan(), ChatMessage, LoginRequest, RegisterRequest, TokenResponse (+22 more)

### Community 6 - "AI Proxy & Chat Routes"
Cohesion: 0.18
Nodes (28): FastAPI App (main), Reserved Workspace Row IDs & Helpers, Settings Blob Persistence (save/load), ChatRequest, ChatResponse, ChatUsage, ModelsResponse, Password Hashing (bcrypt) (+20 more)

### Community 7 - "Frontend Types & Model Settings"
Cohesion: 0.10
Nodes (24): ChatRequestPayload, sampleState, updateThreadModelSettings(), AIProviderConfig, AISettings, ChatMessage, FabricMetrics, ForkDraft (+16 more)

### Community 8 - "Node Profile & Key Encryption"
Cohesion: 0.14
Nodes (23): clearKey(), decryptKey(), deleteEncryptedKey(), deriveKey(), EncryptedKey, encryptKey(), getProfile(), keyPath() (+15 more)

### Community 9 - "Thread Settings Test Suite"
Cohesion: 0.11
Nodes (15): GenerationParams, Profile, Group 1 — Thread model assignment, Group 2 — Persistence through operations, Group 3 — Edge cases and migration, ResolvedThreadModel (test interface), resolveThreadModelSettings (test helper), loadWorkspaceStoreFromDir() (+7 more)

### Community 10 - "Frontend Package Config"
Cohesion: 0.10
Nodes (19): dependencies, react, react-dom, react-markdown, devDependencies, @types/node, @types/react, @types/react-dom (+11 more)

### Community 11 - "Server Package Config"
Cohesion: 0.10
Nodes (19): dependencies, hono, @hono/node-server, description, devDependencies, tsx, @types/node, typescript (+11 more)

### Community 12 - "Frontend TypeScript Config"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, allowSyntheticDefaultImports, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, jsx, lib (+10 more)

### Community 13 - "Node Workspace Persistence"
Cohesion: 0.22
Nodes (15): ensureDir(), listWorkspaceIds(), loadWorkspace(), loadWorkspaceStore(), loadWorkspaceStoreUpdatedAt(), migrateWorkspaceForThreadSettings(), resolveThreadModelSettings(), saveWorkspace() (+7 more)

### Community 14 - "Media Utilities"
Cohesion: 0.17
Nodes (14): createMixedMessage(), createTextMessage(), decodeBase64Text(), getAttachmentsByType(), getMessageText(), hasAttachments(), migrateMessage(), validateFile() (+6 more)

### Community 15 - "Server TypeScript Config"
Cohesion: 0.15
Nodes (12): compilerOptions, declaration, esModuleInterop, module, moduleResolution, outDir, rootDir, skipLibCheck (+4 more)

### Community 16 - "Node HTTP Server Entry"
Cohesion: 0.20
Nodes (11): app, DIST_DIR, orphans, PORT, listProfiles(), loadSettingsSnapshot(), loadSettingsUpdatedAt(), SaveSettingsSnapshotInput (+3 more)

### Community 17 - "Node Profile CRUD"
Cohesion: 0.32
Nodes (12): handleUpsert(), deleteProfile(), ensureDirs(), orphanedKeyIds(), readProfiles(), readStoredSettings(), saveSettingsSnapshot(), saveSettingsUpdatedAt() (+4 more)

### Community 18 - "Thread Model Override Concepts"
Cohesion: 0.25
Nodes (11): Dual Backend Architecture (FastAPI + Node/Hono), Per-Thread Model Settings Override Pattern, sanitizeStoredProfile (server-side validation), Hono Server App (Node backend), Profile Type & File Storage (Node), ThreadModelSettings Interface, chatCompletion Function (Node proxy), Thread Model Override Merge (Node proxy) (+3 more)

### Community 19 - "AI Request Dispatch"
Cohesion: 0.35
Nodes (11): apiChat(), estimateCost(), resolveBaseUrl(), normalizeUsage(), openAiGenerationBodyForParams(), requestAiReply(), requestAnthropic(), requestOpenAiCompatible() (+3 more)

### Community 20 - "Node AI Proxy"
Cohesion: 0.31
Nodes (10): AIProvider, resolveKey(), anthropicChat(), chatCompletion(), ChatRequest, ChatResponse, fetchModels(), openaiCompatibleChat() (+2 more)

### Community 21 - "Media Feature Design Docs"
Cohesion: 0.22
Nodes (9): IMPLEMENTATION_PLAN.md (media/INT-17), Phase 1A: Type System Enhancement, Phase 2: File Upload Infrastructure, Phase 3: AI Provider Vision Integration, processFile(), MediaAttachment, Client-side only base64 upload strategy, Vision API multi-provider integration (+1 more)

### Community 22 - "Workspace State Management"
Cohesion: 0.29
Nodes (8): createWorkspaceEntry(), createWorkspaceState(), defaultWorkspaceStore(), loadWorkspaceStore(), migrateWorkspaceState(), newWorkspaceId(), resetWorkspaceState(), Backend-persisted vs browser-local data split

### Community 23 - "Node TypeScript Config"
Cohesion: 0.25
Nodes (7): compilerOptions, allowSyntheticDefaultImports, lib, module, moduleResolution, types, include

### Community 24 - "Settings Loading"
Cohesion: 0.60
Nodes (6): defaultProviderConfigId(), isProvider(), loadSettings(), readCookie(), readLegacySettingsPayload(), readSettingsPayload()

### Community 25 - "Database Migrations"
Cohesion: 0.60
Nodes (3): get_url(), run_migrations_offline(), run_migrations_online()

## Knowledge Gaps
- **126 isolated node(s):** `Config`, `AsyncSession`, `name`, `private`, `version` (+121 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Hono Server App (Node backend)` connect `Thread Model Override Concepts` to `AI Proxy & Chat Routes`?**
  _High betweenness centrality (0.325) - this node is a cross-community bridge._
- **Why does `GenerationParams` connect `Frontend API & Deployment` to `Thread Settings Test Suite`, `Frontend State Store`, `Chat UI & Provider Logic`, `Frontend Types & Model Settings`?**
  _High betweenness centrality (0.229) - this node is a cross-community bridge._
- **Why does `main()` connect `Python Backend Data Layer` to `Thread Model Override Concepts`, `Profile & Settings Schemas`, `FastAPI App & Auth Schemas`, `AI Proxy & Chat Routes`?**
  _High betweenness centrality (0.206) - this node is a cross-community bridge._
- **Are the 33 inferred relationships involving `User` (e.g. with `Base` and `AsyncClient`) actually correct?**
  _`User` has 33 INFERRED edges - model-reasoned connections that need verification._
- **Are the 21 inferred relationships involving `Profile` (e.g. with `Base` and `AsyncClient`) actually correct?**
  _`Profile` has 21 INFERRED edges - model-reasoned connections that need verification._
- **Are the 13 inferred relationships involving `Workspace` (e.g. with `Base` and `Any`) actually correct?**
  _`Workspace` has 13 INFERRED edges - model-reasoned connections that need verification._
- **Are the 8 inferred relationships involving `User` (e.g. with `Profile` and `User`) actually correct?**
  _`User` has 8 INFERRED edges - model-reasoned connections that need verification._