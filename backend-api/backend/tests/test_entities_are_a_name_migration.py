import os
import subprocess
import sys
from uuid import uuid4

import pytest
import sqlalchemy as sa
import sqlalchemy_utils

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BEFORE = "b18373ba8216"
REVISION = "4871959e3457"
GONE = {"entity_type_uuid", "email", "company_type", "organization_size", "aum", "country"}

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
    sa.column("email", sa.String),
    sa.column("company_type", sa.String),
    sa.column("organization_size", sa.String),
    sa.column("aum", sa.BigInteger),
    sa.column("country", sa.String),
    sa.column("require_authenticator", sa.Boolean),
    sa.column("sharing_enabled", sa.Boolean),
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
    result = subprocess.run(  # noqa: S603
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
    db_path = str(tmp_path / "entities_are_a_name.db")
    _alembic(db_path, "upgrade", BEFORE)
    engine = sa.create_engine(f"sqlite:///{db_path}")
    yield db_path, engine
    engine.dispose()


def _seed(engine: sa.Engine) -> dict:
    type_uuid, first, second = uuid4(), uuid4(), uuid4()
    with engine.begin() as conn:
        conn.execute(
            entity_type.insert().values(
                uuid=type_uuid, entity_type="Fund", code="FND", permission_hierarchy=2,
                active=True,
            )
        )
        conn.execute(
            entity.insert(),
            [
                {"uuid": uuid, "name": name, "entity_type_uuid": type_uuid,
                 "email": f"{name}@example.com", "company_type": "Fund",
                 "organization_size": "Small", "aum": 5, "country": "USA",
                 "require_authenticator": authenticator, "sharing_enabled": sharing}
                for uuid, name, authenticator, sharing in (
                    (first, "first", True, False),
                    (second, "second", False, True),
                )
            ],
        )
    return {"first": first, "second": second}


def _entities(engine: sa.Engine) -> dict:
    with engine.connect() as conn:
        rows = conn.execute(
            sa.text("SELECT name, require_authenticator, sharing_enabled FROM entity")
        )
        return {row.name: (bool(row.require_authenticator), bool(row.sharing_enabled))
                for row in rows}


def test_the_details_and_the_types_go_and_the_entities_stay(database):
    db_path, engine = database
    _seed(engine)

    _alembic(db_path, "upgrade", REVISION)

    inspector = sa.inspect(engine)
    columns = {column["name"] for column in inspector.get_columns("entity")}
    assert not columns & GONE
    assert {"uuid", "name", "require_authenticator", "sharing_enabled"} <= columns
    assert not inspector.has_table("entity_type")
    assert _entities(engine) == {"first": (True, False), "second": (False, True)}


def test_running_it_again_changes_nothing(database):
    db_path, engine = database
    _seed(engine)
    _alembic(db_path, "upgrade", REVISION)

    _alembic(db_path, "downgrade", BEFORE)
    _alembic(db_path, "upgrade", REVISION)

    assert not sa.inspect(engine).has_table("entity_type")
    assert _entities(engine) == {"first": (True, False), "second": (False, True)}
