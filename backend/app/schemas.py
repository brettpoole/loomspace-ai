from typing import Any
from datetime import datetime
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    """Base model that serializes to camelCase and accepts both snake and camel on input."""
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,  # also accept snake_case on input
        from_attributes=True,
    )


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

class RegisterRequest(BaseModel):
    username: str
    password: str


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(CamelModel):
    id: str
    username: str
    created_at: datetime


# ---------------------------------------------------------------------------
# Profiles
# ---------------------------------------------------------------------------

class ProfileOut(CamelModel):
    id: str
    kind: str
    label: str
    model: str
    base_url: str | None = None
    has_key: bool


class UpsertProfileRequest(CamelModel):
    id: str | None = None
    kind: str
    label: str
    model: str
    base_url: str | None = None
    api_key: str | None = None


class StoreKeyRequest(CamelModel):
    api_key: str


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
