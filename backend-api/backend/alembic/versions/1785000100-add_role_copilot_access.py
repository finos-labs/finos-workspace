import sqlalchemy as sa
import sqlalchemy_utils

import api.models.model_helpers
from alembic import op  # type: ignore

revision = "c3a97e5d2b14"
down_revision = "8b1d6f3a7c25"
branch_labels = None
depends_on = None


def _base_columns() -> list[sa.Column]:
    return [
        sa.Column("role_uuid", sqlalchemy_utils.types.uuid.UUIDType(), nullable=False),
        sa.Column("uuid", sqlalchemy_utils.types.uuid.UUIDType(), nullable=False),
        sa.Column(
            "created_date", api.models.model_helpers.AwareDateTime(), nullable=True
        ),
        sa.Column(
            "updated_date", api.models.model_helpers.AwareDateTime(), nullable=True
        ),
    ]


def upgrade():
    op.create_table(
        "role_copilot_model",
        *_base_columns(),
        sa.Column("agent_id", sa.String(length=255), nullable=False),
        sa.Column("model_id", sa.String(length=255), nullable=False),
        sa.ForeignKeyConstraint(
            ["role_uuid"],
            ["role.uuid"],
            name=op.f("fk_role_copilot_model_role_uuid_role"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("uuid"),
        sa.UniqueConstraint(
            "role_uuid", "agent_id", "model_id", name="uix_role_copilot_model"
        ),
    )
    with op.batch_alter_table("role_copilot_model", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_role_copilot_model_role_uuid"), ["role_uuid"], unique=False
        )

    op.create_table(
        "role_mcp_access",
        *_base_columns(),
        sa.Column("server_url", sa.String(length=400), nullable=False),
        sa.Column("tool_name", sa.String(length=200), nullable=False),
        sa.ForeignKeyConstraint(
            ["role_uuid"],
            ["role.uuid"],
            name=op.f("fk_role_mcp_access_role_uuid_role"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("uuid"),
        sa.UniqueConstraint(
            "role_uuid", "server_url", "tool_name", name="uix_role_mcp_access"
        ),
    )
    with op.batch_alter_table("role_mcp_access", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_role_mcp_access_role_uuid"), ["role_uuid"], unique=False
        )


def downgrade():
    with op.batch_alter_table("role_mcp_access", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_role_mcp_access_role_uuid"))
    op.drop_table("role_mcp_access")

    with op.batch_alter_table("role_copilot_model", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_role_copilot_model_role_uuid"))
    op.drop_table("role_copilot_model")
