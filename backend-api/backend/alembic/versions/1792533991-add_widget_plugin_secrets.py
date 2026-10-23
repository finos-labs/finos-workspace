import sqlalchemy as sa
import sqlalchemy_utils

import api.models.model_helpers
from alembic import op  # type: ignore

revision = "7c3d5f20a1b4"
down_revision = "5e2b8c41d907"
branch_labels = None
depends_on = None


def upgrade():
    uuid_type = sqlalchemy_utils.types.uuid.UUIDType
    op.create_table(
        "widget_plugin_secret",
        sa.Column("uuid", uuid_type(), nullable=False),
        sa.Column("created_date", api.models.model_helpers.AwareDateTime(), nullable=True),
        sa.Column("updated_date", api.models.model_helpers.AwareDateTime(), nullable=True),
        sa.Column("plugin_uuid", uuid_type(), nullable=False),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column("set_by_uuid", uuid_type(), nullable=True),
        sa.ForeignKeyConstraint(
            ["plugin_uuid"],
            ["widget_plugin.uuid"],
            name=op.f("fk_widget_plugin_secret_plugin_uuid_widget_plugin"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("uuid"),
        sa.UniqueConstraint("plugin_uuid", "name", name="uix_widget_plugin_secret"),
    )
    with op.batch_alter_table("widget_plugin_secret", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_widget_plugin_secret_plugin_uuid"), ["plugin_uuid"], unique=False)
    with op.batch_alter_table("entity_widget_plugin", schema=None) as batch_op:
        batch_op.add_column(sa.Column("server_network_narrow", api.models.model_helpers.JSONType(), nullable=True))


def downgrade():
    with op.batch_alter_table("entity_widget_plugin", schema=None) as batch_op:
        batch_op.drop_column("server_network_narrow")
    with op.batch_alter_table("widget_plugin_secret", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_widget_plugin_secret_plugin_uuid"))
    op.drop_table("widget_plugin_secret")
