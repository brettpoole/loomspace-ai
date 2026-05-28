import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import auth, profiles, workspace, proxy


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Nothing to do at startup — Alembic handles migrations
    yield


app = FastAPI(title="LoomSpace AI Backend", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(profiles.router, prefix="/api")
app.include_router(workspace.router, prefix="/api")
app.include_router(proxy.router, prefix="/api")


@app.get("/api/health")
async def health():
    return {"status": "ok", "ts": int(time.time() * 1000)}
