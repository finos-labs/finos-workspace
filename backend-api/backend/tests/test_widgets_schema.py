import copy
import json
from itertools import combinations
from pathlib import Path
from typing import Any
from uuid import UUID

import pytest
from jsonschema import Draft7Validator

from api.widget_plugins.widgets_schema import compose, load_kit
from scripts.compose_widgets_schema import main as compose_main
from tests.fixtures.base import _SECOND_USER
from tests.fixtures.widget_plugins import approve, manifest, rescan, write_package


def _pointer(path: list[str]) -> str:
    return "/" + "/".join(p.replace("~", "~0").replace("/", "~1") for p in path)


_CONDITIONS = ("if", "then", "else", "not", "contains")


def closedness_problems(schema: Any) -> list[str]:  # noqa: PLR0912
    problems: list[str] = []

    def walk(node: Any, path: list[str], shape: bool) -> None:  # noqa: PLR0912
        if not isinstance(node, dict):
            return
        where = _pointer(path)
        declared = node.get("type")
        types = {declared} if isinstance(declared, str) else set(declared or [])
        if shape and "object" in types:
            additional = node.get("additionalProperties")
            if additional is not False and not isinstance(additional, dict):
                problems.append(f"{where}: an object needs additionalProperties false or a value schema")
        if shape and "array" in types and not isinstance(node.get("maxItems"), int):
            problems.append(f"{where}: an array needs maxItems")
        if (
            shape
            and "string" in types
            and not any(k in node for k in ("maxLength", "enum", "const", "pattern", "format"))
        ):
            problems.append(f"{where}: a string needs maxLength, enum, const, pattern or format")
        for name, child in (node.get("properties") or {}).items():
            walk(child, [*path, "properties", name], shape)
        for key in ("additionalProperties", "items", "propertyNames"):
            if isinstance(node.get(key), dict):
                walk(node[key], [*path, key], shape)
        for key in ("anyOf", "oneOf", "allOf"):
            for i, child in enumerate(node.get(key) or []):
                walk(child, [*path, key, str(i)], shape)
        for key in _CONDITIONS:
            if isinstance(node.get(key), dict):
                walk(node[key], [*path, key], False)
        for key in ("definitions", "$defs"):
            for name, child in (node.get(key) or {}).items():
                walk(child, [*path, key, name], True)

    walk(schema, [], True)
    return problems


CHART = {
    "type": "object",
    "additionalProperties": False,
    "properties": {"title": {"type": "string", "maxLength": 80}, "axis": {"$ref": "#/$defs/axis"}},
    "$defs": {"axis": {"type": "object", "additionalProperties": False, "properties": {"log": {"type": "boolean"}}}},
}
GRID = {"type": "object", "additionalProperties": False, "properties": {"pageSize": {"type": "integer", "maximum": 500}}}

WIDGET = {"name": "N", "description": "D", "endpoint": "/n", "type": "markdown"}


def _errors(schema: dict, document: dict) -> list[str]:
    return ["/" + "/".join(map(str, e.absolute_path)) for e in Draft7Validator(schema).iter_errors(document)]


def _valid(schema: dict, widget: dict) -> bool:
    return not _errors(schema, {"w": widget})


@pytest.fixture(scope="module")
def schema() -> dict:
    return compose({"chart_x": CHART, "grid_y": None}, "test")


class TestComposition:
    def test_the_composed_schema_is_a_closed_draft_7_schema(self, schema):
        Draft7Validator.check_schema(schema)
        assert closedness_problems(schema) == []
        assert schema["x-types"] == ["markdown", "html", "newsfeed", "pdf", "iframe", "chart_x", "grid_y"]

    @pytest.mark.parametrize("size", [0, 1, 2])
    def test_closed_for_every_combination_of_plugin_types(self, size):
        fragments = {"chart_x": CHART, "grid_y": GRID, "empty_z": None}
        for chosen in combinations(fragments, size):
            composed = compose({t: fragments[t] for t in chosen}, "m")
            Draft7Validator.check_schema(composed)
            assert closedness_problems(composed) == [], chosen

    def test_a_fragment_keeps_its_own_definitions(self, schema):
        assert "Plugin_chart_x_axis" in schema["definitions"]
        assert _valid(schema, {**WIDGET, "type": "chart_x", "data": {"chart_x": {"title": "T", "axis": {"log": True}}}})
        assert not _valid(schema, {**WIDGET, "type": "chart_x", "data": {"chart_x": {"axis": {"scale": 2}}}})

    def test_the_kit_is_not_changed_by_composing(self):
        before = copy.deepcopy(load_kit())
        compose({"chart_x": CHART}, "x")
        assert load_kit() == before


