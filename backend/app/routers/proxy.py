import base64

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Profile
from app.persistence import load_settings_blob, params_by_profile_id

from app.schemas import (
    ChatMessage,
    ChatRequest,
    ChatResponse,
    ChatUsage,
    MessageAttachment,
    ModelsResponse,
)
from app.security import decrypt_api_key

router = APIRouter(tags=["proxy"])


def _resolve_base_url(base_url: str | None, kind: str) -> str:
    if kind == "anthropic":
        return (base_url or "").rstrip("/") or "https://api.anthropic.com/v1"
    if kind == "openrouter":
        return (base_url or "").rstrip("/") or "https://openrouter.ai/api/v1"
    if kind == "openai":
        return (base_url or "").rstrip("/") or "https://api.openai.com/v1"
    trimmed = (base_url or "").strip()
    if not trimmed:
        raise ValueError("baseUrl is required for custom OpenAI-compatible providers")
    return trimmed.rstrip("/")


async def _get_profile_with_key(
    profile_id: str,
    db: AsyncSession,
) -> tuple[Profile, str | None]:
    result = await db.execute(select(Profile).where(Profile.id == profile_id))
    profile = result.scalar_one_or_none()
    if profile is None:
        raise HTTPException(404, f"Profile {profile_id} not found")
    key: str | None = None
    if profile.encrypted_api_key is not None:
        key = decrypt_api_key(profile.encrypted_api_key)
    return profile, key


def _generation_params_for_profile(settings_blob: dict, profile_id: str) -> dict:
    return params_by_profile_id(settings_blob).get(profile_id, {})


def _effective_chat_settings(profile: Profile, profile_params: dict, body: ChatRequest) -> tuple[str, dict]:
    if body.thread_model_settings is None:
        return profile.model, profile_params
    merged_params = dict(profile_params)
    thread_params = body.thread_model_settings.params
    if thread_params is not None:
        merged_params.update(thread_params.model_dump(mode="json", by_alias=True, exclude_none=True))
    model = body.thread_model_settings.model.strip() or profile.model
    return model, merged_params


def _decode_base64_text(data: str) -> str:
    try:
        return base64.b64decode(data).decode("utf-8", errors="replace")
    except Exception:
        return ""


def _attachment_to_openai_part(attachment: MessageAttachment) -> dict:
    if attachment.type == "image":
        return {
            "type": "image_url",
            "image_url": {"url": f"data:{attachment.mime_type};base64,{attachment.data}"},
        }
    if attachment.mime_type == "application/pdf":
        return {
            "type": "file",
            "file": {
                "filename": attachment.filename,
                "file_data": f"data:application/pdf;base64,{attachment.data}",
            },
        }
    return {
        "type": "text",
        "text": f'Attached file "{attachment.filename}":\n\n{_decode_base64_text(attachment.data)}',
    }


def _attachment_to_anthropic_part(attachment: MessageAttachment) -> dict:
    if attachment.type == "image":
        return {
            "type": "image",
            "source": {"type": "base64", "media_type": attachment.mime_type, "data": attachment.data},
        }
    if attachment.mime_type == "application/pdf":
        return {
            "type": "document",
            "source": {"type": "base64", "media_type": "application/pdf", "data": attachment.data},
        }
    return {
        "type": "text",
        "text": f'Attached file "{attachment.filename}":\n\n{_decode_base64_text(attachment.data)}',
    }


def _format_messages_for_openai(messages: list[ChatMessage]) -> list[dict]:
    formatted: list[dict] = []
    for message in messages:
        attachments = message.attachments or []
        if not attachments:
            formatted.append({"role": message.role, "content": message.text or ""})
            continue
        parts: list[dict] = []
        if message.text:
            parts.append({"type": "text", "text": message.text})
        parts.extend(_attachment_to_openai_part(att) for att in attachments)
        formatted.append({"role": message.role, "content": parts})
    return formatted


def _format_messages_for_anthropic(messages: list[ChatMessage]) -> list[dict]:
    formatted: list[dict] = []
    for message in messages:
        if message.role == "system":
            continue
        role = "assistant" if message.role == "assistant" else "user"
        attachments = message.attachments or []
        if not attachments:
            formatted.append({"role": role, "content": message.text or ""})
            continue
        parts: list[dict] = []
        if message.text:
            parts.append({"type": "text", "text": message.text})
        parts.extend(_attachment_to_anthropic_part(att) for att in attachments)
        formatted.append({"role": role, "content": parts})
    return formatted


def _openai_generation_body(profile: Profile, params: dict) -> dict:
    body: dict = {}
    temperature = params.get("temperature")
    if temperature is None and profile.kind != "openai":
        temperature = 0.4
    if temperature is not None:
        body["temperature"] = temperature
    if params.get("topP") is not None:
        body["top_p"] = params["topP"]
    if params.get("maxTokens") is not None:
        body["max_tokens"] = params["maxTokens"]
    if params.get("frequencyPenalty") is not None:
        body["frequency_penalty"] = params["frequencyPenalty"]
    if params.get("presencePenalty") is not None:
        body["presence_penalty"] = params["presencePenalty"]
    if params.get("seed") is not None:
        body["seed"] = params["seed"]
    if isinstance(params.get("stop"), list) and params["stop"]:
        body["stop"] = params["stop"]
    if profile.kind != "openai" and params.get("topK") is not None:
        body["top_k"] = params["topK"]
    return body


