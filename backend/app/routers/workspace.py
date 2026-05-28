from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.database import get_db
from app.models import Workspace, User
from app.routers.auth import get_current_user

router = APIRouter(tags=["workspace"])


@router.get("/workspace/{workspace_id}")
async def load_workspace(
    workspace_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Workspace).where(
            Workspace.id == workspace_id,
            Workspace.user_id == current_user.id,
        )
    )
    ws = result.scalar_one_or_none()
    if ws is None:
        raise HTTPException(404, "Workspace not found")
    return ws.data


@router.put("/workspace/{workspace_id}")
async def save_workspace(
    workspace_id: str,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    body: Any = await request.json()
    now = datetime.now(timezone.utc)

    stmt = (
        insert(Workspace)
        .values(
            id=workspace_id,
            user_id=current_user.id,
            data=body,
            updated_at=now,
        )
        .on_conflict_do_update(
            index_elements=["id"],
            where=Workspace.user_id == current_user.id,
            set_={"data": body, "updated_at": now},
        )
    )
    await db.execute(stmt)
    await db.commit()
    return {"ok": True}
