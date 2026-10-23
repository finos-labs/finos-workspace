import os
import subprocess
import sys
from uuid import uuid4

import pytest
import sqlalchemy as sa
import sqlalchemy_utils

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BEFORE = "8615f7e17679"
REVISION = "b18373ba8216"
TOOLS_URL = "http://Tools.example.com:8787/mcp/"

UUID = sqlalchemy_utils.types.uuid.UUIDType()

entity_type = sa.table(
    "entity_type",
    sa.column("uuid", UUID),
    sa.column("entity_type", sa.String),
    sa.column("code", sa.String),
    sa.column("permission_hierarchy", sa.Integer),
    sa.column("active", sa.Boolean),
)
entity = sa.table(
    "entity",
    sa.column("uuid", UUID),
    sa.column("name", sa.String),
    sa.column("entity_type_uuid", UUID),
    sa.column("require_authenticator", sa.Boolean),
)
permissions_map = sa.table(
    "permissions_entity_map",
    sa.column("uuid", UUID),
    sa.column("entity_uuid", UUID),
    sa.column("name", sa.String),
)
user = sa.table(
    "user",
    sa.column("uuid", UUID),
    sa.column("email", sa.String),
    sa.column("clean_email", sa.String),
    sa.column("password", sa.String),
    sa.column("totp_active", sa.Boolean),
    sa.column("two_factor_auth", sa.Boolean),
    sa.column("referral_code", sa.String),
    sa.column("is_superuser", sa.Boolean),
    sa.column("deleted", sa.Boolean),
    sa.column("permissions_uuid", UUID),
)
role = sa.table(
    "role",
    sa.column("uuid", UUID),
    sa.column("name", sa.String),
    sa.column("description", sa.Text),
    sa.column("entity_uuid", UUID),
    sa.column("sharing", sa.String),
    sa.column("copilot_calls_day", sa.Integer),
    sa.column("search_web", sa.Boolean),
)
user_role = sa.table(
    "user_role", sa.column("uuid", UUID), sa.column("user_uuid", UUID), sa.column("role_uuid", UUID)
)
role_copilot_model = sa.table(
    "role_copilot_model",
    sa.column("role_uuid", UUID),
    sa.column("agent_id", sa.String),
    sa.column("model_id", sa.String),
)
role_mcp_access = sa.table(
    "role_mcp_access",
    sa.column("role_uuid", UUID),
    sa.column("server_url", sa.String),
    sa.column("tool_name", sa.String),
)


