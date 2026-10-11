"""add the Copilot's web tools to tiers and entitlements

An administrator can switch off the Copilot's tools for searching the web (SEARCH_WEB) and for reading
a page from it (FETCH_FROM_WEB), for an entity and for one user. Everything that exists is on, as it
was before the switches.

Revision ID: 7e2b5c9d4a18
Revises: b179074b50c6
Create Date: 2026-10-10

"""

import sqlalchemy as sa

from alembic import op  # type: ignore

# revision identifiers, used by Alembic.
revision = "7e2b5c9d4a18"
# After b179074b50c6, not beside it: two revisions with the same parent are two heads, and
# `alembic upgrade head` refuses to run with more than one (the API applies the migrations at
# every start, so that is the API not starting).
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
