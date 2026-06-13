import uuid
from datetime import datetime, timezone
from sqlalchemy import DateTime, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base

def utcnow() -> datetime:
    return datetime.now(timezone.utc)

def new_uuid() -> str:
    return str(uuid.uuid4())

class Profile(Base):
    __tablename__ = "profiles"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    kind: Mapped[str] = mapped_column(String(64), nullable=False)  # AIProvider
    label: Mapped[str] = mapped_column(String(256), nullable=False)
    model: Mapped[str] = mapped_column(String(256), nullable=False)
    base_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    encrypted_api_key: Mapped[str | None] = mapped_column(Text, nullable=True)  # Fernet token
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

class Workspace(Base):
    __tablename__ = "workspaces"
    id: Mapped[str] = mapped_column(String(128), primary_key=True)  # client-supplied UUID
    data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
