"""The roles migration (revision 4f1c8a2d9e63) on the Copilot's web tools.

Before it, an organization's entitlement switched SEARCH_WEB and FETCH_FROM_WEB off for its
users; after it, they are settings of a role. A role keeps off what its organization had off.

As in test_secrets_migration, alembic runs in a subprocess against a SQLite file: the database
is brought to the revision before, filled, upgraded, checked, and downgraded.
"""

import os
import subprocess
import sys
from uuid import uuid4

import pytest
import sqlalchemy as sa
import sqlalchemy_utils

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BEFORE = "b6dd1da576b6"
REVISION = "4f1c8a2d9e63"
# The head before develop was merged in, which a database that ran this branch is at
BRANCH_HEAD = "8b5e2d7c1f40"
FULL_TIER_ID = 1

UUID = sqlalchemy_utils.types.uuid.UUIDType()


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
    db_path = str(tmp_path / "roles.db")
    _alembic(db_path, "upgrade", BEFORE)
    engine = sa.create_engine(f"sqlite:///{db_path}")
    yield db_path, engine
    engine.dispose()


def _seed(engine: sa.Engine) -> dict[str, object]:
    """Three organizations, each with a role: one whose entitlement has web search off, one
    with reading pages off, and one without an entitlement."""
    entity = sa.table(
        "entity",
        sa.column("uuid", UUID),
        sa.column("entity_type_uuid", UUID),
        sa.column("require_authenticator", sa.Boolean),
    )
    role = sa.table(
        "role",
        sa.column("uuid", UUID),
        sa.column("name", sa.String),
        sa.column("description", sa.Text),
        sa.column("entity_uuid", UUID),
    )
    entitlement = sa.table(
        "entity_entitlement",
        sa.column("uuid", UUID),
        sa.column("entity_uuid", UUID),
        sa.column("tier_id", sa.Integer),
        sa.column("search_web", sa.Boolean),
        sa.column("fetch_from_web", sa.Boolean),
    )
    entities = {name: uuid4() for name in ("no_search", "no_fetch", "plain")}
    roles = {name: uuid4() for name in entities}
    with engine.begin() as conn:
        conn.execute(
            entity.insert(),
            [
                {"uuid": uuid, "entity_type_uuid": uuid4(), "require_authenticator": False}
                for uuid in entities.values()
            ],
        )
        conn.execute(
            role.insert(),
            [
                {"uuid": roles[name], "name": name, "description": "", "entity_uuid": uuid}
                for name, uuid in entities.items()
            ],
        )
        conn.execute(
            entitlement.insert(),
            [
                {
                    "uuid": uuid4(),
                    "entity_uuid": entities["no_search"],
                    "tier_id": FULL_TIER_ID,
                    "search_web": False,
                    "fetch_from_web": True,
                },
                {
                    "uuid": uuid4(),
                    "entity_uuid": entities["no_fetch"],
                    "tier_id": FULL_TIER_ID,
                    "search_web": None,
                    "fetch_from_web": False,
                },
            ],
        )
    return roles


def _web_switches(engine: sa.Engine, role_uuid) -> tuple[bool, bool]:
    role = sa.table(
        "role",
        sa.column("uuid", UUID),
        sa.column("search_web", sa.Boolean),
        sa.column("fetch_from_web", sa.Boolean),
    )
    with engine.connect() as conn:
        row = conn.execute(
            sa.select(role.c.search_web, role.c.fetch_from_web).where(role.c.uuid == role_uuid)
        ).one()
    return row.search_web, row.fetch_from_web


def test_a_role_keeps_off_what_its_organization_had_off(database):
    db_path, engine = database
    roles = _seed(engine)

    _alembic(db_path, "upgrade", REVISION)

    assert _web_switches(engine, roles["no_search"]) == (False, True)
    # A switch that was never set was on
    assert _web_switches(engine, roles["no_fetch"]) == (True, False)
    assert _web_switches(engine, roles["plain"]) == (True, True)


