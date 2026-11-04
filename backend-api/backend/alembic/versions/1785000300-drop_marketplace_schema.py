import sqlalchemy as sa

from alembic import op  # type: ignore

revision = "2f6c81b4e7a9"
down_revision = "7e2b5c9d4a18"
branch_labels = None
depends_on = None

REMOVED_TABLES = [
    "user_app_subscription",
    "rate_vendor_app",
    "vendor_app",
    "vendor",
]

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
    ...
