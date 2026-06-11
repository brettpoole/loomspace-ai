import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Profile
from app.persistence import SETTINGS_ROW_ID, load_settings_blob, params_by_profile_id, save_reserved_json
from app.schemas import (
    GenerationParams,
    ProfileOut,
    SaveSettingsRequest,
    SettingsSnapshot,
    StoreKeyRequest,
    UpsertProfileRequest,
)
from app.security import encrypt_api_key

router = APIRouter(tags=["profiles"])


def _params_payload(params: GenerationParams | None) -> dict[str, Any] | None:
    if params is None:
        return None
    payload = params.model_dump(mode="json", by_alias=True, exclude_none=True)
    return payload or None


def _to_out(profile: Profile, params_map: dict[str, dict[str, Any]]) -> ProfileOut:
    params_payload = params_map.get(profile.id)
    return ProfileOut(
        id=profile.id,
        kind=profile.kind,
        label=profile.label,
        model=profile.model,
        base_url=profile.base_url,
        params=GenerationParams.model_validate(params_payload) if params_payload else None,
        has_key=profile.encrypted_api_key is not None,
    )


async def _list_profiles(db: AsyncSession) -> list[Profile]:
    result = await db.execute(select(Profile))
    return list(result.scalars().all())


async def _profile_params_map(db: AsyncSession) -> dict[str, dict[str, Any]]:
    return params_by_profile_id(await load_settings_blob(db))


@router.get("/profiles", response_model=list[ProfileOut])
async def list_profiles(db: AsyncSession = Depends(get_db)):
    profiles = await _list_profiles(db)
    params_map = await _profile_params_map(db)
    return [_to_out(profile, params_map) for profile in profiles]


@router.get("/profiles/{profile_id}", response_model=ProfileOut)
async def get_profile(
    profile_id: str,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Profile).where(Profile.id == profile_id))
    profile = result.scalar_one_or_none()
    if profile is None:
        raise HTTPException(404, "Profile not found")
    params_map = await _profile_params_map(db)
    return _to_out(profile, params_map)


async def _upsert(
    body: UpsertProfileRequest,
    db: AsyncSession,
    profile_id: str | None = None,
) -> Profile:
    target_id = profile_id or body.id
    if target_id:
        result = await db.execute(select(Profile).where(Profile.id == target_id))
        profile = result.scalar_one_or_none()
        if profile is None:
            profile = Profile(id=target_id)
            db.add(profile)
    else:
        profile = Profile(id=str(uuid.uuid4()))
        db.add(profile)

    profile.kind = body.kind
    profile.label = body.label
    profile.model = body.model
    profile.base_url = body.base_url
    if body.api_key:
        profile.encrypted_api_key = encrypt_api_key(body.api_key)

    settings_blob = await load_settings_blob(db)
    params_map = params_by_profile_id(settings_blob)
    params_payload = _params_payload(body.params)
    if params_payload:
        params_map[profile.id] = params_payload
    elif profile.id in params_map:
        del params_map[profile.id]
    settings_blob["providerParamsById"] = params_map
    if not settings_blob.get("activeProviderConfigId"):
        settings_blob["activeProviderConfigId"] = profile.id
    await save_reserved_json(SETTINGS_ROW_ID, settings_blob, db)

    await db.commit()
    await db.refresh(profile)
    return profile


@router.post("/profiles", response_model=ProfileOut, status_code=201)
async def create_profile(
    body: UpsertProfileRequest,
    db: AsyncSession = Depends(get_db),
):
    profile = await _upsert(body, db)
    params_map = await _profile_params_map(db)
    return _to_out(profile, params_map)


@router.put("/profiles/{profile_id}", response_model=ProfileOut)
async def update_profile(
    profile_id: str,
    body: UpsertProfileRequest,
    db: AsyncSession = Depends(get_db),
):
    profile = await _upsert(body, db, profile_id=profile_id)
    params_map = await _profile_params_map(db)
    return _to_out(profile, params_map)


