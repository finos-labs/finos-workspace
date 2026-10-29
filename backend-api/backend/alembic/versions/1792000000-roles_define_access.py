from datetime import UTC, datetime
from uuid import uuid4

import sqlalchemy as sa
import sqlalchemy_utils

import api.models.model_helpers
from alembic import op  # type: ignore

revision = "4f1c8a2d9e63"
down_revision = "b6dd1da576b6"
branch_labels = None
depends_on = None

REMOVED_TABLES = [
    "entitlement",
    "entity_entitlement",
    "default_tier",
    "data_bundle",
    "tier",
]

OLD_USAGE_TABLE = "entitlement_usage"
USAGE_TABLE = "user_usage"

ROLE_SHARING_CHECK = "check_role_sharing"

DEVELOPER_MAP = "Developer"

WEB_SWITCHES = ("search_web", "fetch_from_web")


def _role_columns() -> list[sa.Column]:
    return [
        sa.Column(
            "sharing", sa.String(length=10), server_default="none", nullable=False
        ),
        sa.Column("copilot_calls_day", sa.Integer(), nullable=True),
        sa.Column("copilot_tokens_day", sa.BigInteger(), nullable=True),
        sa.Column("upload_size_gb", sa.Integer(), nullable=True),
        *(
            sa.Column(switch, sa.Boolean(), server_default=sa.true(), nullable=False)
            for switch in WEB_SWITCHES
        ),
    ]


def upgrade():
    with op.batch_alter_table("role", schema=None) as batch_op:
        for column in _role_columns():
            batch_op.add_column(column)
        batch_op.create_check_constraint(
            ROLE_SHARING_CHECK, "sharing IN ('none', 'receive', 'share')"
        )
    _copy_web_switches()

    for table in REMOVED_TABLES:
        op.drop_table(table)

    op.rename_table(OLD_USAGE_TABLE, USAGE_TABLE)
    _rename_usage_keys(OLD_USAGE_TABLE, USAGE_TABLE)

    with op.batch_alter_table("entity", schema=None) as batch_op:
        batch_op.drop_column("seats")
        batch_op.drop_column("expiration_date")
        batch_op.add_column(
            sa.Column(
                "sharing_enabled",
                sa.Boolean(),
                server_default=sa.true(),
                nullable=False,
            )
        )

    with op.batch_alter_table("user", schema=None) as batch_op:
        batch_op.drop_column("billing_active")

    _add_developer_maps()


def _copy_web_switches():
    uuid_type = sqlalchemy_utils.types.uuid.UUIDType()
    role = sa.table(
        "role",
        sa.column("entity_uuid", uuid_type),
        *(sa.column(switch, sa.Boolean) for switch in WEB_SWITCHES),
    )
    entitlement = sa.table(
        "entity_entitlement",
        sa.column("entity_uuid", uuid_type),
        *(sa.column(switch, sa.Boolean) for switch in WEB_SWITCHES),
    )
    for switch in WEB_SWITCHES:
        off = sa.select(entitlement.c.entity_uuid).where(
            entitlement.c[switch] == sa.false()
        )
        op.execute(
            role.update().where(role.c.entity_uuid.in_(off)).values({switch: False})
        )


def _rename_usage_keys(old: str, new: str):
    if op.get_bind().dialect.name == "postgresql":
        op.execute(f"ALTER TABLE {new} RENAME CONSTRAINT {old}_pkey TO {new}_pkey")

    with op.batch_alter_table(new, schema=None) as batch_op:
        batch_op.drop_constraint(f"fk_{old}_user_uuid_user", type_="foreignkey")
        batch_op.drop_index(f"ix_{old}_user_uuid")
        batch_op.create_index(
            batch_op.f(f"ix_{new}_user_uuid"), ["user_uuid"], unique=True
        )
        batch_op.create_foreign_key(
            batch_op.f(f"fk_{new}_user_uuid_user"), "user", ["user_uuid"], ["uuid"]
        )


