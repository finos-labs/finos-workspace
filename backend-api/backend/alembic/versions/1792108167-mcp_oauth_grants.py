import sqlalchemy as sa
import sqlalchemy_utils

import api.models.model_helpers
from alembic import op  # type: ignore

revision = "210b7a161dbc"
down_revision = "7002053173be"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "mcp_oauth_grant",
        sa.Column("user_uuid", sqlalchemy_utils.types.uuid.UUIDType(), nullable=False),
        sa.Column("server_url", sa.String(length=400), nullable=False),
        sa.Column("credentials", sa.Text(), nullable=False),
        sa.Column("uuid", sqlalchemy_utils.types.uuid.UUIDType(), nullable=False),
        sa.Column(
            "created_date", api.models.model_helpers.AwareDateTime(), nullable=True
        ),
        sa.Column(
            "updated_date", api.models.model_helpers.AwareDateTime(), nullable=True
        ),
        sa.ForeignKeyConstraint(
            ["user_uuid"],
            ["user.uuid"],
            name=op.f("fk_mcp_oauth_grant_user_uuid_user"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("uuid"),
        sa.UniqueConstraint("user_uuid", "server_url", name="uix_mcp_oauth_grant"),
    )


def downgrade():
    op.drop_table("mcp_oauth_grant")
