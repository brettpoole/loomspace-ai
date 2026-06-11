# Graph Report - .  (2026-06-11)

## Corpus Check
- Corpus is ~31,917 words - fits in a single context window. You may not need a graph.

## Summary
- 539 nodes · 1072 edges · 32 communities (30 shown, 2 thin omitted)
- Extraction: 89% EXTRACTED · 11% INFERRED · 0% AMBIGUOUS · INFERRED: 118 edges (avg confidence: 0.56)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Server Routing & App Setup|Server Routing & App Setup]]
- [[_COMMUNITY_Backend Configuration & DB|Backend Configuration & DB]]
- [[_COMMUNITY_Frontend State Management|Frontend State Management]]
- [[_COMMUNITY_AI Provider Utilities|AI Provider Utilities]]
- [[_COMMUNITY_Database Models & Schemas|Database Models & Schemas]]
- [[_COMMUNITY_Frontend API Client|Frontend API Client]]
- [[_COMMUNITY_Backend Infrastructure|Backend Infrastructure]]
- [[_COMMUNITY_App Lifecycle & Health|App Lifecycle & Health]]
- [[_COMMUNITY_Type Definitions & Samples|Type Definitions & Samples]]
- [[_COMMUNITY_Frontend Dependencies|Frontend Dependencies]]
- [[_COMMUNITY_TypeScript Configuration|TypeScript Configuration]]
- [[_COMMUNITY_Server Dependencies|Server Dependencies]]
- [[_COMMUNITY_AI Provider API Endpoints|AI Provider API Endpoints]]
- [[_COMMUNITY_Media Message Utilities|Media Message Utilities]]
- [[_COMMUNITY_TypeScript Build Config|TypeScript Build Config]]
- [[_COMMUNITY_Vision API Providers|Vision API Providers]]
- [[_COMMUNITY_UI Feature Enhancements|UI Feature Enhancements]]
- [[_COMMUNITY_Message Content System|Message Content System]]
- [[_COMMUNITY_Provider Configuration|Provider Configuration]]
- [[_COMMUNITY_File Upload Infrastructure|File Upload Infrastructure]]
- [[_COMMUNITY_AI Request Handlers|AI Request Handlers]]
- [[_COMMUNITY_Node TypeScript Config|Node TypeScript Config]]
- [[_COMMUNITY_Image Generation Features|Image Generation Features]]
- [[_COMMUNITY_Migration Strategy|Migration Strategy]]
- [[_COMMUNITY_Alembic Migrations|Alembic Migrations]]
- [[_COMMUNITY_Image Processing|Image Processing]]
- [[_COMMUNITY_Legacy Workspace|Legacy Workspace]]

## God Nodes (most connected - your core abstractions)
1. `Profile` - 20 edges
2. `AsyncSession` - 18 edges
3. `compilerOptions` - 17 edges
4. `INT-17 Media Handling Design` - 17 edges
5. `Workspace` - 14 edges
6. `CamelModel` - 13 edges
7. `sync_node_to_fastapi()` - 13 edges
8. `SettingsSnapshot` - 12 edges
9. `Profile` - 11 edges
10. `_upsert()` - 11 edges

## Surprising Connections (you probably didn't know these)
- `Phase 2: File Upload Infrastructure` --semantically_similar_to--> `Browser-Local Data`  [INFERRED] [semantically similar]
  IMPLEMENTATION_PLAN.md → README.md
- `Phase 3: AI Provider Vision Integration` --semantically_similar_to--> `POST /api/ai/chat`  [INFERRED] [semantically similar]
  IMPLEMENTATION_PLAN.md → README.md
- `Vision API Support` --semantically_similar_to--> `Phase 3: AI Provider Vision Integration`  [INFERRED] [semantically similar]
  MEDIA_HANDLING_DESIGN.md → IMPLEMENTATION_PLAN.md
- `Thread Management` --semantically_similar_to--> `Phase 5: Testing & Polish`  [INFERRED] [semantically similar]
  MEDIA_HANDLING_DESIGN.md → IMPLEMENTATION_PLAN.md
- `Extended Message Types` --semantically_similar_to--> `MessageContentType`  [INFERRED] [semantically similar]
  MEDIA_HANDLING_DESIGN.md → IMPLEMENTATION_PLAN.md

