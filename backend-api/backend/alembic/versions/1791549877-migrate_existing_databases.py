from datetime import UTC, datetime
from uuid import uuid4

import sqlalchemy as sa
import sqlalchemy_utils

import api.models.model_helpers
from alembic import op  # type: ignore

revision = "b179074b50c6"
down_revision = "c3a97e5d2b14"
branch_labels = None
depends_on = None

REMOVED_TABLES = [
    "copilot_chat_old",
    "copilot_chats",
    "developer_onboarding",
    "enabled_widget_bundles",
    "feedback",
    "permissions_invite",
    "single_widget",
    "stripe_event",
    "trading_view",
]

RENAMED_COLUMNS = [
    ("session", "pro", "app_session", sa.Boolean(), False),
    ("user", "pro_start", "app_start", sa.DateTime(), True),
    (
        "user",
        "pro_display_settings",
        "display_settings",
        api.models.model_helpers.UserDisplaySettingsType(),
        True,
    ),
]

OLD_INVITE_TABLE = "user_pro_invite"
INVITE_TABLE = "user_invite"
INVITE_SHARE_COLUMNS = ["shared_dashboards", "shared_apps"]

USER_STRIPE_INDEX = "ix_user_stripe_id"
TRIAL_BUNDLE = "Pro Trial"


def _removed_columns() -> dict[str, list[sa.Column]]:
    json_type = api.models.model_helpers.JSONType
    date_type = api.models.model_helpers.AwareDateTime
    return {
        "entity": [
            sa.Column("api_keys", json_type(), nullable=True),
            sa.Column("stripe_id", sa.Text(), nullable=True),
        ],
        "login": [
            sa.Column("city", sa.String(length=100), nullable=True),
            sa.Column("region", sa.String(length=100), nullable=True),
            sa.Column("region_iso_code", sa.String(length=100), nullable=True),
            sa.Column("postal_code", sa.String(length=10), nullable=True),
            sa.Column("country", sa.String(length=100), nullable=True),
            sa.Column("country_code", sa.String(length=10), nullable=True),
            sa.Column("continent", sa.String(length=100), nullable=True),
            sa.Column("continent_code", sa.String(length=10), nullable=True),
            sa.Column("timezone_name", sa.String(length=100), nullable=True),
            sa.Column("timezone_abbrev", sa.String(length=10), nullable=True),
            sa.Column("connection_type", sa.String(length=100), nullable=True),
        ],
        "permissions_entity_map": [
            sa.Column("entitlements", json_type(), nullable=True),
        ],
        "tier": [
            sa.Column("has_trial", sa.Boolean(), nullable=True),
            sa.Column("trial_duration_days", sa.Integer(), nullable=True),
        ],
        "user": [
            sa.Column("pro_entitlements", json_type(), nullable=True),
            sa.Column("pro_zero_to_hero", json_type(), nullable=True),
            sa.Column("primary_usage", sa.Text(), nullable=True),
            sa.Column("wants_contacted", sa.Boolean(), nullable=True),
            sa.Column("has_profile_url", sa.Boolean(), nullable=True),
            sa.Column("accepted_pro_tos", sa.Boolean(), nullable=True),
            sa.Column("pro_trial_granted", sa.Boolean(), nullable=True),
            sa.Column("pro_trial_granted_date", date_type(), nullable=True),
            sa.Column("pro_trial_end", date_type(), nullable=True),
            sa.Column("pro_trial_extension", sa.Boolean(), nullable=True),
            sa.Column("pro_trial_renewals", sa.Integer(), nullable=True),
            sa.Column("pro_inactivity_email_sent", sa.Boolean(), nullable=True),
            sa.Column("welcome_screen", sa.Boolean(), nullable=True),
            sa.Column("hear_about_us", sa.Text(), nullable=True),
            sa.Column("stripe_id", sa.String(length=50), nullable=True),
        ],
    }


