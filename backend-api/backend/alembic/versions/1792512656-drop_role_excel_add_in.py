import sqlalchemy as sa

from alembic import op  # type: ignore

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
    ...
