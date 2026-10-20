"""mcp oauth grants

The API signs users in to remote MCP servers (routers/app/mcp_oauth.py) and keeps what
they get in mcp_oauth_grant, per user and normalized server URL: the tokens and the client
registered with the authorization server, AES-GCM encrypted (EncryptedType). The browser
kept these in its own storage before; nothing of that is moved, and users sign in to their
OAuth MCP servers again.

downgrade() drops the table with the grants.

Revision ID: 210b7a161dbc
Revises: 7002053173be
Create Date: 2026-10-15

"""

import sqlalchemy as sa
import sqlalchemy_utils

import api.models.model_helpers
from alembic import op  # type: ignore

# revision identifiers, used by Alembic.
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
