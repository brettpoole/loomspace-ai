from typing import Any

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    """Base model that serializes to camelCase and accepts both snake and camel on input."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )


# ---------------------------------------------------------------------------
# Profiles and durable settings
# ---------------------------------------------------------------------------

class GenerationParams(CamelModel):
    temperature: float | None = None
    top_p: float | None = None
    top_k: int | None = None
    max_tokens: int | None = None
    frequency_penalty: float | None = None
    presence_penalty: float | None = None
    seed: int | None = None
    stop: list[str] | None = None


class ProfileOut(CamelModel):
    id: str
    kind: str
    label: str
    model: str
    base_url: str | None = None
    params: GenerationParams | None = None
    has_key: bool


class UpsertProfileRequest(CamelModel):
    id: str | None = None
    kind: str
    label: str
    model: str
    base_url: str | None = None
    params: GenerationParams | None = None
    api_key: str | None = None


class StoreKeyRequest(CamelModel):
    api_key: str


class SettingsProfile(CamelModel):
    id: str
    kind: str
    label: str
    model: str
    base_url: str | None = None
    params: GenerationParams | None = None


class SettingsSnapshot(CamelModel):
    active_provider_config_id: str
    provider_configs: list[ProfileOut]


class SaveSettingsRequest(CamelModel):
    active_provider_config_id: str
    provider_configs: list[SettingsProfile]
    last_sync_at: str | None = None  # ISO 8601 timestamp for conflict detection


# ---------------------------------------------------------------------------
# Workspace
# ---------------------------------------------------------------------------

class WorkspaceResponse(BaseModel):
    data: Any


# ---------------------------------------------------------------------------
# AI proxy
# ---------------------------------------------------------------------------

class ChatMessage(BaseModel):
    role: str
    content: Any


class ChatRequest(CamelModel):
    profile_id: str
    messages: list[ChatMessage]
    system_prompt: str | None = None


class ChatUsage(CamelModel):
    input_tokens: int
    output_tokens: int
    total_tokens: int


class ChatResponse(CamelModel):
    assistant_text: str
    usage: ChatUsage | None = None


class ModelsResponse(BaseModel):
    models: list[str]
