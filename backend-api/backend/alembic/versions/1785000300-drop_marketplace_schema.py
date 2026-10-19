"""drop the tables and the columns the marketplace left behind

The marketplace was removed, and the revisions that created its schema (0001 and
0d4a342f4c26) were edited in place rather than followed by a revision that drops it. A
database created by the current revisions never has any of it; one that ran their earlier
versions still has the four tables and the columns, with nobody left to read them. This
revision drops them there.

A table that is still in use can hold a foreign key into one that is going away
(``api_source.vendor_app_uuid`` points at ``vendor_app``), and a database that enforces
its keys refuses to drop the table while that key exists. So the links from the tables
that stay are dropped first, then the tables themselves, children before parents. The
indexes on a column that goes are dropped with it: SQLite rebuilds the table and would
create them again on the column that is no longer there.

Like b179074b50c6, every step asks the database what it has first, so this revision changes
nothing on a database created by the current revisions and running it again is safe.

downgrade() does not bring the marketplace back. Its tables held the submissions, the
listings and the ratings of a feature that no longer exists, and nothing in the schema or
the code refers to them, so re-creating them empty would only put the orphans back.

Revision ID: 2f6c81b4e7a9
Revises: 7e2b5c9d4a18
Create Date: 2026-10-10

"""

import sqlalchemy as sa

from alembic import op  # type: ignore

# revision identifiers, used by Alembic.
revision = "2f6c81b4e7a9"
down_revision = "7e2b5c9d4a18"
branch_labels = None
depends_on = None

# Children before parents: user_app_subscription and rate_vendor_app point at vendor_app,
# which points at vendor, and a database that still enforces those keys refuses the other order.
REMOVED_TABLES = [
    "user_app_subscription",
    "rate_vendor_app",
    "vendor_app",
    "vendor",
]

# (table, column) that the marketplace added to a table that is still in use. The model and the
# current 0001 have neither, so on a database that has them they are orphans.
REMOVED_COLUMNS = [
    ("user", "can_submit_marketplace"),
    ("api_source", "vendor_app_uuid"),
]


def _inspector() -> sa.Inspector:
    return sa.inspect(op.get_bind())


def _columns(inspector: sa.Inspector, table: str) -> set[str]:
    if not inspector.has_table(table):
        return set()
    return {column["name"] for column in inspector.get_columns(table)}


def upgrade():
    inspector = _inspector()
    going = set(REMOVED_TABLES)
    sqlite = op.get_bind().dialect.name == "sqlite"

    # The keys that point from a table that stays into one that goes. SQLite has no statement for
    # dropping a constraint; there, dropping the column rebuilds the table without the key.
    for table, column in REMOVED_COLUMNS:
        if column not in _columns(inspector, table):
            continue
        keys = [
            key
            for key in inspector.get_foreign_keys(table)
            if key.get("referred_table") in going and key.get("name")
        ]
        indexes = [
            index["name"]
            for index in inspector.get_indexes(table)
            if column in index["column_names"] and index.get("name")
        ]
        with op.batch_alter_table(table, schema=None) as batch_op:
            if not sqlite:
                for key in keys:
                    batch_op.drop_constraint(key["name"], type_="foreignkey")
            for index in indexes:
                batch_op.drop_index(index)
            batch_op.drop_column(column)

    for table in REMOVED_TABLES:
        if inspector.has_table(table):
            op.drop_table(table)


def downgrade():
    """Nothing: see the note above. The marketplace is gone, not hidden."""
