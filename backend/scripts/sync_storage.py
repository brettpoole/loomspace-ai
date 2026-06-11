from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from dataclasses import dataclass
from hashlib import pbkdf2_hmac
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


load_env_file(ROOT.parent / ".env")

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import delete, select

from app.database import AsyncSessionLocal
from app.models import Profile, Workspace
from app.persistence import SETTINGS_ROW_ID, WORKSPACE_STORE_ROW_ID, load_settings_blob, params_by_profile_id, save_reserved_json
from app.security import decrypt_api_key, encrypt_api_key


@dataclass
class NodeProfile:
    id: str
    kind: str
    label: str
    model: str
    base_url: str | None
    params: dict[str, Any] | None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Manually sync durable data between server/ file storage and the FastAPI/Postgres backend.",
    )
    parser.add_argument(
        "--server-data-dir",
        default=str((ROOT.parent / "server" / "data").resolve()),
        help="Path to the Node backend data directory. Default: ../server/data",
    )

    subparsers = parser.add_subparsers(dest="command", required=True)

    to_fastapi = subparsers.add_parser(
        "node-to-fastapi",
        help="Replace the FastAPI backend data with the contents of server/data.",
    )
    to_fastapi.add_argument(
        "--node-data-secret",
        default=os.environ.get("DATA_SECRET"),
        help="DATA_SECRET used to decrypt Node backend key files. Defaults to current DATA_SECRET env var.",
    )

    to_node = subparsers.add_parser(
        "fastapi-to-node",
        help="Export the FastAPI backend data into server/data, overwriting the Node backend files.",
    )
    to_node.add_argument(
        "--node-data-secret",
        default=os.environ.get("DATA_SECRET"),
        help="DATA_SECRET used to encrypt Node backend key files. Defaults to current DATA_SECRET env var.",
    )

    return parser.parse_args()


def read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text())


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")


def derive_node_key(secret: str, salt: bytes) -> bytes:
    return pbkdf2_hmac("sha256", secret.encode(), salt, 100_000, 32)


def decrypt_node_key(payload: dict[str, str], secret: str) -> str:
    salt = bytes.fromhex(payload["salt"])
    iv = bytes.fromhex(payload["iv"])
    tag = bytes.fromhex(payload["tag"])
    ciphertext = bytes.fromhex(payload["ciphertext"])
    aesgcm = AESGCM(derive_node_key(secret, salt))
    return aesgcm.decrypt(iv, ciphertext + tag, None).decode()


def encrypt_node_key(plaintext: str, secret: str) -> dict[str, str]:
    salt = os.urandom(16)
    iv = os.urandom(12)
    aesgcm = AESGCM(derive_node_key(secret, salt))
    encrypted = aesgcm.encrypt(iv, plaintext.encode(), None)
    ciphertext, tag = encrypted[:-16], encrypted[-16:]
    return {
        "salt": salt.hex(),
        "iv": iv.hex(),
        "tag": tag.hex(),
        "ciphertext": ciphertext.hex(),
    }


def load_node_profiles(data_dir: Path) -> list[NodeProfile]:
    raw_profiles = read_json(data_dir / "profiles.json", [])
    profiles: list[NodeProfile] = []
    for item in raw_profiles:
        if not isinstance(item, dict):
            continue
        profile_id = item.get("id")
        kind = item.get("kind")
        label = item.get("label")
        model = item.get("model")
        if not all(isinstance(value, str) for value in (profile_id, kind, label, model)):
            continue
        base_url = item.get("baseUrl") if isinstance(item.get("baseUrl"), str) else None
        params = item.get("params") if isinstance(item.get("params"), dict) else None
        profiles.append(
            NodeProfile(
                id=profile_id,
                kind=kind,
                label=label,
                model=model,
                base_url=base_url,
                params=params,
            )
        )
    return profiles


def load_node_workspace_store(data_dir: Path) -> dict[str, Any]:
    aggregate = data_dir / "workspace-store.json"
    if aggregate.exists():
        payload = read_json(aggregate, None)
        if isinstance(payload, dict):
            return payload

    workspaces_dir = data_dir / "workspaces"
    workspaces: list[dict[str, Any]] = []
    if workspaces_dir.exists():
        for path in sorted(workspaces_dir.glob("*.json")):
            state = read_json(path, None)
            if state is None:
                continue
            workspaces.append({"id": path.stem, "state": state})

    active_workspace_id = workspaces[0]["id"] if workspaces else ""
    return {
        "activeWorkspaceId": active_workspace_id,
        "workspaces": workspaces,
    }


def load_node_active_provider_id(data_dir: Path, profiles: list[NodeProfile]) -> str:
    settings = read_json(data_dir / "settings.json", {})
    active = settings.get("activeProviderConfigId") if isinstance(settings, dict) else None
    if isinstance(active, str) and active:
        return active
    return profiles[0].id if profiles else ""


