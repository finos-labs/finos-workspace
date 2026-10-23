import sqlalchemy as sa

import api.models.model_helpers
from alembic import op  # type: ignore

revision = "9a4e61c2b8d0"
down_revision = "7c3d5f20a1b4"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("entity_widget_plugin", schema=None) as batch_op:
        batch_op.add_column(sa.Column("data_sources", api.models.model_helpers.JSONType(), nullable=True))


def downgrade():
    with op.batch_alter_table("entity_widget_plugin", schema=None) as batch_op:
        batch_op.drop_column("data_sources")
