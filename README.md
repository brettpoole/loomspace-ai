# Loomspace

A canvas for weaving project ideas and AI conversations into persistent, navigable threads.

Current state split:
- durable app data can live on a backend: workspaces, threads, provider profiles, provider keys
- runtime-only preferences remain browser-local: theme, panel sizes, TTS settings, onboarding/session UI state, model cache

---

## What to run

The backend is a FastAPI + PostgreSQL service on port `8000`. The frontend is a Vite/React app.

---

## Local development

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

### Start frontend

In a second terminal:

```bash
npm ci
npm run dev
```

Expected:
- frontend URL: `http://127.0.0.1:5173`

`vite.config.ts` proxies `/api` to `http://127.0.0.1:8000` by default in dev.

Then open `http://127.0.0.1:5173`.

---

## What is persisted where

### Backend-persisted

These survive a full browser wipe:
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

## Building

### Frontend build

```bash
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
├── backend/              # FastAPI + PostgreSQL backend
├── docker-compose.yml    # Starts Postgres + FastAPI backend
├── Dockerfile.frontend   # Frontend dev container image
└── README.md
```

---

## Troubleshooting

### `Server error 404`

Usually one of these:

1. You started the frontend but not the backend.
2. The requested `/api/settings` or `/api/workspaces` route was not available in the process you started.

### `401 Unauthorized`

You are talking to the FastAPI backend without a valid auth token.
