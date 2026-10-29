import json

import pytest

from workspace_mcp.models import WorkspaceCommandResult
from workspace_mcp.server import (
    LIVE_RESOURCE_TAG,
    SERVER_INSTRUCTIONS,
    WIDGETS_JSON_SCHEMA_URI,
    create_mcp_server,
)
from workspace_mcp.state import BridgeSessionManager


def _server():
    return create_mcp_server(
        BridgeSessionManager(
            base_url="http://127.0.0.1:8787",
            websocket_path="/bridge/ws",
            command_timeout_seconds=1,
        )
    )


@pytest.mark.asyncio
async def test_mcp_initialize_advertises_resources_and_prompts():
    server = _server()

    resources = await server.list_resources()
    prompts = await server.list_prompts()
    tools = await server.list_tools()

    assert resources
    assert {prompt.name for prompt in prompts} == {
        "workspace_tool_usage",
        "workspace_session_context",
    }
    assert "get_workspace_snapshot" in {tool.name for tool in tools}


@pytest.mark.asyncio
async def test_mcp_resources_list_and_read_app_builder_index():
    server = _server()

    resources = await server.list_resources()
    index_resource = next(
        resource
        for resource in resources
        if str(resource.uri) == "workspace://app-builder/index"
    )

    assert index_resource.name == "App Builder Index"
    assert index_resource.mime_type == "text/markdown"

    result = await server.read_resource("workspace://app-builder/index")
    content = result.contents[0]

    assert content.mime_type == "text/markdown"
    assert "How to use this resource set" in content.content


def test_server_instructions_ground_dashboards_in_existing_data():
    assert "Only use widgets returned by list_available_widgets" in SERVER_INSTRUCTIONS
    assert "do not build or modify a backend" in SERVER_INSTRUCTIONS
    assert "note widget" in SERVER_INSTRUCTIONS
    assert "explicitly asks" in SERVER_INSTRUCTIONS


@pytest.mark.asyncio
async def test_app_builder_index_description_gates_on_explicit_build_request():
    server = _server()

    resources = await server.list_resources()
    index_resource = next(
        resource
        for resource in resources
        if str(resource.uri) == "workspace://app-builder/index"
    )

    assert "explicitly asked" in index_resource.description


@pytest.mark.asyncio
async def test_mcp_prompts_list_and_get_workspace_tool_usage():
    server = _server()

    result = await server.render_prompt("workspace_tool_usage")

    messages = result.messages
    assert messages[0].content.text == SERVER_INSTRUCTIONS
    assert "FINOS Workspace browser session" in messages[0].content.text
    assert messages[1].content.text == "No FINOS Workspace browser session context is currently available."


def _server_answering(result):
    state = BridgeSessionManager(
        base_url="http://127.0.0.1:8787",
        websocket_path="/bridge/ws",
        command_timeout_seconds=1,
    )
    sent = []

    async def execute(command):
        sent.append(command)
        return result

    state.execute_command = execute
    return create_mcp_server(state), sent


@pytest.mark.asyncio
async def test_the_widgets_json_schema_resource_is_the_users_schema_from_the_browser():
    schema = {"$id": "workspace://widgets-schema/abc", "x-types": ["markdown"], "definitions": {}}
    server, sent = _server_answering(
        WorkspaceCommandResult(ok=True, command="get_widgets_schema", message="ok", data={"schema": schema})
    )

    listed = next(r for r in await server.list_resources() if str(r.uri) == WIDGETS_JSON_SCHEMA_URI)
    assert listed.mime_type == "application/schema+json"
    assert LIVE_RESOURCE_TAG in listed.tags

    result = await server.read_resource(WIDGETS_JSON_SCHEMA_URI)
    assert json.loads(result.contents[0].content) == schema
    assert [command.command for command in sent] == ["get_widgets_schema"]


@pytest.mark.asyncio
async def test_the_widgets_json_schema_resource_fails_without_a_browser():
    server, _ = _server_answering(
        WorkspaceCommandResult(
            ok=False,
            command="get_widgets_schema",
            message="No FINOS Workspace browser session is connected.",
        )
    )

    with pytest.raises(Exception, match="No FINOS Workspace browser session is connected"):
        await server.read_resource(WIDGETS_JSON_SCHEMA_URI)
