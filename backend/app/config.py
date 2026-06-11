from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://loomspace:loomspace@localhost:5432/loomspace"
    data_secret: str  # required — used for Fernet key derivation
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:3000", "http://localhost:4173"]

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

settings = Settings()
