"""drop the Developer organization and the On-Premise entity type

Developer is a user type: the "Developer" permissions map that every organization has. The
API used to make an organization of that name at every start (entity type "Default", code
DEF), a bucket for the users of a hosted sign-up; nothing makes it any more. And init named
the first organization's entity type "On-Premise", after a deployment mode that is gone.

This revision deletes the Developer organization where nothing is in it or refers to it: no
user in its maps, and no role, relationship, dashboard, backend, file share, theme or audit
entry of it. Its maps go with it, and the invites made for them lose their map, as the key
would have it. The entity type it had goes too when no organization has it any more. A
Developer organization that something still refers to is left as it is. Entity types named
"On-Premise" are renamed "Default".

Everything asks the database first, so on a database made by the current code this changes
nothing, and running it again is safe. downgrade() does not bring them back: nothing reads
them.

Revision ID: 8615f7e17679
Revises: f11377401858
Create Date: 2026-10-20

"""

import sqlalchemy as sa
import sqlalchemy_utils

from alembic import op  # type: ignore

# revision identifiers, used by Alembic.
revision = "8615f7e17679"
down_revision = "f11377401858"
branch_labels = None
depends_on = None

UUID = sqlalchemy_utils.types.uuid.UUIDType()

DEVELOPER_ORGANIZATION = "Developer"
DEVELOPER_ENTITY_TYPE_CODE = "DEF"
ON_PREMISE = "On-Premise"
DEFAULT = "Default"

# What refers to an organization, besides its own permissions maps
ENTITY_REFERENCES = [
    ("entity_relationship", "parent_uuid"),
    ("entity_relationship", "child_uuid"),
    ("entity_relationship", "supreme_uuid"),
    ("role", "entity_uuid"),
    ("dashboard_item", "entity_uuid"),
    ("api_source", "entity_uuid"),
    ("stored_file_share", "entity_uuid"),
    ("entity_theme_settings", "entity_uuid"),
    ("audit_entity_roles_permissions", "entity_uuid"),
]

entity_type = sa.table(
    "entity_type",
    sa.column("uuid", UUID),
    sa.column("code", sa.String),
    sa.column("entity_type", sa.String),
)
entity = sa.table(
    "entity",
    sa.column("uuid", UUID),
    sa.column("name", sa.String),
    sa.column("entity_type_uuid", UUID),
)
permissions_map = sa.table(
    "permissions_entity_map", sa.column("uuid", UUID), sa.column("entity_uuid", UUID)
)
user = sa.table("user", sa.column("permissions_uuid", UUID))
user_invite = sa.table("user_invite", sa.column("permissions_uuid", UUID))


def _referred(bind: sa.Connection, inspector: sa.Inspector, entity_uuid) -> bool:
    """Whether anything but the organization's own maps refers to it."""
    for table_name, column_name in ENTITY_REFERENCES:
        if not inspector.has_table(table_name):
            continue
        if column_name not in {column["name"] for column in inspector.get_columns(table_name)}:
            continue
        table = sa.table(table_name, sa.column(column_name, UUID))
        column = table.c[column_name]
        if bind.execute(sa.select(column).where(column == entity_uuid).limit(1)).first():
            return True
    return False


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    developer_types = sa.select(entity_type.c.uuid).where(
        entity_type.c.code == DEVELOPER_ENTITY_TYPE_CODE
    )
    organizations = bind.execute(
        sa.select(entity.c.uuid).where(
            entity.c.name == DEVELOPER_ORGANIZATION,
            entity.c.entity_type_uuid.in_(developer_types),
        )
    ).scalars()
    for entity_uuid in list(organizations):
        maps = list(
            bind.execute(
                sa.select(permissions_map.c.uuid).where(
                    permissions_map.c.entity_uuid == entity_uuid
                )
            ).scalars()
        )
        members = (
            bind.execute(
                sa.select(sa.func.count())
                .select_from(user)
                .where(user.c.permissions_uuid.in_(maps))
            ).scalar()
            if maps
            else 0
        )
        if members or _referred(bind, inspector, entity_uuid):
            continue
        if maps:
            bind.execute(
                user_invite.update()
                .where(user_invite.c.permissions_uuid.in_(maps))
                .values(permissions_uuid=None)
            )
            bind.execute(permissions_map.delete().where(permissions_map.c.uuid.in_(maps)))
        bind.execute(entity.delete().where(entity.c.uuid == entity_uuid))

    # The entity type the Developer organization had, once no organization has it
    in_use = sa.exists().where(entity.c.entity_type_uuid == entity_type.c.uuid)
    bind.execute(
        entity_type.delete().where(
            entity_type.c.code == DEVELOPER_ENTITY_TYPE_CODE, ~in_use
        )
    )

    bind.execute(
        entity_type.update()
        .where(entity_type.c.entity_type == ON_PREMISE)
        .values(entity_type=DEFAULT)
    )


def downgrade():
    """Nothing: see the note above."""
