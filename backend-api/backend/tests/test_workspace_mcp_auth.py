import json
from contextlib import asynccontextmanager
from uuid import UUID

import pytest


MCP_HEADERS = {"Accept": "application/json, text/event-stream"}


@asynccontextmanager
async def mcp_running():
    """Starts the MCP app's session manager, which httpx's ASGI transport does not do."""
    from main import workspace_mcp_asgi_app

    async with workspace_mcp_asgi_app.lifespan(workspace_mcp_asgi_app):
        yield


def rpc_message(response) -> dict:
    """The JSON-RPC message of a streamable-HTTP response (plain JSON or one SSE event)."""
    if response.headers["content-type"].startswith("text/event-stream"):
        data = [line for line in response.text.splitlines() if line.startswith("data:")]
        return json.loads(data[-1].removeprefix("data:").strip())
    return response.json()


def test_workspace_mcp_token_helpers_generate_hash_and_prefix():
    from routers.app.workspace_mcp.auth import (
        WORKSPACE_MCP_TOKEN_PREFIX,
        display_token_prefix,
        generate_workspace_mcp_token,
        hash_workspace_mcp_token,
    )

    token = generate_workspace_mcp_token()
    other_token = generate_workspace_mcp_token()

    assert token.startswith(WORKSPACE_MCP_TOKEN_PREFIX)
    assert other_token.startswith(WORKSPACE_MCP_TOKEN_PREFIX)
    assert token != other_token
    assert len(token.removeprefix(WORKSPACE_MCP_TOKEN_PREFIX)) >= 43
    assert hash_workspace_mcp_token(token) == hash_workspace_mcp_token(token)
    assert hash_workspace_mcp_token(token) != token
    assert display_token_prefix(token) == token[:20]


def test_workspace_mcp_auth_failure_does_not_advertise_oauth():
    from routers.app.workspace_mcp.auth import workspace_mcp_credentials_exception

    assert "WWW-Authenticate" not in (workspace_mcp_credentials_exception.headers or {})


@pytest.mark.asyncio
async def test_mcp_endpoint_rejects_missing_and_malformed_auth(client):
    request = {"jsonrpc": "2.0", "id": 1, "method": "tools/list"}
    async with mcp_running():
        missing = await client.post("/mcp", headers=MCP_HEADERS, json=request)
        malformed = await client.post(
            "/mcp", headers={**MCP_HEADERS, "Authorization": "Basic abc"}, json=request
        )
        unknown = await client.post(
            "/mcp",
            headers={**MCP_HEADERS, "Authorization": "Bearer ws_mcp_unknown"},
            json=request,
        )

    assert missing.status_code == 401
    assert malformed.status_code == 401
    assert unknown.status_code == 401
    assert "resource_metadata" not in unknown.headers.get("www-authenticate", "")


@pytest.mark.asyncio
async def test_mcp_get_is_not_registered_as_one_shot_transport(client):
    response = await client.get("/mcp")

    assert response.status_code == 405


@pytest.mark.asyncio
async def test_unknown_path_returns_404_not_credential_error(client):
    response = await client.post(
        "/app/adfasdfasfd",
        json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
    )

    assert response.status_code == 404
    assert "Could not validate Workspace MCP credentials" not in response.text


@pytest.mark.asyncio
async def test_mcp_endpoint_rejects_revoked_token(auth_client, client):
    create_response = await auth_client.post(
        "/app/workspace-mcp/tokens",
        json={"name": "Revoked token"},
    )
    token = create_response.json()["token"]
    token_uuid = create_response.json()["uuid"]

    await auth_client.delete(f"/app/workspace-mcp/tokens/{token_uuid}")

    async with mcp_running():
        response = await client.post(
            "/mcp",
            headers={**MCP_HEADERS, "Authorization": f"Bearer {token}"},
            json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
        )

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_mcp_tool_call_with_valid_token_returns_no_browser_connected(
    auth_client, client
):
    create_response = await auth_client.post(
        "/app/workspace-mcp/tokens",
        json={"name": "Agent"},
    )
    payload = create_response.json()

    assert UUID(payload["uuid"])

    async with mcp_running():
        response = await client.post(
            "/mcp",
            headers={**MCP_HEADERS, "Authorization": f"Bearer {payload['token']}"},
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": "get_workspace_snapshot", "arguments": {}},
            },
        )

    # An MCP tool call always answers 200; the tool reports that no browser is connected
    assert response.status_code == 200
    result = rpc_message(response)["result"]
    assert result["structuredContent"]["ok"] is False
    assert result["structuredContent"]["error"]["code"] == "unavailable"
