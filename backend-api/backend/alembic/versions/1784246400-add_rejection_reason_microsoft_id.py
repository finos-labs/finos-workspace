import sqlalchemy as sa

from alembic import op  # type: ignore

revision = "5c8f2e91d0a3"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "user", sa.Column("microsoft_id", sa.String(length=100), nullable=True)
    )


def downgrade():
    op.drop_column("user", "microsoft_id")
