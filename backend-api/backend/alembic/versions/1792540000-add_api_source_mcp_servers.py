import sqlalchemy as sa

import api.models.model_helpers
from alembic import op  # type: ignore

revision = "c5d8e2f1a7b3"
down_revision = "9a4e61c2b8d0"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("api_source", schema=None) as batch_op:
        batch_op.add_column(sa.Column("mcp_servers", api.models.model_helpers.JSONType(), nullable=True))


def downgrade():
    with op.batch_alter_table("api_source", schema=None) as batch_op:
        batch_op.drop_column("mcp_servers")
