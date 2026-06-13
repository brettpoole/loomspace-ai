from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Workspace

SETTINGS_ROW_ID = "__loomspace_settings__"
WORKSPACE_STORE_ROW_ID = "__loomspace_workspace_store__"
WORKSPACE_STORE_UPDATED_AT_ROW_ID = "__loomspace_workspace_store_updated_at__"
SETTINGS_UPDATED_AT_ROW_ID = "__loomspace_settings_updated_at__"



async def load_reserved_json(
    row_id: str,
    db: AsyncSession,
) -> dict[str, Any] | None:
    result = await db.execute(select(Workspace).where(Workspace.id == row_id))
    row = result.scalar_one_or_none()
    if row is None or not isinstance(row.data, dict):
        return None
    return row.data


async def save_reserved_json(
    row_id: str,
    payload: dict[str, Any],
    db: AsyncSession,
) -> None:
    result = await db.execute(select(Workspace).where(Workspace.id == row_id))
    row = result.scalar_one_or_none()
    if row is None:
        db.add(Workspace(id=row_id, data=payload))
        return
    row.data = payload


async def load_settings_blob(db: AsyncSession) -> dict[str, Any]:
    return await load_reserved_json(SETTINGS_ROW_ID, db) or {}


def params_by_profile_id(settings_blob: dict[str, Any]) -> dict[str, dict[str, Any]]:
    raw = settings_blob.get("providerParamsById")
    if not isinstance(raw, dict):
        return {}

    params: dict[str, dict[str, Any]] = {}
    for profile_id, value in raw.items():
        if isinstance(profile_id, str) and isinstance(value, dict):
            params[profile_id] = value
    return params
