from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

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
    result = await db.execute(
        select(Workspace).where(
            Workspace.id == workspace_id,
            Workspace.user_id == current_user.id,
        )
    )
    ws = result.scalar_one_or_none()
    if ws is None:
        ws = Workspace(id=workspace_id, user_id=current_user.id, data=body)
        db.add(ws)
    else:
        ws.data = body
    await db.commit()
    return {"ok": True}
