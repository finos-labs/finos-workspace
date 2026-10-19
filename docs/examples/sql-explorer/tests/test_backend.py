"""The backend without a database server: its identity, its values, DuckDB over files, and
the requests Workspace's API sends it. tests/test_postgres.py covers Postgres."""

import base64
import hashlib
import importlib
import json
import sys
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from uuid import UUID

import duckdb
import engines
import pytest
from identity import identity, version_digest
from starlette.testclient import TestClient
from values import EXACT_INTEGER, MAX_TEXT, cell


@pytest.fixture
def data(tmp_path, monkeypatch) -> Path:
    """A data directory with a Parquet file, a CSV file, and a file of another kind."""
    directory = tmp_path / "data"
    directory.mkdir()
    duckdb.sql(
        f"COPY (SELECT range AS id, 'sensor-' || (range % 3) AS sensor, range * 1.5 AS value FROM range(30))"
        f" TO '{directory}/Readings 2026.parquet' (FORMAT parquet)"
    )
    (directory / "stations.csv").write_text("sensor,site\nsensor-0,north\nsensor-1,south\n", encoding="utf-8")
    (directory / "notes.txt").write_text("not a table", encoding="utf-8")
    monkeypatch.setattr(engines, "DATA", directory)
    return directory


class TestIdentity:
    def test_the_digest_is_workspaces(self, tmp_path):
        (tmp_path / "backend").mkdir()
        (tmp_path / "plugin.json").write_text('{"id": "sql-explorer", "version": "1.2.3"}', encoding="utf-8")
        (tmp_path / "backend" / "server.py").write_text("print()", encoding="utf-8")
        lines = "".join(
            f"{name}\0{hashlib.sha256((tmp_path / name).read_bytes()).hexdigest()}\n"
            for name in ["backend/server.py", "plugin.json"]
        )
        expected = "sha256-" + base64.urlsafe_b64encode(hashlib.sha256(lines.encode()).digest()).decode().rstrip("=")
        assert version_digest(tmp_path) == expected
        assert identity(tmp_path) == {"plugin": "sql-explorer", "version": "1.2.3", "digest": expected, "protocol": 1}

    def test_any_change_changes_it(self, tmp_path):
        (tmp_path / "plugin.json").write_text("{}", encoding="utf-8")
        before = version_digest(tmp_path)
        (tmp_path / "extra.py").write_text("", encoding="utf-8")
        assert version_digest(tmp_path) != before


class TestValues:
    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            (None, None),
            (True, True),
            (12, 12),
            (EXACT_INTEGER + 1, str(EXACT_INTEGER + 1)),
            (1.5, 1.5),
            (float("nan"), "nan"),
            (Decimal("12345678901234567890.123"), "12345678901234567890.123"),
            (date(2026, 10, 13), "2026-10-13"),
            (datetime(2026, 10, 13, 9, 30, tzinfo=UTC), "2026-10-13T09:30:00+00:00"),
            (UUID("12345678-1234-5678-1234-567812345678"), "12345678-1234-5678-1234-567812345678"),
            (b"\x00\xff", "\\x00ff"),
            ({"a": [1, Decimal("2.5")]}, {"a": [1, "2.5"]}),
        ],
    )
    def test_cells_are_json(self, value, expected):
        assert cell(value) == expected
        json.dumps(cell(value))

    def test_long_text_is_cut(self):
        assert cell("x" * (MAX_TEXT + 5)) == "x" * MAX_TEXT + "…"


