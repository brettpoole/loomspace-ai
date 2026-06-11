from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User, Workspace

SETTINGS_ROW_ID = "__loomspace_settings__"
WORKSPACE_STORE_ROW_ID = "__loomspace_workspace_store__"
WORKSPACE_STORE_UPDATED_AT_ROW_ID = "__loomspace_workspace_store_updated_at__"
SETTINGS_UPDATED_AT_ROW_ID = "__loomspace_settings_updated_at__"


def reserved_row_id(row_id: str, user_id: str) -> str:
    return f"{row_id}:{user_id}"


def reserved_workspace_ids(user_id: str) -> set[str]:
    return {
        reserved_row_id(SETTINGS_ROW_ID, user_id),
        reserved_row_id(WORKSPACE_STORE_ROW_ID, user_id),
        reserved_row_id(WORKSPACE_STORE_UPDATED_AT_ROW_ID, user_id),
        reserved_row_id(SETTINGS_UPDATED_AT_ROW_ID, user_id),
    }


async def save_updated_at(
    row_id: str,
    ts: str,
    current_user: User,
    db: AsyncSession,
) -> None:
    """Save a timestamp for conflict detection."""
    scoped = reserved_row_id(row_id, current_user.id)
    result = await db.execute(
        select(Workspace).where(
            Workspace.id == scoped,
            Workspace.user_id == current_user.id,
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        db.add(Workspace(id=scoped, user_id=current_user.id, data={"updatedAt": ts}))
        return
    row.data = {"updatedAt": ts}


async def load_updated_at(
    row_id: str,
    current_user: User,
    db: AsyncSession,
) -> str | None:
    """Load the stored timestamp (ISO 8601) for conflict detection."""
    blob = await load_reserved_json(row_id, current_user, db)
    if blob is None:
        return None
    return blob.get("updatedAt")


async def load_reserved_json(
    row_id: str,
    current_user: User,
    db: AsyncSession,
) -> dict[str, Any] | None:
    scoped_row_id = reserved_row_id(row_id, current_user.id)
    result = await db.execute(
        select(Workspace).where(
            Workspace.id == scoped_row_id,
            Workspace.user_id == current_user.id,
        )
    )
    row = result.scalar_one_or_none()
    if row is None or not isinstance(row.data, dict):
        return None
    return row.data


async def save_reserved_json(
    row_id: str,
    payload: dict[str, Any],
    current_user: User,
    db: AsyncSession,
) -> None:
    scoped_row_id = reserved_row_id(row_id, current_user.id)
    result = await db.execute(
        select(Workspace).where(
            Workspace.id == scoped_row_id,
            Workspace.user_id == current_user.id,
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        db.add(Workspace(id=scoped_row_id, user_id=current_user.id, data=payload))
        return
    row.data = payload


async def load_settings_blob(current_user: User, db: AsyncSession) -> dict[str, Any]:
    return await load_reserved_json(SETTINGS_ROW_ID, current_user, db) or {}


def params_by_profile_id(settings_blob: dict[str, Any]) -> dict[str, dict[str, Any]]:
    raw = settings_blob.get("providerParamsById")
    if not isinstance(raw, dict):
        return {}

    params: dict[str, dict[str, Any]] = {}
    for profile_id, value in raw.items():
        if isinstance(profile_id, str) and isinstance(value, dict):
            params[profile_id] = value
    return params