def _add_developer_maps():
    uuid_type = sqlalchemy_utils.types.uuid.UUIDType()
    entity = sa.table("entity", sa.column("uuid", uuid_type))
    permissions_map = sa.table(
        "permissions_entity_map",
        sa.column("uuid", uuid_type),
        sa.column("entity_uuid", uuid_type),
        sa.column("name", sa.String),
        sa.column("created_date", sa.DateTime),
        sa.column("updated_date", sa.DateTime),
    )
    has_developer_map = sa.exists().where(
        permissions_map.c.entity_uuid == entity.c.uuid,
        permissions_map.c.name == DEVELOPER_MAP,
    )
    entity_uuids = (
        op.get_bind()
        .execute(sa.select(entity.c.uuid).where(~has_developer_map))
        .scalars()
        .all()
    )
    if not entity_uuids:
        return

    now = datetime.now(UTC).replace(tzinfo=None)
    op.bulk_insert(
        permissions_map,
        [
            {
                "uuid": uuid4(),
                "entity_uuid": entity_uuid,
                "name": DEVELOPER_MAP,
                "created_date": now,
                "updated_date": now,
            }
            for entity_uuid in entity_uuids
        ],
    )


def downgrade():
    with op.batch_alter_table("role", schema=None) as batch_op:
        batch_op.drop_constraint(ROLE_SHARING_CHECK, type_="check")
        for column in reversed(_role_columns()):
            batch_op.drop_column(column.name)

    with op.batch_alter_table("user", schema=None) as batch_op:
        batch_op.add_column(sa.Column("billing_active", sa.Boolean(), nullable=True))

    with op.batch_alter_table("entity", schema=None) as batch_op:
        batch_op.drop_column("sharing_enabled")
        batch_op.add_column(sa.Column("seats", sa.Integer(), nullable=True))
        batch_op.add_column(
            sa.Column(
                "expiration_date",
                api.models.model_helpers.AwareDateTime(),
                nullable=True,
            )
        )

    op.rename_table(USAGE_TABLE, OLD_USAGE_TABLE)
    _rename_usage_keys(USAGE_TABLE, OLD_USAGE_TABLE)

    _restore_removed_tables()


def _base_columns() -> list[sa.Column]:
    return [
        sa.Column("uuid", sqlalchemy_utils.types.uuid.UUIDType(), nullable=False),
        sa.Column(
            "created_date", api.models.model_helpers.AwareDateTime(), nullable=True
        ),
        sa.Column(
            "updated_date", api.models.model_helpers.AwareDateTime(), nullable=True
        ),
    ]


def _limit_columns() -> list[sa.Column]:
    return [
        sa.Column("number_copilot_calls_day", sa.Integer(), nullable=True),
        sa.Column("number_copilot_tokens_day", sa.BigInteger(), nullable=True),
        sa.Column("total_file_upload_size_gb", sa.Integer(), nullable=True),
        sa.Column("share_widgets", sa.String(length=20), nullable=True),
    ]


def _feature_columns() -> list[sa.Column]:
    return [
        sa.Column("bring_your_own_data", sa.Boolean(), nullable=True),
        sa.Column("bring_your_own_copilot", sa.Boolean(), nullable=True),
        sa.Column("admin_access", sa.Boolean(), nullable=True),
        sa.Column("support", sa.Boolean(), nullable=True),
        sa.Column("data_add_ons_redistribution", sa.Boolean(), nullable=True),
        *(
            sa.Column(switch, sa.Boolean(), nullable=True, server_default=sa.true())
            for switch in WEB_SWITCHES
        ),
    ]


def _entitlement_columns() -> list[sa.Column]:
    return [
        sa.Column("tier_id", sa.Integer(), nullable=False),
        *_limit_columns(),
        *_feature_columns(),
        sa.Column("allow_custom_backends", sa.Boolean(), nullable=True),
        sa.Column(
            "data_bundle_uuid", sqlalchemy_utils.types.uuid.UUIDType(), nullable=True
        ),
        *_base_columns(),
    ]


def _share_widgets_check(name: str) -> sa.CheckConstraint:
    return sa.CheckConstraint("share_widgets IN ('public', 'private')", name=name)


