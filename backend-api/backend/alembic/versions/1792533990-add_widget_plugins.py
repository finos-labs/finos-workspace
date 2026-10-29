import sqlalchemy as sa
import sqlalchemy_utils

import api.models.model_helpers
from alembic import op  # type: ignore

revision = "5e2b8c41d907"
down_revision = "4871959e3457"
branch_labels = None
depends_on = None


def _base_columns() -> list[sa.Column]:
    return [
        sa.Column("uuid", sqlalchemy_utils.types.uuid.UUIDType(), nullable=False),
        sa.Column("created_date", api.models.model_helpers.AwareDateTime(), nullable=True),
        sa.Column("updated_date", api.models.model_helpers.AwareDateTime(), nullable=True),
    ]


def _plugin_fk(table: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ["plugin_uuid"],
        ["widget_plugin.uuid"],
        name=op.f(f"fk_{table}_plugin_uuid_widget_plugin"),
        ondelete="CASCADE",
    )


def _entity_fk(table: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ["entity_uuid"],
        ["entity.uuid"],
        name=op.f(f"fk_{table}_entity_uuid_entity"),
        ondelete="CASCADE",
    )


def _index(table: str, *columns: str) -> None:
    with op.batch_alter_table(table, schema=None) as batch_op:
        for column in columns:
            batch_op.create_index(batch_op.f(f"ix_{table}_{column}"), [column], unique=False)


