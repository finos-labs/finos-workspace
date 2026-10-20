"""give every organization its default roles

Every organization starts with two roles (DEFAULT_ROLES in routers/app/helpers.py, which a
new organization gets when it is created):

- Agent User: the default agent with every model it offers (a `*` model grant), every tool of
  the deployment's default MCP servers (DEFAULT_MCP_SERVERS), no daily limits. Every new user
  of the organization gets it.
- Sharer: sharing, and nothing else (its limits are 0 and its web tools off, so it lifts no
  limit and switches no tool on).

An organization made before them has neither, so nobody in it may use the agent until an
admin makes a role. This revision gives each organization the ones it lacks (a role of that
name it has already is kept as it is), and gives the superusers of an organization both, and
its users who have no role at all Agent User, as a new user would get it. Users with a role
keep exactly what an admin gave them. The cached usage of those it gives a role is dropped,
so that the API reads their new limits.

downgrade() takes nothing away: the roles are ordinary roles by now, which an admin may have
changed or given to others.

Revision ID: b18373ba8216
Revises: 8615f7e17679
Create Date: 2026-10-20

"""

import logging
from datetime import UTC, datetime
from uuid import uuid4

import sqlalchemy as sa
import sqlalchemy_utils

from alembic import op  # type: ignore
from api.schemas import normalize_mcp_url
from utilities.config import settings

# revision identifiers, used by Alembic.
revision = "b18373ba8216"
down_revision = "8615f7e17679"
branch_labels = None
depends_on = None

UUID = sqlalchemy_utils.types.uuid.UUIDType()

log = logging.getLogger("alembic.runtime.migration")

AGENT_USER = "Agent User"
SHARER = "Sharer"
# The id the default agent gives itself in its agents.json
DEFAULT_AGENT_ID = "default_agent"
ALL = "*"

# As routers/app/helpers.py's DEFAULT_ROLES had them when this revision was written
ROLES = {
    AGENT_USER: {
        "description": "The agent, with every model it offers and the deployment's own tools, "
        "with no daily limits. New users get this role.",
        "sharing": "none",
        "copilot_calls_day": None,
        "copilot_tokens_day": None,
        "upload_size_gb": None,
        "search_web": True,
        "fetch_from_web": True,
    },
    SHARER: {
        "description": "Shares dashboards and apps with others; nothing else.",
        "sharing": "share",
        "copilot_calls_day": 0,
        "copilot_tokens_day": 0,
        "upload_size_gb": 0,
        "search_web": False,
        "fetch_from_web": False,
    },
}


def _dated() -> tuple:
    """The dates of a row, as columns of their own for each table."""
    return (sa.column("created_date", sa.DateTime), sa.column("updated_date", sa.DateTime))


entity = sa.table("entity", sa.column("uuid", UUID))
permissions_map = sa.table(
    "permissions_entity_map", sa.column("uuid", UUID), sa.column("entity_uuid", UUID)
)
user = sa.table(
    "user",
    sa.column("uuid", UUID),
    sa.column("permissions_uuid", UUID),
    sa.column("is_superuser", sa.Boolean),
    sa.column("deleted", sa.Boolean),
)
role = sa.table(
    "role",
    sa.column("uuid", UUID),
    sa.column("name", sa.String),
    sa.column("description", sa.Text),
    sa.column("entity_uuid", UUID),
    sa.column("sharing", sa.String),
    sa.column("copilot_calls_day", sa.Integer),
    sa.column("copilot_tokens_day", sa.BigInteger),
    sa.column("upload_size_gb", sa.Integer),
    sa.column("search_web", sa.Boolean),
    sa.column("fetch_from_web", sa.Boolean),
    sa.column("deleted_at", sa.DateTime),
    *_dated(),
)
user_role = sa.table(
    "user_role",
    sa.column("uuid", UUID),
    sa.column("user_uuid", UUID),
    sa.column("role_uuid", UUID),
    *_dated(),
)
role_copilot_model = sa.table(
    "role_copilot_model",
    sa.column("uuid", UUID),
    sa.column("role_uuid", UUID),
    sa.column("agent_id", sa.String),
    sa.column("model_id", sa.String),
    *_dated(),
)
role_mcp_access = sa.table(
    "role_mcp_access",
    sa.column("uuid", UUID),
    sa.column("role_uuid", UUID),
    sa.column("server_url", sa.String),
    sa.column("tool_name", sa.String),
    *_dated(),
)


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _members(bind: sa.Connection, entity_uuid) -> list[tuple]:
    """The organization's users that are not deleted: (uuid, is_superuser)."""
    return [
        tuple(row)
        for row in bind.execute(
            sa.select(user.c.uuid, user.c.is_superuser)
            .join(permissions_map, permissions_map.c.uuid == user.c.permissions_uuid)
            .where(
                permissions_map.c.entity_uuid == entity_uuid,
                sa.or_(user.c.deleted.is_(None), user.c.deleted == sa.false()),
            )
        )
    ]