@router.put("/settings", response_model=SettingsSnapshot)
async def save_settings(
    body: SaveSettingsRequest,
    db: AsyncSession = Depends(get_db),
):
    existing_profiles = {profile.id: profile for profile in await _list_profiles(db)}
    incoming_ids = [profile.id for profile in body.provider_configs]

    for payload in body.provider_configs:
        profile = existing_profiles.get(payload.id)
        if profile is None:
            profile = Profile(id=payload.id)
            db.add(profile)
        profile.kind = payload.kind
        profile.label = payload.label
        profile.model = payload.model
        profile.base_url = payload.base_url

    incoming_id_set = set(incoming_ids)
    for profile in existing_profiles.values():
        if profile.id not in incoming_id_set:
            await db.delete(profile)

    provider_params_by_id = {
        profile.id: params_payload
        for profile in body.provider_configs
        if (params_payload := _params_payload(profile.params)) is not None
    }
    active_provider_config_id = (
        body.active_provider_config_id
        if body.active_provider_config_id in incoming_id_set
        else incoming_ids[0] if incoming_ids else ""
    )
    await save_reserved_json(
        SETTINGS_ROW_ID,
        {
            "activeProviderConfigId": active_provider_config_id,
            "providerParamsById": provider_params_by_id,
        },
        db,
    )

    await db.commit()

    refreshed_profiles = await _list_profiles(db)
    refreshed_map = {profile.id: profile for profile in refreshed_profiles}
    return SettingsSnapshot(
        active_provider_config_id=active_provider_config_id,
        provider_configs=[
            _to_out(refreshed_map[profile_id], provider_params_by_id)
            for profile_id in incoming_ids
            if profile_id in refreshed_map
        ],
    )


@router.get("/settings", response_model=SettingsSnapshot)
async def load_settings(
    db: AsyncSession = Depends(get_db),
):
    profiles = await _list_profiles(db)
    settings_blob = await load_settings_blob(db)
    if not profiles and not settings_blob:
        raise HTTPException(404, "Settings not found")

    params_map = params_by_profile_id(settings_blob)
    active_provider_config_id = settings_blob.get("activeProviderConfigId")
    profile_ids = {profile.id for profile in profiles}
    if active_provider_config_id not in profile_ids:
        active_provider_config_id = profiles[0].id if profiles else ""

    return SettingsSnapshot(
        active_provider_config_id=active_provider_config_id,
        provider_configs=[_to_out(profile, params_map) for profile in profiles],
    )


@router.delete("/profiles/{profile_id}")
async def delete_profile(
    profile_id: str,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Profile).where(Profile.id == profile_id))
    profile = result.scalar_one_or_none()
    if profile is None:
        raise HTTPException(404, "Profile not found")

    await db.delete(profile)

    settings_blob = await load_settings_blob(db)
    params_map = params_by_profile_id(settings_blob)
    if profile_id in params_map:
        del params_map[profile_id]
    settings_blob["providerParamsById"] = params_map
    if settings_blob.get("activeProviderConfigId") == profile_id:
        remaining_profiles = [item for item in await _list_profiles(db) if item.id != profile_id]
        settings_blob["activeProviderConfigId"] = remaining_profiles[0].id if remaining_profiles else ""
    await save_reserved_json(SETTINGS_ROW_ID, settings_blob, db)

    await db.commit()
    return {"ok": True}


@router.post("/profiles/{profile_id}/key")
async def store_key(
    profile_id: str,
    body: StoreKeyRequest,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Profile).where(Profile.id == profile_id))
    profile = result.scalar_one_or_none()
    if profile is None:
        raise HTTPException(404, "Profile not found")
    profile.encrypted_api_key = encrypt_api_key(body.api_key)
    await db.commit()
    return {"ok": True}


@router.delete("/profiles/{profile_id}/key")
async def clear_key(
    profile_id: str,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Profile).where(Profile.id == profile_id))
    profile = result.scalar_one_or_none()
    if profile is None:
        raise HTTPException(404, "Profile not found")
    profile.encrypted_api_key = None
    await db.commit()
    return {"ok": True}
