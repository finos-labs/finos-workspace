"""entities are a name: drop their type, email, company type, size, AUM and country

An entity keeps its name and the switches that act on it (sharing_enabled,
require_authenticator). Nothing read the rest: entity.email, company_type, organization_size,
aum and country were stored and shown only, and nothing behaved differently by an entity's
type or its permission hierarchy. The type goes with the entity_type table that
entity.entity_type_uuid pointed at.

Each column, the foreign key, its index and the table are asked for first, so this changes
nothing that is gone already and running it again is safe. downgrade() does not bring them
back: nothing reads them.

Revision ID: 4871959e3457
Revises: b18373ba8216
Create Date: 2026-10-20

"""

import sqlalchemy as sa

from alembic import op  # type: ignore

# revision identifiers, used by Alembic.
revision = "4871959e3457"
down_revision = "b18373ba8216"
branch_labels = None
depends_on = None

TABLE = "entity"
DETAILS = ("email", "company_type", "organization_size", "aum", "country")
TYPE_COLUMN = "entity_type_uuid"
TYPE_FOREIGN_KEY = "fk_entity_entity_type_uuid_entity_type"
TYPE_INDEX = "ix_entity_entity_type_uuid"
TYPE_TABLE = "entity_type"


def upgrade():
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns(TABLE)}
    details = [column for column in DETAILS if column in columns]
    has_type = TYPE_COLUMN in columns

    if details or has_type:
        foreign_keys = {key["name"] for key in inspector.get_foreign_keys(TABLE)}
        indexes = {index["name"] for index in inspector.get_indexes(TABLE)}
        with op.batch_alter_table(TABLE, schema=None) as batch_op:
            # MySQL keeps the index while the foreign key needs it: the key goes first
            if TYPE_FOREIGN_KEY in foreign_keys:
                batch_op.drop_constraint(TYPE_FOREIGN_KEY, type_="foreignkey")
            if TYPE_INDEX in indexes:
                batch_op.drop_index(TYPE_INDEX)
            if has_type:
                batch_op.drop_column(TYPE_COLUMN)
            for column in details:
                batch_op.drop_column(column)

    if inspector.has_table(TYPE_TABLE):
        op.drop_table(TYPE_TABLE)


def downgrade():
    """Nothing: see the note above."""