class TestPluginConfig:
    SETTINGS = {
        "type": "object",
        "properties": {
            "palette": {"type": "string", "enum": ["warm", "cool"]},
            "points": {"type": "integer", "minimum": 2, "maximum": 500},
        },
    }

    def test_each_plugin_type_has_its_config_definition(self):
        composed = compose({"chart_x": CHART, "grid_y": None}, "c", {"chart_x": self.SETTINGS})
        config = Draft7Validator(composed["definitions"]["PluginConfig_chart_x"])
        assert config.is_valid({"palette": "warm", "points": 10})
        assert config.is_valid({})
        assert not config.is_valid({"palette": "neon"})
        assert not config.is_valid({"points": 1})
        assert not config.is_valid({"glow": True})
        assert not Draft7Validator(composed["definitions"]["PluginConfig_grid_y"]).is_valid({"any": 1})
        assert "PluginConfig_markdown" not in composed["definitions"]
        assert closedness_problems(composed) == []


class TestTheContract:
    @pytest.mark.parametrize(
        ("widget", "valid"),
        [
            (WIDGET, True),
            ({**WIDGET, "defaultViz": "html"}, False),
            ({**WIDGET, "widgetId": "x"}, False),
            ({**WIDGET, "searchCategory": "x"}, False),
            ({**WIDGET, "sub_category": "x"}, False),
            ({**WIDGET, "endpoint": "/n?x=1"}, False),
            ({**WIDGET, "endpoint": "/n#top"}, False),
            ({k: v for k, v in WIDGET.items() if k != "type"}, False),
            ({**WIDGET, "type": "table"}, False),
            ({**WIDGET, "data": {"dataKey": "a.b"}}, True),
            ({**WIDGET, "data": {"dataKey": "a", "table": {}}}, False),
            ({**WIDGET, "gridData": {"w": 41, "h": 4}}, False),
            ({**WIDGET, "params": [{"paramName": "p", "type": "text", "color": "red"}]}, False),
            ({**WIDGET, "params": [{"paramName": "p", "type": "text", "options": [{"label": "A", "extra": 1}]}]}, False),
            ({**WIDGET, "params": [{"paramName": "p", "type": "number", "multiple": True}]}, False),
            ({**WIDGET, "params": [{"paramName": "p", "type": "text", "multiple": True}]}, True),
            ({**WIDGET, "params": [[{"paramName": "a", "type": "text"}, {"paramName": "b", "type": "date"}]]}, True),
            (
                {
                    **WIDGET,
                    "params": [
                        {
                            "paramName": "team",
                            "type": "endpoint",
                            "optionsEndpoint": "/teams/{region}",
                            "optionsMethod": "POST",
                            "optionsParams": {"region": "$region", "active": True},
                        }
                    ],
                },
                True,
            ),
            ({**WIDGET, "params": [{"paramName": "t", "type": "endpoint", "optionsParams": {"a": {"b": 1}}}]}, False),
            ({**WIDGET, "params": [{"paramName": "t", "type": "endpoint", "optionsEndpoint": "/o?x=1"}]}, False),
            (
                {
                    **WIDGET,
                    "params": [{"type": "form", "endpoint": "/f", "inputParams": [{"paramName": "a", "type": "text"}]}],
                },
                True,
            ),
            (
                {
                    **WIDGET,
                    "params": [
                        {
                            "type": "form",
                            "endpoint": "/f",
                            "inputParams": [{"paramName": "a", "type": "text", "in": "body"}],
                        }
                    ],
                },
                False,
            ),
        ],
    )
    def test_every_key_is_defined(self, schema, widget, valid):
        assert _valid(schema, widget) is valid, _errors(schema, {"w": widget})

    def test_the_top_level_is_a_map_of_widgets(self, schema):
        assert not _errors(schema, {"$schema": "https://x", "a": WIDGET, "b": {**WIDGET, "type": "pdf"}})
        assert _errors(schema, {"a": "not a widget"})


