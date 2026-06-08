# Loomspace

A canvas for weaving project ideas and AI conversations into persistent, navigable threads.

Current state split:
- durable app data can live on a backend: workspaces, threads, provider profiles, provider keys
- runtime-only preferences remain browser-local: theme, panel sizes, TTS settings, onboarding/session UI state, model cache

---

## What to run

There are **two backends** in this repo:

1. `server/` — Node/Hono file-backed backend on port `3001`
   - easiest way to run the app end-to-end right now
   - no auth setup required
   - stores durable data under `server/data/`

2. `backend/` — FastAPI + PostgreSQL backend on port `8000`
   - used by the Docker/Postgres stack
   - requires auth for `/api/*`
   - the current `src/` frontend does **not** ship a login/register screen, so this path is not the easiest way to start using the UI locally

If you just want the app working locally, use **`server/` + Vite frontend**.

---

## Recommended local run

### Terminal 1 — start the backend

```bash
cd server
npm ci
DATA_SECRET=$(python -c "import secrets; print(secrets.token_hex(32))") npm start
```

Expected:
- backend URL: `http://127.0.0.1:3001`
- durable data written under `server/data/`

### Terminal 2 — start the frontend

```bash
npm ci
VITE_API_BASE=http://127.0.0.1:3001 npm run dev
```

Expected:
- frontend URL: `http://127.0.0.1:5173`

Then open `http://127.0.0.1:5173`.

This path supports the current persistence model:
- workspaces survive a browser wipe
- threads/messages survive a browser wipe
- provider profiles survive a browser wipe
- saved provider keys survive a browser wipe
- runtime-only settings reset after a browser wipe

---

## What is persisted where

### Backend-persisted

With the recommended `server/` backend running, these survive a full browser wipe:
- workspace collection
- active workspace
- thread graph / messages / canvas state
- AI provider profiles
- saved provider API keys
- provider model/generation settings

### Browser-local only

These stay local to the browser and may reset after a wipe:
- theme mode
- panel sizes
- TTS settings / voices
- onboarding dismissal state
- cached model lists

---

## Alternative: FastAPI + PostgreSQL stack

Use this only if you explicitly want the Python backend.

### Start backend services

```bash
cp .env.example .env
```

Generate secrets and place them in `.env`:

```bash
python -c "import secrets; print(secrets.token_hex(32))"
python -c "import secrets; print(secrets.token_hex(32))"
```

Start Postgres + FastAPI:

```bash
docker compose up --build
```

Expected:
- backend URL: `http://127.0.0.1:8000`
- API docs: `http://127.0.0.1:8000/docs`

### Start frontend against FastAPI

In a second terminal:

```bash
npm ci
npm run dev
```

Notes:
- `vite.config.ts` proxies `/api` to `http://127.0.0.1:8000` by default in dev.
- The current frontend does not expose a login/register screen, but the FastAPI backend requires auth on `/api/*`.
- So this stack is **not** the easiest path for using the UI unless you already have a token flow in place.

---

## Manual sync between the two backends

Yes. There is now a manual one-shot sync script.

Location:

```bash
backend/scripts/sync_storage.py
```

What it does:
- `node-to-fastapi` — copies durable data from `server/data/` into one FastAPI user
- `fastapi-to-node` — exports one FastAPI user's durable data back into `server/data/`

Scope:
- profiles
- saved provider keys
- provider params / active provider
- full workspace store
- per-workspace legacy files

Important:
- this is **manual sync**, not live replication
- the target side is treated as replaceable state
- for FastAPI, the sync is scoped to one username

### Run it

From the repo root, after installing the Python backend deps:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -e .
cd ..
```

If you use `.env` at the repo root, the script will load it automatically.

#### Node backend → FastAPI backend

Creates the FastAPI user if needed, then replaces that user's durable data with `server/data/`.

```bash
python backend/scripts/sync_storage.py \
  node-to-fastapi \
  --username alice \
  --password 'choose-a-password-if-the-user-does-not-exist'
```

If the Node backend used a different `DATA_SECRET`, pass it explicitly:

```bash
python backend/scripts/sync_storage.py \
  node-to-fastapi \
  --username alice \
  --password 'choose-a-password-if-the-user-does-not-exist' \
  --node-data-secret '<node-backend-data-secret>'
```

#### FastAPI backend → Node backend

Exports one FastAPI user's durable data into `server/data/`.

```bash
python backend/scripts/sync_storage.py \
  fastapi-to-node \
  --username alice
```

Again, if the Node backend should encrypt keys with a different secret:

```bash
python backend/scripts/sync_storage.py \
  fastapi-to-node \
  --username alice \
  --node-data-secret '<node-backend-data-secret>'
```

#### Non-default Node data directory

```bash
python backend/scripts/sync_storage.py \
  fastapi-to-node \
  --username alice \
  --server-data-dir /path/to/server/data
```

## Building

### Frontend build

```bash
npm run build
```

### Node backend typecheck/build

```bash
cd server
npm run build
```

### FastAPI Python syntax check

```bash
python -m py_compile \
  backend/app/main.py \
  backend/app/schemas.py \
  backend/app/persistence.py \
  backend/app/routers/profiles.py \
  backend/app/routers/proxy.py \
  backend/app/routers/workspace.py
```

---

## API surface used by the current frontend

### Durable settings

- `GET /api/settings`
- `PUT /api/settings`

Persists provider metadata and active provider selection.

### Workspace collection

- `GET /api/workspaces`
- `PUT /api/workspaces`

Persists the full workspace collection and active workspace.

### Provider keys

- `POST /api/profiles/{id}/key`
- `DELETE /api/profiles/{id}/key`

Persists encrypted provider secrets.

### AI proxy

- `POST /api/ai/chat`
- `GET /api/ai/models/{profileId}`

### Legacy single-workspace endpoints

- `GET /api/workspace/{id}`
- `PUT /api/workspace/{id}`

Still present for compatibility/migration.

---

## Project structure

```text
loomspace-ai/
├── src/                  # React frontend
├── server/               # Recommended local backend: Node/Hono + file persistence
├── backend/              # Alternative backend: FastAPI + PostgreSQL
├── docker-compose.yml    # Starts Postgres + FastAPI backend
├── Dockerfile.frontend   # Frontend dev container image
└── README.md
```

---

## Troubleshooting

### `Server error 404`

Usually one of these:

1. You started the frontend but not the backend.
2. You started the frontend against the wrong backend port.
3. You ran `npm run dev` without `VITE_API_BASE=http://127.0.0.1:3001` while trying to use `server/`.
4. You are using the FastAPI backend, but the requested `/api/settings` or `/api/workspaces` route was not available in the process you started.

### `401 Unauthorized`

You are almost certainly talking to the FastAPI backend on `:8000` without an auth token.

If you want the app working immediately, switch to the recommended local path:
- `server/` on `:3001`
- `VITE_API_BASE=http://127.0.0.1:3001 npm run dev`

---

## Exact commands recap

```bash
# terminal 1
cd server
npm ci
DATA_SECRET=$(python -c "import secrets; print(secrets.token_hex(32))") npm start

# terminal 2
npm ci
VITE_API_BASE=http://127.0.0.1:3001 npm run dev
```

Open: `http://127.0.0.1:5173`
