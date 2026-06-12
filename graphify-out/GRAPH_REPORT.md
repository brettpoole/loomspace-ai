# Graph Report - .  (2026-06-12)

## Corpus Check
- Corpus is ~33,250 words - fits in a single context window. You may not need a graph.

## Summary
- 478 nodes · 1137 edges · 28 communities (22 shown, 6 thin omitted)
- Extraction: 85% EXTRACTED · 15% INFERRED · 0% AMBIGUOUS · INFERRED: 172 edges (avg confidence: 0.61)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_API Client|API Client]]
- [[_COMMUNITY_Schemas & Profiles|Schemas & Profiles]]
- [[_COMMUNITY_Backend Core|Backend Core]]
- [[_COMMUNITY_Frontend Store|Frontend Store]]
- [[_COMMUNITY_App Thread Logic|App Thread Logic]]
- [[_COMMUNITY_Security & Params|Security & Params]]
- [[_COMMUNITY_Frontend Sync Services|Frontend Sync Services]]
- [[_COMMUNITY_App Types|App Types]]
- [[_COMMUNITY_Media Plan|Media Plan]]
- [[_COMMUNITY_UI Preferences|UI Preferences]]
- [[_COMMUNITY_Frontend Dependencies|Frontend Dependencies]]
- [[_COMMUNITY_TypeScript App Config|TypeScript App Config]]
- [[_COMMUNITY_Provider Presentation|Provider Presentation]]
- [[_COMMUNITY_TypeScript Node Config|TypeScript Node Config]]
- [[_COMMUNITY_Workspace Persistence|Workspace Persistence]]
- [[_COMMUNITY_Alembic Env|Alembic Env]]
- [[_COMMUNITY_FastAPI Routing|FastAPI Routing]]
- [[_COMMUNITY_Review Notes|Review Notes]]
- [[_COMMUNITY_Deployment Files|Deployment Files]]
- [[_COMMUNITY_Project Principles|Project Principles]]
- [[_COMMUNITY_Backend App Package|Backend App Package]]
- [[_COMMUNITY_Password Hashing|Password Hashing]]
- [[_COMMUNITY_Provider Param Support|Provider Param Support]]
- [[_COMMUNITY_Router Package|Router Package]]

## God Nodes (most connected - your core abstractions)
1. `User` - 31 edges
2. `App()` - 28 edges
3. `save_settings()` - 22 edges
4. `get_current_user()` - 20 edges
5. `User` - 20 edges
6. `AsyncSession` - 20 edges
7. `Profile` - 19 edges
8. `chat()` - 18 edges
9. `apiFetch()` - 17 edges
10. `BrowserUiPreferences` - 17 edges

## Surprising Connections (you probably didn't know these)
- `sanitizeGenerationParams()` --semantically_similar_to--> `sanitizeGenerationParams triplication (frontend/Node/Python)`  [INFERRED] [semantically similar]
  src/lib/store.ts → /home/user/Development/loomspace-ai/review-backend.yaml
- `409 Conflict Detection with lastSyncAt` --rationale_for--> `save_settings()`  [INFERRED]
  /home/user/Development/loomspace-ai/README.md → backend/app/routers/profiles.py
- `409 Conflict Detection with lastSyncAt` --rationale_for--> `save_workspace_store()`  [INFERRED]
  /home/user/Development/loomspace-ai/README.md → backend/app/routers/workspace.py
- `Phase 2: File Upload Infrastructure` --rationale_for--> `processFile()`  [INFERRED]
  /home/user/Development/loomspace-ai/IMPLEMENTATION_PLAN.md → src/lib/mediaUtils.ts
- `Client-side only base64 upload strategy` --rationale_for--> `processFile()`  [INFERRED]
  /home/user/Development/loomspace-ai/MEDIA_HANDLING_DESIGN.md → src/lib/mediaUtils.ts

## Import Cycles
- 1-file cycle: `backend/app/models.py -> backend/app/models.py`
- 1-file cycle: `backend/app/main.py -> backend/app/main.py`

## Hyperedges (group relationships)
- **JWT Auth Dependency Injection via get_current_user** — routers_deps_get_current_user, routers_profiles_router, routers_proxy_router, routers_workspace_router [INFERRED 0.95]
- **AI Provider Dispatch: profile lookup -> base URL resolve -> provider-specific chat** — routers_proxy_chat, routers_proxy__get_profile_with_key, routers_proxy__resolve_base_url, routers_proxy__anthropic_chat, routers_proxy__openai_compatible_chat [INFERRED 0.90]
- **Frontend Toolchain Configuration** — package_loomspace, tsconfig_typescript_config, tsconfig_node_typescript_config, vite_config_default_config [INFERRED 0.85]
- **409 Conflict Detection + Server-First Merge + Sync-Before-Write Pattern** — readme_conflict_detection, readme_server_first_merge, routers_profiles_save_settings, routers_workspace_save_workspace_store, lib_api_apisavesettingswithsync, lib_api_apisaveworkspacestorewithsync, lib_api_mergesettingsserverfirst, lib_api_mergeworkspaceserverfirst [INFERRED 0.90]
- **App Settings Sync Flow** — src_app_app, lib_frontendpersistenceservice_frontendpersistenceservice, lib_settingssnapshotmapper_settingssnapshotmapper [INFERRED 0.85]
- **Browser UI Preference Lifecycle** — src_app_app, lib_uipreferences_browseruipreferences, lib_uipreferences_loadthememode, lib_uipreferences_savethememode, lib_uipreferences_loadpanelsizes, lib_uipreferences_savepanelsizes [INFERRED 0.85]

## Communities (28 total, 6 thin omitted)

