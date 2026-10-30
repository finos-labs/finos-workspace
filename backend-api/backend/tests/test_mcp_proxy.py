import httpx
import pytest
from pydantic import ValidationError

from routers.app import mcp_oauth
from routers.app.index import (
    MCPProxyRequest,
    _first_sse_event,
    _watch_sse_announcement,
    under_mcp_server_path,
)
from tests.fixtures.mcp_network import FakeHosts, FakeNetwork
from utilities.config import DefaultMCPServer, settings

SERVER = "https://mcp.example.com/mcp"
PUBLIC = "93.184.215.14"


def _ok(request: httpx.Request) -> httpx.Response:
    return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": {}})


@pytest.fixture
def hosts(monkeypatch):
    hosts = FakeHosts()
    monkeypatch.setattr(mcp_oauth, "resolve_host", hosts.resolve)
    return hosts


@pytest.fixture
async def mcp_client(hosts):
    async with mcp_oauth.create_mcp_http_client(FakeNetwork(hosts)) as client:
        yield client


class TestTheRequestGoesToTheServerItNames:
    @pytest.mark.parametrize(
        ("server_url", "url"),
        [
            (SERVER, SERVER),
            (SERVER, "https://mcp.example.com/mcp?session=1"),
            ("https://MCP.example.com/mcp/", "https://mcp.example.com/mcp"),
            (SERVER, "https://mcp.example.com/mcp/"),
            (SERVER, "https://mcp.example.com/mcp/messages"),
            ("https://mcp.example.com", "https://mcp.example.com/mcp"),
            ("https://mcp.example.com/", "https://mcp.example.com/"),
        ],
    )
    def test_requests_to_the_servers_path_or_under_it(self, server_url, url):
        request = MCPProxyRequest(server_url=server_url, url=url, method="POST", body={})
        assert under_mcp_server_path(request.server_url, request.url)

    @pytest.mark.parametrize(
        ("server_url", "url"),
        [
            (SERVER, "https://mcp.example.com/admin/mcp"),
            (SERVER, "https://mcp.example.com/"),
            (SERVER, "https://mcp.example.com/mcpx"),
            ("https://gw.example.com/v1/alice", "https://gw.example.com/v1/mallory"),
            ("https://tools.example.com/api/mcp", "https://tools.example.com/apis/mcp"),
            ("https://tools.example.com/api/mcp", "https://tools.example.com/api/mcp/../../admin"),
            ("https://tools.example.com/api/mcp", "https://tools.example.com/api/../admin"),
            ("https://mcp.example.com/sse", "https://mcp.example.com/messages/?session_id=1"),
            ("https://h.example.com/a/b/sse", "https://h.example.com/a/b/messages/"),
        ],
    )
    def test_other_paths_of_the_host_are_not_the_servers(self, server_url, url):
        request = MCPProxyRequest(server_url=server_url, url=url, method="POST", body={})
        assert not under_mcp_server_path(request.server_url, request.url)

    @pytest.mark.parametrize(
        "url",
        [
            "https://other.example.com/api/mcp",
            "http://tools.example.com/api/mcp",
            "https://tools.example.com:8443/api/mcp",
            "https://tools.example.com/api/%2e%2e/admin",
            "https://tools.example.com/api/mcp/%2e%2e/%2e%2e/admin",
        ],
    )
    def test_requests_elsewhere_are_refused(self, url):
        with pytest.raises(ValidationError, match="the MCP server it names"):
            MCPProxyRequest(server_url="https://tools.example.com/api/mcp", url=url)

    @pytest.mark.parametrize(
        "url",
        ["ftp://mcp.example.com/mcp", "mcp.example.com/mcp", "https://user:pw@mcp.example.com/mcp"],
    )
    def test_only_web_urls_without_credentials(self, url):
        with pytest.raises(ValidationError):
            MCPProxyRequest(server_url=url, url=url)

    def test_the_server_is_named(self):
        with pytest.raises(ValidationError, match="server_url"):
            MCPProxyRequest(url=SERVER)


class TestTheSseAnnouncement:
    @pytest.mark.parametrize(
        ("start", "event"),
        [
            (
                b"event: endpoint\r\ndata: /messages/?session_id=1\r\n\r\n",
                {"event": "endpoint", "data": "/messages/?session_id=1"},
            ),
            (b"event:endpoint\ndata:/m\n\n", {"event": "endpoint", "data": "/m"}),
            (b": ping\n\nevent: endpoint\ndata: /m\n\n", {"event": "endpoint", "data": "/m"}),
            (b'data: {"jsonrpc": "2.0"}\n\n', {"data": '{"jsonrpc": "2.0"}'}),
            (b"event: endpoint\ndata: /m\n", None),
            (b"", None),
        ],
    )
    def test_the_first_event(self, start, event):
        assert _first_sse_event(start) == event

    @pytest.mark.asyncio
    async def test_the_endpoint_is_recorded_before_the_browser_sees_it(self):
        seen: list[str] = []

        async def chunks():
            yield b"event: endp"
            yield b"oint\r\ndata: /messages/?session_id=abc\r"
            assert seen == []
            yield b"\n\r\n"
            assert seen == ["/messages/?session_id=abc"]
            yield b'event: message\ndata: {"id": 1}\n\n'

        async def record(endpoint: str) -> None:
            seen.append(endpoint)

        passed = [chunk async for chunk in _watch_sse_announcement(chunks(), record)]

        assert b"".join(passed).startswith(b"event: endpoint\r\n")
        assert seen == ["/messages/?session_id=abc"]

    @pytest.mark.asyncio
    async def test_only_a_first_endpoint_event_is_recorded(self):
        seen: list[str] = []

        async def chunks():
            yield b'event: message\ndata: {"id": 1}\n\n'
            yield b"event: endpoint\ndata: /admin\n\n"

        async def record(endpoint: str) -> None:
            seen.append(endpoint)

        assert len([chunk async for chunk in _watch_sse_announcement(chunks(), record)]) == 2
        assert seen == []


