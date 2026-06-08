from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User, Workspace

SETTINGS_ROW_ID = "__loomspace_settings__"
WORKSPACE_STORE_ROW_ID = "__loomspace_workspace_store__"
RESERVED_WORKSPACE_IDS = {SETTINGS_ROW_ID, WORKSPACE_STORE_ROW_ID}


async def load_reserved_json(
    row_id: str,
    current_user: User,
    db: AsyncSession,
) -> dict[str, Any] | None:
    result = await db.execute(
        select(Workspace).where(
            Workspace.id == row_id,
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
    result = await db.execute(
        select(Workspace).where(
            Workspace.id == row_id,
            Workspace.user_id == current_user.id,
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        db.add(Workspace(id=row_id, user_id=current_user.id, data=payload))
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