class TestRequestMapping:
    @pytest.mark.parametrize(
        ("widget", "valid"),
        [
            ({**WIDGET, "method": "POST"}, True),
            ({**WIDGET, "method": "PUT"}, False),
            ({**WIDGET, "params": [{"paramName": "f", "type": "text", "in": "body"}]}, False),
            ({**WIDGET, "method": "POST", "params": [{"paramName": "f", "type": "text", "in": "body"}]}, True),
            ({**WIDGET, "params": [[{"paramName": "f", "type": "text", "in": "body"}]]}, False),
            ({**WIDGET, "params": [{"paramName": "X-Region", "type": "text", "in": "header", "value": "eu"}]}, True),
            ({**WIDGET, "params": [{"paramName": "X Region", "type": "text", "in": "header"}]}, False),
            ({**WIDGET, "params": [{"paramName": "cookie", "type": "text", "in": "header"}]}, False),
            ({**WIDGET, "params": [{"paramName": "Authorization", "type": "text", "in": "header"}]}, False),
            ({**WIDGET, "params": [{"paramName": "Sec-Fetch-Mode", "type": "text", "in": "header"}]}, False),
            ({**WIDGET, "params": [{"paramName": "Proxy-X", "type": "text", "in": "header"}]}, False),
            ({**WIDGET, "params": [{"paramName": "X-A", "type": "text", "in": "header", "value": "é"}]}, False),
            ({**WIDGET, "params": [{"paramName": "theme", "type": "text"}]}, False),
            ({**WIDGET, "params": [{"paramName": "theme", "type": "text", "in": "query"}]}, False),
            ({**WIDGET, "params": [{"paramName": "theme", "type": "text", "in": "header"}]}, True),
            ({**WIDGET, "type": "html", "params": [{"paramName": "raw", "type": "boolean"}]}, False),
            ({**WIDGET, "type": "pdf", "params": [{"paramName": "theme", "type": "text"}]}, True),
            ({**WIDGET, "type": "grid_y", "params": [{"paramName": "theme", "type": "text"}]}, False),
            ({**WIDGET, "type": "grid_y", "params": [{"paramName": "theme", "type": "text", "in": "header"}]}, True),
            ({**WIDGET, "type": "grid_y", "params": [{"paramName": "mode", "type": "text"}]}, True),
            ({**WIDGET, "type": "grid_y", "params": [{"paramName": "raw", "type": "boolean"}]}, False),
            ({**WIDGET, "type": "iframe", "method": "POST"}, False),
            ({**WIDGET, "type": "iframe", "params": [{"paramName": "a", "type": "text", "in": "body"}]}, False),
            ({**WIDGET, "type": "iframe", "params": [{"paramName": "a", "type": "text", "in": "header"}]}, False),
            ({**WIDGET, "type": "iframe", "params": [{"paramName": "a", "type": "text"}]}, True),
        ],
    )
    def test_the_rules_json_schema_can_state(self, schema, widget, valid):
        assert _valid(schema, widget) is valid, _errors(schema, {"w": widget})