class TestFiles:
    def test_each_file_is_a_view(self, data):
        schema = engines.files_schema()
        assert schema["engine"].startswith("DuckDB ")
        tables = {t["name"]: t for t in schema["tables"]}
        assert set(tables) == {"readings_2026", "stations"}
        assert tables["readings_2026"]["file"] == "Readings 2026.parquet"
        assert [c["name"] for c in tables["stations"]["columns"]] == ["sensor", "site"]

    def test_a_select_joins_them(self, data):
        result = engines.files_query(
            "SELECT s.site, count(*) AS n FROM readings_2026 r JOIN stations s USING (sensor) GROUP BY 1 ORDER BY 1"
        )
        assert result["columns"] == [{"name": "site", "type": "VARCHAR"}, {"name": "n", "type": "BIGINT"}]
        assert result["rows"] == [["north", 10], ["south", 10]]
        assert result["truncated"] is False

    def test_rows_stop_at_the_cap(self, data, monkeypatch):
        monkeypatch.setattr(engines, "MAX_ROWS", 7)
        result = engines.files_query("SELECT * FROM readings_2026")
        assert len(result["rows"]) == 7
        assert result["truncated"] is True

    @pytest.mark.parametrize(
        "text",
        [
            "SELECT 1; SELECT 2",
            "COPY (SELECT 1) TO 'out.csv'",
            "CREATE TABLE t AS SELECT 1",
            "INSTALL httpfs",
            "ATTACH 'other.db'",
            "SET enable_external_access = true",
        ],
    )
    def test_only_one_select_runs(self, data, text):
        with pytest.raises(engines.QueryError, match="one SELECT"):
            engines.files_query(text)
        assert sorted(p.name for p in data.iterdir()) == ["Readings 2026.parquet", "notes.txt", "stations.csv"]

    def test_nothing_outside_the_data_directory_is_read(self, data, tmp_path):
        (tmp_path / "private.csv").write_text("a\n1\n", encoding="utf-8")
        with pytest.raises(engines.QueryError, match="Permission"):
            engines.files_query(f"SELECT * FROM read_csv('{tmp_path / 'private.csv'}')")

    def test_a_query_that_runs_too_long_is_stopped(self, data, monkeypatch):
        monkeypatch.setattr(engines, "STATEMENT_SECONDS", 0.5)
        with pytest.raises(engines.QueryError, match="longer than"):
            engines.files_query("SELECT sum(a.range * b.range) FROM range(100000000) a, range(100000) b")

    def test_an_error_is_the_engines_message(self, data):
        with pytest.raises(engines.QueryError, match="missing_table"):
            engines.files_query("SELECT * FROM missing_table")

    def test_a_file_that_does_not_read_is_named(self, data):
        (data / "broken.parquet").write_bytes(b"not parquet")
        schema = engines.files_schema()
        assert "broken" not in {t["name"] for t in schema["tables"]}
        assert schema["skipped"][0].startswith("broken.parquet: ")


class TestServer:
    @pytest.fixture
    def client(self, data, tmp_path, monkeypatch):
        """The app over a package of its own: it computes its identity when it starts."""
        package = tmp_path / "package"
        package.mkdir()
        (package / "plugin.json").write_text('{"id": "sql-explorer", "version": "1.0.0"}', encoding="utf-8")
        monkeypatch.setenv("SQL_EXPLORER_PACKAGE", str(package))
        import identity as identity_module

        importlib.reload(identity_module)
        monkeypatch.delitem(sys.modules, "server", raising=False)
        server = importlib.import_module("server")
        return TestClient(server.app)

    def test_identity_and_health(self, client):
        answer = client.get("/.workspace/identity").json()
        assert answer["plugin"] == "sql-explorer"
        assert answer["protocol"] == 1
        assert answer["digest"].startswith("sha256-")
        assert client.get("/.workspace/health").status_code == 200

    def test_a_route_answers_with_its_result_and_time(self, client):
        response = client.post(
            "/.workspace/routes/files_query",
            json={"args": {"sql": "SELECT count(*) AS n FROM stations"}, "widget": {}, "caller": {"id": "abc"}},
        )
        assert response.status_code == 200
        answer = response.json()
        assert answer["rows"] == [[2]]
        assert isinstance(answer["elapsedMs"], int)

    def test_a_query_that_fails_is_an_answer(self, client):
        answer = client.post("/.workspace/routes/files_query", json={"args": {"sql": "DROP TABLE x"}}).json()
        assert answer["error"]["message"] == engines.ONE_SELECT

    def test_calls_that_should_not_have_been_made(self, client):
        assert client.post("/.workspace/routes/other", json={}).status_code == 404
        assert client.post("/.workspace/routes/files_query", json={"args": {}}).status_code == 400
        assert client.post("/.workspace/routes/files_query", content=b"not json").status_code == 400
        # Workspace sends the secret; a call without it is not Workspace's
        assert client.post("/.workspace/routes/postgres_schema", json={"args": {}}).status_code == 400
        assert client.get("/anything").status_code == 404