class TestPublicAddresses:
    @pytest.mark.parametrize("address", [PUBLIC, "8.8.8.8", "2606:4700::1111"])
    def test_public(self, address):
        assert mcp_oauth.is_public_address(address)

    @pytest.mark.parametrize(
        "address",
        [
            "127.0.0.1",
            "10.0.0.1",
            "172.16.0.1",
            "192.168.1.1",
            "169.254.169.254",
            "100.100.100.200",
            "100.64.0.1",
            "0.0.0.0",  # noqa: S104
            "224.0.0.1",
            "255.255.255.255",
            "::1",
            "::",
            "fe80::1",
            "fd00:ec2::254",
            "::ffff:127.0.0.1",
            "::ffff:169.254.169.254",
            "64:ff9b::a9fe:a9fe",
            "ff02::1",
        ],
    )
    def test_not_public(self, address):
        assert not mcp_oauth.is_public_address(address)


class TestTheMcpClient:
    @pytest.mark.asyncio
    async def test_it_connects_to_the_address_it_checked(self, hosts, mcp_client):
        hosts.add("mcp.example.com", PUBLIC, handler=_ok)

        response = await mcp_client.post(SERVER, json={})

        assert response.status_code == 200
        assert hosts.connections == [(PUBLIC, 443)]
        assert hosts.tls_names == ["mcp.example.com"]
        assert hosts.requests[0].headers["host"] == "mcp.example.com"

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "url",
        [
            "http://127.0.0.1:8080/mcp",
            "http://localhost/mcp",
            "http://[::1]/mcp",
            "http://169.254.169.254/latest/meta-data/",
            "http://10.0.0.1/mcp",
            "http://[::ffff:127.0.0.1]/mcp",
            "http://[fd00:ec2::254]/latest/meta-data/",
        ],
    )
    async def test_it_refuses_addresses_that_are_not_public(self, hosts, mcp_client, url):
        hosts.add("localhost", "127.0.0.1", "::1")

        with pytest.raises(mcp_oauth.BlockedAddressError):
            await mcp_client.get(url)
        assert hosts.connections == []

    @pytest.mark.asyncio
    async def test_it_refuses_names_of_such_addresses(self, hosts, mcp_client):
        hosts.add("intranet.example.com", "10.0.0.7", handler=_ok)
        hosts.add("mixed.example.com", PUBLIC, "127.0.0.1", handler=_ok)

        for url in ("http://intranet.example.com/mcp", "https://mixed.example.com/mcp"):
            with pytest.raises(mcp_oauth.BlockedAddressError):
                await mcp_client.post(url, json={})
        assert hosts.connections == []

    @pytest.mark.asyncio
    async def test_the_deployments_own_servers_may_be_private(
        self, hosts, mcp_client, monkeypatch
    ):
        monkeypatch.setattr(settings, "ALLOWED_MCP_HOSTNAMES", ["Intranet.example.com"])
        hosts.add("intranet.example.com", "10.0.0.7", handler=_ok)

        response = await mcp_client.post("http://intranet.example.com/mcp", json={})

        assert response.status_code == 200
        assert hosts.connections == [("intranet.example.com", 80)]

    @pytest.mark.asyncio
    async def test_the_default_servers_may_be_private_on_their_own_port(
        self, hosts, mcp_client, monkeypatch
    ):
        monkeypatch.setattr(
            settings,
            "DEFAULT_MCP_SERVERS",
            [DefaultMCPServer(id="tools", name="Tools", url="http://Agent-MCP:8787/mcp")],
        )
        hosts.add("agent-mcp", "172.18.0.5", handler=_ok)

        response = await mcp_client.post("http://agent-mcp:8787/mcp", json={})

        assert response.status_code == 200
        assert hosts.connections == [("agent-mcp", 8787)]
        with pytest.raises(mcp_oauth.BlockedAddressError):
            await mcp_client.get("http://agent-mcp:9000/")
        assert hosts.connections == [("agent-mcp", 8787)]

    @pytest.mark.asyncio
    async def test_a_host_that_does_not_resolve_is_not_reached(self, hosts, mcp_client):
        with pytest.raises(httpx.ConnectError):
            await mcp_client.get("https://nowhere.example.com/mcp")
        assert hosts.connections == []

    @pytest.mark.asyncio
    async def test_it_follows_no_redirect(self, hosts, mcp_client):
        hosts.add(
            "mcp.example.com",
            PUBLIC,
            handler=lambda request: httpx.Response(
                307, headers={"Location": "http://169.254.169.254/latest/meta-data/"}
            ),
        )

        response = await mcp_client.post(SERVER, json={})

        assert response.status_code == 307
        assert hosts.connections == [(PUBLIC, 443)]

    @pytest.mark.asyncio
    async def test_it_keeps_no_cookie(self, hosts, mcp_client):
        def set_cookie(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={}, headers={"Set-Cookie": "session=one-user"})

        hosts.add("mcp.example.com", PUBLIC, handler=set_cookie)

        await mcp_client.post(SERVER, json={})
        await mcp_client.post(SERVER, json={})

        assert [request.headers.get("cookie") for request in hosts.requests] == [None, None]
        assert not mcp_client.cookies
