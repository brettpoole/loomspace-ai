# Graph Report - .  (2026-06-12)

## Corpus Check
- 7 files · ~33,034 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 571 nodes · 1364 edges · 33 communities (26 shown, 7 thin omitted)
- Extraction: 85% EXTRACTED · 15% INFERRED · 0% AMBIGUOUS · INFERRED: 201 edges (avg confidence: 0.58)
- Token cost: 53,171 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_NodeHono Server Routes|Node/Hono Server Routes]]
- [[_COMMUNITY_DB Migration Environment|DB Migration Environment]]
- [[_COMMUNITY_Python Storage & Persistence|Python Storage & Persistence]]
- [[_COMMUNITY_Frontend API Client & Media|Frontend API Client & Media]]
- [[_COMMUNITY_Frontend State & Sample Data|Frontend State & Sample Data]]
- [[_COMMUNITY_Database Models & ORM|Database Models & ORM]]
- [[_COMMUNITY_Provider Config & AI Interface|Provider Config & AI Interface]]
- [[_COMMUNITY_FastAPI RequestResponse Schemas|FastAPI Request/Response Schemas]]
- [[_COMMUNITY_Implementation Planning Docs|Implementation Planning Docs]]
- [[_COMMUNITY_Frontend Package Config|Frontend Package Config]]
- [[_COMMUNITY_Node Server Package Config|Node Server Package Config]]
- [[_COMMUNITY_Frontend TypeScript Config|Frontend TypeScript Config]]
- [[_COMMUNITY_Server TypeScript Config|Server TypeScript Config]]
- [[_COMMUNITY_Crypto & Secret Storage|Crypto & Secret Storage]]
- [[_COMMUNITY_Settings Lifecycle & Cleanup|Settings Lifecycle & Cleanup]]
- [[_COMMUNITY_Cost & URL Utilities|Cost & URL Utilities]]
- [[_COMMUNITY_Node TypeScript Config|Node TypeScript Config]]
- [[_COMMUNITY_Profile Data Contracts|Profile Data Contracts]]
- [[_COMMUNITY_Workspace State Management|Workspace State Management]]
- [[_COMMUNITY_Design Concepts & Audit Notes|Design Concepts & Audit Notes]]
- [[_COMMUNITY_Deployment Configuration|Deployment Configuration]]
- [[_COMMUNITY_App Entry Points|App Entry Points]]
- [[_COMMUNITY_Project Documentation|Project Documentation]]
- [[_COMMUNITY_Password Security|Password Security]]
- [[_COMMUNITY_Conflict Detection Concept|Conflict Detection Concept]]
- [[_COMMUNITY_Thread Model Settings Concept|Thread Model Settings Concept]]
- [[_COMMUNITY_Param Support Config|Param Support Config]]

## God Nodes (most connected - your core abstractions)
1. `User` - 38 edges
2. `Profile` - 25 edges
3. `save_settings()` - 22 edges
4. `Workspace` - 20 edges
5. `User` - 20 edges
6. `AsyncSession` - 20 edges
7. `apiFetch()` - 20 edges
8. `get_current_user()` - 19 edges
9. `chat()` - 18 edges
10. `compilerOptions` - 17 edges

## Surprising Connections (you probably didn't know these)
- `sanitizeGenerationParams()` --semantically_similar_to--> `sanitizeGenerationParams triplication (frontend/Node/Python)`  [INFERRED] [semantically similar]
  src/lib/store.ts → /home/user/Development/loomspace-ai/review-backend.yaml
- `409 Conflict Detection with lastSyncAt` --rationale_for--> `save_settings()`  [INFERRED]
  README.md → backend/app/routers/profiles.py
- `409 Conflict Detection with lastSyncAt` --rationale_for--> `save_workspace_store()`  [INFERRED]
  README.md → backend/app/routers/workspace.py
- `Phase 2: File Upload Infrastructure` --rationale_for--> `processFile()`  [INFERRED]
  /home/user/Development/loomspace-ai/IMPLEMENTATION_PLAN.md → src/lib/mediaUtils.ts