class TestTypeKeys:
    @pytest.mark.parametrize(
        ("widget", "valid"),
        [
            ({**WIDGET, "type": "html", "raw": True}, True),
            ({**WIDGET, "raw": True}, False),
            ({**WIDGET, "type": "iframe", "storage": {"mcpUrl": "https://mcp.invalid/mcp"}}, True),
            ({**WIDGET, "type": "iframe", "storage": {"html": "<p>"}}, False),
            ({**WIDGET, "storage": {"text": "x"}}, False),
            ({**WIDGET, "type": "grid_y", "data": {"grid_y": {}}}, False),
            ({**WIDGET, "type": "grid_y", "data": {"dataKey": "rows"}}, True),
            ({**WIDGET, "type": "grid_y", "raw": True}, True),
            (
                {**WIDGET, "type": "html", "raw": True, "data": {"rawDataKey": "results.records", "rawType": "grid_y"}},
                True,
            ),
            (
                {
                    **WIDGET,
                    "type": "grid_y",
                    "raw": True,
                    "data": {"dataKey": "results.chart", "rawDataKey": "results.records", "rawType": "table_x"},
                },
                True,
            ),
            ({**WIDGET, "type": "grid_y", "data": {"rawDataKey": "results.records"}}, False),
            ({**WIDGET, "type": "html", "raw": False, "data": {"rawType": "grid_y"}}, False),
            ({**WIDGET, "data": {"rawDataKey": "results"}}, False),
            ({**WIDGET, "type": "grid_y", "raw": True, "data": {"rawType": "Grid Y"}}, False),
        ],
    )
    def test_each_type_takes_its_own_keys(self, schema, widget, valid):
        assert _valid(schema, widget) is valid, _errors(schema, {"w": widget})


class TestMcpTool:
    @pytest.mark.parametrize(
        ("link", "extra", "valid"),
        [
            ({"mcp_server": "S", "tool_id": "t"}, {}, True),
            ({"mcp_server": "S", "tool_id": "t", "args": {"team_id": "$team", "n": 3, "on": True}}, {}, True),
            ({"mcp_server": "S"}, {}, False),
            ({"mcp_server": "S", "tool_id": "t", "url": "https://x"}, {}, False),
            ({"mcp_server": "S", "tool_id": "t", "args": {"a": ["x"]}}, {}, False),
            ({"mcp_server": "S", "tool_id": "t"}, {"disableRetrievalForCopilot": True}, False),
            ({"mcp_server": "S", "tool_id": "t"}, {"disableRetrievalForCopilot": False}, True),
        ],
    )
    def test_the_link_is_a_closed_key(self, schema, link, extra, valid):
        widget = {**WIDGET, **extra, "mcp_tool": link}
        assert _valid(schema, widget) is valid, _errors(schema, {"w": widget})


FIXTURES = Path(__file__).parent / "fixtures"
FRONTEND_FIXTURE = Path(__file__).resolve().parents[3] / "frontend/tests/mocks/widgets-schema.json"
FIXTURE_ARGS = [
    "--plugin",
    f"test_chart={FIXTURES / 'test_chart_definition.json'}",
    "--settings",
    f"test_chart={FIXTURES / 'test_chart_settings.json'}",
    "--id",
    "fixture",
]


class TestOffline:
    def test_the_script_prints_the_composition(self, capsys):
        definition = FIXTURES / "test_chart_definition.json"
        settings = FIXTURES / "test_chart_settings.json"
        assert compose_main(FIXTURE_ARGS) == 0
        printed = json.loads(capsys.readouterr().out)
        assert printed == compose(
            {"test_chart": json.loads(definition.read_text())},
            "fixture",
            {"test_chart": json.loads(settings.read_text())},
        )

    def test_the_frontend_fixture_is_current(self, capsys):
        compose_main(FIXTURE_ARGS)
        assert FRONTEND_FIXTURE.read_text() == capsys.readouterr().out

    def test_settings_need_their_type(self, capsys):
        with pytest.raises(SystemExit):
            compose_main(["--settings", f"other_x={FIXTURES / 'test_chart_settings.json'}"])
        assert "--settings for a type with no --plugin: other_x" in capsys.readouterr().err

    def test_a_definition_that_is_not_closed_is_refused(self, tmp_path):
        loose = tmp_path / "loose.json"
        loose.write_text(json.dumps({"type": "object", "properties": {"t": {"type": "string"}}}))
        with pytest.raises(SystemExit):
            compose_main(["--plugin", f"t_x={loose}"])


