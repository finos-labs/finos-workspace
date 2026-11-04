import gzip
import json
from uuid import uuid4

import pytest
import sqlalchemy as sa

from tests.test_secrets_migration import UUID, _alembic

BEFORE = "ff59d563599c"
REVISION = "7002053173be"
SECRET = "sk-data-backend-key"


def _gzip(value) -> bytes:
    return gzip.compress(json.dumps(value).encode("utf-8"))


def _content(name: str) -> dict:
    return {
        "name": name,
        "widgets": [
            {
                "i": "w1",
                "endpoint": {
                    "url": "http://localhost:8001/prices",
                    "method": "GET",
                    "headers": {"X-Api-Key": SECRET},
                    "query": {"apikey": SECRET},
                },
                "endpointHeaders": [{"key": "X-Api-Key", "value": SECRET}],
            }
        ],
    }


@pytest.fixture
def database(tmp_path):
    db_path = str(tmp_path / "sessions.db")
    _alembic(db_path, "upgrade", BEFORE)
    engine = sa.create_engine(f"sqlite:///{db_path}")
    yield db_path, engine
    engine.dispose()


def _tables():
    meta = sa.MetaData()
    user = sa.Table(
        "user",
        meta,
        sa.Column("uuid", UUID),
        sa.Column("email", sa.String),
        sa.Column("clean_email", sa.String),
        sa.Column("password", sa.String),
        sa.Column("referral_code", sa.String),
        sa.Column("is_superuser", sa.Boolean),
        sa.Column("two_factor_auth", sa.Boolean),
        sa.Column("totp_active", sa.Boolean),
    )
    session = sa.Table(
        "session",
        meta,
        sa.Column("uuid", UUID),
        sa.Column("user_uuid", UUID),
        sa.Column("app_session", sa.Boolean),
        sa.Column("source", sa.String),
    )
    dashboard = sa.Table(
        "dashboard_item",
        meta,
        sa.Column("uuid", UUID),
        sa.Column("creator_uuid", UUID),
        sa.Column("owner_uuid", UUID),
        sa.Column("entity_share", sa.Boolean),
        sa.Column("is_shared", sa.Boolean),
        sa.Column("content", sa.LargeBinary),
    )
    user_app = sa.Table(
        "user_app",
        meta,
        sa.Column("uuid", UUID),
        sa.Column("user_uuid", UUID),
        sa.Column("is_shared", sa.Boolean),
        sa.Column("content", sa.LargeBinary),
    )
    return user, session, dashboard, user_app


def test_sessions_are_hashed_and_saved_content_loses_its_credentials(database):
    db_path, engine = database
    user, session, dashboard, user_app = _tables()
    user_uuid, dashboard_uuid, app_uuid = uuid4(), uuid4(), uuid4()
    with engine.begin() as conn:
        conn.execute(
            user.insert(),
            {
                "uuid": user_uuid,
                "email": "sessions@mail.test",
                "clean_email": "sessions@mail.test",
                "password": "x",
                "referral_code": "r1",
                "is_superuser": False,
                "two_factor_auth": False,
                "totp_active": False,
            },
        )
        conn.execute(
            session.insert(),
            {"uuid": uuid4(), "user_uuid": user_uuid, "app_session": True, "source": "app"},
        )
        conn.execute(
            dashboard.insert(),
            {
                "uuid": dashboard_uuid,
                "creator_uuid": user_uuid,
                "owner_uuid": user_uuid,
                "entity_share": False,
                "is_shared": False,
                "content": _gzip(_content("Markets")),
            },
        )
        conn.execute(
            user_app.insert(),
            {
                "uuid": app_uuid,
                "user_uuid": user_uuid,
                "is_shared": False,
                "content": _gzip(_content("App")),
            },
        )

    _alembic(db_path, "upgrade", REVISION)

    inspector = sa.inspect(engine)
    columns = {column["name"]: column for column in inspector.get_columns("session")}
    assert columns["token_hash"]["nullable"] is False
    indexes = {index["name"]: index for index in inspector.get_indexes("session")}
    assert indexes["ix_session_token_hash"]["unique"]
    with engine.connect() as conn:
        assert conn.execute(sa.select(sa.func.count()).select_from(session)).scalar() == 0
        for table, uuid in ((dashboard, dashboard_uuid), (user_app, app_uuid)):
            stored = conn.execute(
                sa.select(table.c.content).where(table.c.uuid == uuid)
            ).scalar_one()
            content = json.loads(gzip.decompress(stored))
            assert SECRET not in json.dumps(content)
            assert content["widgets"][0]["endpoint"] == {
                "url": "http://localhost:8001/prices",
                "method": "GET",
            }

    _alembic(db_path, "downgrade", BEFORE)
    assert "token_hash" not in {
        column["name"] for column in sa.inspect(engine).get_columns("session")
    }
