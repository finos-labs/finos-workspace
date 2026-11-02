import importlib
import json
import sys
from pathlib import Path

import pytest
from starlette.testclient import TestClient

MANIFEST = json.loads((Path(__file__).resolve().parent.parent / "src" / "plugin.json").read_text(encoding="utf-8"))


@pytest.fixture
def module(tmp_path, monkeypatch):
    package = tmp_path / "package"
    package.mkdir()
    (package / "plugin.json").write_text(json.dumps({"id": "ag-grid", "version": "9.9.9"}), encoding="utf-8")
    monkeypatch.setenv("SQL_EXPLORER_PACKAGE", str(package))
    monkeypatch.setenv("AG_GRID_PACKAGE", str(package))
    for name in ("identity", "server", "grid_server"):
        monkeypatch.delitem(sys.modules, name, raising=False)
    return importlib.import_module("grid_server")


def test_the_package_answers_as_the_plugin(module):
    client = TestClient(module.app)
    assert client.get("/.workspace/identity").json()["plugin"] == "ag-grid"
    assert client.get("/.workspace/health").json() == {"ok": True}
    assert client.post("/.workspace/routes/nothing", json={}).status_code == 404


def test_every_route_needs_the_secret_it_declares(module):
    client = TestClient(module.app)
    declared = {route["id"]: route.get("secrets", []) for route in MANIFEST["server"]["backend"]["routes"]}
    assert set(declared) == set(module.ROUTES)
    for name, secrets in declared.items():
        answer = client.post(f"/.workspace/routes/{name}", json={"args": {}})
        assert ("postgres_url" in answer.json().get("detail", "")) == bool(secrets), name


def test_the_widgets_call_only_declared_routes():
    declared = {route["id"] for route in MANIFEST["server"]["backend"]["routes"]}
    for widget in MANIFEST["contributes"]["widgets"]:
        assert set(widget.get("server", {}).get("routes", [])) <= declared
        if widget.get("server", {}).get("routes"):
            assert "core:backend:call" in widget["permissions"]
