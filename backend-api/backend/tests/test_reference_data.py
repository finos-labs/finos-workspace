import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from prometheus_client import CollectorRegistry

from scripts import export_reference_data as export
from utilities.request_metrics import instrument
from utilities.runtime_metrics import LABEL_VALUES


@pytest.fixture(autouse=True)
def reset_rate_limiter():
    yield


@pytest.mark.parametrize("name", sorted(export.FILES))
def test_each_collector_renders_json(name):
    assert json.loads(export.render(export.COLLECTORS[name]()))


def test_the_request_metrics_listed_are_the_ones_the_api_serves():
    registry = CollectorRegistry()
    app = FastAPI()

    @app.get("/ping")
    def ping():
        return {}

    instrument(app, registry)
    TestClient(app).get("/ping")

    served = {family.name for family in registry.collect()}
    listed = {entry["name"].removesuffix("_total") for entry in export.collect_api_metrics()["requests"]}
    assert listed == served


def test_the_runtime_metrics_list_values_only_for_their_labels():
    runtime = export.collect_api_metrics()["runtime"]
    assert runtime
    for entry in runtime:
        assert set(entry["label_values"]) <= set(entry["labels"])
    assert {entry["name"] for entry in runtime if entry["label_values"]} == set(LABEL_VALUES)


def test_the_exporter_writes_every_file(tmp_path):
    assert export.main(["-o", str(tmp_path)]) == 0
    assert sorted(path.name for path in tmp_path.iterdir()) == sorted(export.FILES.values())
