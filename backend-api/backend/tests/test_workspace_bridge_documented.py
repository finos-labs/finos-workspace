import json
import re
from pathlib import Path

import pytest

from scripts.reference_bridge import collect_workspace_bridge

BACKEND = Path(__file__).resolve().parents[1]
SURFACE = Path(__file__).parent / "fixtures" / "workspace_mcp_sidecar_surface.json"
SENT = re.compile(r"""command\s*=\s*["']([a-z_]+)["']|["']command["']\s*:\s*["']([a-z_]+)["']""")


@pytest.fixture(autouse=True)
def reset_rate_limiter():
    yield


@pytest.fixture(scope="module")
def bridge():
    return collect_workspace_bridge()


def nested(node):
    if node.get("type") == "object" and node.get("properties"):
        return [node]
    if node.get("type") == "array" and isinstance(node.get("items"), dict):
        return nested(node["items"])
    return [found for branch in node.get("anyOf", []) for found in nested(branch)]


def undescribed(schema, where):
    missing = []
    for name, value in schema.get("properties", {}).items():
        if not value.get("description"):
            missing.append(f"{where}.{name}")
        for inner in nested(value):
            missing += undescribed(inner, f"{where}.{name}")
    return missing


def test_every_field_of_a_command_has_a_description(bridge):
    missing = []
    for command in bridge["commands"]:
        schema = command["schema"]
        missing += [name for name in undescribed(schema, command["name"]) if not name.endswith((".command", ".type"))]
    assert missing == []


def test_every_field_of_a_message_and_of_the_result_has_a_description(bridge):
    missing = []
    for message in [*bridge["toTab"], *bridge["toApi"]]:
        missing += [name for name in undescribed(message["schema"], message["type"]) if not name.endswith(".type")]
    missing += undescribed(bridge["result"], "result")
    assert missing == []


def test_the_tools_are_the_commands_that_have_one(bridge):
    surface = json.loads(SURFACE.read_text(encoding="utf-8"))["surface"]
    assert sorted(tool["name"] for tool in surface["tools"]) == sorted(
        command["tool"] for command in bridge["commands"] if command["tool"]
    )


def test_the_commands_without_a_tool_are_resources(bridge):
    surface = json.loads(SURFACE.read_text(encoding="utf-8"))["surface"]
    assert [command["name"] for command in bridge["commands"] if command["tool"] is None] == ["get_widgets_schema"]
    assert bridge["constants"]["widgetsSchemaResource"] in {resource["uri"] for resource in surface["resources"]}


def test_the_tools_send_the_commands_that_are_listed(bridge):
    sent = set()
    for path in sorted((BACKEND / "workspace_mcp" / "server").rglob("*.py")):
        for match in SENT.finditer(path.read_text(encoding="utf-8")):
            sent.add(match.group(1) or match.group(2))
    assert sent == {command["name"] for command in bridge["commands"]}
