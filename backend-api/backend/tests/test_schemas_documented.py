import pytest

from scripts import export_reference_data as export


@pytest.fixture(autouse=True)
def reset_rate_limiter():
    yield


def undescribed(schema, definitions_key):
    missing = []

    def walk(node, where):
        for name, value in (node.get("properties") or {}).items():
            if not isinstance(value, dict) or not value.get("description", "").strip():
                missing.append(f"{where}.{name}")

    walk(schema, "root")
    for name, node in schema.get(definitions_key, {}).items():
        walk(node, name)
    return missing


def test_every_property_of_the_manifest_has_a_description():
    assert undescribed(export.collect_plugin_manifest_schema(), "$defs") == []


def test_every_property_of_widgets_json_has_a_description():
    assert undescribed(export.collect_widgets_schema(), "definitions") == []
