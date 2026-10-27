import sqlalchemy as sa

from alembic import op  # type: ignore

revision = "c4d8a7e19f26"
down_revision = "9a4e61c2b8d0"
branch_labels = None
depends_on = None

DROPPED = {
    "user": ("referred_by", "referred_by_sent", "referral_code", "total_referrals"),
    "stored_file": ("is_entity_shared",),
}


def upgrade():
    inspector = sa.inspect(op.get_bind())
    for table, names in DROPPED.items():
        present = {column["name"] for column in inspector.get_columns(table)}
        columns = [name for name in names if name in present]
        if not columns:
            continue
        uniques = [
            constraint["name"]
            for constraint in inspector.get_unique_constraints(table)
            if constraint["name"] and set(constraint["column_names"]) & set(columns)
        ]
        indexes = [
            index["name"]
            for index in inspector.get_indexes(table)
            if index["name"] and set(index["column_names"]) & set(columns)
        ]
        with op.batch_alter_table(table, schema=None) as batch_op:
            for name in uniques:
                batch_op.drop_constraint(name, type_="unique")
            for name in indexes:
                if name not in uniques:
                    batch_op.drop_index(name)
            for name in columns:
                batch_op.drop_column(name)


def downgrade():
    ...
