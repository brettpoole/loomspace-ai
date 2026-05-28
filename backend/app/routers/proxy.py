import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models import Profile, User
from app.schemas import ChatRequest, ChatResponse, ChatUsage, ModelsResponse
from app.security import decrypt_api_key
from app.routers.auth import get_current_user

router = APIRouter(tags=["proxy"])


def _resolve_base_url(base_url: str | None, kind: str) -> str:
    if kind == "anthropic":
        return (base_url or "").rstrip("/") or "https://api.anthropic.com/v1"
    if kind == "openrouter":
        return (base_url or "").rstrip("/") or "https://openrouter.ai/api/v1"
    if kind == "openai":
        return (base_url or "").rstrip("/") or "https://api.openai.com/v1"
    # openai-compatible-custom
    trimmed = (base_url or "").strip()
    if not trimmed:
        raise ValueError("baseUrl is required for custom OpenAI-compatible providers")
    return trimmed.rstrip("/")


async def _get_profile_with_key(
    profile_id: str, current_user: User, db: AsyncSession
) -> tuple[Profile, str]:
    result = await db.execute(
        select(Profile).where(Profile.id == profile_id, Profile.user_id == current_user.id)
    )
    p = result.scalar_one_or_none()
    if p is None:
        raise HTTPException(404, f"Profile {profile_id} not found")
    if p.encrypted_api_key is None:
        raise HTTPException(400, f"No API key stored for profile {profile_id}")
    api_key = decrypt_api_key(p.encrypted_api_key)
    return p, api_key


@router.get("/ai/models/{profile_id}", response_model=ModelsResponse)
async def fetch_models(
    profile_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    p, api_key = await _get_profile_with_key(profile_id, current_user, db)
    base_url = _resolve_base_url(p.base_url, p.kind)
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            if p.kind == "anthropic":
                r = await client.get(
                    f"{base_url}/models",
                    headers={"x-api-key": api_key, "anthropic-version": "2023-06-01"},
                )
                r.raise_for_status()
                data = r.json()
                models = sorted(
                    m["id"] for m in (data.get("data") or []) if m.get("id")
                )
            else:
                r = await client.get(
                    f"{base_url}/models",
                    headers={"Authorization": f"Bearer {api_key}"},
                )
                r.raise_for_status()
                data = r.json()
                if p.kind == "openrouter":
                    models = sorted(
                        m["id"]
                        for m in (data.get("data") or [])
                        if m.get("id")
                        and (
                            str(m["id"]).endswith(":free")
                            or (
                                float(m.get("pricing", {}).get("prompt", "1") or "1") == 0
                                and float(m.get("pricing", {}).get("completion", "1") or "1") == 0
                            )
                        )
                    )
                else:
                    models = sorted(m["id"] for m in (data.get("data") or []) if m.get("id"))
        return ModelsResponse(models=models)
    except httpx.HTTPStatusError as e:
        raise HTTPException(502, str(e))
    except Exception as e:
        raise HTTPException(502, str(e))


@router.post("/ai/chat", response_model=ChatResponse)
async def chat(
    body: ChatRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    p, api_key = await _get_profile_with_key(body.profile_id, current_user, db)
    base_url = _resolve_base_url(p.base_url, p.kind)
    messages = [{"role": m.role, "content": m.content} for m in body.messages]
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            if p.kind == "anthropic":
                result = await _anthropic_chat(
                    client, base_url, api_key, p.model, messages, body.system_prompt
                )
            else:
                result = await _openai_compatible_chat(
                    client, base_url, api_key, p, messages, body.system_prompt
                )
        return result
    except httpx.HTTPStatusError as e:
        raise HTTPException(502, e.response.text or str(e))
    except Exception as e:
        raise HTTPException(502, str(e))


async def _anthropic_chat(
    client: httpx.AsyncClient,
    base_url: str,
    api_key: str,
    model: str,
    messages: list[dict],
    system_prompt: str | None,
) -> ChatResponse:
    payload: dict = {
        "model": model,
        "max_tokens": 4096,
        "messages": [m for m in messages if m["role"] != "system"],
    }
    if system_prompt:
        payload["system"] = system_prompt
    r = await client.post(
        f"{base_url}/messages",
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        },
        json=payload,
    )
    r.raise_for_status()
    data = r.json()
    text = "\n".join(
        b["text"] for b in (data.get("content") or []) if b.get("type") == "text" and b.get("text")
    ).strip()
    if not text:
        raise ValueError("Anthropic returned no text")
    u = data.get("usage")
    usage = None
    if u:
        inp = u.get("input_tokens", 0)
        out = u.get("output_tokens", 0)
        usage = ChatUsage(input_tokens=inp, output_tokens=out, total_tokens=inp + out)
    return ChatResponse(assistant_text=text, usage=usage)


async def _openai_compatible_chat(
    client: httpx.AsyncClient,
    base_url: str,
    api_key: str,
    profile: Profile,
    messages: list[dict],
    system_prompt: str | None,
) -> ChatResponse:
    combined: list[dict] = []
    if system_prompt:
        combined.append({"role": "system", "content": system_prompt})
    combined.extend(messages)
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    if profile.kind == "openrouter":
        headers["X-App-Name"] = "Loomspace"
    payload_base = {"model": profile.model, "messages": combined}

    async def send(with_temperature: bool):
        payload = {**payload_base, "temperature": 0.4} if with_temperature else payload_base
        r = await client.post(f"{base_url}/chat/completions", headers=headers, json=payload)
        return r

    r = await send(profile.kind != "openai")
    if not r.is_success and profile.kind == "openai":
        text = r.text
        if "temperature" in text.lower() and ("unsupported" in text.lower() or "default (1)" in text.lower()):
            r = await send(False)
    r.raise_for_status()
    data = r.json()
    text = (data.get("choices") or [{}])[0].get("message", {}).get("content", "").strip()
    if not text:
        raise ValueError(f"{profile.label} returned no assistant text")
    u = data.get("usage")
    usage = None
    if u:
        inp = u.get("prompt_tokens", 0)
        out = u.get("completion_tokens", 0)
        usage = ChatUsage(input_tokens=inp, output_tokens=out, total_tokens=u.get("total_tokens", inp + out))
    return ChatResponse(assistant_text=text, usage=usage)