@router.get("/ai/models/{profile_id}", response_model=ModelsResponse)
async def fetch_models(
    profile_id: str,
    db: AsyncSession = Depends(get_db),
):
    profile, api_key = await _get_profile_with_key(profile_id, db)
    base_url = _resolve_base_url(profile.base_url, profile.kind)
    if api_key is None:
        if profile.kind in ("anthropic", "openrouter"):
            raise HTTPException(400, f"No API key stored for profile {profile_id}")
        # openai-compatible-custom (e.g. local llama-cpp) may not need a key
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            if profile.kind == "anthropic":
                response = await client.get(
                    f"{base_url}/models",
                    headers={"x-api-key": api_key, "anthropic-version": "2023-06-01"},
                )
                response.raise_for_status()
                data = response.json()
                models = sorted(
                    entry["id"] for entry in (data.get("data") or []) if entry.get("id")
                )
            else:
                headers: dict = {}
                if api_key:
                    headers["Authorization"] = f"Bearer {api_key}"
                response = await client.get(f"{base_url}/models", headers=headers)
                response.raise_for_status()
                data = response.json()
                if profile.kind == "openrouter":
                    models = sorted(
                        entry["id"]
                        for entry in (data.get("data") or [])
                        if entry.get("id")
                        and (
                            str(entry["id"]).endswith(":free")
                            or (
                                float(entry.get("pricing", {}).get("prompt", "1") or "1") == 0
                                and float(entry.get("pricing", {}).get("completion", "1") or "1") == 0
                            )
                        )
                    )
                else:
                    models = sorted(entry["id"] for entry in (data.get("data") or []) if entry.get("id"))
        return ModelsResponse(models=models)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(502, str(exc))
    except Exception as exc:
        raise HTTPException(502, str(exc))


@router.post("/ai/chat", response_model=ChatResponse)
async def chat(
    body: ChatRequest,
    db: AsyncSession = Depends(get_db),
):
    profile, api_key = await _get_profile_with_key(body.profile_id, db)
    base_url = _resolve_base_url(profile.base_url, profile.kind)
    if api_key is None:
        if profile.kind in ("anthropic", "openrouter"):
            raise HTTPException(400, f"No API key stored for profile {body.profile_id}")
    params = _generation_params_for_profile(await load_settings_blob(db), profile.id)
    model, params = _effective_chat_settings(profile, params, body)
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            if profile.kind == "anthropic":
                result = await _anthropic_chat(
                    client,
                    base_url,
                    api_key,
                    model,
                    _format_messages_for_anthropic(body.messages),
                    body.system_prompt,
                    params,
                )
            else:
                result = await _openai_compatible_chat(
                    client,
                    base_url,
                    api_key,
                    profile,
                    model,
                    _format_messages_for_openai(body.messages),
                    body.system_prompt,
                    params,
                )
        return result
    except httpx.HTTPStatusError as exc:
        raise HTTPException(502, exc.response.text or str(exc))
    except Exception as exc:
        raise HTTPException(502, str(exc))


async def _anthropic_chat(
    client: httpx.AsyncClient,
    base_url: str,
    api_key: str | None,
    model: str,
    messages: list[dict],
    system_prompt: str | None,
    params: dict,
) -> ChatResponse:
    payload: dict = {
        "model": model,
        "max_tokens": params.get("maxTokens") or 4096,
        "messages": messages,
    }
    if system_prompt:
        payload["system"] = system_prompt
    if params.get("temperature") is not None:
        payload["temperature"] = params["temperature"]
    if params.get("topP") is not None:
        payload["top_p"] = params["topP"]
    if params.get("topK") is not None:
        payload["top_k"] = params["topK"]
    if isinstance(params.get("stop"), list) and params["stop"]:
        payload["stop_sequences"] = params["stop"]

    response = await client.post(
        f"{base_url}/messages",
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        },
        json=payload,
    )
    response.raise_for_status()
    data = response.json()
    text = "\n".join(
        block["text"]
        for block in (data.get("content") or [])
        if block.get("type") == "text" and block.get("text")
    ).strip()
    if not text:
        raise ValueError("Anthropic returned no text")
    usage_data = data.get("usage")
    usage = None
    if usage_data:
        input_tokens = usage_data.get("input_tokens", 0)
        output_tokens = usage_data.get("output_tokens", 0)
        usage = ChatUsage(
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_tokens=input_tokens + output_tokens,
        )
    return ChatResponse(assistant_text=text, usage=usage)


async def _openai_compatible_chat(
    client: httpx.AsyncClient,
    base_url: str,
    api_key: str | None,
    profile: Profile,
    model: str,
    messages: list[dict],
    system_prompt: str | None,
    params: dict,
) -> ChatResponse:
    combined: list[dict] = []
    if system_prompt:
        combined.append({"role": "system", "content": system_prompt})
    combined.extend(messages)

    headers: dict = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    if profile.kind == "openrouter":
        headers["X-App-Name"] = "Loomspace"

    payload_base = {
        "model": model,
        "messages": combined,
        **_openai_generation_body(profile, params),
    }

    async def send(include_temperature: bool):
        payload = dict(payload_base)
        if not include_temperature and "temperature" in payload:
            del payload["temperature"]
        return await client.post(f"{base_url}/chat/completions", headers=headers, json=payload)

    response = await send(True)
    if not response.is_success and profile.kind == "openai":
        text = response.text.lower()
        if "temperature" in text and ("unsupported" in text or "default (1)" in text):
            response = await send(False)
    response.raise_for_status()

    data = response.json()
    text = (data.get("choices") or [{}])[0].get("message", {}).get("content", "").strip()
    if not text:
        raise ValueError(f"{profile.label} returned no assistant text")
    usage_data = data.get("usage")
    usage = None
    if usage_data:
        input_tokens = usage_data.get("prompt_tokens", 0)
        output_tokens = usage_data.get("completion_tokens", 0)
        usage = ChatUsage(
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_tokens=usage_data.get("total_tokens", input_tokens + output_tokens),
        )
    return ChatResponse(assistant_text=text, usage=usage)