## Import Cycles
- 1-file cycle: `backend/app/models.py -> backend/app/models.py`
- 1-file cycle: `backend/app/main.py -> backend/app/main.py`

## Hyperedges (group relationships)
- **INT-17 Media Implementation** — implementation_plan_phase_1a_type_system, implementation_plan_phase_1b_migration, implementation_plan_phase_2_file_upload, implementation_plan_phase_3_vision, media_design_message_types, media_design_file_input_ui, media_design_vision_api [EXTRACTED 1.00]
- **Durable vs Browser-Local Storage** — readme_durable_data, readme_browser_local_data, readme_server_backend, implementation_plan_store_ts, media_design_client_side_storage [INFERRED 0.75]

## Communities (32 total, 2 thin omitted)

### Community 0 - "Server Routing & App Setup"
Cohesion: 0.07
Nodes (61): app, DIST_DIR, handleUpsert(), orphans, PORT, AIProvider, clearKey(), decryptKey() (+53 more)

### Community 1 - "Backend Configuration & DB"
Cohesion: 0.10
Nodes (41): Config, Settings, Base, get_db(), utcnow(), Workspace, load_reserved_json(), load_settings_blob() (+33 more)

### Community 2 - "Frontend State Management"
Cohesion: 0.06
Nodes (46): appendContextInjection(), clearProviderSecret(), clearSettingsCookies(), computeMetrics(), createChatNode(), createContextNode(), createThread(), createWorkspaceEntry() (+38 more)

### Community 3 - "AI Provider Utilities"
Cohesion: 0.07
Nodes (30): decodeBase64Text(), getMessageText(), createProviderConfig(), fetchProviderModels(), getModelWindow(), providerInfo(), summarizeThreadUsage(), apiKeyPlaceholder() (+22 more)

### Community 4 - "Database Models & Schemas"
Cohesion: 0.21
Nodes (35): Profile, params_by_profile_id(), CamelModel, ChatMessage, GenerationParams, ProfileOut, Base model that serializes to camelCase and accepts both snake and camel on inpu, SaveSettingsRequest (+27 more)

### Community 5 - "Frontend API Client"
Cohesion: 0.09
Nodes (23): AIProvider, apiChat(), apiClearKey(), ApiError, apiFetch(), apiFetchModels(), apiGetProfile(), apiListProfiles() (+15 more)

### Community 6 - "Backend Infrastructure"
Cohesion: 0.09
Nodes (27): 401 Unauthorized, 404 Server Error, FastAPI Backend, Canvas (metaphor), DATA_SECRET, Docker Compose, FastAPI-to-Node Sync, Frontend (React + Vite) (+19 more)

### Community 7 - "App Lifecycle & Health"
Cohesion: 0.23
Nodes (19): lifespan(), ChatRequest, ChatResponse, ChatUsage, ModelsResponse, AsyncClient, AsyncSession, Profile (+11 more)

### Community 8 - "Type Definitions & Samples"
Cohesion: 0.10
Nodes (19): sampleState, AIProviderConfig, AISettings, FabricMetrics, ForkDraft, LoomspaceState, MessageRole, PersistedWorkspace (+11 more)

### Community 9 - "Frontend Dependencies"
Cohesion: 0.10
Nodes (19): dependencies, react, react-dom, react-markdown, devDependencies, @types/node, @types/react, @types/react-dom (+11 more)

### Community 10 - "TypeScript Configuration"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, allowSyntheticDefaultImports, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, jsx, lib (+10 more)

### Community 11 - "Server Dependencies"
Cohesion: 0.12
Nodes (16): dependencies, hono, @hono/node-server, description, devDependencies, tsx, @types/node, typescript (+8 more)

### Community 12 - "AI Provider API Endpoints"
Cohesion: 0.13
Nodes (15): AI Provider Profiles, GET /api/ai/models/{id}, POST/DELETE /api/profiles/{id}/key, GET/PUT /api/settings, GET/PUT /api/workspaces, Browser-Local Data, Canvas State, Durable Data (+7 more)

### Community 13 - "Media Message Utilities"
Cohesion: 0.16
Nodes (13): createMixedMessage(), createTextMessage(), getAttachmentsByType(), hasAttachments(), migrateMessage(), processFile(), validateFile(), verifyImageBytes() (+5 more)

