import os
import subprocess
import sys
from uuid import uuid4

import pytest
import sqlalchemy as sa
import sqlalchemy_utils

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BEFORE = "9a4e61c2b8d0"
REVISION = "c4d8a7e19f26"
USER_GONE = {"referred_by", "referred_by_sent", "referral_code", "total_referrals"}
FILE_GONE = {"is_entity_shared"}

UUID = sqlalchemy_utils.types.uuid.UUIDType()

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
)
stored_file = sa.table(
    "stored_file",
    sa.column("uuid", UUID),
    sa.column("creater_uuid", UUID),
    sa.column("s3_file_name", sa.String),
    sa.column("bucket", sa.String),
    sa.column("extension", sa.String),
    sa.column("original_file_name", sa.String),
    sa.column("size", sa.Integer),
    sa.column("is_global", sa.Boolean),
    sa.column("is_entity_shared", sa.Boolean),
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
    db_path = str(tmp_path / "unused_columns.db")
    _alembic(db_path, "upgrade", BEFORE)
    engine = sa.create_engine(f"sqlite:///{db_path}")
    yield db_path, engine
    engine.dispose()


def _seed(engine: sa.Engine) -> dict:
    owner, other, file = uuid4(), uuid4(), uuid4()
    with engine.begin() as conn:
        conn.execute(
            user.insert(),
            [
                {"uuid": owner, "email": "owner@example.com", "clean_email": "owner@example.com",
                 "password": "x", "totp_active": False, "two_factor_auth": False,
                 "referral_code": "r1", "is_superuser": True},
                {"uuid": other, "email": "other@example.com", "clean_email": "other@example.com",
                 "password": "y", "totp_active": False, "two_factor_auth": False,
                 "referral_code": "r2", "is_superuser": False},
            ],
        )
        conn.execute(
            stored_file.insert().values(
                uuid=file, creater_uuid=owner, s3_file_name="a.csv", bucket="b", extension="csv",
                original_file_name="a.csv", size=3, is_global=True, is_entity_shared=False,
            )
        )
    return {"owner": owner, "other": other, "file": file}


def _users(engine: sa.Engine) -> dict:
    with engine.connect() as conn:
        rows = conn.execute(sa.text('SELECT email, password, is_superuser FROM "user"'))
        return {row.email: (row.password, bool(row.is_superuser)) for row in rows}


def _files(engine: sa.Engine) -> list[tuple]:
    with engine.connect() as conn:
        rows = conn.execute(sa.text("SELECT s3_file_name, size, is_global FROM stored_file"))
        return [(row.s3_file_name, row.size, bool(row.is_global)) for row in rows]


def test_the_unused_columns_go_and_the_rows_stay(database):
    db_path, engine = database
    _seed(engine)

    _alembic(db_path, "upgrade", REVISION)

    inspector = sa.inspect(engine)
    user_columns = {column["name"] for column in inspector.get_columns("user")}
    file_columns = {column["name"] for column in inspector.get_columns("stored_file")}
    assert not user_columns & USER_GONE
    assert not file_columns & FILE_GONE
    assert {"uuid", "email", "password", "is_superuser"} <= user_columns
    assert {"uuid", "s3_file_name", "size", "is_global"} <= file_columns
    assert "ix_stored_file_is_entity_shared" not in {i["name"] for i in inspector.get_indexes("stored_file")}
    assert _users(engine) == {"owner@example.com": ("x", True), "other@example.com": ("y", False)}
    assert _files(engine) == [("a.csv", 3, True)]


def test_running_it_again_changes_nothing(database):
    db_path, engine = database
    _seed(engine)
    _alembic(db_path, "upgrade", REVISION)

    _alembic(db_path, "downgrade", BEFORE)
    _alembic(db_path, "upgrade", REVISION)

    assert not {column["name"] for column in sa.inspect(engine).get_columns("user")} & USER_GONE
    assert _users(engine) == {"owner@example.com": ("x", True), "other@example.com": ("y", False)}
