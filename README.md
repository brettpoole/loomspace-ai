# Loomspace

A canvas for weaving project ideas and AI conversations into persistent, navigable threads.

Each thread is an independent lane with its own AI context. Threads can be forked, cross-linked, and arranged spatially on an infinite canvas. All data is stored server-side per user account — nothing sensitive lives in the browser.

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Development](#development)
- [Project Structure](#project-structure)
- [Security](#security)
- [License](#license)

---

## Features

- **Thread canvas** — infinite zoomable/pannable workspace; each thread is a vertical lane of chat nodes
- **Multi-provider AI** — OpenAI, Anthropic, OpenRouter, and any OpenAI-compatible endpoint
- **Server-side key storage** — API keys are encrypted at rest with Fernet (AES-128-GCM); the browser never handles a plaintext key after it is saved
- **User accounts** — JWT-authenticated; each user's threads, profiles, and workspace are fully isolated
- **Thread forking** — branch a conversation into a new thread with injected context from selected nodes
- **Context injection** — pull messages from other threads into the active thread's context
- **Responsive layout** — sidebar collapses to a drawer below 1024 px

---

## Architecture

```
browser (React + Vite)
        │  HTTP / JSON
        ▼
backend (FastAPI, port 8000)
        │  asyncpg
        ▼
PostgreSQL 16 (port 5432)
```

| Layer | Stack |
|---|---|
| Frontend | React 19, TypeScript, Vite 7 |
| Backend | Python 3.12, FastAPI, SQLAlchemy 2 async, Alembic |
| Database | PostgreSQL 16 |
| Auth | JWT (HS256), bcrypt passwords |
| Encryption | Fernet (cryptography library), key derived from `DATA_SECRET` |
| Container | Docker + Compose |

---

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) ≥ 24 with the Compose plugin
- That's it for the default dev setup

To run services individually:

- Node.js ≥ 22
- Python ≥ 3.12

---

## Quick Start

```bash
# 1. Clone
git clone <repo-url>
cd loomspace-ai

# 2. Create your environment file
cp .env.example .env
```

Edit `.env` and set **both** required secrets:

```bash
# Generate DATA_SECRET
python -c "import secrets; print(secrets.token_hex(32))"

# Generate JWT_SECRET
python -c "import secrets; print(secrets.token_hex(32))"
```

```bash
# 3. Start the stack
docker compose up --build

# Frontend → http://localhost:5174
# Backend  → http://localhost:8000
# API docs → http://localhost:8000/docs
```

On first boot Alembic runs migrations automatically before uvicorn starts.

Register an account at http://localhost:5174, then add an AI profile in Settings and save your API key.

---

## Configuration

All backend configuration is via environment variables, loaded from `.env`.

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATA_SECRET` | Yes | — | 64-char hex secret used to derive the Fernet key for API key encryption |
| `JWT_SECRET` | Yes | `change-me-in-production` | Secret for signing JWT tokens |
| `DATABASE_URL` | No | `postgresql+asyncpg://loomspace:loomspace@db:5432/loomspace` | asyncpg connection string |
| `JWT_ALGORITHM` | No | `HS256` | JWT signing algorithm |
| `JWT_EXPIRE_MINUTES` | No | `10080` (7 days) | JWT token lifetime |
| `CORS_ORIGINS` | No | localhost dev ports | JSON array of allowed origins |

The frontend reads one variable at build time:

| Variable | Default | Description |
|---|---|---|
| `VITE_API_BASE` | `http://localhost:8000` | Backend base URL |

---

## API Reference

Interactive docs are available at `http://localhost:8000/docs` when the backend is running.

### Auth

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Create account → `{access_token, token_type}` |
| `POST` | `/api/auth/login` | Sign in → `{access_token, token_type}` |
| `GET` | `/api/auth/me` | Current user → `{id, username, createdAt}` |

All other endpoints require `Authorization: Bearer <token>`.

### Profiles (AI provider configurations)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/profiles` | List profiles |
| `POST` | `/api/profiles` | Create profile |
| `PUT` | `/api/profiles/{id}` | Update profile |
| `DELETE` | `/api/profiles/{id}` | Delete profile |
| `POST` | `/api/profiles/{id}/key` | Store encrypted API key |
| `DELETE` | `/api/profiles/{id}/key` | Clear stored API key |

### Workspace

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/workspace/{id}` | Load workspace JSON |
| `PUT` | `/api/workspace/{id}` | Save workspace JSON (upsert) |

### AI Proxy

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/ai/chat` | Proxy chat completion to configured provider |
| `GET` | `/api/ai/models/{profileId}` | Fetch available models for a profile |

### Health

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | `{status: "ok", ts: <epoch ms>}` |

---

## Development

### Docker (recommended)

```bash
docker compose up --build
```

Source is bind-mounted into both containers so changes hot-reload immediately — Vite HMR for the frontend, uvicorn `--reload` for the backend.

### Without Docker

**Backend**

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -e .

# Set env vars (or export them)
export DATA_SECRET=<hex>
export JWT_SECRET=<hex>
export DATABASE_URL=postgresql+asyncpg://loomspace:loomspace@localhost:5432/loomspace

alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

**Frontend**

```bash
npm install
VITE_API_BASE=http://localhost:8000 npm run dev
```

### Database migrations

```bash
cd backend

# Apply all pending migrations
alembic upgrade head

# Create a new migration after changing models.py
alembic revision --autogenerate -m "description"

# Downgrade one step
alembic downgrade -1
```

### Building for production

```bash
# Build frontend static assets
npm run build          # outputs to dist/

# The backend serves dist/ automatically when it exists
```

---

## Project Structure

```
loomspace-ai/
├── src/                        # React frontend
│   ├── App.tsx                 # Main canvas component (~2500 lines)
│   ├── AuthGate.tsx            # Login / register screen
│   ├── main.tsx                # Entry point, auth state
│   ├── styles.css              # Global styles
│   └── lib/
│       ├── api.ts              # Backend API client
│       ├── store.ts            # Pure state helpers
│       ├── types.ts            # Shared TypeScript types
│       └── mediaUtils.ts       # File/image attachment handling
│
├── backend/
│   ├── app/
│   │   ├── main.py             # FastAPI app, CORS, router wiring
│   │   ├── config.py           # pydantic-settings configuration
│   │   ├── database.py         # Async SQLAlchemy engine + session
│   │   ├── models.py           # ORM models (User, Profile, Workspace)
│   │   ├── schemas.py          # Pydantic request/response schemas
│   │   ├── security.py         # Password hashing, JWT, Fernet encryption
│   │   └── routers/
│   │       ├── auth.py         # /api/auth/*
│   │       ├── profiles.py     # /api/profiles/*
│   │       ├── workspace.py    # /api/workspace/*
│   │       └── proxy.py        # /api/ai/*
│   ├── alembic/                # Database migrations
│   ├── alembic.ini
│   ├── Dockerfile
│   └── pyproject.toml
│
├── docker-compose.yml          # Full stack: db + backend + frontend
├── Dockerfile.frontend
├── .env.example                # Environment variable template
└── index.html
```

---

## Security

- **API keys** are encrypted with Fernet before storage. The encryption key is derived from `DATA_SECRET` via SHA-256. The plaintext key is only held in memory server-side during a proxied request and is never returned to the browser after initial submission.
- **Passwords** are hashed with bcrypt (via the `bcrypt` library directly).
- **JWTs** use HS256 with a configurable secret and 7-day expiry by default.
- **Workspace isolation** — each workspace row is scoped to `user_id`; the server enforces ownership on every read and write.
- **CORS** — in production, set `CORS_ORIGINS` to your actual frontend origin. The default allows all localhost ports for development.
- **No secrets in source** — `.env` is gitignored; `.env.example` contains only placeholder values.

> **Note:** This is a development-oriented setup. For production deployment, use a strong randomly-generated `DATA_SECRET` and `JWT_SECRET`, put the stack behind TLS, and restrict `CORS_ORIGINS`.

---

## License

MIT License — see [LICENSE](LICENSE) for details. The software is provided as-is without warranty.