def _alembic(db_path: str, *args: str) -> None:
    env = {
        **os.environ,
        "MODE": "test",
        "DATABASE_TYPE": "sqlite",
        "DB_PATH": db_path,
        "REDIS_HOST": "127.0.0.1",
        "STORAGE_PROVIDER": "aws",
        "DEFAULT_MCP_SERVERS": f'[{{"id": "tools", "name": "Tools", "url": "{TOOLS_URL}"}}]',
    }
    result = subprocess.run(  # noqa: S603 (the test's own alembic arguments)
        [sys.executable, "-m", "alembic", *args],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    assert result.returncode == 0, f"alembic {args} failed:\n{result.stderr}"


@pytest.fixture
def database(tmp_path):
    db_path = str(tmp_path / "default_roles.db")
    _alembic(db_path, "upgrade", BEFORE)
    engine = sa.create_engine(f"sqlite:///{db_path}")
    yield db_path, engine
    engine.dispose()


def _user(uuid, name: str, map_uuid, *, superuser: bool = False, deleted: bool = False) -> dict:
    return {
        "uuid": uuid,
        "email": f"{name}@mail.test",
        "clean_email": f"{name}@mail.test",
        "password": "x",
        "totp_active": False,
        "two_factor_auth": False,
        "referral_code": name,
        "is_superuser": superuser,
        "deleted": deleted,
        "permissions_uuid": map_uuid,
    }


def _seed(engine: sa.Engine) -> dict:
    ids = {
        name: uuid4()
        for name in (
            "type", "first", "second", "admin_map", "user_map", "second_map",
            "superuser", "roleless", "analyst", "deleted", "second_user",
            "analysts", "their_agent_user",
        )
    }
    with engine.begin() as conn:
        conn.execute(
            entity_type.insert().values(
                uuid=ids["type"], entity_type="Default", code="DEF", permission_hierarchy=2,
                active=True,
            )
        )
        conn.execute(
            entity.insert(),
            [
                {"uuid": ids[name], "name": name, "entity_type_uuid": ids["type"],
                 "require_authenticator": False}
                for name in ("first", "second")
            ],
        )
        conn.execute(
            permissions_map.insert(),
            [
                {"uuid": ids["admin_map"], "entity_uuid": ids["first"], "name": "Admin"},
                {"uuid": ids["user_map"], "entity_uuid": ids["first"], "name": "User"},
                {"uuid": ids["second_map"], "entity_uuid": ids["second"], "name": "User"},
            ],
        )
        conn.execute(
            user.insert(),
            [
                _user(ids["superuser"], "superuser", ids["admin_map"], superuser=True),
                _user(ids["roleless"], "roleless", ids["user_map"]),
                _user(ids["analyst"], "analyst", ids["user_map"]),
                _user(ids["deleted"], "deleted", ids["user_map"], deleted=True),
                _user(ids["second_user"], "second", ids["second_map"]),
            ],
        )
        conn.execute(
            role.insert(),
            [
                {"uuid": ids["analysts"], "name": "Analysts", "description": "",
                 "entity_uuid": ids["first"], "sharing": "receive", "copilot_calls_day": 3,
                 "search_web": True},
                {"uuid": ids["their_agent_user"], "name": "Agent User", "description": "Ours",
                 "entity_uuid": ids["second"], "sharing": "none", "copilot_calls_day": 1,
                 "search_web": False},
            ],
        )
        conn.execute(
            user_role.insert().values(
                uuid=uuid4(), user_uuid=ids["analyst"], role_uuid=ids["analysts"]
            )
        )
    return ids


def _roles(engine: sa.Engine, entity_uuid) -> dict:
    with engine.connect() as conn:
        rows = conn.execute(
            sa.select(role.c.name, role.c.uuid).where(role.c.entity_uuid == entity_uuid)
        )
        return {row.name: row.uuid for row in rows}


def _held(engine: sa.Engine, user_uuid) -> set:
    with engine.connect() as conn:
        return set(
            conn.execute(
                sa.select(user_role.c.role_uuid).where(user_role.c.user_uuid == user_uuid)
            ).scalars()
        )


def test_each_organization_gets_the_roles_it_lacks(database):
    db_path, engine = database
    ids = _seed(engine)

    _alembic(db_path, "upgrade", REVISION)

    first = _roles(engine, ids["first"])
    assert set(first) == {"Analysts", "Agent User", "Sharer"}
    with engine.connect() as conn:
        assert conn.execute(
            sa.select(role_copilot_model.c.agent_id, role_copilot_model.c.model_id).where(
                role_copilot_model.c.role_uuid == first["Agent User"]
            )
        ).all() == [("default_agent", "*")]
        assert conn.execute(
            sa.select(role_mcp_access.c.server_url, role_mcp_access.c.tool_name).where(
                role_mcp_access.c.role_uuid == first["Agent User"]
            )
        ).all() == [("http://tools.example.com:8787/mcp", "*")]
        sharer = conn.execute(
            sa.select(role.c.sharing, role.c.copilot_calls_day, role.c.search_web).where(
                role.c.uuid == first["Sharer"]
            )
        ).one()
    assert tuple(sharer) == ("share", 0, False)

    second = _roles(engine, ids["second"])
    assert set(second) == {"Agent User", "Sharer"}
    assert second["Agent User"] == ids["their_agent_user"]
    with engine.connect() as conn:
        assert conn.execute(
            sa.select(role_copilot_model.c.model_id).where(
                role_copilot_model.c.role_uuid == ids["their_agent_user"]
            )
        ).all() == []


def test_superusers_get_both_and_users_without_a_role_agent_user(database):
    db_path, engine = database
    ids = _seed(engine)

    _alembic(db_path, "upgrade", REVISION)

    first = _roles(engine, ids["first"])
    second = _roles(engine, ids["second"])
    assert _held(engine, ids["superuser"]) == {first["Agent User"], first["Sharer"]}
    assert _held(engine, ids["roleless"]) == {first["Agent User"]}
    assert _held(engine, ids["analyst"]) == {ids["analysts"]}
    assert _held(engine, ids["deleted"]) == set()
    assert _held(engine, ids["second_user"]) == {second["Agent User"]}


def test_running_it_again_changes_nothing(database):
    db_path, engine = database
    ids = _seed(engine)
    _alembic(db_path, "upgrade", REVISION)
    before = {name: _held(engine, ids[name]) for name in ("superuser", "roleless", "analyst")}

    _alembic(db_path, "downgrade", BEFORE)
    _alembic(db_path, "upgrade", REVISION)

    assert set(_roles(engine, ids["first"])) == {"Analysts", "Agent User", "Sharer"}
    assert {name: _held(engine, ids[name]) for name in before} == before