def _invite_keys(table: str) -> tuple[list[tuple], tuple[str, str]]:
    return (
        [
            (f"fk_{table}_inviting_user_uuid_user", "inviting_user_uuid", "user", None),
            (
                f"fk_{table}_permissions_uuid_permissions_entity_map",
                "permissions_uuid",
                "permissions_entity_map",
                "SET NULL",
            ),
        ],
        (f"ix_{table}_inviting_user_uuid", "inviting_user_uuid"),
    )


def _inspector() -> sa.Inspector:
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return _inspector().has_table(table)


def _columns(table: str) -> dict[str, dict]:
    return {column["name"]: column for column in _inspector().get_columns(table)}


def _index_names(table: str) -> set[str]:
    return {index["name"] for index in _inspector().get_indexes(table)}


def _foreign_key_names(table: str) -> set[str]:
    return {fk["name"] for fk in _inspector().get_foreign_keys(table)}


def _data_bundle_table() -> sa.TableClause:
    return sa.table(
        "data_bundle",
        sa.column("uuid", sqlalchemy_utils.types.uuid.UUIDType()),
        sa.column("bundle_name", sa.String),
        sa.column("except_widgets", api.models.model_helpers.JSONType()),
        sa.column("except_dashboard_templates", api.models.model_helpers.JSONType()),
        sa.column("except_team_collaboration", api.models.model_helpers.JSONType()),
        sa.column("data_export", sa.Boolean),
        sa.column("providers", api.models.model_helpers.JSONType()),
        sa.column("dashboards_at_launch", api.models.model_helpers.JSONType()),
        sa.column("my_dashboards", api.models.model_helpers.JSONType()),
        sa.column("invite_your_colleagues", sa.Boolean),
        sa.column("number_copilot_calls_day", sa.Integer),
        sa.column("total_file_upload_size_gb", sa.Integer),
        sa.column("allow_custom_backends", sa.Boolean),
        sa.column("created_date", sa.DateTime),
        sa.column("updated_date", sa.DateTime),
    )


def _trial_bundle_uuid():
    data_bundle = _data_bundle_table()
    query = sa.select(data_bundle.c.uuid).where(
        data_bundle.c.bundle_name == TRIAL_BUNDLE
    )
    return op.get_bind().execute(query).scalar_one_or_none()


def upgrade():
    for table in REMOVED_TABLES:
        if _has_table(table):
            op.drop_table(table)

    _rename_invite_table()

    for table, old_name, new_name, type_, nullable in RENAMED_COLUMNS:
        columns = _columns(table)
        if old_name in columns and new_name not in columns:
            with op.batch_alter_table(table, schema=None) as batch_op:
                batch_op.alter_column(
                    old_name,
                    new_column_name=new_name,
                    existing_type=type_,
                    existing_nullable=nullable,
                )

    if USER_STRIPE_INDEX in _index_names("user"):
        with op.batch_alter_table("user", schema=None) as batch_op:
            batch_op.drop_index(USER_STRIPE_INDEX)

    for table, removed in _removed_columns().items():
        columns = _columns(table)
        with op.batch_alter_table(table, schema=None) as batch_op:
            for column in removed:
                if column.name in columns:
                    batch_op.drop_column(column.name)

    _remove_trial_bundle()


def _rename_invite_table():
    if _has_table(OLD_INVITE_TABLE) and not _has_table(INVITE_TABLE):
        op.rename_table(OLD_INVITE_TABLE, INVITE_TABLE)

    _drop_invite_keys(INVITE_TABLE, named_after=OLD_INVITE_TABLE)
    columns = _columns(INVITE_TABLE)
    with op.batch_alter_table(INVITE_TABLE, schema=None) as batch_op:
        for column in INVITE_SHARE_COLUMNS:
            if column in columns:
                batch_op.drop_column(column)
        if not columns["inviting_user_uuid"]["nullable"]:
            batch_op.alter_column(
                "inviting_user_uuid",
                existing_type=sqlalchemy_utils.types.uuid.UUIDType(),
                nullable=True,
            )
    _create_invite_keys(INVITE_TABLE)