- `Client-side only base64 upload strategy` --rationale_for--> `processFile()`  [INFERRED]
  /home/user/Development/loomspace-ai/MEDIA_HANDLING_DESIGN.md → src/lib/mediaUtils.ts

## Import Cycles
- 1-file cycle: `backend/app/models.py -> backend/app/models.py`
- 1-file cycle: `backend/app/main.py -> backend/app/main.py`

## Hyperedges (group relationships)
- **409 Conflict Detection + Server-First Merge + Sync-Before-Write Pattern** — readme_conflict_detection, readme_server_first_merge, routers_profiles_save_settings, routers_workspace_save_workspace_store, lib_api_apisavesettingswithsync, lib_api_apisaveworkspacestorewithsync, lib_api_mergesettingsserverfirst, lib_api_mergeworkspaceserverfirst [INFERRED 0.90]
- **JWT Auth Dependency Injection via get_current_user** — routers_deps_get_current_user, routers_profiles_router, routers_proxy_router, routers_workspace_router [INFERRED 0.95]
- **AI Provider Dispatch: profile lookup -> base URL resolve -> provider-specific chat** — routers_proxy_chat, routers_proxy__get_profile_with_key, routers_proxy__resolve_base_url, routers_proxy__anthropic_chat, routers_proxy__openai_compatible_chat [INFERRED 0.90]

## Communities (33 total, 7 thin omitted)

### Community 0 - "Node/Hono Server Routes"
Cohesion: 0.05
Nodes (80): app, DIST_DIR, handleUpsert(), orphans, PORT, AIProvider, clearKey(), decryptKey() (+72 more)

### Community 1 - "DB Migration Environment"
Cohesion: 0.07
Nodes (43): get_url(), run_migrations_offline(), run_migrations_online(), Config, Settings, Async SQLAlchemy Engine & Session, get_db(), lifespan() (+35 more)

### Community 2 - "Python Storage & Persistence"
Cohesion: 0.12
Nodes (50): Any, load_reserved_json(), load_settings_blob(), load_updated_at(), params_by_profile_id(), Save a timestamp for conflict detection., Load the stored timestamp (ISO 8601) for conflict detection., reserved_row_id() (+42 more)

### Community 3 - "Frontend API Client & Media"
Cohesion: 0.06
Nodes (34): SaveServerSettingsPayload, ServerSettingsPayload, decodeBase64Text(), getMessageText(), createChatNode(), createProviderConfig(), fetchProviderModels(), getModelWindow() (+26 more)

### Community 4 - "Frontend State & Sample Data"
Cohesion: 0.07
Nodes (43): sampleState, appendContextInjection(), computeMetrics(), createContextNode(), createThread(), EncryptedSecretPayload, PBKDF2/AES-GCM API key encryption, loadModelCache() (+35 more)

### Community 5 - "Database Models & ORM"
Cohesion: 0.15
Nodes (41): Alembic Migration Runner, Base, Profile, User, CamelModel, ChatMessage, GenerationParams, LoginRequest (+33 more)

### Community 6 - "Provider Config & AI Interface"
Cohesion: 0.09
Nodes (35): AIProvider, apiChat(), apiClearKey(), apiDeleteProfile(), ApiError, apiFetch(), apiFetchModels(), apiGetMe() (+27 more)

### Community 7 - "FastAPI Request/Response Schemas"
Cohesion: 0.22
Nodes (24): ChatRequest, ChatResponse, ChatUsage, ModelsResponse, AsyncClient, AsyncSession, Profile, User (+16 more)

### Community 8 - "Implementation Planning Docs"
Cohesion: 0.13
Nodes (19): IMPLEMENTATION_PLAN.md (media/INT-17), Phase 1A: Type System Enhancement, Phase 2: File Upload Infrastructure, Phase 3: AI Provider Vision Integration, createMixedMessage(), createTextMessage(), getAttachmentsByType(), hasAttachments() (+11 more)

### Community 9 - "Frontend Package Config"
Cohesion: 0.10
Nodes (19): dependencies, react, react-dom, react-markdown, devDependencies, @types/node, @types/react, @types/react-dom (+11 more)

