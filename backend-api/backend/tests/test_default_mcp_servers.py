"""
Tests for the MCP servers that every user has by default (``DEFAULT_MCP_SERVERS``).

The service that serves the Copilot is registered this way in a deployment, so that its tools
are there without each user adding the server. What a user stores under the same URL wins, so
they can still switch a default off.
"""

import os
import sys
from unittest.mock import patch

BACKEND_DIR = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import pytest

from tests.fixtures.base import settings
from utilities.config import DefaultMCPServer

TOOLS_URL = "http://tools.internal:8787/mcp"
DEFAULT = DefaultMCPServer(id="tools", name="Tools", url=TOOLS_URL)
USER_SERVER = {
    "id": "mine",
    "name": "Mine",
    "url": "https://mcp.example.com/mcp",
    "enabled": True,
    "tools": [],
}


async def _servers(client, stored: list[dict]) -> list[dict]:
    """What the backend returns for a user who stores ``stored``."""
    response = await client.post("/app/mcp-servers", json={"servers": stored})
    assert response.status_code == 200, response.text
    return response.json()["servers"]


class TestDefaultMcpServers:
    @pytest.mark.asyncio
    async def test_nothing_is_added_when_none_are_configured(self, auth_client):
        with patch.object(settings, "DEFAULT_MCP_SERVERS", []):
            assert await _servers(auth_client, []) == []

    @pytest.mark.asyncio
    async def test_a_user_without_servers_has_the_defaults_enabled(self, auth_client):
        with patch.object(settings, "DEFAULT_MCP_SERVERS", [DEFAULT]):
            servers = await _servers(auth_client, [])
        assert [(s["id"], s["name"], s["url"], s["enabled"]) for s in servers] == [
            ("tools", "Tools", TOOLS_URL, True)
        ]

    @pytest.mark.asyncio
    async def test_defaults_come_before_the_servers_a_user_added(self, auth_client):
        with patch.object(settings, "DEFAULT_MCP_SERVERS", [DEFAULT]):
            servers = await _servers(auth_client, [USER_SERVER])
        assert [s["id"] for s in servers] == ["tools", "mine"]

    @pytest.mark.asyncio
    async def test_a_stored_server_with_the_same_url_wins(self, auth_client):
        switched_off = {
            "id": "tools",
            "name": "Tools",
            "url": TOOLS_URL + "/",  # stored URLs are compared without a trailing slash
            "enabled": False,
            "tools": [],
        }
        with patch.object(settings, "DEFAULT_MCP_SERVERS", [DEFAULT]):
            servers = await _servers(auth_client, [switched_off])
        assert len(servers) == 1
        assert servers[0]["enabled"] is False

    @pytest.mark.asyncio
    async def test_the_defaults_are_not_stored(self, auth_client):
        """Taking the default away from the configuration takes it away from every user."""
        with patch.object(settings, "DEFAULT_MCP_SERVERS", [DEFAULT]):
            await _servers(auth_client, [USER_SERVER])
        with patch.object(settings, "DEFAULT_MCP_SERVERS", []):
            servers = await _servers(auth_client, [USER_SERVER])
        assert [s["id"] for s in servers] == ["mine"]


class TestDefaultMcpServersSetting:
    def test_it_is_read_from_a_json_environment_variable(self):
        from utilities.config import Settings

        env = {
            "DEFAULT_MCP_SERVERS": f'[{{"id": "tools", "name": "Tools", "url": "{TOOLS_URL}"}}]'
        }
        with patch.dict(os.environ, env):
            loaded = Settings()  # type: ignore[call-arg]
        assert loaded.DEFAULT_MCP_SERVERS == [DEFAULT]
