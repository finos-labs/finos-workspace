import json
from pathlib import Path

import pytest
from starlette.testclient import TestClient

import server

MANIFEST = Path(__file__).resolve().parent.parent / "src" / "plugin.json"


@pytest.fixture
def client():
    return TestClient(server.app)


def params(widget: dict) -> dict:
    return {p["paramName"]: p["value"] for p in widget.get("params", [])}


def test_every_widget_answers_and_follows_the_plugins_definition(client):
    jsonschema = pytest.importorskip("jsonschema")
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    definition = manifest["contributes"]["widgets"][0]["handles"][0]["definition"]
    widgets = client.get("/widgets.json").json()
    assert len(widgets) == 12
    for key, widget in widgets.items():
        assert widget["type"] == "ag-grid", key
        if "data" in widget:
            jsonschema.validate(widget["data"]["ag-grid"], definition)
        answer = client.get(widget["endpoint"], params=params(widget))
        assert answer.status_code == 200, key
        assert isinstance(answer.json(), list) and answer.json(), key


def test_the_cell_click_pair_shares_the_symbol(client):
    widgets = client.get("/widgets.json").json()
    clicks = widgets["ag_table_chart_cell_click"]["data"]["ag-grid"]["columnsDefs"][0]["renderFnParams"]["groupBy"]["paramName"]
    assert clicks in params(widgets["ag_table_chart_company_detail"])
    assert client.get("/ag-table-chart/company", params={"symbol": "msft"}).json()[0]["company"] == "Microsoft"


def test_the_live_prices_move(client, monkeypatch):
    monkeypatch.setattr(server.time, "time", lambda: 0)
    before = client.get("/ag-table-chart/live").json()
    monkeypatch.setattr(server.time, "time", lambda: server.LIVE_SECONDS)
    after = client.get("/ag-table-chart/live").json()
    assert [r["symbol"] for r in before] == [r["symbol"] for r in after]
    assert [r["price"] for r in before] != [r["price"] for r in after]


def test_the_web_app_may_call_it(client):
    answer = client.get("/widgets.json", headers={"Origin": "http://localhost:3000"})
    assert answer.headers["access-control-allow-origin"] == "http://localhost:3000"
