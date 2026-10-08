"""add rejection_reason, microsoft_id

Revision ID: 5c8f2e91d0a3
Revises: 0003
Create Date: 2026-07-17

"""

import sqlalchemy as sa

from alembic import op  # type: ignore

# revision identifiers, used by Alembic.
revision = "5c8f2e91d0a3"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("vendor_app", sa.Column("rejection_reason", sa.Text(), nullable=True))
    op.add_column(
        "user", sa.Column("microsoft_id", sa.String(length=100), nullable=True)
    )


def downgrade():
    op.drop_column("user", "microsoft_id")
    op.drop_column("vendor_app", "rejection_reason")
