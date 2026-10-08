"""add copilot token limits and usage

Revision ID: 8b1d6f3a7c25
Revises: 0d4a342f4c26
Create Date: 2026-10-05

"""

import sqlalchemy as sa

from alembic import op  # type: ignore

# revision identifiers, used by Alembic.
revision = "8b1d6f3a7c25"
down_revision = "0d4a342f4c26"
branch_labels = None
depends_on = None

LIMIT_TABLES = ("default_tier", "entity_entitlement", "entitlement")


def upgrade():
    for table in LIMIT_TABLES:
        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.add_column(
                sa.Column("number_copilot_tokens_day", sa.BigInteger(), nullable=True)
            )

    with op.batch_alter_table("entitlement_usage", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "number_copilot_tokens_day_count",
                sa.BigInteger(),
                nullable=False,
                server_default="0",
            )
        )
    with op.batch_alter_table("entitlement_usage", schema=None) as batch_op:
        batch_op.alter_column("number_copilot_tokens_day_count", server_default=None)


def downgrade():
    with op.batch_alter_table("entitlement_usage", schema=None) as batch_op:
        batch_op.drop_column("number_copilot_tokens_day_count")

    for table in LIMIT_TABLES:
        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.drop_column("number_copilot_tokens_day")
