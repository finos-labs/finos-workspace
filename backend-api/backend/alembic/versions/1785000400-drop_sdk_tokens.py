"""drop the column the SDK token endpoints used

The ``/sdk`` endpoints are gone: they issued a long-lived token, kept it in
``user.auth_token`` as it was, and handed it back on request. Personal access
tokens are the ``personal_access_token`` table instead, which keeps a hash and
shows the token once. Nothing read or wrote ``user.auth_token`` but those
endpoints, so the column goes with them.

Revision 0001 no longer creates it, so a database made by the current revisions
never has it; one made by the earlier 0001 does, and this drops it there. The
column is asked for first, so this changes nothing on a database that has none
and running it again is safe.

downgrade() puts the column back, empty. The tokens it held are not recoverable
and no code reads it any more, so what comes back is the shape, not the data.

Revision ID: 9c4d7a2e1f35
Revises: 2f6c81b4e7a9
Create Date: 2026-10-11

"""

import sqlalchemy as sa

from alembic import op  # type: ignore

# revision identifiers, used by Alembic.
revision = "9c4d7a2e1f35"
down_revision = "2f6c81b4e7a9"
branch_labels = None
depends_on = None

TABLE = "user"
COLUMN = "auth_token"


def _has_column() -> bool:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(TABLE):
        return False
    return COLUMN in {column["name"] for column in inspector.get_columns(TABLE)}


def upgrade():
    if _has_column():
        with op.batch_alter_table(TABLE, schema=None) as batch_op:
            batch_op.drop_column(COLUMN)


def downgrade():
    if not _has_column():
        with op.batch_alter_table(TABLE, schema=None) as batch_op:
            batch_op.add_column(sa.Column(COLUMN, sa.Text(), nullable=True))
