"""Postgres through the engine, against a real server.

SQL_EXPLORER_TEST_POSTGRES names an administrator's connection URL, or
SQL_EXPLORER_TEST_POSTGRES_FILE a file holding it, of a database the tests may change: they
create a schema and a role, and drop both after. A throwaway container will do (README).
Without either, these tests are skipped.
"""

import os
import secrets
from pathlib import Path

import engines
import psycopg
import pytest
from psycopg import sql


def _admin_url() -> str | None:
    if os.environ.get("SQL_EXPLORER_TEST_POSTGRES"):
        return os.environ["SQL_EXPLORER_TEST_POSTGRES"]
    path = os.environ.get("SQL_EXPLORER_TEST_POSTGRES_FILE")
    return Path(path).read_text(encoding="utf-8").strip() if path else None


ADMIN = _admin_url()
pytestmark = pytest.mark.skipif(not ADMIN, reason="no Postgres to test against")


@pytest.fixture(scope="module")
def reader() -> str:
    """A role that may read the test schema, and its URL."""
    password = secrets.token_urlsafe(24)
    with psycopg.connect(ADMIN, autocommit=True) as admin:
        admin.execute("DROP SCHEMA IF EXISTS explorer_test CASCADE")
        admin.execute("DROP ROLE IF EXISTS explorer_test_reader")
        admin.execute("CREATE SCHEMA explorer_test")
        admin.execute(
            "CREATE TABLE explorer_test.readings (id int, sensor text, value numeric(10, 2), at timestamptz)"
        )
        admin.execute(
            "INSERT INTO explorer_test.readings"
            " SELECT i, 'sensor-' || (i % 3), i * 1.25, timestamptz '2026-10-01 00:00+00' + i * interval '1 hour'"
            " FROM generate_series(1, 50) AS i"
        )
        admin.execute("CREATE SEQUENCE explorer_test.counter")
        admin.execute(sql.SQL("CREATE ROLE explorer_test_reader LOGIN PASSWORD {}").format(password))
        admin.execute("GRANT USAGE ON SCHEMA explorer_test TO explorer_test_reader")
        admin.execute("GRANT SELECT ON ALL TABLES IN SCHEMA explorer_test TO explorer_test_reader")
        where = f"{admin.info.host}:{admin.info.port}/{admin.info.dbname}"
    yield f"postgresql://explorer_test_reader:{password}@{where}"
    with psycopg.connect(ADMIN, autocommit=True) as admin:
        admin.execute("DROP SCHEMA explorer_test CASCADE")
        admin.execute("DROP OWNED BY explorer_test_reader")
        admin.execute("DROP ROLE explorer_test_reader")


def rows_left() -> int:
    with psycopg.connect(ADMIN) as admin:
        return admin.execute("SELECT count(*) FROM explorer_test.readings").fetchone()[0]


def test_a_query_answers_with_typed_columns_and_json_cells(reader):
    result = engines.postgres_query(
        reader, "SELECT id, sensor, value, at FROM explorer_test.readings WHERE id <= 2 ORDER BY id", None
    )
    # Postgres's own type names, with their modifiers
    assert result["columns"] == [
        {"name": "id", "type": "int4"},
        {"name": "sensor", "type": "text"},
        {"name": "value", "type": "numeric(10,2)"},
        {"name": "at", "type": "timestamptz"},
    ]
    assert result["rows"][0] == [1, "sensor-1", "1.25", "2026-10-01T01:00:00+00:00"]
    assert result["truncated"] is False


def test_a_percent_sign_is_sql_not_a_placeholder(reader):
    assert engines.postgres_query(reader, "SELECT 7 % 3 AS r", None)["rows"] == [[1]]


def test_rows_stop_at_the_cap(reader, monkeypatch):
    monkeypatch.setattr(engines, "MAX_ROWS", 10)
    result = engines.postgres_query(reader, "SELECT * FROM explorer_test.readings", None)
    assert len(result["rows"]) == 10
    assert result["truncated"] is True


@pytest.mark.parametrize(
    "text",
    [
        "DELETE FROM explorer_test.readings",
        "SELECT 1; DELETE FROM explorer_test.readings",
        "WITH gone AS (DELETE FROM explorer_test.readings RETURNING *) SELECT * FROM gone",
        "SELECT * INTO explorer_test.copy FROM explorer_test.readings",
    ],
)
def test_nothing_is_written_even_by_a_role_that_could(reader, text):
    # The administrator's URL may write; the engine still does not
    with pytest.raises(engines.QueryError):
        engines.postgres_query(ADMIN, text, None)
    assert rows_left() == 50


def test_a_function_that_writes_is_refused_by_the_read_only_transaction(reader):
    with pytest.raises(engines.QueryError, match="read-only transaction"):
        engines.postgres_query(ADMIN, "SELECT nextval('explorer_test.counter')", None)
    with psycopg.connect(ADMIN) as admin:
        assert admin.execute("SELECT last_value FROM explorer_test.counter").fetchone()[0] == 1


def test_a_query_that_runs_too_long_is_stopped(reader, monkeypatch):
    monkeypatch.setattr(engines, "STATEMENT_SECONDS", 1)
    with pytest.raises(engines.QueryError, match="longer than 1 seconds"):
        engines.postgres_query(reader, "SELECT pg_sleep(3)", None)


def test_the_session_is_named_by_the_callers_pseudonym(reader):
    result = engines.postgres_query(reader, "SELECT current_setting('application_name')", "abcdefghijklmnopqrstuvwxyz")
    assert result["rows"] == [["workspace-sql-explorer:abcdefghijklmnop"]]


def test_the_schema_lists_what_the_role_may_read(reader):
    schema = engines.postgres_schema(reader, None)
    assert schema["engine"].startswith("PostgreSQL ")
    [table] = [t for t in schema["tables"] if t["schema"] == "explorer_test"]
    assert table["name"] == "readings"
    assert [c["name"] for c in table["columns"]] == ["id", "sensor", "value", "at"]


def test_a_failed_connection_says_so_and_nothing_more(reader):
    wrong = reader.replace("explorer_test_reader:", "explorer_test_reader:wrong", 1)
    with pytest.raises(engines.QueryError) as caught:
        engines.postgres_query(wrong, "SELECT 1", None)
    message = str(caught.value)
    assert message.startswith("Could not connect to the database.")
    assert "explorer_test_reader" not in message
    assert reader.split("@", 1)[1].split("/", 1)[0] not in message
