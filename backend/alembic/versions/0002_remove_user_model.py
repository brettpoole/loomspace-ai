"""Remove user model, auth, and multi-user scoping.

- Drop the users table entirely.
- Drop user_id columns from profiles and workspaces.
- Drop associated indexes.

"""

from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop indexes first (FK columns depend on them)
    op.drop_index("ix_profiles_user_id", table_name="profiles")
    op.drop_index("ix_workspaces_user_id", table_name="workspaces")

    # Drop user_id columns
    op.drop_column("profiles", "user_id")
    op.drop_column("workspaces", "user_id")

    # Drop the users table
    op.drop_table("users")


def downgrade() -> None:
    # Recreate users table
    op.create_table(
        "users",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("username", sa.String(128), unique=True, nullable=False),
        sa.Column("hashed_password", sa.String(256), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )

    # Recreate user_id columns
    op.add_column("profiles", sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False))
    op.add_column("workspaces", sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False))

    # Recreate indexes
    op.create_index("ix_profiles_user_id", "profiles", ["user_id"])
    op.create_index("ix_workspaces_user_id", "workspaces", ["user_id"])
