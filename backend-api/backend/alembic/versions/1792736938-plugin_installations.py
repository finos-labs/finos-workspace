"""plugin installations

A superuser installs a plugin from the plugin host's registry: plugin_installation keeps
the approved version, pinned by its release digest, with a snapshot of that release. An
admin enables an installed plugin for their organization in entity_plugin; uninstalling
the plugin or deleting the organization removes those rows.

downgrade() drops both tables, with every installation and enablement.

Revision ID: f15edbcff4aa
Revises: 4871959e3457
Create Date: 2026-10-23

"""

import sqlalchemy as sa
import sqlalchemy_utils

import api.models.model_helpers
from alembic import op  # type: ignore

# revision identifiers, used by Alembic.
revision = "f15edbcff4aa"
down_revision = "4871959e3457"
branch_labels = None
depends_on = None


def _dates() -> list[sa.Column]:
    return [
        sa.Column("uuid", sqlalchemy_utils.types.uuid.UUIDType(), nullable=False),
        sa.Column(
            "created_date", api.models.model_helpers.AwareDateTime(), nullable=True
        ),
        sa.Column(
            "updated_date", api.models.model_helpers.AwareDateTime(), nullable=True
        ),
    ]


def upgrade():
    op.create_table(
        "plugin_installation",
        sa.Column("plugin_id", sa.String(length=100), nullable=False),
        sa.Column("version", sa.String(length=64), nullable=False),
        sa.Column("digest", sa.String(length=71), nullable=False),
        sa.Column("release", api.models.model_helpers.GzipJsonType(), nullable=False),
        sa.Column(
            "approved_at", api.models.model_helpers.AwareDateTime(), nullable=False
        ),
        sa.Column(
            "approved_by_uuid", sqlalchemy_utils.types.uuid.UUIDType(), nullable=True
        ),
        *_dates(),
        sa.ForeignKeyConstraint(
            ["approved_by_uuid"],
            ["user.uuid"],
            name=op.f("fk_plugin_installation_approved_by_uuid_user"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("uuid"),
    )
    with op.batch_alter_table("plugin_installation") as batch_op:
        batch_op.create_index(
            batch_op.f("ix_plugin_installation_plugin_id"), ["plugin_id"], unique=True
        )
        batch_op.create_index(
            batch_op.f("ix_plugin_installation_approved_by_uuid"),
            ["approved_by_uuid"],
            unique=False,
        )

    op.create_table(
        "entity_plugin",
        sa.Column("entity_uuid", sqlalchemy_utils.types.uuid.UUIDType(), nullable=False),
        sa.Column("plugin_id", sa.String(length=100), nullable=False),
        sa.Column(
            "enabled_by_uuid", sqlalchemy_utils.types.uuid.UUIDType(), nullable=True
        ),
        *_dates(),
        sa.ForeignKeyConstraint(
            ["entity_uuid"],
            ["entity.uuid"],
            name=op.f("fk_entity_plugin_entity_uuid_entity"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["plugin_id"],
            ["plugin_installation.plugin_id"],
            name=op.f("fk_entity_plugin_plugin_id_plugin_installation"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["enabled_by_uuid"],
            ["user.uuid"],
            name=op.f("fk_entity_plugin_enabled_by_uuid_user"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("uuid"),
        sa.UniqueConstraint("entity_uuid", "plugin_id", name="uix_entity_plugin"),
    )
    with op.batch_alter_table("entity_plugin") as batch_op:
        for column in ("entity_uuid", "plugin_id", "enabled_by_uuid"):
            batch_op.create_index(
                batch_op.f(f"ix_entity_plugin_{column}"), [column], unique=False
            )


def downgrade():
    op.drop_table("entity_plugin")
    op.drop_table("plugin_installation")
