import os
import subprocess
import sys
from uuid import uuid4

import pytest
import sqlalchemy as sa
import sqlalchemy_utils

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BEFORE = "c4d8a7e19f26"
REVISION = "e5a9d3b7c104"

UUID = sqlalchemy_utils.types.uuid.UUIDType()

entity = sa.table(
    "entity",
    sa.column("uuid", UUID),
    sa.column("name", sa.String),
    sa.column("require_authenticator", sa.Boolean),
    sa.column("sharing_enabled", sa.Boolean),
)
entity_relationship = sa.table(
    "entity_relationship",
    sa.column("uuid", UUID),
    sa.column("parent_uuid", UUID),
    sa.column("child_uuid", UUID),
    sa.column("supreme_uuid", UUID),
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
    db_path = str(tmp_path / "drop_entity_relationship.db")
    _alembic(db_path, "upgrade", BEFORE)
    engine = sa.create_engine(f"sqlite:///{db_path}")
    yield db_path, engine
    engine.dispose()


def _seed(engine: sa.Engine) -> None:
    parent, child = uuid4(), uuid4()
    with engine.begin() as conn:
        conn.execute(
            entity.insert(),
            [
                {"uuid": parent, "name": "parent", "require_authenticator": True,
                 "sharing_enabled": False},
                {"uuid": child, "name": "child", "require_authenticator": False,
                 "sharing_enabled": True},
            ],
        )
        conn.execute(
            entity_relationship.insert().values(
                uuid=uuid4(), parent_uuid=parent, child_uuid=child, supreme_uuid=parent
            )
        )


def _entities(engine: sa.Engine) -> dict:
    with engine.connect() as conn:
        rows = conn.execute(
            sa.text("SELECT name, require_authenticator, sharing_enabled FROM entity")
        )
        return {row.name: (bool(row.require_authenticator), bool(row.sharing_enabled))
                for row in rows}


def test_the_relationships_go_and_the_entities_stay(database):
    db_path, engine = database
    _seed(engine)
    assert sa.inspect(engine).has_table("entity_relationship")

    _alembic(db_path, "upgrade", REVISION)

    assert not sa.inspect(engine).has_table("entity_relationship")
    assert _entities(engine) == {"parent": (True, False), "child": (False, True)}


def test_running_it_again_changes_nothing(database):
    db_path, engine = database
    _seed(engine)
    _alembic(db_path, "upgrade", REVISION)

    _alembic(db_path, "downgrade", BEFORE)
    _alembic(db_path, "upgrade", REVISION)

    assert not sa.inspect(engine).has_table("entity_relationship")
    assert _entities(engine) == {"parent": (True, False), "child": (False, True)}
