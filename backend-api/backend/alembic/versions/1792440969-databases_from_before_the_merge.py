"""bring a database that ran this branch before develop was merged into it to the schema

Develop's revisions 7e2b5c9d4a18, 2f6c81b4e7a9 and 9c4d7a2e1f35 came in under
4f1c8a2d9e63 with the merge, and 4f1c8a2d9e63 gained the role settings of the Copilot's
web tools (role.search_web, role.fetch_from_web). A database that had already reached
8b5e2d7c1f40 runs none of that: alembic only goes forward from the revision it is at. It
gets here what the schema needs:

- the two role columns, on (its entitlements, which they would have been copied from, are
  gone already);
- the tables and columns the marketplace left behind, dropped by running 2f6c81b4e7a9 again.

The tier tables that 7e2b5c9d4a18 adds columns to are gone there too, and 9c4d7a2e1f35 drops
a column that 1792102721 already dropped. Every step asks the database what it has first, so
on a database that came through the whole chain this revision changes nothing.

downgrade() changes nothing: the columns belong to 4f1c8a2d9e63, whose downgrade drops them.

Revision ID: 1ded5470241f
Revises: 8b5e2d7c1f40
Create Date: 2026-10-19

"""

import sqlalchemy as sa

from alembic import context, op  # type: ignore

# revision identifiers, used by Alembic.
revision = "1ded5470241f"
down_revision = "8b5e2d7c1f40"
branch_labels = None
depends_on = None

WEB_SWITCHES = ("search_web", "fetch_from_web")
MARKETPLACE_CLEANUP = "2f6c81b4e7a9"


def upgrade():
    role_columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("role")}
    missing = [switch for switch in WEB_SWITCHES if switch not in role_columns]
    if missing:
        with op.batch_alter_table("role", schema=None) as batch_op:
            for switch in missing:
                batch_op.add_column(
                    sa.Column(switch, sa.Boolean(), server_default=sa.true(), nullable=False)
                )

    context.script.get_revision(MARKETPLACE_CLEANUP).module.upgrade()


def downgrade():
    """Nothing: see the note above."""
