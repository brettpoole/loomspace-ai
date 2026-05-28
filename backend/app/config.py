from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://loomspace:loomspace@localhost:5432/loomspace"
    data_secret: str  # required — used for Fernet key derivation
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24 * 7  # 7 days
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:3000", "http://localhost:4173"]

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

settings = Settings()