def _drop_invite_keys(table: str, named_after: str):
    foreign_keys, (index, _) = _invite_keys(named_after)
    names = [name for name, _, _, _ in foreign_keys]
    existing_foreign_keys = _foreign_key_names(table)
    existing_indexes = _index_names(table)
    with op.batch_alter_table(table, schema=None) as batch_op:
        for name in names:
            if name in existing_foreign_keys:
                batch_op.drop_constraint(name, type_="foreignkey")
        for name in [*names, index]:
            if name in existing_indexes:
                batch_op.drop_index(name)


def _create_invite_keys(table: str):
    foreign_keys, (index, indexed_column) = _invite_keys(table)
    existing_foreign_keys = _foreign_key_names(table)
    existing_indexes = _index_names(table)
    with op.batch_alter_table(table, schema=None) as batch_op:
        for name, column, referred_table, ondelete in foreign_keys:
            if name not in existing_foreign_keys:
                batch_op.create_foreign_key(
                    op.f(name), referred_table, [column], ["uuid"], ondelete=ondelete
                )
        if index not in existing_indexes:
            batch_op.create_index(batch_op.f(index), [indexed_column], unique=False)


def _remove_trial_bundle():
    trial_uuid = _trial_bundle_uuid()
    if trial_uuid is None:
        return

    for table in ("entitlement", "entity_entitlement"):
        entitlement = sa.table(
            table, sa.column("data_bundle_uuid", sqlalchemy_utils.types.uuid.UUIDType())
        )
        op.execute(
            entitlement.update()
            .where(entitlement.c.data_bundle_uuid == trial_uuid)
            .values(data_bundle_uuid=None)
        )
    data_bundle = _data_bundle_table()
    op.execute(data_bundle.delete().where(data_bundle.c.uuid == trial_uuid))


def downgrade():
    if _has_table(INVITE_TABLE):
        invite = sa.table(
            INVITE_TABLE,
            sa.column("inviting_user_uuid", sqlalchemy_utils.types.uuid.UUIDType()),
        )
        without_inviter = op.get_bind().execute(
            sa.select(sa.func.count())
            .select_from(invite)
            .where(invite.c.inviting_user_uuid.is_(None))
        )
        if without_inviter.scalar():
            raise RuntimeError(
                f"{INVITE_TABLE} has rows without inviting_user_uuid, which "
                f"{OLD_INVITE_TABLE} requires. Set or delete them, then downgrade again."
            )

    _restore_trial_bundle()

    for table, removed in _removed_columns().items():
        columns = _columns(table)
        with op.batch_alter_table(table, schema=None) as batch_op:
            for column in removed:
                if column.name not in columns:
                    batch_op.add_column(column)

    if USER_STRIPE_INDEX not in _index_names("user"):
        with op.batch_alter_table("user", schema=None) as batch_op:
            batch_op.create_index(
                batch_op.f(USER_STRIPE_INDEX), ["stripe_id"], unique=False
            )

    for table, old_name, new_name, type_, nullable in reversed(RENAMED_COLUMNS):
        columns = _columns(table)
        if new_name in columns and old_name not in columns:
            with op.batch_alter_table(table, schema=None) as batch_op:
                batch_op.alter_column(
                    new_name,
                    new_column_name=old_name,
                    existing_type=type_,
                    existing_nullable=nullable,
                )

    _restore_invite_table()
    _restore_removed_tables()


def _restore_trial_bundle():
    if _trial_bundle_uuid() is not None:
        return

    now = datetime.now(UTC).replace(tzinfo=None)
    op.bulk_insert(
        _data_bundle_table(),
        [
            {
                "uuid": uuid4(),
                "bundle_name": TRIAL_BUNDLE,
                "except_widgets": [],
                "except_dashboard_templates": [],
                "except_team_collaboration": [],
                "data_export": True,
                "providers": None,
                "dashboards_at_launch": [],
                "my_dashboards": [],
                "invite_your_colleagues": False,
                "number_copilot_calls_day": 100,
                "total_file_upload_size_gb": 100,
                "allow_custom_backends": True,
                "created_date": now,
                "updated_date": now,
            }
        ],
    )


