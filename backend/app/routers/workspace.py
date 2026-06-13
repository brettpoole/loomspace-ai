from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Workspace
from app.persistence import WORKSPACE_STORE_ROW_ID, load_reserved_json, save_reserved_json

router = APIRouter(tags=["workspace"])


@router.get("/workspaces")
async def load_workspace_store(db: AsyncSession = Depends(get_db)):
    workspace_store = await load_reserved_json(WORKSPACE_STORE_ROW_ID, db)
    if workspace_store is not None:
        return workspace_store

    result = await db.execute(select(Workspace))
    workspaces = list(result.scalars().all())
    if not workspaces:
        raise HTTPException(404, "Workspace store not found")

    return {
        "activeWorkspaceId": workspaces[0].id,
        "workspaces": [{"id": workspace.id, "state": workspace.data} for workspace in workspaces],
    }


@router.put("/workspaces")
async def save_workspace_store(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    body: Any = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(400, "Workspace store must be an object")

    await save_reserved_json(WORKSPACE_STORE_ROW_ID, body, db)

    items = body.get("workspaces")
    if isinstance(items, list):
        existing_result = await db.execute(select(Workspace))
        existing_by_id = {workspace.id: workspace for workspace in existing_result.scalars().all()}
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
                db.add(Workspace(id=workspace_id, data=state))
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
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Workspace).where(Workspace.id == workspace_id)
    )
    workspace = result.scalar_one_or_none()
    if workspace is None:
        raise HTTPException(404, "Workspace not found")
    return workspace.data


@router.put("/workspace/{workspace_id}")
async def save_workspace(
    workspace_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    body: Any = await request.json()
    result = await db.execute(
        select(Workspace).where(Workspace.id == workspace_id)
    )
    workspace = result.scalar_one_or_none()
    if workspace is None:
        workspace = Workspace(id=workspace_id, data=body)
        db.add(workspace)
    else:
        workspace.data = body
    await db.commit()
    return {"ok": True}
