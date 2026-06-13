# ---------------------------------------------------------------------------
# Stage 1: Build the React frontend
# ---------------------------------------------------------------------------

FROM node:22-alpine AS frontend-build

WORKDIR /src

# Copy frontend manifests early for caching
COPY package.json package-lock.json index.html tsconfig.json tsconfig.node.json vite.config.ts ./
COPY src ./src

RUN npm ci
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2: Python backend + compiled frontend
# ---------------------------------------------------------------------------

FROM python:3.12-slim

WORKDIR /app

# System deps for asyncpg and cryptography
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Create venv
RUN python -m venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONPATH="/app"

# Copy backend metadata first for caching
COPY backend/pyproject.toml ./pyproject.toml
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir .

# Copy backend source
COPY backend/ .

# Copy compiled frontend dist into dist/
COPY --from=frontend-build /src/dist ./dist

# System deps for security hardening
RUN apt-get update && apt-get install -y --no-install-recommends libcap2-bin && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -r appuser && useradd -r -g appuser -d /app -s /bin/sh appuser
RUN chown -R appuser:appuser /app
USER appuser

CMD ["setpriv", "--no-new-privileges", "--", "sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
