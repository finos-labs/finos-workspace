import importlib
import json
import sys

import data
import engines
import pytest
from starlette.testclient import TestClient

ORIGIN = "http://localhost:3000"


@pytest.fixture
def client(tmp_path, monkeypatch):
    package = tmp_path / "package"
    package.mkdir()
    (package / "plugin.json").write_text(json.dumps({"id": "sql-explorer", "version": "9.9.9"}), encoding="utf-8")
    files = tmp_path / "data"
    data.write_files(str(files))
    monkeypatch.setenv("SQL_EXPLORER_PACKAGE", str(package))
    monkeypatch.setattr(engines, "DATA", files)
    for name in ("identity", "server", "main"):
        monkeypatch.delitem(sys.modules, name, raising=False)
    return TestClient(importlib.import_module("main").app)


def params(widget: dict) -> dict:
    return {p["paramName"]: p["value"] for p in widget.get("params", [])}


def test_every_widget_endpoint_answers(client):
    widgets = client.get("/widgets.json").json()
    assert {w["type"] for w in widgets.values()} == {"plotly", "ag-grid"}
    for widget in widgets.values():
        answer = client.get(widget["endpoint"], params=params(widget))
        assert answer.status_code == 200, widget["endpoint"]
        assert answer.json()


def test_a_plotly_figure_follows_the_theme(client):
    dark = client.get("/plotly/sales", params={"theme": "dark"}).json()
    light = client.get("/plotly/sales", params={"theme": "light"}).json()
    assert [trace["name"] for trace in dark["data"]] == ["emea", "apac", "americas"]
    assert dark["layout"]["template"] != light["layout"]["template"]


def test_the_sales_chart_gives_its_rows_and_the_grid_draws_them(client):
    widgets = client.get("/widgets.json").json()
    assert widgets["plotly_sales"]["raw"] is True
    assert widgets["plotly_sales"]["data"] == {"rawType": "ag-grid"}
    rows = client.get("/plotly/sales", params={"raw": "true"}).json()
    assert rows[0] == {"month": "Jan", "emea": 100, "apac": 105, "americas": 120}


def test_the_grid_shapes(client):
    assert set(client.get("/ag-grid/explicit").json()) == {"columnDefs", "rowData", "gridOptions"}
    assert isinstance(client.get("/ag-grid/records").json(), list)
    assert set(client.get("/ag-grid/columns").json()) == set(data.DEALS[0])
    assert set(client.get("/ag-grid/split").json()) == {"columns", "index", "data"}
    grouped = client.get("/ag-grid/grouped").json()
    assert [d["field"] for d in grouped["columnDefs"] if d.get("rowGroup")] == ["region"]


def test_the_stream_moves(client, monkeypatch):
    import main

    monkeypatch.setattr(main.time, "time", lambda: 0)
    before = client.get("/ag-grid/stream").json()["rowData"]
    monkeypatch.setattr(main.time, "time", lambda: main.STREAM_SECONDS)
    after = client.get("/ag-grid/stream").json()["rowData"]
    assert [r["id"] for r in before] == ["stream-0", "stream-1", "stream-2"]
    assert [r["id"] for r in after] == ["stream-1", "stream-2", "stream-3"]


def test_sql_runs_over_the_files_the_explorer_reads(client):
    sql = "SELECT region, sum(units) AS units FROM sales GROUP BY region ORDER BY region"
    figure = client.get("/sql/chart", params={"sql": sql, "theme": "dark"}).json()
    assert figure["data"][0]["x"] == ["americas", "apac", "emea"]
    assert figure["data"][0]["y"][0] == sum(data.REGIONS["americas"])


def test_sql_refuses_what_the_explorer_refuses(client):
    for text in ("DELETE FROM sales", "SELECT 1; SELECT 2", "SELECT * FROM read_csv('/etc/passwd')", ""):
        answer = client.get("/sql/chart", params={"sql": text})
        assert answer.status_code == 400
        assert answer.json()["detail"]


def test_the_plugin_routes_are_served_beside_the_data_routes(client):
    identity = client.get("/.workspace/identity").json()
    assert identity["plugin"] == "sql-explorer"
    assert identity["version"] == "9.9.9"
    assert client.get("/.workspace/health").json() == {"ok": True}
    assert client.post("/.workspace/routes/files_schema", json={}).json()["tables"]


def test_cors_allows_the_web_apps_and_nobody_else(client):
    allowed = client.get("/widgets.json", headers={"Origin": ORIGIN})
    assert allowed.headers["access-control-allow-origin"] == ORIGIN
    other = client.get("/widgets.json", headers={"Origin": "http://evil.example"})
    assert "access-control-allow-origin" not in other.headers
    assert client.get("/nothing").status_code == 404
