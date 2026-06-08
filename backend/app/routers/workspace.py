from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User, Workspace
from app.persistence import RESERVED_WORKSPACE_IDS, WORKSPACE_STORE_ROW_ID, load_reserved_json, save_reserved_json
from app.routers.auth import get_current_user

router = APIRouter(tags=["workspace"])


async def _list_user_workspaces(current_user: User, db: AsyncSession) -> list[Workspace]:
    result = await db.execute(
        select(Workspace).where(
            Workspace.user_id == current_user.id,
            Workspace.id.not_in(RESERVED_WORKSPACE_IDS),
        )
    )
    return list(result.scalars().all())


@router.get("/workspaces")
async def load_workspace_store(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    workspace_store = await load_reserved_json(WORKSPACE_STORE_ROW_ID, current_user, db)
    if workspace_store is not None:
        return workspace_store

    workspaces = await _list_user_workspaces(current_user, db)
    if not workspaces:
        raise HTTPException(404, "Workspace store not found")

    return {
        "activeWorkspaceId": workspaces[0].id,
        "workspaces": [{"id": workspace.id, "state": workspace.data} for workspace in workspaces],
    }


@router.put("/workspaces")
async def save_workspace_store(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    body: Any = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(400, "Workspace store must be an object")

    await save_reserved_json(WORKSPACE_STORE_ROW_ID, body, current_user, db)

    items = body.get("workspaces")
    if isinstance(items, list):
        existing_by_id = {workspace.id: workspace for workspace in await _list_user_workspaces(current_user, db)}
        incoming_ids: set[str] = set()

        for item in items:
            if not isinstance(item, dict):
                continue
            workspace_id = item.get("id")
            state = item.get("state")
            if not isinstance(workspace_id, str) or state is None:
                continue
            incoming_ids.add(workspace_id)
            workspace = existing_by_id.get(workspace_id)
            if workspace is None:
                db.add(Workspace(id=workspace_id, user_id=current_user.id, data=state))
                continue
            workspace.data = state

        for workspace in existing_by_id.values():
            if workspace.id not in incoming_ids:
                await db.delete(workspace)

    await db.commit()
    return {"ok": True}


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
    workspace = result.scalar_one_or_none()
    if workspace is None:
        raise HTTPException(404, "Workspace not found")
    return workspace.data


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
    workspace = result.scalar_one_or_none()
    if workspace is None:
        workspace = Workspace(id=workspace_id, user_id=current_user.id, data=body)
        db.add(workspace)
    else:
        workspace.data = body
    await db.commit()
    return {"ok": True}
