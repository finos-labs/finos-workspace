import sqlalchemy as sa

from alembic import op  # type: ignore

revision = "e5a9d3b7c104"
down_revision = "c4d8a7e19f26"
branch_labels = None
depends_on = None

TABLE = "entity_relationship"


def upgrade():
    if sa.inspect(op.get_bind()).has_table(TABLE):
        op.drop_table(TABLE)


def downgrade():
    ...
