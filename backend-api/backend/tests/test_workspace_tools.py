"""
Tests for the Workspace's tools as the agent in the web app is given them.

The tools are those of the Workspace MCP server that external hosts use, with the same
descriptions and schemas. The user is signed in, so the endpoints are asked with the session token,
and a call is turned into the command that the user's tab runs.
"""

import asyncio
import json
from pathlib import Path
from unittest.mock import patch

import pytest

from api import schemas

SURFACE = Path(__file__).parent / "fixtures" / "workspace_mcp_sidecar_surface.json"
PATH = "/app/workspace-tools"
PREPARE = f"{PATH}/prepare"
ACCESS = "routers.app.workspace_tools.app_helpers.get_user_copilot_access"


def external_tools() -> dict[str, dict]:
    """The tools of the server that external hosts use."""
    tools = json.loads(SURFACE.read_text(encoding="utf-8"))["surface"]["tools"]
    return {tool["name"]: tool for tool in tools}


def restricted_to(url: str, *names: str) -> schemas.CopilotAccess:
    """The access of a user whose roles grant only these tools of the Workspace's server."""
    return schemas.CopilotAccess(
        models=[],
        mcp=[schemas.McpGrant(server_url=url, tool_name=name) for name in names],
        models_restricted=False,
        mcp_restricted=True,
        disabled_capabilities=[],
    )


class TestWorkspaceTools:
    @pytest.mark.asyncio
    async def test_the_session_token_is_needed(self, client):
        assert (await client.get(PATH)).status_code in {401, 403}
        response = await client.post(PREPARE, json={"name": "get_widget_data", "arguments": {}})
        assert response.status_code in {401, 403}

    @pytest.mark.asyncio
    async def test_the_tools_are_those_that_external_hosts_have(self, auth_client):
        response = await auth_client.get(PATH)
        assert response.status_code == 200, response.text
        listed = {tool["name"]: tool for tool in response.json()["tools"]}
        external = external_tools()
        assert listed.keys() == external.keys()
        for name, tool in listed.items():
            assert tool["description"] == external[name]["description"]
            assert tool["inputSchema"] == external[name]["parameters"]

    @pytest.mark.asyncio
    async def test_the_tools_say_where_their_server_is(self, auth_client):
        url = (await auth_client.get(PATH)).json()["url"]
        assert url == f"http://test{PATH}"

    @pytest.mark.asyncio
    async def test_the_server_is_where_the_proxy_prefix_says(self, auth_client):
        response = await auth_client.get(PATH, headers={"X-Forwarded-Prefix": "/api/"})
        assert response.json()["url"] == f"http://test/api{PATH}"

    @pytest.mark.asyncio
    async def test_only_the_tools_the_roles_grant_are_listed(self, auth_client):
        url = f"http://test{PATH}"
        access = restricted_to(url, "get_widget_data", "read_widget")
        with patch(ACCESS, return_value=access):
            response = await auth_client.get(PATH)
        assert sorted(tool["name"] for tool in response.json()["tools"]) == [
            "get_widget_data",
            "read_widget",
        ]

    @pytest.mark.asyncio
    async def test_a_role_that_grants_another_server_grants_none_of_these(self, auth_client):
        access = restricted_to("https://mcp.example.com/mcp", "get_widget_data")
        with patch(ACCESS, return_value=access):
            response = await auth_client.get(PATH)
        assert response.json()["tools"] == []