async def sync_node_to_fastapi(args: argparse.Namespace) -> None:
    if not args.node_data_secret:
        raise SystemExit("node-to-fastapi requires --node-data-secret or DATA_SECRET in the environment.")

    data_dir = Path(args.server_data_dir).resolve()
    profiles = load_node_profiles(data_dir)
    workspace_store = load_node_workspace_store(data_dir)
    active_provider_id = load_node_active_provider_id(data_dir, profiles)
    keys_dir = data_dir / "keys"

    async with AsyncSessionLocal() as session:
        # Clear existing data
        await session.execute(delete(Profile))
        for reserved_id in (SETTINGS_ROW_ID, WORKSPACE_STORE_ROW_ID):
            result = await session.execute(select(Workspace).where(Workspace.id == reserved_id))
            row = result.scalar_one_or_none()
            if row:
                await session.delete(row)
        await session.commit()

        provider_params_by_id: dict[str, dict[str, Any]] = {}
        imported_keys = 0
        for profile in profiles:
            encrypted_api_key = None
            key_file = keys_dir / f"{profile.id}.json"
            if key_file.exists():
                plaintext = decrypt_node_key(read_json(key_file, {}), args.node_data_secret)
                encrypted_api_key = encrypt_api_key(plaintext)
                imported_keys += 1

            if profile.params:
                provider_params_by_id[profile.id] = profile.params

            session.add(
                Profile(
                    id=profile.id,
                    kind=profile.kind,
                    label=profile.label,
                    model=profile.model,
                    base_url=profile.base_url,
                    encrypted_api_key=encrypted_api_key,
                )
            )

        settings_blob = {
            "activeProviderConfigId": active_provider_id,
            "providerParamsById": provider_params_by_id,
        }
        await save_reserved_json(SETTINGS_ROW_ID, settings_blob, session)
        await save_reserved_json(WORKSPACE_STORE_ROW_ID, workspace_store, session)

        workspace_count = 0
        for item in workspace_store.get("workspaces", []):
            if not isinstance(item, dict):
                continue
            workspace_id = item.get("id")
            state = item.get("state")
            if not isinstance(workspace_id, str) or state is None:
                continue
            session.add(Workspace(id=workspace_id, data=state))
            workspace_count += 1

        await session.commit()

    print(f'Imported {len(profiles)} profiles, {imported_keys} saved keys, and {workspace_count} workspaces into FastAPI backend.')


async def sync_fastapi_to_node(args: argparse.Namespace) -> None:
    if not args.node_data_secret:
        raise SystemExit("fastapi-to-node requires --node-data-secret or DATA_SECRET in the environment.")

    data_dir = Path(args.server_data_dir).resolve()
    keys_dir = data_dir / "keys"
    workspaces_dir = data_dir / "workspaces"

    async with AsyncSessionLocal() as session:
        profiles_result = await session.execute(select(Profile))
        profiles = list(profiles_result.scalars().all())

        settings_blob = await load_settings_blob(session)
        provider_params_by_id = params_by_profile_id(settings_blob)

        result = await session.execute(select(Workspace).where(Workspace.id == WORKSPACE_STORE_ROW_ID))
        workspace_store_row = result.scalar_one_or_none()

        if workspace_store_row and isinstance(workspace_store_row.data, dict):
            workspace_store = workspace_store_row.data
        else:
            all_workspaces_result = await session.execute(select(Workspace))
            all_workspaces = list(all_workspaces_result.scalars().all())
            workspace_store = {
                "activeWorkspaceId": all_workspaces[0].id if all_workspaces else "",
                "workspaces": [{"id": row.id, "state": row.data} for row in all_workspaces],
            }

    node_profiles: list[dict[str, Any]] = []
    saved_key_ids: set[str] = set()
    for profile in profiles:
        payload: dict[str, Any] = {
            "id": profile.id,
            "kind": profile.kind,
            "label": profile.label,
            "model": profile.model,
        }
        if profile.base_url:
            payload["baseUrl"] = profile.base_url
        params = provider_params_by_id.get(profile.id)
        if isinstance(params, dict) and params:
            payload["params"] = params
        node_profiles.append(payload)

        if profile.encrypted_api_key:
            keys_dir.mkdir(parents=True, exist_ok=True)
            plaintext = decrypt_api_key(profile.encrypted_api_key)
            write_json(keys_dir / f"{profile.id}.json", encrypt_node_key(plaintext, args.node_data_secret))
            saved_key_ids.add(profile.id)

    write_json(data_dir / "profiles.json", node_profiles)
    active_provider_id = settings_blob.get("activeProviderConfigId") if isinstance(settings_blob.get("activeProviderConfigId"), str) else ""
    write_json(data_dir / "settings.json", {"activeProviderConfigId": active_provider_id or (profiles[0].id if profiles else "")})
    write_json(data_dir / "workspace-store.json", workspace_store)

    workspaces_dir.mkdir(parents=True, exist_ok=True)
    valid_workspace_ids: set[str] = set()
    for item in workspace_store.get("workspaces", []):
        if not isinstance(item, dict):
            continue
        workspace_id = item.get("id")
        state = item.get("state")
        if not isinstance(workspace_id, str) or state is None:
            continue
        valid_workspace_ids.add(workspace_id)
        write_json(workspaces_dir / f"{workspace_id}.json", state)

    if keys_dir.exists():
        for path in keys_dir.glob("*.json"):
            if path.stem not in saved_key_ids:
                path.unlink()

    if workspaces_dir.exists():
        for path in workspaces_dir.glob("*.json"):
            if path.stem not in valid_workspace_ids:
                path.unlink()

    print(f'Exported {len(profiles)} profiles and {len(valid_workspace_ids)} workspaces from FastAPI backend into {data_dir}.')


async def main() -> None:
    args = parse_args()
    if args.command == "node-to-fastapi":
        await sync_node_to_fastapi(args)
        return
    if args.command == "fastapi-to-node":
        await sync_fastapi_to_node(args)
        return
    raise SystemExit(f"Unknown command: {args.command}")


if __name__ == "__main__":
    asyncio.run(main())
