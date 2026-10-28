import sqlalchemy as sa
import sqlalchemy_utils

import api.models.model_helpers
from alembic import op  # type: ignore

revision = "8b5e2d7c1f40"
down_revision = "4c1d2e8f9a3b"
branch_labels = None
depends_on = None

INDEXED = ("requester_uuid", "dashboard_item_uuid", "user_app_uuid", "recipient_uuid")


def upgrade():
    op.create_table(
        "share_request",
        sa.Column(
            "requester_uuid", sqlalchemy_utils.types.uuid.UUIDType(), nullable=False
        ),
        sa.Column(
            "dashboard_item_uuid", sqlalchemy_utils.types.uuid.UUIDType(), nullable=True
        ),
        sa.Column("user_app_uuid", sqlalchemy_utils.types.uuid.UUIDType(), nullable=True),
        sa.Column(
            "recipient_uuid", sqlalchemy_utils.types.uuid.UUIDType(), nullable=True
        ),
        sa.Column("permissions", sa.String(length=10), nullable=True),
        sa.Column("uuid", sqlalchemy_utils.types.uuid.UUIDType(), nullable=False),
        sa.Column(
            "created_date", api.models.model_helpers.AwareDateTime(), nullable=True
        ),
        sa.Column(
            "updated_date", api.models.model_helpers.AwareDateTime(), nullable=True
        ),
        sa.CheckConstraint(
            "(dashboard_item_uuid IS NULL) <> (user_app_uuid IS NULL)",
            name="check_share_request_item",
        ),
        sa.ForeignKeyConstraint(
            ["requester_uuid"],
            ["user.uuid"],
            name=op.f("fk_share_request_requester_uuid_user"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["dashboard_item_uuid"],
            ["dashboard_item.uuid"],
            name=op.f("fk_share_request_dashboard_item_uuid_dashboard_item"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_app_uuid"],
            ["user_app.uuid"],
            name=op.f("fk_share_request_user_app_uuid_user_app"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["recipient_uuid"],
            ["user.uuid"],
            name=op.f("fk_share_request_recipient_uuid_user"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("uuid"),
    )
    with op.batch_alter_table("share_request") as batch_op:
        for column in INDEXED:
            batch_op.create_index(
                batch_op.f(f"ix_share_request_{column}"), [column], unique=False
            )


def downgrade():
    op.drop_table("share_request")
