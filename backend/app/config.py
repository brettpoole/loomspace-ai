from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "loomspace-backend"
    debug: bool = False
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    sqlite_path: str = "./loomspace_secrets.db"
    secret_manager_key: str = ""
    request_timeout_seconds: float = 60.0

    model_config = SettingsConfigDict(env_prefix="LOOMSPACE_", case_sensitive=False)

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


settings = Settings()