def _restore_removed_tables():
    json_type = api.models.model_helpers.JSONType
    op.create_table(
        "tier",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=20), nullable=False),
        sa.Column(
            "created_date", api.models.model_helpers.AwareDateTime(), nullable=True
        ),
        sa.Column(
            "updated_date", api.models.model_helpers.AwareDateTime(), nullable=True
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )

    op.create_table(
        "data_bundle",
        sa.Column("bundle_name", sa.String(length=50), nullable=False),
        sa.Column("except_widgets", json_type(), nullable=False),
        sa.Column("except_dashboard_templates", json_type(), nullable=False),
        sa.Column("except_team_collaboration", json_type(), nullable=True),
        sa.Column("data_export", sa.Boolean(), nullable=False),
        sa.Column("providers", json_type(), nullable=True),
        sa.Column("dashboards_at_launch", json_type(), nullable=True),
        sa.Column("my_dashboards", json_type(), nullable=True),
        sa.Column("invite_your_colleagues", sa.Boolean(), nullable=False),
        sa.Column("number_copilot_calls_day", sa.Integer(), nullable=True),
        sa.Column("total_file_upload_size_gb", sa.Integer(), nullable=True),
        sa.Column("allow_custom_backends", sa.Boolean(), nullable=True),
        *_base_columns(),
        sa.PrimaryKeyConstraint("uuid"),
        sa.UniqueConstraint("bundle_name"),
    )

    op.create_table(
        "default_tier",
        sa.Column("tier_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=50), nullable=False),
        *_limit_columns(),
        sa.Column("data_bundle", sa.Boolean(), nullable=True),
        *_feature_columns(),
        *_base_columns(),
        _share_widgets_check("check_share_widgets_values_tier_defaults"),
        sa.ForeignKeyConstraint(
            ["tier_id"], ["tier.id"], name=op.f("fk_default_tier_tier_id_tier")
        ),
        sa.PrimaryKeyConstraint("uuid"),
        sa.UniqueConstraint("name"),
    )

    op.create_table(
        "entity_entitlement",
        sa.Column(
            "entity_uuid", sqlalchemy_utils.types.uuid.UUIDType(), nullable=False
        ),
        *_entitlement_columns(),
        _share_widgets_check("check_share_widgets_values_entity_entitlements"),
        sa.ForeignKeyConstraint(
            ["data_bundle_uuid"],
            ["data_bundle.uuid"],
            name=op.f("fk_entity_entitlement_data_bundle_uuid_data_bundle"),
        ),
        sa.ForeignKeyConstraint(
            ["entity_uuid"],
            ["entity.uuid"],
            name=op.f("fk_entity_entitlement_entity_uuid_entity"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["tier_id"], ["tier.id"], name=op.f("fk_entity_entitlement_tier_id_tier")
        ),
        sa.PrimaryKeyConstraint("uuid"),
    )
    with op.batch_alter_table("entity_entitlement", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_entity_entitlement_entity_uuid"),
            ["entity_uuid"],
            unique=True,
        )

    op.create_table(
        "entitlement",
        sa.Column("user_uuid", sqlalchemy_utils.types.uuid.UUIDType(), nullable=False),
        *_entitlement_columns(),
        _share_widgets_check("check_share_widgets_values_entitlements"),
        sa.ForeignKeyConstraint(
            ["data_bundle_uuid"],
            ["data_bundle.uuid"],
            name=op.f("fk_entitlement_data_bundle_uuid_data_bundle"),
        ),
        sa.ForeignKeyConstraint(
            ["tier_id"], ["tier.id"], name=op.f("fk_entitlement_tier_id_tier")
        ),
        sa.ForeignKeyConstraint(
            ["user_uuid"], ["user.uuid"], name=op.f("fk_entitlement_user_uuid_user")
        ),
        sa.PrimaryKeyConstraint("uuid"),
    )
    with op.batch_alter_table("entitlement", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_entitlement_user_uuid"), ["user_uuid"], unique=True
        )
