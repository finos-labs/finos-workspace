import sqlalchemy as sa

import api.models.model_helpers
from alembic import op  # type: ignore

revision = "c4d81f6a2e95"
down_revision = "b7e2c94d1a63"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("entity", schema=None) as batch_op:
        batch_op.add_column(sa.Column("disabled", sa.Boolean(), server_default=sa.false(), nullable=False))
        batch_op.add_column(sa.Column("deleted_at", api.models.model_helpers.AwareDateTime(timezone=True), nullable=True))
    with op.batch_alter_table("api_source", schema=None) as batch_op:
        batch_op.add_column(sa.Column("enabled", sa.Boolean(), server_default=sa.true(), nullable=False))


def downgrade():
    with op.batch_alter_table("api_source", schema=None) as batch_op:
        batch_op.drop_column("enabled")
    with op.batch_alter_table("entity", schema=None) as batch_op:
        batch_op.drop_column("deleted_at")
        batch_op.drop_column("disabled")
