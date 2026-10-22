"""drop login ip_address

Drops login.ip_address. No client sends an IP address with a login, so every row
holds NULL. downgrade() adds the column back, empty.

Revision ID: bd12bc3c71ac
Revises: 4f1c8a2d9e63
Create Date: 2026-10-15

"""

import sqlalchemy as sa
import sqlalchemy_utils

from alembic import op  # type: ignore

# revision identifiers, used by Alembic.
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
