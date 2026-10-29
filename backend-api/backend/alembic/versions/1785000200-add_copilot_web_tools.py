import sqlalchemy as sa

from alembic import op  # type: ignore

revision = "7e2b5c9d4a18"
down_revision = "b179074b50c6"
branch_labels = None
depends_on = None

TABLES = ("default_tier", "entity_entitlement", "entitlement")
FLAGS = ("search_web", "fetch_from_web")


def upgrade():
    for table in TABLES:
        with op.batch_alter_table(table, schema=None) as batch_op:
            for flag in FLAGS:
                batch_op.add_column(
                    sa.Column(
                        flag, sa.Boolean(), nullable=True, server_default=sa.true()
                    )
                )


def downgrade():
    for table in TABLES:
        with op.batch_alter_table(table, schema=None) as batch_op:
            for flag in FLAGS:
                batch_op.drop_column(flag)
