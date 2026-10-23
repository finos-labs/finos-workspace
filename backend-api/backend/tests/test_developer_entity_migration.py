import os
import subprocess
import sys
from uuid import uuid4

import pytest
import sqlalchemy as sa
import sqlalchemy_utils

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BEFORE = "f11377401858"
REVISION = "8615f7e17679"

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
    sa.column("permissions_uuid", UUID),
)
user_invite = sa.table(
    "user_invite",
    sa.column("uuid", UUID),
    sa.column("email", sa.String),
    sa.column("used", sa.Boolean),
    sa.column("permissions_uuid", UUID),
)


def _alembic(db_path: str, *args: str) -> None:
    env = {
        **os.environ,
        "MODE": "test",
        "DATABASE_TYPE": "sqlite",
        "DB_PATH": db_path,
        "REDIS_HOST": "127.0.0.1",
        "STORAGE_PROVIDER": "aws",
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
    db_path = str(tmp_path / "developer.db")
    _alembic(db_path, "upgrade", BEFORE)
    engine = sa.create_engine(f"sqlite:///{db_path}")
    yield db_path, engine
    engine.dispose()


def _seed(engine: sa.Engine, *, member_in_developer: bool) -> dict[str, object]:
    ids = {
        name: uuid4()
        for name in ("on_premise", "default", "workspace", "developer", "invite", "user")
    }
    maps = {name: uuid4() for name in ("Admin", "Developer", "User")}
    with engine.begin() as conn:
        conn.execute(
            entity_type.insert(),
            [
                {"uuid": ids["on_premise"], "entity_type": "On-Premise", "code": "WOR",
                 "permission_hierarchy": 2, "active": True},
                {"uuid": ids["default"], "entity_type": "Default", "code": "DEF",
                 "permission_hierarchy": 0, "active": True},
            ],
        )
        conn.execute(
            entity.insert(),
            [
                {"uuid": ids["workspace"], "name": "Workspace",
                 "entity_type_uuid": ids["on_premise"], "require_authenticator": False},
                {"uuid": ids["developer"], "name": "Developer",
                 "entity_type_uuid": ids["default"], "require_authenticator": False},
            ],
        )
        conn.execute(
            permissions_map.insert(),
            [
                {"uuid": uuid, "entity_uuid": ids["developer"], "name": name}
                for name, uuid in maps.items()
            ],
        )
        conn.execute(
            user_invite.insert().values(
                uuid=ids["invite"], email="invited@mail.test", used=False,
                permissions_uuid=maps["Developer"],
            )
        )
        if member_in_developer:
            conn.execute(
                user.insert().values(
                    uuid=ids["user"], email="member@mail.test", clean_email="member@mail.test",
                    password="x", totp_active=False, two_factor_auth=False, referral_code="r1",
                    is_superuser=False, permissions_uuid=maps["User"],
                )
            )
    return {**ids, "maps": maps}


def _rows(engine: sa.Engine, table: sa.TableClause, *columns: str) -> list[tuple]:
    with engine.connect() as conn:
        return [tuple(row) for row in conn.execute(sa.select(*(table.c[c] for c in columns)))]


def test_the_developer_organization_goes_and_on_premise_becomes_default(database):
    db_path, engine = database
    ids = _seed(engine, member_in_developer=False)

    _alembic(db_path, "upgrade", REVISION)

    assert _rows(engine, entity, "name") == [("Workspace",)]
    assert _rows(engine, permissions_map, "uuid") == []
    assert _rows(engine, user_invite, "uuid", "permissions_uuid") == [(ids["invite"], None)]
    assert _rows(engine, entity_type, "uuid", "entity_type", "code") == [
        (ids["on_premise"], "Default", "WOR")
    ]


def test_a_developer_organization_with_a_member_is_kept(database):
    db_path, engine = database
    ids = _seed(engine, member_in_developer=True)

    _alembic(db_path, "upgrade", REVISION)

    assert sorted(_rows(engine, entity, "name")) == [("Developer",), ("Workspace",)]
    assert len(_rows(engine, permissions_map, "uuid")) == 3
    assert sorted(_rows(engine, entity_type, "entity_type", "code")) == [
        ("Default", "DEF"),
        ("Default", "WOR"),
    ]
    assert _rows(engine, user_invite, "permissions_uuid") == [(ids["maps"]["Developer"],)]


def test_a_database_without_either_is_left_as_it_is(database):
    db_path, engine = database

    _alembic(db_path, "upgrade", REVISION)

    assert _rows(engine, entity, "name") == []
    assert _rows(engine, entity_type, "entity_type") == []