def _restore_invite_table():
    if _has_table(INVITE_TABLE) and not _has_table(OLD_INVITE_TABLE):
        _drop_invite_keys(INVITE_TABLE, named_after=INVITE_TABLE)
        columns = _columns(INVITE_TABLE)
        with op.batch_alter_table(INVITE_TABLE, schema=None) as batch_op:
            for column in INVITE_SHARE_COLUMNS:
                if column not in columns:
                    batch_op.add_column(
                        sa.Column(
                            column, api.models.model_helpers.JSONType(), nullable=True
                        )
                    )
            if columns["inviting_user_uuid"]["nullable"]:
                batch_op.alter_column(
                    "inviting_user_uuid",
                    existing_type=sqlalchemy_utils.types.uuid.UUIDType(),
                    nullable=False,
                )
        op.rename_table(INVITE_TABLE, OLD_INVITE_TABLE)

    _create_invite_keys(OLD_INVITE_TABLE)


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


def _user_uuid_column() -> sa.Column:
    return sa.Column(
        "user_uuid", sqlalchemy_utils.types.uuid.UUIDType(), nullable=False
    )


def _user_foreign_key(table: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ["user_uuid"], ["user.uuid"], name=op.f(f"fk_{table}_user_uuid_user")
    )


def _restore_removed_tables():
    if not _has_table("copilot_chat_old"):
        op.create_table(
            "copilot_chat_old",
            _user_uuid_column(),
            sa.Column(
                "content", api.models.model_helpers.GzipJsonLongType(), nullable=True
            ),
            *_base_columns(),
            _user_foreign_key("copilot_chat_old"),
            sa.PrimaryKeyConstraint("uuid"),
        )
        with op.batch_alter_table("copilot_chat_old", schema=None) as batch_op:
            batch_op.create_index(
                batch_op.f("ix_copilot_chat_old_user_uuid"), ["user_uuid"], unique=False
            )

    if not _has_table("copilot_chats"):
        op.create_table(
            "copilot_chats",
            _user_uuid_column(),
            sa.Column("chats", api.models.model_helpers.GzipJsonType(), nullable=True),
            *_base_columns(),
            _user_foreign_key("copilot_chats"),
            sa.PrimaryKeyConstraint("uuid"),
            sa.UniqueConstraint("user_uuid"),
        )

    if not _has_table("developer_onboarding"):
        op.create_table(
            "developer_onboarding",
            _user_uuid_column(),
            sa.Column("primary_usage", sa.Text(), nullable=True),
            sa.Column("organization", sa.Text(), nullable=True),
            sa.Column("organization_name", sa.Text(), nullable=True),
            sa.Column("role", sa.Text(), nullable=True),
            sa.Column("programming_experience", sa.Text(), nullable=True),
            sa.Column("data_types", api.models.model_helpers.JSONType(), nullable=True),
            sa.Column("other_data_types", sa.Text(), nullable=True),
            sa.Column("skip_onboarding", sa.Boolean(), nullable=False),
            *_base_columns(),
            _user_foreign_key("developer_onboarding"),
            sa.PrimaryKeyConstraint("uuid"),
        )
        with op.batch_alter_table("developer_onboarding", schema=None) as batch_op:
            batch_op.create_index(
                batch_op.f("ix_developer_onboarding_user_uuid"),
                ["user_uuid"],
                unique=False,
            )

    if not _has_table("enabled_widget_bundles"):
        op.create_table(
            "enabled_widget_bundles",
            _user_uuid_column(),
            sa.Column(
                "enabled_bundles",
                sqlalchemy_utils.types.scalar_list.ScalarListType(),
                nullable=False,
            ),
            sa.Column(
                "disabled_widgets",
                sqlalchemy_utils.types.scalar_list.ScalarListType(),
                nullable=True,
            ),
            *_base_columns(),
            _user_foreign_key("enabled_widget_bundles"),
            sa.PrimaryKeyConstraint("uuid"),
            sa.UniqueConstraint("user_uuid"),
        )

    if not _has_table("feedback"):
        op.create_table(
            "feedback",
            sa.Column("text", sa.Text(), nullable=False),
            sa.Column("emoji", sa.Integer(), nullable=False),
            sa.Column("url", sa.Text(), nullable=False),
            sa.Column("email", sa.Text(), nullable=True),
            *_base_columns(),
            sa.PrimaryKeyConstraint("uuid"),
        )

    if not _has_table("permissions_invite"):
        op.create_table(
            "permissions_invite",
            _user_uuid_column(),
            sa.Column(
                "permissions_uuid",
                sqlalchemy_utils.types.uuid.UUIDType(),
                nullable=False,
            ),
            sa.Column("revoked", sa.Boolean(), nullable=False),
            sa.Column("accepted", sa.Boolean(), nullable=False),
            sa.Column(
                "expiration_date",
                api.models.model_helpers.AwareDateTime(),
                nullable=False,
            ),
            sa.Column(
                "shared_dashboards", api.models.model_helpers.JSONType(), nullable=True
            ),
            sa.Column(
                "shared_apps", api.models.model_helpers.JSONType(), nullable=True
            ),
            *_base_columns(),
            sa.ForeignKeyConstraint(
                ["permissions_uuid"],
                ["permissions_entity_map.uuid"],
                name=op.f(
                    "fk_permissions_invite_permissions_uuid_permissions_entity_map"
                ),
                ondelete="CASCADE",
            ),
            _user_foreign_key("permissions_invite"),
            sa.PrimaryKeyConstraint("uuid"),
        )
        with op.batch_alter_table("permissions_invite", schema=None) as batch_op:
            batch_op.create_index(
                batch_op.f("ix_permissions_invite_permissions_uuid"),
                ["permissions_uuid"],
                unique=False,
            )
            batch_op.create_index(
                batch_op.f("ix_permissions_invite_user_uuid"),
                ["user_uuid"],
                unique=False,
            )

    if not _has_table("single_widget"):
        op.create_table(
            "single_widget",
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("endpoint", sa.Text(), nullable=False),
            sa.Column("name", sa.Text(), nullable=False),
            _user_uuid_column(),
            sa.Column("grid_data", api.models.model_helpers.JSONType(), nullable=True),
            sa.Column("data", api.models.model_helpers.JSONType(), nullable=True),
            sa.Column(
                "endpoint_headers", api.models.model_helpers.JSONType(), nullable=True
            ),
            sa.Column(
                "source",
                sqlalchemy_utils.types.scalar_list.ScalarListType(),
                nullable=True,
            ),
            sa.Column("category", sa.Text(), nullable=True),
            sa.Column("sub_category", sa.Text(), nullable=True),
            sa.Column("data_key", sa.Text(), nullable=True),
            *_base_columns(),
            _user_foreign_key("single_widget"),
            sa.PrimaryKeyConstraint("uuid"),
        )
        with op.batch_alter_table("single_widget", schema=None) as batch_op:
            batch_op.create_index(
                batch_op.f("ix_single_widget_user_uuid"), ["user_uuid"], unique=False
            )

    if not _has_table("stripe_event"):
        op.create_table(
            "stripe_event",
            sa.Column("event_id", sa.String(length=255), nullable=False),
            sa.Column("type", sa.String(length=100), nullable=False),
            sa.Column("livemode", sa.Boolean(), nullable=False),
            sa.Column("uuid", sqlalchemy_utils.types.uuid.UUIDType(), nullable=False),
            sa.Column("created_date", sa.DateTime(), nullable=True),
            sa.Column("updated_date", sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint("uuid"),
            sa.UniqueConstraint("event_id", name="uq_stripe_event_event_id"),
        )

    if not _has_table("trading_view"):
        op.create_table(
            "trading_view",
            _user_uuid_column(),
            sa.Column(
                "charts_state", api.models.model_helpers.GzipJsonType(), nullable=False
            ),
            sa.Column(
                "settings", api.models.model_helpers.GzipJsonType(), nullable=False
            ),
            *_base_columns(),
            _user_foreign_key("trading_view"),
            sa.PrimaryKeyConstraint("uuid"),
            sa.UniqueConstraint("user_uuid"),
        )
