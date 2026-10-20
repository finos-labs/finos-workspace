"""drop the Excel add-in's role switch from a database that ran this branch

The Excel add-in is gone (develop's b6dd1da576b6 drops its entitlement columns), and with it
role.excel_add_in, which 4f1c8a2d9e63 no longer adds. A database that reached 4f1c8a2d9e63
before that has the column, with nobody left to read it; this revision drops it there.

The column is asked for first, so this changes nothing on a database that has none and
running it again is safe. downgrade() does not bring it back: the add-in it switched on no
longer exists.

Revision ID: f11377401858
Revises: 1ded5470241f
Create Date: 2026-10-20

"""

import sqlalchemy as sa

from alembic import op  # type: ignore

# revision identifiers, used by Alembic.
revision = "f11377401858"
down_revision = "1ded5470241f"
branch_labels = None
depends_on = None

TABLE = "role"
COLUMN = "excel_add_in"


def upgrade():
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns(TABLE)}
    if COLUMN in columns:
        with op.batch_alter_table(TABLE, schema=None) as batch_op:
            batch_op.drop_column(COLUMN)


def downgrade():
    """Nothing: see the note above."""
