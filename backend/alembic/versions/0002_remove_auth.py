"""remove user auth columns

Revision ID: 0002
Revises: 0001
Create Date: 2026-06-15 00:00:00.000000
"""
from typing import Sequence, Union
from alembic import op

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index("ix_profiles_user_id", table_name="profiles")
    op.drop_index("ix_workspaces_user_id", table_name="workspaces")
    op.drop_constraint("profiles_user_id_fkey", "profiles", type_="foreignkey")
    op.drop_constraint("workspaces_user_id_fkey", "workspaces", type_="foreignkey")
    op.drop_column("profiles", "user_id")
    op.drop_column("workspaces", "user_id")
    op.drop_table("users")


def downgrade() -> None:
    import sqlalchemy as sa
    op.create_table(
        "users",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("username", sa.String(128), unique=True, nullable=False),
        sa.Column("hashed_password", sa.String(256), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.add_column("profiles", sa.Column("user_id", sa.String(36), nullable=True))
    op.add_column("workspaces", sa.Column("user_id", sa.String(36), nullable=True))
    op.create_foreign_key("profiles_user_id_fkey", "profiles", "users", ["user_id"], ["id"], ondelete="CASCADE")
    op.create_foreign_key("workspaces_user_id_fkey", "workspaces", "users", ["user_id"], ["id"], ondelete="CASCADE")
    op.create_index("ix_profiles_user_id", "profiles", ["user_id"])
    op.create_index("ix_workspaces_user_id", "workspaces", ["user_id"])