### Community 0 - "API Client"
Cohesion: 0.08
Nodes (47): AIProvider, apiChat(), apiClearKey(), apiDeleteProfile(), ApiError, apiFetch(), apiFetchModels(), apiGetProfile() (+39 more)

### Community 1 - "Schemas & Profiles"
Cohesion: 0.13
Nodes (51): Alembic Migration Runner, Profile, User, CamelModel, ChatMessage, ChatRequest, ChatResponse, ChatUsage (+43 more)

### Community 2 - "Backend Core"
Cohesion: 0.09
Nodes (38): Config, Settings, Base, Async SQLAlchemy Engine & Session, get_db(), lifespan(), utcnow(), Workspace (+30 more)

### Community 3 - "Frontend Store"
Cohesion: 0.08
Nodes (42): clearProviderSecret(), clearSettingsCookies(), computeMetrics(), createContextNode(), createThread(), decryptSecret(), defaultProviderConfigId(), deleteCookie() (+34 more)

### Community 4 - "App Thread Logic"
Cohesion: 0.08
Nodes (34): index.html (SPA entry with CSP), decodeBase64Text(), getMessageText(), appendContextInjection(), createChatNode(), estimateCost(), resolveBaseUrl(), summarize() (+26 more)

### Community 5 - "Security & Params"
Cohesion: 0.15
Nodes (34): params_by_profile_id(), create_access_token(), decode_access_token(), decrypt_api_key(), encrypt_api_key(), _fernet(), AsyncSession, User (+26 more)

### Community 6 - "Frontend Sync Services"
Cohesion: 0.07
Nodes (36): FrontendPersistenceService.clearPendingWrites, FrontendPersistenceService.createConflictError, FrontendPersistenceService.saveSettings, FrontendPersistenceService.saveWorkspaceStore, ProviderPresentationPolicy.apiKeyPlaceholder, ProviderPresentationPolicy.providerKeyLink, SettingsSnapshotMapper.serialize, getModelWindow() (+28 more)

### Community 7 - "App Types"
Cohesion: 0.11
Nodes (20): sampleState, updateThreadModelSettings(), AIProviderConfig, FabricMetrics, ForkDraft, LoomspaceState, MessageRole, PersistedWorkspace (+12 more)

### Community 8 - "Media Plan"
Cohesion: 0.13
Nodes (19): IMPLEMENTATION_PLAN.md (media/INT-17), Phase 1A: Type System Enhancement, Phase 2: File Upload Infrastructure, Phase 3: AI Provider Vision Integration, createMixedMessage(), createTextMessage(), getAttachmentsByType(), hasAttachments() (+11 more)

### Community 9 - "UI Preferences"
Cohesion: 0.14
Nodes (5): BrowserUiPreferences, PanelBounds, PanelSizes, ThemeMode, TtsSettings

### Community 10 - "Frontend Dependencies"
Cohesion: 0.10
Nodes (19): dependencies, react, react-dom, react-markdown, devDependencies, @types/node, @types/react, @types/react-dom (+11 more)

### Community 11 - "TypeScript App Config"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, allowSyntheticDefaultImports, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, jsx, lib (+10 more)

### Community 12 - "Provider Presentation"
Cohesion: 0.23
Nodes (8): ProviderPresentationPolicy.autoProfileLabel, ProviderPresentationPolicy, createProviderConfig(), fetchProviderModels(), LegacySettingsPayload, providerInfo(), PROVIDERS, AIProvider

### Community 13 - "TypeScript Node Config"
Cohesion: 0.25
Nodes (7): compilerOptions, allowSyntheticDefaultImports, lib, module, moduleResolution, types, include

### Community 14 - "Workspace Persistence"
Cohesion: 0.33
Nodes (7): createWorkspaceEntry(), createWorkspaceState(), defaultWorkspaceStore(), loadWorkspaceStore(), migrateWorkspaceState(), newWorkspaceId(), resetWorkspaceState()

### Community 15 - "Alembic Env"
Cohesion: 0.60
Nodes (3): get_url(), run_migrations_offline(), run_migrations_online()

### Community 16 - "FastAPI Routing"
Cohesion: 0.50
Nodes (4): FastAPI Application (main.py), profiles APIRouter, proxy APIRouter, workspace APIRouter

### Community 17 - "Review Notes"
Cohesion: 0.50
Nodes (4): App.tsx monolith (3000+ lines), sanitizeGenerationParams triplication (frontend/Node/Python), review-backend.yaml (multi-commit review report), scout-recon.yaml (codebase recon report)

## Knowledge Gaps
- **92 isolated node(s):** `Config`, `AsyncSession`, `name`, `private`, `version` (+87 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `App()` connect `Frontend Sync Services` to `API Client`, `App Thread Logic`, `Provider Presentation`?**
  _High betweenness centrality (0.110) - this node is a cross-community bridge._
- **Why does `chat()` connect `Schemas & Profiles` to `API Client`, `Backend Core`, `Security & Params`?**
  _High betweenness centrality (0.075) - this node is a cross-community bridge._
- **Why does `apiChat()` connect `API Client` to `Schemas & Profiles`, `App Thread Logic`?**
  _High betweenness centrality (0.067) - this node is a cross-community bridge._
- **Are the 26 inferred relationships involving `User` (e.g. with `Base` and `AsyncClient`) actually correct?**
  _`User` has 26 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `save_settings()` (e.g. with `apiSaveSettings()` and `409 Conflict Detection with lastSyncAt`) actually correct?**
  _`save_settings()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Are the 8 inferred relationships involving `User` (e.g. with `Profile` and `User`) actually correct?**
  _`User` has 8 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Config`, `AsyncSession`, `Save a timestamp for conflict detection.` to the rest of the system?**
  _100 weakly-connected nodes found - possible documentation gaps or missing edges._