def upgrade():
    json_type = api.models.model_helpers.JSONType
    uuid_type = sqlalchemy_utils.types.uuid.UUIDType

    op.create_table(
        "widget_plugin",
        *_base_columns(),
        sa.Column("plugin_id", sa.String(length=48), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("active_version", sa.String(length=32), nullable=True),
        sa.Column("overrides", json_type(), nullable=True),
        sa.PrimaryKeyConstraint("uuid"),
        sa.UniqueConstraint("plugin_id", name=op.f("uq_widget_plugin_plugin_id")),
    )

    op.create_table(
        "widget_plugin_version",
        *_base_columns(),
        sa.Column("plugin_uuid", uuid_type(), nullable=False),
        sa.Column("version", sa.String(length=32), nullable=False),
        sa.Column("digest", sa.String(length=80), nullable=True),
        sa.Column("declared_checksum", sa.String(length=80), nullable=True),
        sa.Column("pin_status", sa.String(length=16), nullable=False),
        sa.Column("manifest", api.models.model_helpers.GzipJsonType(), nullable=True),
        sa.Column("files", json_type(), nullable=True),
        sa.Column("path", sa.String(length=120), nullable=False),
        sa.Column("state", sa.String(length=16), nullable=False),
        sa.Column("blocked_reason", sa.Text(), nullable=True),
        sa.Column("findings", json_type(), nullable=True),
        sa.Column("discovered_at", api.models.model_helpers.AwareDateTime(), nullable=True),
        sa.Column("approved", json_type(), nullable=True),
        sa.Column("approved_by_uuid", uuid_type(), nullable=True),
        sa.Column("approved_at", api.models.model_helpers.AwareDateTime(), nullable=True),
        _plugin_fk("widget_plugin_version"),
        sa.PrimaryKeyConstraint("uuid"),
        sa.UniqueConstraint("plugin_uuid", "version", name="uix_widget_plugin_version"),
    )
    _index("widget_plugin_version", "plugin_uuid")

    op.create_table(
        "entity_widget_plugin",
        *_base_columns(),
        sa.Column("entity_uuid", uuid_type(), nullable=False),
        sa.Column("plugin_uuid", uuid_type(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("settings", json_type(), nullable=True),
        sa.Column("narrowed_permissions", json_type(), nullable=True),
        sa.Column("csp_narrow", json_type(), nullable=True),
        _entity_fk("entity_widget_plugin"),
        _plugin_fk("entity_widget_plugin"),
        sa.PrimaryKeyConstraint("uuid"),
        sa.UniqueConstraint("entity_uuid", "plugin_uuid", name="uix_entity_widget_plugin"),
    )
    _index("entity_widget_plugin", "entity_uuid", "plugin_uuid")

    op.create_table(
        "entity_viz_handler",
        *_base_columns(),
        sa.Column("entity_uuid", uuid_type(), nullable=False),
        sa.Column("viz_type", sa.String(length=32), nullable=False),
        sa.Column("plugin_uuid", uuid_type(), nullable=False),
        sa.Column("widget_id", sa.String(length=48), nullable=False),
        _entity_fk("entity_viz_handler"),
        _plugin_fk("entity_viz_handler"),
        sa.PrimaryKeyConstraint("uuid"),
        sa.UniqueConstraint("entity_uuid", "viz_type", name="uix_entity_viz_handler"),
    )
    _index("entity_viz_handler", "entity_uuid", "plugin_uuid")

    op.create_table(
        "role_widget_plugin",
        *_base_columns(),
        sa.Column("role_uuid", uuid_type(), nullable=False),
        sa.Column("plugin_uuid", uuid_type(), nullable=False),
        sa.Column("widget_id", sa.String(length=48), nullable=False),
        sa.ForeignKeyConstraint(
            ["role_uuid"],
            ["role.uuid"],
            name=op.f("fk_role_widget_plugin_role_uuid_role"),
            ondelete="CASCADE",
        ),
        _plugin_fk("role_widget_plugin"),
        sa.PrimaryKeyConstraint("uuid"),
        sa.UniqueConstraint("role_uuid", "plugin_uuid", "widget_id", name="uix_role_widget_plugin"),
    )
    _index("role_widget_plugin", "role_uuid", "plugin_uuid")

    op.create_table(
        "widget_plugin_event",
        *_base_columns(),
        sa.Column("plugin_uuid", uuid_type(), nullable=False),
        sa.Column("version", sa.String(length=32), nullable=True),
        sa.Column("entity_uuid", uuid_type(), nullable=True),
        sa.Column("actor_uuid", uuid_type(), nullable=True),
        sa.Column("action", sa.String(length=48), nullable=False),
        sa.Column("details", json_type(), nullable=True),
        _plugin_fk("widget_plugin_event"),
        sa.PrimaryKeyConstraint("uuid"),
    )
    _index("widget_plugin_event", "plugin_uuid", "entity_uuid")

    op.create_table(
        "widget_plugin_csp_report",
        *_base_columns(),
        sa.Column("plugin_uuid", uuid_type(), nullable=False),
        sa.Column("version", sa.String(length=32), nullable=False),
        sa.Column("entity_uuid", uuid_type(), nullable=False),
        sa.Column("directive", sa.String(length=32), nullable=False),
        sa.Column("blocked_origin", sa.String(length=255), nullable=False),
        sa.Column("count", sa.Integer(), nullable=False),
        sa.Column("first_seen", api.models.model_helpers.AwareDateTime(), nullable=True),
        sa.Column("last_seen", api.models.model_helpers.AwareDateTime(), nullable=True),
        _entity_fk("widget_plugin_csp_report"),
        _plugin_fk("widget_plugin_csp_report"),
        sa.PrimaryKeyConstraint("uuid"),
        sa.UniqueConstraint(
            "plugin_uuid",
            "entity_uuid",
            "directive",
            "blocked_origin",
            name="uix_widget_plugin_csp_report",
        ),
    )
    _index("widget_plugin_csp_report", "plugin_uuid", "entity_uuid")


def downgrade():
    for table, columns in (
        ("widget_plugin_csp_report", ("plugin_uuid", "entity_uuid")),
        ("widget_plugin_event", ("plugin_uuid", "entity_uuid")),
        ("role_widget_plugin", ("role_uuid", "plugin_uuid")),
        ("entity_viz_handler", ("entity_uuid", "plugin_uuid")),
        ("entity_widget_plugin", ("entity_uuid", "plugin_uuid")),
        ("widget_plugin_version", ("plugin_uuid",)),
    ):
        with op.batch_alter_table(table, schema=None) as batch_op:
            for column in columns:
                batch_op.drop_index(batch_op.f(f"ix_{table}_{column}"))
        op.drop_table(table)
    op.drop_table("widget_plugin")