### Community 10 - "Node Server Package Config"
Cohesion: 0.10
Nodes (19): dependencies, hono, @hono/node-server, description, devDependencies, tsx, @types/node, typescript (+11 more)

### Community 11 - "Frontend TypeScript Config"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, allowSyntheticDefaultImports, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, jsx, lib (+10 more)

### Community 12 - "Server TypeScript Config"
Cohesion: 0.15
Nodes (12): compilerOptions, declaration, esModuleInterop, module, moduleResolution, outDir, rootDir, skipLibCheck (+4 more)

### Community 13 - "Crypto & Secret Storage"
Cohesion: 0.26
Nodes (12): decryptSecret(), defaultProviderConfigId(), fromBase64(), isProvider(), loadSettings(), parseSecretPayload(), readConfigSecretPayload(), readCookie() (+4 more)

### Community 14 - "Settings Lifecycle & Cleanup"
Cohesion: 0.20
Nodes (11): clearProviderSecret(), clearSettingsCookies(), deleteCookie(), deleteProviderConfig(), encryptSecret(), saveProviderSecret(), saveSettings(), secretCookieName() (+3 more)

### Community 15 - "Cost & URL Utilities"
Cohesion: 0.40
Nodes (10): estimateCost(), resolveBaseUrl(), normalizeUsage(), openAiGenerationBodyForParams(), requestAiReply(), requestAnthropic(), requestOpenAiCompatible(), requestOpenRouter() (+2 more)

### Community 16 - "Node TypeScript Config"
Cohesion: 0.25
Nodes (7): compilerOptions, allowSyntheticDefaultImports, lib, module, moduleResolution, types, include

### Community 17 - "Profile Data Contracts"
Cohesion: 0.29
Nodes (7): SaveServerProfile, UpsertProfilePayload, LegacySettingsPayload, PersistedProviderConfig, sanitizeGenerationParams(), AIProvider, GenerationParams

### Community 18 - "Workspace State Management"
Cohesion: 0.33
Nodes (7): createWorkspaceEntry(), createWorkspaceState(), defaultWorkspaceStore(), loadWorkspaceStore(), migrateWorkspaceState(), newWorkspaceId(), resetWorkspaceState()

### Community 19 - "Design Concepts & Audit Notes"
Cohesion: 0.50
Nodes (4): App.tsx monolith (3000+ lines), sanitizeGenerationParams triplication (frontend/Node/Python), review-backend.yaml (multi-commit review report), scout-recon.yaml (codebase recon report)

## Knowledge Gaps
- **126 isolated node(s):** `Config`, `AsyncSession`, `name`, `private`, `version` (+121 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `save_settings()` connect `Python Storage & Persistence` to `Database Models & ORM`, `Provider Config & AI Interface`?**
  _High betweenness centrality (0.047) - this node is a cross-community bridge._
- **Why does `apiSaveSettings()` connect `Provider Config & AI Interface` to `Python Storage & Persistence`, `Frontend API Client & Media`?**
  _High betweenness centrality (0.040) - this node is a cross-community bridge._
- **Why does `chat()` connect `FastAPI Request/Response Schemas` to `Python Storage & Persistence`, `Provider Config & AI Interface`?**
  _High betweenness centrality (0.040) - this node is a cross-community bridge._
- **Are the 33 inferred relationships involving `User` (e.g. with `Base` and `AsyncClient`) actually correct?**
  _`User` has 33 INFERRED edges - model-reasoned connections that need verification._
- **Are the 21 inferred relationships involving `Profile` (e.g. with `Base` and `AsyncClient`) actually correct?**
  _`Profile` has 21 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `save_settings()` (e.g. with `apiSaveSettings()` and `409 Conflict Detection with lastSyncAt`) actually correct?**
  _`save_settings()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Are the 13 inferred relationships involving `Workspace` (e.g. with `Base` and `Any`) actually correct?**
  _`Workspace` has 13 INFERRED edges - model-reasoned connections that need verification._