class TestEndpoint:
    @pytest.mark.asyncio
    async def test_built_in_types_without_plugins(self, member, superuser, plugins_dir):
        response = await member.get("/app/widget-plugins/widgets-schema")
        assert response.status_code == 200, response.text
        assert response.json()["x-types"] == ["markdown", "html", "newsfeed", "pdf", "iframe"]

    @pytest.mark.asyncio
    async def test_the_types_of_plugins_enabled_for_the_entity(self, member, superuser, second_user_client, plugins_dir):
        write_package(plugins_dir)
        await rescan(superuser)
        await approve(superuser)
        assert "test_chart" not in (await member.get("/app/widget-plugins/widgets-schema")).json()["x-types"]

        assert (await superuser.put("/admin/plugins/test-chart", json={"enabled": True})).status_code == 200
        response = await member.get("/app/widget-plugins/widgets-schema")
        schema = response.json()
        assert "test_chart" in schema["x-types"]
        assert _valid(schema, {**WIDGET, "type": "test_chart", "data": {"test_chart": {"title": "T"}}})
        assert not _valid(schema, {**WIDGET, "type": "test_chart", "data": {"test_chart": {"colour": "red"}}})

        etag = response.headers["etag"]
        again = await member.get("/app/widget-plugins/widgets-schema", headers={"If-None-Match": etag})
        assert again.status_code == 304
        await superuser.post("/plugins/test-chart/revoke")
        changed = await member.get("/app/widget-plugins/widgets-schema", headers={"If-None-Match": etag})
        assert changed.status_code == 200
        assert "test_chart" not in changed.json()["x-types"]

        await superuser.post("/plugins/test-chart/restore")
        assert "test_chart" not in (await second_user_client.get("/app/widget-plugins/widgets-schema")).json()["x-types"]

    @pytest.mark.asyncio
    async def test_a_template_config_follows_the_handlers_settings(self, member, superuser, plugins_dir):
        data = manifest()
        data["contributes"]["widgets"][0]["settings"] = {"schema": TestPluginConfig.SETTINGS, "defaults": {}}
        write_package(plugins_dir, data)
        await rescan(superuser)
        await approve(superuser)
        assert (await superuser.put("/admin/plugins/test-chart", json={"enabled": True})).status_code == 200

        definitions = (await member.get("/app/widget-plugins/widgets-schema")).json()["definitions"]
        config = Draft7Validator(definitions["PluginConfig_test_chart"])
        assert config.is_valid({"palette": "cool"})
        assert not config.is_valid({"palette": "cool", "glow": 1})

    @pytest.mark.asyncio
    async def test_a_superuser_may_name_an_entity(self, member, superuser, plugins_dir):
        second = UUID(_SECOND_USER["entity_uuid"])
        assert (await member.get(f"/app/widget-plugins/widgets-schema?entity={second}")).status_code == 403
        response = await superuser.get(f"/app/widget-plugins/widgets-schema?entity={second}")
        assert response.status_code == 200
        assert response.json()["x-types"] == ["markdown", "html", "newsfeed", "pdf", "iframe"]

    @pytest.mark.asyncio
    async def test_the_entity_chooses_the_handler(self, member, superuser, plugins_dir):
        write_package(plugins_dir)
        other = manifest("other-chart")
        other["contributes"]["widgets"][0]["handles"][0]["definition"] = GRID
        write_package(plugins_dir, other)
        await rescan(superuser)
        await approve(superuser)
        await approve(superuser, "other-chart")
        for plugin_id in ("test-chart", "other-chart"):
            assert (await superuser.put(f"/admin/plugins/{plugin_id}", json={"enabled": True})).status_code == 200

        def config_of(schema):
            return schema["definitions"]["Data_test_chart"]["properties"]["test_chart"]["properties"]

        assert "pageSize" in config_of((await member.get("/app/widget-plugins/widgets-schema")).json())
        response = await superuser.put("/admin/plugins/test-chart", json={"handlers": {"test_chart": "chart"}})
        assert response.status_code == 200, response.text
        assert "title" in config_of((await member.get("/app/widget-plugins/widgets-schema")).json())
