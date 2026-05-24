from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone

from cryptography.fernet import Fernet


class SecretManager:
    def __init__(self, sqlite_path: str, encryption_key: str):
        if not encryption_key.strip():
            raise ValueError("LOOMSPACE_SECRET_MANAGER_KEY is required")

        self.sqlite_path = sqlite_path
        self.fernet = Fernet(encryption_key.encode("utf-8"))
        self._init_db()

    @contextmanager
    def _conn(self):
        conn = sqlite3.connect(self.sqlite_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def _init_db(self) -> None:
        with self._conn() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS provider_secrets (
                    provider_config_id TEXT PRIMARY KEY,
                    provider TEXT NOT NULL,
                    encrypted_api_key TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )

    @staticmethod
    def _now_iso() -> str:
        return datetime.now(timezone.utc).isoformat()

    def upsert_secret(self, provider_config_id: str, provider: str, api_key: str) -> None:
        encrypted = self.fernet.encrypt(api_key.encode("utf-8")).decode("utf-8")
        now = self._now_iso()
        with self._conn() as conn:
            conn.execute(
                """
                INSERT INTO provider_secrets (provider_config_id, provider, encrypted_api_key, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(provider_config_id) DO UPDATE SET
                  provider = excluded.provider,
                  encrypted_api_key = excluded.encrypted_api_key,
                  updated_at = excluded.updated_at
                """,
                (provider_config_id, provider, encrypted, now, now),
            )

    def delete_secret(self, provider_config_id: str) -> bool:
        with self._conn() as conn:
            cursor = conn.execute("DELETE FROM provider_secrets WHERE provider_config_id = ?", (provider_config_id,))
            return cursor.rowcount > 0

    def secret_exists(self, provider_config_id: str) -> bool:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT 1 FROM provider_secrets WHERE provider_config_id = ? LIMIT 1",
                (provider_config_id,),
            ).fetchone()
            return row is not None

    def get_secret(self, provider_config_id: str) -> tuple[str, str]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT provider, encrypted_api_key FROM provider_secrets WHERE provider_config_id = ? LIMIT 1",
                (provider_config_id,),
            ).fetchone()

        if row is None:
            raise KeyError(f"No secret found for provider config '{provider_config_id}'")

        decrypted = self.fernet.decrypt(row["encrypted_api_key"].encode("utf-8")).decode("utf-8")
        return row["provider"], decrypted
