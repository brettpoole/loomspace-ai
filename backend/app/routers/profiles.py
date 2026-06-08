from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models import Profile, User
from app.schemas import ProfileOut, UpsertProfileRequest, StoreKeyRequest
from app.security import encrypt_api_key, decrypt_api_key
from app.routers.auth import get_current_user
import uuid

router = APIRouter(tags=["profiles"])


def _to_out(p: Profile) -> ProfileOut:
    return ProfileOut(
        id=p.id,
        kind=p.kind,
        label=p.label,
        model=p.model,
        base_url=p.base_url,
        has_key=p.encrypted_api_key is not None,
    )


@router.get("/profiles", response_model=list[ProfileOut])
async def list_profiles(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Profile).where(Profile.user_id == current_user.id))
    return [_to_out(p) for p in result.scalars().all()]


@router.get("/profiles/{profile_id}", response_model=ProfileOut)
async def get_profile(
    profile_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Profile).where(Profile.id == profile_id, Profile.user_id == current_user.id)
    )
    p = result.scalar_one_or_none()
    if p is None:
        raise HTTPException(404, "Profile not found")
    return _to_out(p)


async def _upsert(
    body: UpsertProfileRequest,
    current_user: User,
    db: AsyncSession,
    profile_id: str | None = None,
) -> tuple[Profile, bool]:
    """Return (profile, created). profile_id from path takes priority."""
    target_id = profile_id or body.id
    created = False
    if target_id:
        result = await db.execute(
            select(Profile).where(Profile.id == target_id, Profile.user_id == current_user.id)
        )
        p = result.scalar_one_or_none()
        if p is None:
            p = Profile(id=target_id, user_id=current_user.id)
            db.add(p)
            created = True
    else:
        p = Profile(id=str(uuid.uuid4()), user_id=current_user.id)
        db.add(p)
        created = True
    p.kind = body.kind
    p.label = body.label
    p.model = body.model
    p.base_url = body.base_url
    if body.api_key:
        p.encrypted_api_key = encrypt_api_key(body.api_key)
    await db.commit()
    await db.refresh(p)
    return p, created


@router.post("/profiles", response_model=ProfileOut, status_code=201)
async def create_profile(
    body: UpsertProfileRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    p, _ = await _upsert(body, current_user, db)
    return _to_out(p)


@router.put("/profiles/{profile_id}", response_model=ProfileOut)
async def update_profile(
    profile_id: str,
    body: UpsertProfileRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    p, _ = await _upsert(body, current_user, db, profile_id=profile_id)
    return _to_out(p)


@router.delete("/profiles/{profile_id}")
async def delete_profile(
    profile_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Profile).where(Profile.id == profile_id, Profile.user_id == current_user.id)
    )
    p = result.scalar_one_or_none()
    if p is None:
        raise HTTPException(404, "Profile not found")
    await db.delete(p)
    await db.commit()
    return {"ok": True}


@router.post("/profiles/{profile_id}/key")
async def store_key(
    profile_id: str,
    body: StoreKeyRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Profile).where(Profile.id == profile_id, Profile.user_id == current_user.id)
    )
    p = result.scalar_one_or_none()
    if p is None:
        raise HTTPException(404, "Profile not found")
    p.encrypted_api_key = encrypt_api_key(body.api_key)
    await db.commit()
    return {"ok": True}


@router.delete("/profiles/{profile_id}/key")
async def clear_key(
    profile_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Profile).where(Profile.id == profile_id, Profile.user_id == current_user.id)
    )
    p = result.scalar_one_or_none()
    if p is None:
        raise HTTPException(404, "Profile not found")
    p.encrypted_api_key = None
    await db.commit()
    return {"ok": True}