def test_a_new_role_has_both_on(database):
    db_path, engine = database
    _alembic(db_path, "upgrade", REVISION)
    role = sa.table(
        "role",
        sa.column("uuid", UUID),
        sa.column("name", sa.String),
        sa.column("description", sa.Text),
        sa.column("entity_uuid", UUID),
    )
    role_uuid = uuid4()
    with engine.begin() as conn:
        conn.execute(
            role.insert().values(uuid=role_uuid, name="New", description="", entity_uuid=uuid4())
        )
    assert _web_switches(engine, role_uuid) == (True, True)


def test_downgrade_gives_the_switches_back_to_the_entitlement_tables(database):
    db_path, engine = database
    _seed(engine)
    _alembic(db_path, "upgrade", REVISION)

    _alembic(db_path, "downgrade", BEFORE)

    inspector = sa.inspect(engine)
    assert not {"search_web", "fetch_from_web"} & {
        column["name"] for column in inspector.get_columns("role")
    }
    for table in ("default_tier", "entity_entitlement", "entitlement"):
        assert {"search_web", "fetch_from_web"} <= {
            column["name"] for column in inspector.get_columns(table)
        }


def test_a_database_from_before_the_merge_gets_the_switches_and_loses_the_marketplace(tmp_path):
    """A database that reached 8b5e2d7c1f40 before develop's revisions were under 4f1c8a2d9e63
    has neither web switch on its roles and still has what the marketplace left (revision
    1ded5470241f)."""
    db_path = str(tmp_path / "branch.db")
    _alembic(db_path, "upgrade", BRANCH_HEAD)
    engine = sa.create_engine(f"sqlite:///{db_path}")
    with engine.begin() as conn:
        conn.execute(sa.text("ALTER TABLE role DROP COLUMN search_web"))
        conn.execute(sa.text("ALTER TABLE role DROP COLUMN fetch_from_web"))
        # As the earlier 0001 made them: api_source.vendor_app_uuid has an index and points at vendor_app
        conn.execute(sa.text("CREATE TABLE vendor (uuid CHAR(32) PRIMARY KEY)"))
        conn.execute(
            sa.text(
                "CREATE TABLE vendor_app (uuid CHAR(32) PRIMARY KEY, vendor_uuid CHAR(32) REFERENCES vendor (uuid))"
            )
        )
        conn.execute(
            sa.text("ALTER TABLE api_source ADD COLUMN vendor_app_uuid CHAR(32) REFERENCES vendor_app (uuid)")
        )
        conn.execute(sa.text("CREATE INDEX ix_api_source_vendor_app_uuid ON api_source (vendor_app_uuid)"))
        conn.execute(
            sa.text("ALTER TABLE user ADD COLUMN can_submit_marketplace BOOLEAN DEFAULT 0 NOT NULL")
        )

    _alembic(db_path, "upgrade", "head")

    inspector = sa.inspect(engine)
    assert {"search_web", "fetch_from_web"} <= {column["name"] for column in inspector.get_columns("role")}
    assert not inspector.has_table("vendor")
    assert not inspector.has_table("vendor_app")
    assert "vendor_app_uuid" not in {column["name"] for column in inspector.get_columns("api_source")}
    assert "can_submit_marketplace" not in {column["name"] for column in inspector.get_columns("user")}
    engine.dispose()


def test_a_database_that_ran_this_branch_loses_the_excel_add_ins_role_switch(tmp_path):
    """A database that reached 4f1c8a2d9e63 while it still added role.excel_add_in has the
    column; revision f11377401858 drops it."""
    db_path = str(tmp_path / "excel.db")
    _alembic(db_path, "upgrade", "1ded5470241f")
    engine = sa.create_engine(f"sqlite:///{db_path}")
    with engine.begin() as conn:
        conn.execute(
            sa.text("ALTER TABLE role ADD COLUMN excel_add_in BOOLEAN DEFAULT 0 NOT NULL")
        )

    _alembic(db_path, "upgrade", "head")

    columns = {column["name"] for column in sa.inspect(engine).get_columns("role")}
    assert "excel_add_in" not in columns
    assert {"search_web", "fetch_from_web"} <= columns
    engine.dispose()