class TestPrepare:
    @pytest.mark.asyncio
    async def test_a_call_comes_to_the_command_the_tab_runs(self, auth_client):
        response = await auth_client.post(
            PREPARE,
            json={
                "name": "get_widget_data",
                "arguments": {
                    "origin": "Options",
                    "widget_id": "chain",
                    "data_args": {"symbol": "AAPL"},
                    "widget_uuid": "w-1",
                },
            },
        )
        assert response.status_code == 200, response.text
        assert response.json() == {
            "command": {
                "command": "get_widget_data",
                "request_id": None,
                "data_sources": [
                    {
                        "origin": "Options",
                        "id": "chain",
                        "input_args": {"symbol": "AAPL"},
                        "widget_uuid": "w-1",
                    }
                ],
            },
            "result": None,
        }

    @pytest.mark.asyncio
    async def test_a_tool_that_renames_its_arguments_has_them_renamed(self, auth_client):
        response = await auth_client.post(
            PREPARE,
            json={
                "name": "create_widget",
                "arguments": {
                    "origin": "Options",
                    "widget_id": "chain",
                    "data_args": {"symbol": "AAPL"},
                },
            },
        )
        command = response.json()["command"]
        assert command["command"] == "create_widget"
        assert command["backend_name"] == "Options"
        assert command["config"]["data_args"] == {"symbol": "AAPL"}

    @pytest.mark.asyncio
    async def test_a_call_that_is_not_valid_has_no_command_but_the_tools_answer(self, auth_client):
        response = await auth_client.post(PREPARE, json={"name": "read_widget", "arguments": {}})
        body = response.json()
        assert body["command"] is None
        assert body["result"]["ok"] is False
        assert body["result"]["error"]["code"] == "invalid_request"
        assert "widget_uuid" in body["result"]["message"]

    @pytest.mark.asyncio
    async def test_arguments_of_the_wrong_kind_are_answered_the_same_way(self, auth_client):
        response = await auth_client.post(PREPARE, json={"name": "update_widget_layout", "arguments": {"x": "left"}})
        body = response.json()
        assert body["command"] is None
        assert body["result"]["ok"] is False
        assert body["result"]["error"]["code"] == "invalid_request"
        assert body["result"]["command"] == "update_widget_layout"

    @pytest.mark.asyncio
    async def test_a_tool_that_does_not_exist_is_not_found(self, auth_client):
        response = await auth_client.post(PREPARE, json={"name": "no_such_tool", "arguments": {}})
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_a_tool_the_roles_do_not_grant_is_refused(self, auth_client):
        access = restricted_to(f"http://test{PATH}", "read_widget")
        with patch(ACCESS, return_value=access):
            refused = await auth_client.post(
                PREPARE,
                json={
                    "name": "delete_widget",
                    "arguments": {"widget_uuid": "w-1"},
                },
            )
            allowed = await auth_client.post(
                PREPARE,
                json={"name": "read_widget", "arguments": {"widget_uuid": "w-1"}},
            )
        assert refused.status_code == 403
        assert allowed.json()["command"]["command"] == "read_widget"

    @pytest.mark.asyncio
    async def test_calls_at_the_same_time_do_not_take_each_others_commands(self):
        from routers.app.workspace_tools import prepare

        results = await asyncio.gather(*(prepare("read_widget", {"widget_uuid": f"w-{i}"}) for i in range(50)))
        assert [result.command["widget_uuid"] for result in results] == [f"w-{i}" for i in range(50)]

    @pytest.mark.asyncio
    async def test_every_tool_of_the_server_can_be_prepared(self, auth_client):
        """A tool that cannot hand its command over would leave the agent with a tool that never runs."""
        samples: dict[str, dict] = {
            "get_workspace_snapshot": {},
            "get_widget_data": {"origin": "o", "widget_id": "w"},
            "list_available_widgets": {},
            "get_widget_schema": {"origin": "o", "widget_id": "w"},
            "get_params_options": {"origin": "o", "widget_id": "w", "param_name": "p"},
            "read_widget": {"widget_uuid": "u"},
            "create_widget": {"origin": "o", "widget_id": "w"},
            "update_widget": {"widget_uuid": "u", "data_args": {"a": 1}},
            "update_widget_layout": {"widget_uuid": "u", "x": 0, "y": 0, "w": 1, "h": 1},
            "delete_widget": {"widget_uuid": "u"},
            "manage_dashboard": {"operation": "read", "dashboard_id": "d"},
            "manage_navigation_bar": {
                "operation": "create",
                "tabs": [{"name": "Tab"}],
            },
            "navigate_workspace": {"operation": "dashboard", "dashboard_id": "d"},
            "add_generative_widget": {"widget_type": "note", "data": "text"},
            "manage_backends": {"operation": "list"},
            "manage_apps": {"operation": "list"},
            "assign_tasks_to_agents": {
                "task_requests": [
                    {
                        "id": "t",
                        "description": "d",
                        "assigned_holder_url": "https://agent.example.com",
                        "assigned_agent_id": "a",
                    }
                ]
            },
            "get_skill_content": {"slug": "s"},
        }
        assert samples.keys() == external_tools().keys()
        for name, arguments in samples.items():
            response = await auth_client.post(PREPARE, json={"name": name, "arguments": arguments})
            assert response.status_code == 200, (name, response.text)
            body = response.json()
            assert body["command"] is not None, (name, body)
