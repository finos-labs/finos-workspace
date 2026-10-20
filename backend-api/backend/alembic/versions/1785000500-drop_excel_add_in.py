"""drop the entitlement columns of the Excel add-in

The Excel add-in is gone, and with it the ``excel_add_in`` entitlement that switched it on
for a tier, a data bundle, an entity or a user. Revisions 0001, 0002 and b179074b50c6 were
edited in place, so a database created by the current revisions never has the column; one
that ran their earlier versions has it on four tables, with nobody left to read it. This
revision drops it there.

The column is asked for first on every table, so this changes nothing on a database that
has none and running it again is safe.

downgrade() does not bring the column back: the add-in it switched on no longer exists.

Revision ID: b6dd1da576b6
Revises: 9c4d7a2e1f35
Create Date: 2026-10-19

"""

import sqlalchemy as sa

from alembic import op  # type: ignore

# revision identifiers, used by Alembic.
revision = "b6dd1da576b6"
down_revision = "9c4d7a2e1f35"
branch_labels = None
depends_on = None

COLUMN = "excel_add_in"
TABLES = ["default_tier", "data_bundle", "entity_entitlement", "entitlement"]


def _has_column(inspector: sa.Inspector, table: str) -> bool:
    if not inspector.has_table(table):
        return False
    return COLUMN in {column["name"] for column in inspector.get_columns(table)}


def upgrade():
    inspector = sa.inspect(op.get_bind())
    for table in TABLES:
        if _has_column(inspector, table):
            with op.batch_alter_table(table, schema=None) as batch_op:
                batch_op.drop_column(COLUMN)


def downgrade():
    """Nothing: see the note above."""
