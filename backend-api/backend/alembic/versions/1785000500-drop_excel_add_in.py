import sqlalchemy as sa

from alembic import op  # type: ignore

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
    ...