def _with_a_role(bind: sa.Connection, user_uuids: list) -> set:
    """Those of the users who have a role that is not deleted."""
    if not user_uuids:
        return set()
    return set(
        bind.execute(
            sa.select(user_role.c.user_uuid)
            .join(role, role.c.uuid == user_role.c.role_uuid)
            .where(user_role.c.user_uuid.in_(user_uuids), role.c.deleted_at.is_(None))
        ).scalars()
    )


def _roles(bind: sa.Connection, entity_uuid) -> dict:
    """The organization's default roles that are not deleted, by name."""
    return {
        name: uuid
        for name, uuid in bind.execute(
            sa.select(role.c.name, role.c.uuid).where(
                role.c.entity_uuid == entity_uuid,
                role.c.name.in_(list(ROLES)),
                role.c.deleted_at.is_(None),
            )
        )
    }


def _create(bind: sa.Connection, entity_uuid, name: str):
    role_uuid = uuid4()
    now = _now()
    bind.execute(
        role.insert().values(
            uuid=role_uuid,
            name=name,
            entity_uuid=entity_uuid,
            created_date=now,
            updated_date=now,
            **ROLES[name],
        )
    )
    if name == AGENT_USER:
        bind.execute(
            role_copilot_model.insert().values(
                uuid=uuid4(),
                role_uuid=role_uuid,
                agent_id=DEFAULT_AGENT_ID,
                model_id=ALL,
                created_date=now,
                updated_date=now,
            )
        )
        for server_url in sorted({normalize_mcp_url(s.url) for s in settings.DEFAULT_MCP_SERVERS}):
            bind.execute(
                role_mcp_access.insert().values(
                    uuid=uuid4(),
                    role_uuid=role_uuid,
                    server_url=server_url,
                    tool_name=ALL,
                    created_date=now,
                    updated_date=now,
                )
            )
    return role_uuid


def _give(bind: sa.Connection, user_uuid, role_uuid) -> bool:
    """Gives the user the role unless they have it; whether it was given."""
    held = bind.execute(
        sa.select(user_role.c.uuid).where(
            user_role.c.user_uuid == user_uuid, user_role.c.role_uuid == role_uuid
        )
    ).first()
    if held is None:
        now = _now()
        bind.execute(
            user_role.insert().values(
                uuid=uuid4(),
                user_uuid=user_uuid,
                role_uuid=role_uuid,
                created_date=now,
                updated_date=now,
            )
        )
    return held is None


def _forget_usage(user_uuids: set) -> None:
    """Drops the cached usage of these users (the API's `usage:<user>` keys), which holds the
    limits of their roles as they were."""
    try:
        for user_uuid in user_uuids:
            settings.redis_cache(f"usage:{user_uuid}", delete=True)
    except Exception as exc:  # noqa: BLE001 - Redis is not always there (a SQLite stack)
        log.warning("Could not drop the cached usage of %d users: %s", len(user_uuids), exc)


def upgrade():
    bind = op.get_bind()
    given: set = set()
    for entity_uuid in list(bind.execute(sa.select(entity.c.uuid)).scalars()):
        members = _members(bind, entity_uuid)
        # Who has no role at all, before the organization has its default ones
        with_a_role = _with_a_role(bind, [uuid for uuid, _ in members])

        roles = _roles(bind, entity_uuid)
        for name in ROLES:
            if name not in roles:
                roles[name] = _create(bind, entity_uuid, name)

        for user_uuid, is_superuser in members:
            if is_superuser:
                for role_uuid in roles.values():
                    if _give(bind, user_uuid, role_uuid):
                        given.add(user_uuid)
            elif user_uuid not in with_a_role and _give(bind, user_uuid, roles[AGENT_USER]):
                given.add(user_uuid)

    _forget_usage(given)


def downgrade():
    """Nothing: see the note above."""
