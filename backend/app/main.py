from __future__ import annotations

from typing import Any, Literal, cast

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .config import settings
from .secret_manager import SecretManager

Provider = Literal["openai", "openrouter", "anthropic", "openai-compatible-custom"]


class SecretUpsertRequest(BaseModel):
    provider_config_id: str = Field(min_length=1)
    provider: Provider
    api_key: str = Field(min_length=1)


class ChatProxyRequest(BaseModel):
    provider_config_id: str = Field(min_length=1)
    model: str = Field(min_length=1)
    messages: list[dict[str, Any]] = Field(default_factory=list)
    base_url: str | None = None
    temperature: float | None = None


def resolve_base_url(provider: Provider, base_url: str | None) -> str:
    candidate = (base_url or "").strip().rstrip("/")
    if candidate:
        return candidate
    if provider == "anthropic":
        return "https://api.anthropic.com/v1"
    if provider == "openrouter":
        return "https://openrouter.ai/api/v1"
    return "https://api.openai.com/v1"


app = FastAPI(title=settings.app_name, debug=settings.debug)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_methods=["*"],
    allow_headers=["*"],
)

secret_manager = SecretManager(settings.sqlite_path, settings.secret_manager_key)


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/secrets/upsert")
def upsert_secret(payload: SecretUpsertRequest) -> dict[str, bool]:
    secret_manager.upsert_secret(payload.provider_config_id, payload.provider, payload.api_key)
    return {"ok": True}


@app.delete("/api/secrets/{provider_config_id}")
def delete_secret(provider_config_id: str) -> dict[str, bool]:
    return {"ok": secret_manager.delete_secret(provider_config_id)}


@app.get("/api/secrets/{provider_config_id}/exists")
def secret_exists(provider_config_id: str) -> dict[str, bool]:
    return {"exists": secret_manager.secret_exists(provider_config_id)}


@app.post("/api/ai/chat")
async def proxy_chat(payload: ChatProxyRequest):
    try:
        provider_value, api_key = secret_manager.get_secret(payload.provider_config_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    provider = cast(Provider, provider_value)
    if provider not in {"openai", "openrouter", "anthropic", "openai-compatible-custom"}:
        raise HTTPException(status_code=400, detail=f"Unsupported provider: {provider_value}")

    base_url = resolve_base_url(provider, payload.base_url)

    timeout = httpx.Timeout(settings.request_timeout_seconds)
    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            if provider == "anthropic":
                headers = {
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                }
                system_messages = [m.get("content", "") for m in payload.messages if m.get("role") == "system"]
                non_system = [m for m in payload.messages if m.get("role") != "system"]
                req_body: dict[str, Any] = {
                    "model": payload.model,
                    "messages": non_system,
                    "max_tokens": 4096,
                }
                if system_messages:
                    req_body["system"] = "\n\n".join(str(s) for s in system_messages if s)
                if payload.temperature is not None:
                    req_body["temperature"] = payload.temperature
                upstream = await client.post(f"{base_url}/messages", headers=headers, json=req_body)
                data = upstream.json()
                if not upstream.is_success:
                    raise HTTPException(status_code=upstream.status_code, detail=data)
                return data

            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            }
            if provider == "openrouter":
                headers["X-App-Name"] = "Loomspace"

            req_body = {
                "model": payload.model,
                "messages": payload.messages,
            }
            if payload.temperature is not None:
                req_body["temperature"] = payload.temperature

            upstream = await client.post(f"{base_url}/chat/completions", headers=headers, json=req_body)
            data = upstream.json()
            if not upstream.is_success:
                raise HTTPException(status_code=upstream.status_code, detail=data)
            return data
        except httpx.TimeoutException as exc:
            raise HTTPException(status_code=504, detail="Upstream model request timed out") from exc
        except httpx.RequestError as exc:
            raise HTTPException(status_code=502, detail=f"Upstream request failed: {exc}") from exc
