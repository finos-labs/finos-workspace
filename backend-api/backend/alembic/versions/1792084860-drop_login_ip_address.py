import sqlalchemy as sa
import sqlalchemy_utils

from alembic import op  # type: ignore

revision = "bd12bc3c71ac"
down_revision = "4f1c8a2d9e63"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("login", schema=None) as batch_op:
        batch_op.drop_column("ip_address")


def downgrade():
    with op.batch_alter_table("login", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "ip_address",
                sqlalchemy_utils.types.ip_address.IPAddressType(length=50),
                nullable=True,
            )
        )
