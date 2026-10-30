import sqlalchemy as sa
import sqlalchemy_utils

import api.models.model_helpers
from alembic import op  # type: ignore

revision = "b3f7a9c15e62"
down_revision = "c5d8e2f1a7b3"
branch_labels = None
depends_on = None


def upgrade():
    uuid_type = sqlalchemy_utils.types.uuid.UUIDType
    op.create_table(
        "provider_session",
        sa.Column("uuid", uuid_type(), nullable=False),
        sa.Column("created_date", api.models.model_helpers.AwareDateTime(), nullable=True),
        sa.Column("updated_date", api.models.model_helpers.AwareDateTime(), nullable=True),
        sa.Column("session_uuid", uuid_type(), nullable=False),
        sa.Column("provider", sa.String(length=20), nullable=False),
        sa.Column("id_token", sa.Text(), nullable=False),
        sa.Column("id_token_expires_at", api.models.model_helpers.AwareDateTime(), nullable=False),
        sa.Column("refresh_token", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("uuid"),
        sa.UniqueConstraint("session_uuid", name=op.f("uq_provider_session_session_uuid")),
    )
    op.create_table(
        "signing_key",
        sa.Column("uuid", uuid_type(), nullable=False),
        sa.Column("created_date", api.models.model_helpers.AwareDateTime(), nullable=True),
        sa.Column("updated_date", api.models.model_helpers.AwareDateTime(), nullable=True),
        sa.Column("private_key", sa.Text(), nullable=False),
        sa.Column("public_jwk", api.models.model_helpers.JSONType(), nullable=False),
        sa.PrimaryKeyConstraint("uuid"),
    )


def downgrade():
    op.drop_table("signing_key")
    op.drop_table("provider_session")