### Community 14 - "TypeScript Build Config"
Cohesion: 0.15
Nodes (12): compilerOptions, declaration, esModuleInterop, module, moduleResolution, outDir, rootDir, skipLibCheck (+4 more)

### Community 15 - "Vision API Providers"
Cohesion: 0.23
Nodes (10): Anthropic Vision API, Anthropic Claude, OpenAI GPT-4V/4o, OpenAI Vision API, Phase 3: AI Provider Vision Integration, Anthropic API, OpenAI API, OpenRouter API (+2 more)

### Community 16 - "UI Feature Enhancements"
Cohesion: 0.20
Nodes (12): Browser Compatibility, Document Processing, Enhanced Composer, File Size Limits, Image OCR, Message Display (enhanced), INT-17 Media Handling Design, PDF Handling (+4 more)

### Community 17 - "Message Content System"
Cohesion: 0.27
Nodes (10): ChatMessage (enhanced), MediaAttachment, MessageContent, MessageContentType, Phase 1A: Type System Enhancement, Phase 4: Message Display Enhancement, Phase 5: Testing & Polish, lib/types.ts (+2 more)

### Community 18 - "Provider Configuration"
Cohesion: 0.33
Nodes (10): defaultProviderConfigId(), isProvider(), loadSettings(), parseSecretPayload(), readConfigSecretPayload(), readCookie(), readLegacySecretPayload(), readLegacySettingsPayload() (+2 more)

### Community 19 - "File Upload Infrastructure"
Cohesion: 0.28
Nodes (9): FileUpload Component, lib/mediaUtils.ts, Phase 2: File Upload Infrastructure, processFile(), validateFile(), File Input UI, File Validation, Security (+1 more)

### Community 20 - "AI Request Handlers"
Cohesion: 0.47
Nodes (9): estimateCost(), resolveBaseUrl(), normalizeUsage(), openAiGenerationBody(), requestAiReply(), requestAnthropic(), requestOpenAiCompatible(), requestOpenRouter() (+1 more)

### Community 21 - "Node TypeScript Config"
Cohesion: 0.25
Nodes (7): compilerOptions, allowSyntheticDefaultImports, lib, module, moduleResolution, types, include

### Community 22 - "Image Generation Features"
Cohesion: 0.33
Nodes (7): Downloadable Document Generation, Generated Content Strategy, Image Generation Request Detection, OpenAI DALL-E Integration, AI Response Interface, DALL-E Integration, Document Generation

### Community 23 - "Migration Strategy"
Cohesion: 0.33
Nodes (6): migrateMessage(), Phase 1B: Migration Strategy, lib/store.ts, Backward Compatibility, Base64 Encoding, Client-Side Storage (Option A)

### Community 24 - "Alembic Migrations"
Cohesion: 0.60
Nodes (3): get_url(), run_migrations_offline(), run_migrations_online()

## Knowledge Gaps
- **133 isolated node(s):** `Config`, `AsyncSession`, `name`, `private`, `version` (+128 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `INT-17 Media Handling Design` connect `UI Feature Enhancements` to `Vision API Providers`, `Message Content System`, `File Upload Infrastructure`, `Image Generation Features`, `Migration Strategy`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **Why does `Phase 3: AI Provider Vision Integration` connect `Vision API Providers` to `Message Content System`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **Why does `FastAPI Backend` connect `Backend Infrastructure` to `Vision API Providers`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **Are the 18 inferred relationships involving `Profile` (e.g. with `Base` and `AsyncClient`) actually correct?**
  _`Profile` has 18 INFERRED edges - model-reasoned connections that need verification._
- **Are the 7 inferred relationships involving `AsyncSession` (e.g. with `Profile` and `GenerationParams`) actually correct?**
  _`AsyncSession` has 7 INFERRED edges - model-reasoned connections that need verification._
- **Are the 9 inferred relationships involving `Workspace` (e.g. with `Base` and `Any`) actually correct?**
  _`Workspace` has 9 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Config`, `AsyncSession`, `Base model that serializes to camelCase and accepts both snake and camel on inpu` to the rest of the system?**
  _134 weakly-connected nodes found - possible documentation gaps or missing edges._