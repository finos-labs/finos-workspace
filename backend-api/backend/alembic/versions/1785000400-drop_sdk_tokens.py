import sqlalchemy as sa

from alembic import op  # type: ignore

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
