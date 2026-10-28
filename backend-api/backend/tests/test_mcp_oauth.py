"""MCP credentials stay with the API: sign-in (OAuth) and the MCP proxy.

The API signs the user in to a remote MCP server: POST /app/mcp-oauth/start discovers the
authorization server, registers a client and answers the sign-in address (PKCE, a state
kept encrypted in Redis for one use); POST /app/mcp-oauth/complete exchanges the code and
keeps the grant encrypted, keyed by the hash of the server's URL; POST
/app/mcp-oauth/disconnect forgets it. The MCP proxy names the server, attaches the user's
stored headers and the grant's token (refreshed under a lock) to requests under the
server's path (or to the messages endpoint an SSE server announced), drops the browser's
own credentials, reaches public addresses only, follows no redirect, and passes back the
protocol's headers only. Only the web app, by its session cookie, reaches these routes.

The MCP and authorization servers here are fakes, reached through the API's own address
check (tests/fixtures/mcp_network.py): no test uses a network.
"""

import asyncio
import base64
import hashlib
import json
from types import SimpleNamespace
from urllib.parse import parse_qsl, unquote
from uuid import UUID, uuid4

import httpx
import pytest
from loguru import logger
from sqlalchemy import delete, select, text

from api import crypto, models
from routers.app import mcp_oauth
from tests.fixtures.base import (
    _AUTH_USER,
    _SECOND_USER,
    _create_session_record,
    bearer_client,
    settings,
)
from tests.fixtures.mcp_network import FakeHosts, FakeNetwork

USER_UUID = UUID(_AUTH_USER["user_uuid"])
MCP_URL = "https://mcp.example.com/mcp"
AUTH = "https://auth.example.com"
CALLBACK = "http://test/oauth/callback"
RESOURCE_METADATA = "https://mcp.example.com/.well-known/oauth-protected-resource/mcp"
TOOLS_URL = "https://tools.example.com/api/mcp"
SSE_URL = "https://sse.example.com/sse"
SSE_MESSAGES = "https://sse.example.com/messages/?session_id=abc"
# Public addresses of the fake hosts; nothing connects to them
ADDRESSES = {
    "mcp.example.com": "93.184.215.14",
    "auth.example.com": "93.184.215.15",
    "tools.example.com": "93.184.215.16",
    "elsewhere.example.com": "93.184.215.17",
    "moved.example.com": "93.184.215.18",
    "sse.example.com": "93.184.215.19",
}
BROWSER_HEADERS = {
    "Accept": "application/json, text/event-stream",
    "Content-Type": "application/json",
}
TOOLS_LIST = {"jsonrpc": "2.0", "id": 1, "method": "tools/list"}


def _s256(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode()).digest()
    return base64.urlsafe_b64encode(digest).decode().rstrip("=")


def _mcp_answer() -> httpx.Response:
    return httpx.Response(
        200,
        json={"jsonrpc": "2.0", "id": 1, "result": {"tools": []}},
        headers={
            "Mcp-Session-Id": "session-1",
            "Set-Cookie": "upstream=tracking",
            "Access-Control-Allow-Origin": "*",
            "X-Powered-By": "fake",
        },
    )


class FakeAuthorizationServer:
    """auth.example.com: metadata (RFC 8414), registration (RFC 7591) and tokens."""

    def __init__(self) -> None:
        self.clients: dict[str, dict] = {}
        self.registrations: list[dict] = []
        self.codes: dict[str, dict] = {}
        self.refresh_tokens: dict[str, str] = {}
        self.access_tokens: set[str] = set()
        self.token_requests: list[dict] = []
        self.issued = 0
        # The status a refresh answers with instead of a token, while it is set
        self.refresh_status: int | None = None

    def handle(self, request: httpx.Request) -> httpx.Response:
        if request.url.path == "/.well-known/oauth-authorization-server":
            return httpx.Response(
                200,
                json={
                    "issuer": AUTH,
                    "authorization_endpoint": f"{AUTH}/authorize",
                    "token_endpoint": f"{AUTH}/token",
                    "registration_endpoint": f"{AUTH}/register",
                    "response_types_supported": ["code"],
                    "grant_types_supported": ["authorization_code", "refresh_token"],
                    "code_challenge_methods_supported": ["S256"],
                    "scopes_supported": ["mcp", "offline_access"],
                },
            )
        if request.url.path == "/register" and request.method == "POST":
            return self._register(json.loads(request.content))
        if request.url.path == "/token" and request.method == "POST":
            return self._token(request)
        return httpx.Response(404)

    def _register(self, body: dict) -> httpx.Response:
        self.registrations.append(body)
        client_id = f"client-{len(self.clients) + 1}"
        self.clients[client_id] = {
            "secret": f"secret-of-{client_id}",
            "redirect_uris": body["redirect_uris"],
        }
        return httpx.Response(
            201,
            json={
                **body,
                "client_id": client_id,
                "client_secret": f"secret-of-{client_id}",
                "token_endpoint_auth_method": "client_secret_basic",
            },
        )

    def sign_in(self, authorization_url: str) -> tuple[str, str]:
        """The user signs in at the address the API answered: the code and the state the
        browser comes back to the web app with."""
        url = httpx.URL(authorization_url)
        assert (url.host, url.path) == ("auth.example.com", "/authorize")
        params = dict(url.params)
        assert params["redirect_uri"] in self.clients[params["client_id"]]["redirect_uris"]
        code = f"code-{len(self.codes) + 1}"
        self.codes[code] = params
        return code, params["state"]

    def _client(self, request: httpx.Request, form: dict) -> str | None:
        scheme, _, credentials = request.headers.get("authorization", "").partition(" ")
        if scheme != "Basic":
            return None
        client_id, _, secret = base64.b64decode(credentials).decode().partition(":")
        client_id, secret = unquote(client_id), unquote(secret)
        if self.clients.get(client_id, {}).get("secret") != secret:
            return None
        return client_id if form.get("client_id") == client_id else None

    def _token(self, request: httpx.Request) -> httpx.Response:
        form = dict(parse_qsl(request.content.decode()))
        self.token_requests.append(form)
        client_id = self._client(request, form)
        if client_id is None:
            return httpx.Response(401, json={"error": "invalid_client"})
        if form.get("grant_type") == "authorization_code":
            params = self.codes.pop(form.get("code", ""), None)
            if (
                params is None
                or params["client_id"] != client_id
                or params["redirect_uri"] != form.get("redirect_uri")
                or params["code_challenge"] != _s256(form.get("code_verifier", ""))
                or params["resource"] != form.get("resource")
            ):
                return httpx.Response(400, json={"error": "invalid_grant"})
        elif form.get("grant_type") == "refresh_token":
            if self.refresh_status is not None:
                return httpx.Response(self.refresh_status, json={"error": "temporarily_unavailable"})
            if self.refresh_tokens.pop(form.get("refresh_token", ""), None) != client_id:
                return httpx.Response(400, json={"error": "invalid_grant"})
        else:
            return httpx.Response(400, json={"error": "unsupported_grant_type"})
        self.issued += 1
        access, refresh = f"access-{self.issued}", f"refresh-{self.issued}"
        self.access_tokens.add(access)
        self.refresh_tokens[refresh] = client_id
        return httpx.Response(
            200,
            json={
                "access_token": access,
                "token_type": "bearer",
                "expires_in": 3600,
                "refresh_token": refresh,
            },
        )


class FakeMcpServer:
    """mcp.example.com: an MCP server that takes the tokens of auth.example.com."""

    def __init__(self, auth: FakeAuthorizationServer, resource: str = MCP_URL) -> None:
        self.auth = auth
        self.resource = resource
        self.authorization_server = AUTH
        self.tokens_seen: list[str | None] = []

    def handle(self, request: httpx.Request) -> httpx.Response:
        if request.url.path == "/.well-known/oauth-protected-resource/mcp":
            return httpx.Response(
                200,
                json={
                    "resource": self.resource,
                    "authorization_servers": [self.authorization_server],
                    "scopes_supported": ["mcp"],
                },
            )
        if request.url.path != "/mcp":
            return httpx.Response(404)
        authorization = request.headers.get("authorization")
        self.tokens_seen.append(authorization)
        if (authorization or "").removeprefix("Bearer ") not in self.auth.access_tokens:
            return httpx.Response(
                401,
                headers={
                    "WWW-Authenticate": (
                        f'Bearer resource_metadata="{RESOURCE_METADATA}", scope="mcp"'
                    )
                },
            )
        return _mcp_answer()


class FakeSseServer:
    """sse.example.com: an MCP server of the SSE transport, which announces its messages
    endpoint on the stream and takes a key header."""

    def __init__(self) -> None:
        self.posts: list[httpx.Request] = []

    def handle(self, request: httpx.Request) -> httpx.Response:
        if request.headers.get("x-api-key") != "sse-key":
            return httpx.Response(401)
        if request.method == "GET" and request.url.path == "/sse":
            return httpx.Response(
                200,
                headers={"Content-Type": "text/event-stream"},
                content=b"event: endpoint\r\ndata: /messages/?session_id=abc\r\n\r\n",
            )
        if request.method == "POST" and request.url.path == "/messages/":
            self.posts.append(request)
            return httpx.Response(202, text="Accepted")
        return httpx.Response(404)


def _tools_server(request: httpx.Request) -> httpx.Response:
    """tools.example.com: a server that takes a static token and a key header."""
    if (
        request.headers.get("x-api-key") != "key-1"
        or request.headers.get("authorization") != "Bearer static-token"
    ):
        return httpx.Response(401)
    return _mcp_answer()


@pytest.fixture
async def servers(monkeypatch, db_session):
    hosts = FakeHosts()
    auth = FakeAuthorizationServer()
    mcp = FakeMcpServer(auth)
    sse = FakeSseServer()
    for host, address in ADDRESSES.items():
        hosts.add(host, address)
    hosts.add("mcp.example.com", ADDRESSES["mcp.example.com"], handler=mcp.handle)
    hosts.add("auth.example.com", ADDRESSES["auth.example.com"], handler=auth.handle)
    hosts.add("tools.example.com", ADDRESSES["tools.example.com"], handler=_tools_server)
    hosts.add("sse.example.com", ADDRESSES["sse.example.com"], handler=sse.handle)
    hosts.add("intranet.example.com", "10.0.0.7", handler=lambda request: _mcp_answer())
    monkeypatch.setattr(mcp_oauth, "resolve_host", hosts.resolve)
    client = mcp_oauth.create_mcp_http_client(FakeNetwork(hosts))
    monkeypatch.setattr(mcp_oauth, "mcp_http", client)

    yield SimpleNamespace(hosts=hosts, auth=auth, mcp=mcp, sse=sse)

    await client.aclose()
    user_uuids = [USER_UUID, UUID(_SECOND_USER["user_uuid"])]
    for model in (models.MCPOAuthGrant, models.MCPServers):
        await db_session.execute(delete(model).where(model.user_uuid.in_(user_uuids)))
    await db_session.commit()
    redis = settings.get_redis_session("app")
    for pattern in ("mcp_oauth_state:*", "mcp_oauth_refresh:*", "mcp_sse_endpoint:*"):
        for key in redis.keys(pattern):
            redis.delete(key)


def _proxy(client, server_url=MCP_URL, url=None, headers=None):
    return client.post(
        "/app/mcp-proxy",
        json={
            "server_url": server_url,
            "url": url or server_url,
            "method": "POST",
            "headers": headers or BROWSER_HEADERS,
            "body": TOOLS_LIST,
        },
    )


async def _start(client, server_url=MCP_URL) -> httpx.Response:
    return await client.post("/app/mcp-oauth/start", json={"server_url": server_url})


async def _sign_in(client, servers) -> None:
    started = await _start(client)
    assert started.status_code == 200, started.text
    code, state = servers.auth.sign_in(started.json()["authorization_url"])
    completed = await client.post(
        "/app/mcp-oauth/complete", json={"code": code, "state": state}
    )
    assert completed.status_code == 200, completed.text
    assert completed.json() == {"server_url": MCP_URL}


async def _grant(db_session) -> models.MCPOAuthGrant | None:
    # The routes ran on this session too: a new transaction sees what other sessions wrote
    await db_session.commit()
    db_session.expire_all()
    return (
        await db_session.execute(
            select(models.MCPOAuthGrant).where(models.MCPOAuthGrant.user_uuid == USER_UUID)
        )
    ).scalar_one_or_none()


async def _expire_the_token(db_session) -> None:
    grant = await _grant(db_session)
    grant.credentials = {**grant.credentials, "expires_at": 0}
    await db_session.commit()


class TestSignIn:
    @pytest.mark.asyncio
    async def test_the_proxy_asks_for_a_sign_in_the_server_wants(self, auth_client, servers):
        response = await _proxy(auth_client)

        assert response.status_code == 401
        assert response.json() == {"auth_required": True, "server_url": MCP_URL}

    @pytest.mark.asyncio
    async def test_start_discovers_registers_and_answers_where_to_sign_in(
        self, auth_client, servers
    ):
        response = await _start(auth_client, "https://MCP.example.com/mcp/")

        assert response.status_code == 200, response.text
        url = httpx.URL(response.json()["authorization_url"])
        params = dict(url.params)
        assert f"{url.scheme}://{url.host}{url.path}" == f"{AUTH}/authorize"
        assert params["response_type"] == "code"
        assert params["client_id"] == "client-1"
        assert params["redirect_uri"] == CALLBACK
        assert params["code_challenge_method"] == "S256"
        assert len(params["code_challenge"]) == 43
        assert params["resource"] == MCP_URL
        # The challenge's scope, and a refresh token the authorization server offers
        assert params["scope"] == "mcp offline_access"
        assert params["prompt"] == "consent"
        assert len(params["state"]) >= 43

        # The challenge named the resource metadata; the issuer's metadata followed
        paths = [request.url.path for request in servers.hosts.requests]
        assert paths[:3] == [
            "/mcp",
            "/.well-known/oauth-protected-resource/mcp",
            "/.well-known/oauth-authorization-server",
        ]
        assert servers.auth.registrations == [
            {
                "redirect_uris": [CALLBACK],
                "response_types": ["code"],
                "scope": "mcp offline_access",
                "client_name": "FINOS Workspace",
                "grant_types": ["authorization_code", "refresh_token"],
                "application_type": "web",
            }
        ]

    @pytest.mark.asyncio
    async def test_the_state_is_kept_encrypted_under_its_hash_for_ten_minutes(
        self, auth_client, servers
    ):
        response = await _start(auth_client)
        state = dict(httpx.URL(response.json()["authorization_url"]).params)["state"]

        redis = settings.get_redis_session("app")
        key = f"mcp_oauth_state:{hashlib.sha256(state.encode()).hexdigest()}"
        sealed = redis.get(key)
        assert sealed.startswith(b"v2.")
        assert b"secret-of-client-1" not in sealed
        # Encrypted for its key: under another key it does not decrypt
        assert crypto.decrypt_json(sealed.decode(), key)["user_uuid"] == str(USER_UUID)
        with pytest.raises(crypto.DecryptionError):
            crypto.decrypt_json(sealed.decode(), "mcp_oauth_state:other")
        assert 0 < redis.ttl(key) <= 600
        assert not [key for key in redis.keys("*") if state.encode() in key]

    @pytest.mark.asyncio
    async def test_complete_keeps_the_grant_encrypted_and_the_proxy_uses_it(
        self, auth_client, servers, db_session
    ):
        await _sign_in(auth_client, servers)

        # The code went with its PKCE verifier and the client's own credentials
        exchange = servers.auth.token_requests[-1]
        assert exchange["grant_type"] == "authorization_code"
        assert exchange["redirect_uri"] == CALLBACK
        assert exchange["resource"] == MCP_URL
        # Keyed by the hash of the server's URL, which may carry a credential: the URL is
        # inside the ciphertext only, with the user
        raw = (
            await db_session.execute(
                text("SELECT credentials FROM mcp_oauth_grant WHERE server_hash = :hash"),
                {"hash": hashlib.sha256(MCP_URL.encode()).hexdigest()},
            )
        ).scalar_one()
        assert raw.startswith("v2.")
        for secret in ("access-1", "refresh-1", "secret-of-client-1", "mcp.example.com"):
            assert secret not in raw
        grant = await _grant(db_session)
        assert grant.credentials["user_uuid"] == str(USER_UUID)
        assert grant.credentials["server_url"] == MCP_URL

        response = await _proxy(auth_client)

        assert response.status_code == 200, response.text
        assert servers.mcp.tokens_seen[-1] == "Bearer access-1"

    @pytest.mark.asyncio
    async def test_a_state_completes_one_sign_in(self, auth_client, servers):
        started = await _start(auth_client)
        code, state = servers.auth.sign_in(started.json()["authorization_url"])
        body = {"code": code, "state": state}

        assert (await auth_client.post("/app/mcp-oauth/complete", json=body)).status_code == 200
        again = await auth_client.post("/app/mcp-oauth/complete", json=body)
        assert again.status_code == 400

    @pytest.mark.asyncio
    async def test_a_state_completes_the_sign_in_of_its_own_session(
        self, auth_client, second_user_client, servers
    ):
        started = await _start(auth_client)
        code, state = servers.auth.sign_in(started.json()["authorization_url"])

        stolen = await second_user_client.post(
            "/app/mcp-oauth/complete", json={"code": code, "state": state}
        )

        assert stolen.status_code == 400
        assert servers.auth.token_requests == []

    @pytest.mark.asyncio
    async def test_an_expired_token_is_refreshed(self, auth_client, servers, db_session):
        await _sign_in(auth_client, servers)
        await _expire_the_token(db_session)

        response = await _proxy(auth_client)

        assert response.status_code == 200, response.text
        assert servers.mcp.tokens_seen[-1] == "Bearer access-2"
        refresh = servers.auth.token_requests[-1]
        assert refresh["grant_type"] == "refresh_token"
        assert refresh["refresh_token"] == "refresh-1"
        assert refresh["resource"] == MCP_URL
        grant = await _grant(db_session)
        assert grant.credentials["token"]["refresh_token"] == "refresh-2"

    @pytest.mark.asyncio
    async def test_a_refused_token_is_refreshed_and_sent_again(self, auth_client, servers):
        await _sign_in(auth_client, servers)
        servers.auth.access_tokens.discard("access-1")

        response = await _proxy(auth_client)

        assert response.status_code == 200, response.text
        assert servers.mcp.tokens_seen[-2:] == ["Bearer access-1", "Bearer access-2"]

    @pytest.mark.asyncio
    async def test_a_refused_refresh_asks_for_a_new_sign_in(
        self, auth_client, servers, db_session
    ):
        await _sign_in(auth_client, servers)
        servers.auth.access_tokens.discard("access-1")
        servers.auth.refresh_tokens.clear()

        response = await _proxy(auth_client)

        assert response.status_code == 401
        assert response.json() == {"auth_required": True, "server_url": MCP_URL}
        assert await _grant(db_session) is None

    @pytest.mark.asyncio
    @pytest.mark.parametrize("answer", [408, 429, 503])
    async def test_a_server_that_cannot_answer_now_keeps_the_grant(self, auth_client, servers, db_session, answer):
        await _sign_in(auth_client, servers)
        await _expire_the_token(db_session)
        servers.auth.refresh_status = answer

        await _proxy(auth_client)

        assert await _grant(db_session) is not None
        servers.auth.refresh_status = None
        response = await _proxy(auth_client)
        assert response.status_code == 200, response.text
        assert servers.mcp.tokens_seen[-1] == "Bearer access-2"

    @pytest.mark.asyncio
    async def test_one_request_refreshes_at_a_time(self, auth_client, servers, db_session):
        await _sign_in(auth_client, servers)
        await _expire_the_token(db_session)

        headers = await asyncio.gather(
            *[mcp_oauth.grant_authorization(USER_UUID, MCP_URL) for _ in range(3)]
        )

        assert headers == ["Bearer access-2"] * 3
        refreshes = [
            request
            for request in servers.auth.token_requests
            if request["grant_type"] == "refresh_token"
        ]
        assert len(refreshes) == 1

    @pytest.mark.asyncio
    async def test_disconnecting_forgets_the_grant(self, auth_client, servers, db_session):
        await _sign_in(auth_client, servers)

        # The server's URL goes in the body, never in a query string
        response = await auth_client.post(
            "/app/mcp-oauth/disconnect", json={"server_url": "https://MCP.example.com/mcp/"}
        )

        assert response.status_code == 204
        assert await _grant(db_session) is None
        assert (await _proxy(auth_client)).status_code == 401
        gone = await auth_client.delete("/app/mcp-oauth/grant", params={"server_url": MCP_URL})
        assert gone.status_code in {404, 405}

    @pytest.mark.asyncio
    async def test_the_routes_are_the_web_apps_own(self, auth_client, servers, db_session):
        await _sign_in(auth_client, servers)
        servers.hosts.requests.clear()
        session_uuid = uuid4()
        token = await _create_session_record(
            db_session, _AUTH_USER["user_uuid"], str(session_uuid), "app"
        )
        try:
            # A session of the user's, sent as a bearer: only the web app's cookie is one
            async with bearer_client(token) as bearer:
                responses = [
                    await _start(bearer),
                    await _proxy(bearer),
                    await bearer.post("/app/mcp-oauth/disconnect", json={"server_url": MCP_URL}),
                    await bearer.post(
                        "/app/mcp-servers/local-headers",
                        json={"url": "http://localhost:8123/mcp"},
                    ),
                ]
        finally:
            await db_session.execute(
                delete(models.Session).where(models.Session.uuid == session_uuid)
            )
            await db_session.commit()
        assert [response.status_code for response in responses] == [401] * 4
        assert servers.hosts.requests == []
        assert await _grant(db_session) is not None

    @pytest.mark.asyncio
    async def test_a_grant_moved_to_another_users_row_is_not_used(
        self, auth_client, second_user_client, servers, db_session
    ):
        """A write to the database without the key: another user's grant row gets the
        victim's ciphertext. It decrypts in its column, but names another user."""
        await _sign_in(auth_client, servers)
        victim = (
            await db_session.execute(
                text("SELECT credentials FROM mcp_oauth_grant WHERE user_uuid = UNHEX(:u)"),
                {"u": USER_UUID.hex},
            )
        ).scalar_one()
        second = UUID(_SECOND_USER["user_uuid"])
        db_session.add(
            models.MCPOAuthGrant(
                user_uuid=second,
                server_hash=mcp_oauth.server_hash(MCP_URL),
                credentials={"user_uuid": str(second), "server_url": MCP_URL},
            )
        )
        await db_session.commit()
        await db_session.execute(
            text("UPDATE mcp_oauth_grant SET credentials = :raw WHERE user_uuid = UNHEX(:u)"),
            {"raw": victim, "u": second.hex},
        )
        await db_session.commit()

        response = await _proxy(second_user_client)

        assert response.status_code == 401
        assert response.json() == {"auth_required": True, "server_url": MCP_URL}
        assert servers.mcp.tokens_seen[-1] is None

    @pytest.mark.asyncio
    async def test_a_grant_moved_to_another_server_is_not_used(
        self, auth_client, servers, db_session
    ):
        """The row's server hash rewritten to another server's: the grant's own server
        URL is not that server's, so its token does not go there."""
        await _sign_in(auth_client, servers)
        await db_session.execute(
            text("UPDATE mcp_oauth_grant SET server_hash = :hash WHERE user_uuid = UNHEX(:u)"),
            {"hash": mcp_oauth.server_hash(TOOLS_URL), "u": USER_UUID.hex},
        )
        await db_session.commit()

        response = await _proxy(auth_client, TOOLS_URL)

        assert response.status_code == 401
        sent = servers.hosts.requests_to("tools.example.com")
        assert [request.headers.get("authorization") for request in sent] == [None]


class TestSignInReachesPublicAddressesOnly:
    @pytest.mark.asyncio
    async def test_an_authorization_server_on_a_private_address_is_refused(
        self, auth_client, servers
    ):
        servers.mcp.authorization_server = "http://169.254.169.254"

        response = await _start(auth_client)

        assert response.status_code == 400
        assert "169.254.169.254" in response.json()["detail"]
        assert ("169.254.169.254", 80) not in servers.hosts.connections

    @pytest.mark.asyncio
    async def test_a_server_on_a_private_address_is_refused(self, auth_client, servers):
        for server_url in ("http://10.0.0.1/mcp", "http://intranet.example.com/mcp"):
            response = await _start(auth_client, server_url)
            assert response.status_code == 400
        assert servers.hosts.connections == []

    @pytest.mark.asyncio
    async def test_metadata_of_another_resource_is_refused(self, auth_client, servers):
        servers.mcp.resource = "https://elsewhere.example.com/mcp"

        response = await _start(auth_client)

        assert response.status_code == 502
        assert servers.auth.registrations == []


class TestSignInErrorsNameNoUrl:
    """A server's path may carry its credential, and so may the URLs built from it (the
    metadata's): a failed sign-in says what failed without them, in its answer and in the
    log, where the error's text goes."""

    SECRET = "path-secret-789"

    async def _start_and_log(self, auth_client, server_url=MCP_URL):
        lines: list[str] = []
        # As the app's own sinks: no values of local variables (utilities/log_helpers.py)
        sink = logger.add(
            lambda message: lines.append(str(message)),
            level="DEBUG",
            diagnose=False,
            backtrace=False,
        )
        try:
            response = await _start(auth_client, server_url)
        finally:
            logger.remove(sink)
        assert response.status_code == 502
        assert self.SECRET not in response.text
        assert self.SECRET not in "".join(lines)
        return response

    @pytest.mark.asyncio
    async def test_an_answer_too_large(self, auth_client, servers):
        servers.hosts.handlers["elsewhere.example.com"] = lambda request: httpx.Response(
            200, content=b"x" * (mcp_oauth.MAX_ANSWER_BYTES + 1)
        )

        response = await self._start_and_log(
            auth_client, f"https://elsewhere.example.com/api/mcp/s/{self.SECRET}/mcp"
        )

        assert "too much data" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_metadata_of_another_resource(self, auth_client, servers):
        servers.mcp.resource = f"https://mcp.example.com/api/mcp/s/{self.SECRET}/mcp"

        response = await self._start_and_log(auth_client)

        assert "another resource" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_an_authorization_server_without_metadata(self, auth_client, servers):
        servers.mcp.authorization_server = f"https://elsewhere.example.com/{self.SECRET}"

        response = await self._start_and_log(auth_client)

        assert "publishes no metadata" in response.json()["detail"]


class TestTheProxy:
    @pytest.mark.asyncio
    async def test_the_stored_headers_replace_the_browsers_own(self, auth_client, servers):
        saved = await auth_client.post(
            "/app/mcp-servers",
            json={
                "servers": [
                    {
                        "id": "tools",
                        "name": "Tools",
                        "url": TOOLS_URL,
                        "enabled": True,
                        "customHeaders": {
                            "X-Api-Key": "key-1",
                            "Authorization": "Bearer static-token",
                        },
                    }
                ]
            },
        )
        assert saved.status_code == 200, saved.text

        response = await _proxy(
            auth_client,
            TOOLS_URL,
            headers={
                **BROWSER_HEADERS,
                "Authorization": "Bearer from-the-browser",
                "x-api-key": "from-the-browser",
                "Cookie": "workspace=session",
                "X-Forwarded-For": "10.0.0.1",
                "Mcp-Session-Id": "session-1",
            },
        )

        assert response.status_code == 200, response.text
        sent = servers.hosts.requests_to("tools.example.com")[-1]
        assert sent.headers["x-api-key"] == "key-1"
        assert sent.headers.get_list("authorization") == ["Bearer static-token"]
        assert sent.headers["mcp-session-id"] == "session-1"
        assert "cookie" not in sent.headers
        assert "x-forwarded-for" not in sent.headers

    @pytest.mark.asyncio
    async def test_the_stored_headers_go_to_their_server_only(self, auth_client, servers):
        await auth_client.post(
            "/app/mcp-servers",
            json={
                "servers": [
                    {
                        "id": "tools",
                        "name": "Tools",
                        "url": TOOLS_URL,
                        "enabled": True,
                        "customHeaders": {"X-Api-Key": "key-1"},
                    }
                ]
            },
        )

        # Naming the saved server, but going elsewhere
        for url in ("https://elsewhere.example.com/api/mcp", "https://tools.example.com/admin"):
            response = await _proxy(auth_client, TOOLS_URL, url)
            assert response.status_code == 422
        # Another server on the same host
        await _proxy(auth_client, "https://tools.example.com/other/mcp")

        assert [r.url.path for r in servers.hosts.requests] == ["/other/mcp"]
        assert "x-api-key" not in servers.hosts.requests[0].headers

    @pytest.mark.asyncio
    async def test_the_stored_headers_stay_under_the_servers_path(self, auth_client, servers):
        """A server at https://host/mcp: its credentials, and the tool grants for it, do
        not reach the host's other paths."""
        server_url = "https://tools.example.com/mcp"
        await auth_client.post(
            "/app/mcp-servers",
            json={
                "servers": [
                    {
                        "id": "tools",
                        "name": "Tools",
                        "url": server_url,
                        "enabled": True,
                        "customHeaders": {"X-Api-Key": "key-1"},
                    }
                ]
            },
        )

        for url in (
            "https://tools.example.com/admin/mcp",
            "https://tools.example.com/",
            "https://tools.example.com/mcpx",
        ):
            response = await _proxy(auth_client, server_url, url)
            assert response.status_code == 422, url
        assert servers.hosts.requests_to("tools.example.com") == []

    @pytest.mark.asyncio
    async def test_the_messages_endpoint_an_sse_server_announced(self, auth_client, servers):
        saved = await auth_client.post(
            "/app/mcp-servers",
            json={
                "servers": [
                    {
                        "id": "sse",
                        "name": "SSE",
                        "url": SSE_URL,
                        "enabled": True,
                        "customHeaders": {"X-Api-Key": "sse-key"},
                    }
                ]
            },
        )
        assert saved.status_code == 200, saved.text

        # Beside the server's path, until the server announces it
        assert (await _proxy(auth_client, SSE_URL, SSE_MESSAGES)).status_code == 422

        stream = await auth_client.post(
            "/app/mcp-proxy",
            json={
                "server_url": SSE_URL,
                "url": SSE_URL,
                "method": "GET",
                "headers": {"Accept": "text/event-stream"},
            },
        )
        assert stream.status_code == 200, stream.text
        assert b"event: endpoint" in stream.content

        accepted = await _proxy(auth_client, SSE_URL, SSE_MESSAGES)
        assert accepted.status_code == 202, accepted.text
        assert [request.headers["x-api-key"] for request in servers.sse.posts] == ["sse-key"]

        # Only the endpoint it announced, and only for messages
        for url in (
            "https://sse.example.com/messages/?session_id=other",
            "https://sse.example.com/admin",
        ):
            assert (await _proxy(auth_client, SSE_URL, url)).status_code == 422, url
        get = await auth_client.post(
            "/app/mcp-proxy",
            json={"server_url": SSE_URL, "url": SSE_MESSAGES, "method": "GET"},
        )
        assert get.status_code == 422
        assert len(servers.sse.posts) == 1
        # Recorded by its hash only
        redis = settings.get_redis_session("app")
        keys = redis.keys("mcp_sse_endpoint:*")
        assert len(keys) == 1 and b"session_id" not in keys[0]

    @pytest.mark.asyncio
    async def test_only_the_protocols_headers_come_back(self, auth_client, servers, db_session):
        await _sign_in(auth_client, servers)

        response = await _proxy(auth_client)

        assert response.status_code == 200
        assert response.json()["result"] == {"tools": []}
        assert response.headers["mcp-session-id"] == "session-1"
        assert response.headers["content-type"] == "application/json"
        assert "set-cookie" not in response.headers
        assert "x-powered-by" not in response.headers
        # The API's own CORS answer for the web app, not the server's
        assert response.headers["access-control-allow-origin"] == "http://test"
        assert "mcp-session-id" in response.headers["access-control-expose-headers"]

    @pytest.mark.asyncio
    async def test_redirects_are_refused(self, auth_client, servers):
        servers.hosts.handlers["moved.example.com"] = lambda request: httpx.Response(
            307, headers={"Location": "http://169.254.169.254/latest/meta-data/"}
        )

        response = await _proxy(auth_client, "https://moved.example.com/mcp")

        assert response.status_code == 502
        assert "location" not in response.headers
        assert [address for address, _ in servers.hosts.connections] == [
            ADDRESSES["moved.example.com"]
        ]

    @pytest.mark.asyncio
    async def test_a_failed_connection_logs_the_host_only(self, auth_client, servers):
        """A server's path or query may carry a credential: the error log names the host."""
        server_url = "https://unreachable.example.com/api/mcp/s/path-secret-123/mcp"
        lines: list[str] = []
        # As the app's own sinks: no values of local variables (utilities/log_helpers.py)
        sink = logger.add(
            lambda message: lines.append(str(message)),
            level="DEBUG",
            diagnose=False,
            backtrace=False,
        )
        try:
            response = await _proxy(auth_client, f"{server_url}?api_key=query-secret-456")
        finally:
            logger.remove(sink)

        assert response.status_code == 502
        logged = "".join(lines)
        assert "the MCP server at unreachable.example.com: ConnectError" in logged
        assert "path-secret-123" not in logged
        assert "query-secret-456" not in logged

    @pytest.mark.asyncio
    async def test_servers_on_private_addresses_are_refused(self, auth_client, servers):
        for server_url in (
            "http://127.0.0.1:8000/mcp",
            "http://[::1]/mcp",
            "http://169.254.169.254/mcp",
            "http://intranet.example.com/mcp",
        ):
            response = await _proxy(auth_client, server_url)
            assert response.status_code == 403, server_url
        assert servers.hosts.connections == []

    @pytest.mark.asyncio
    async def test_the_deployments_own_servers_are_reached(
        self, auth_client, servers, monkeypatch
    ):
        monkeypatch.setattr(settings, "ALLOWED_MCP_HOSTNAMES", ["intranet.example.com"])

        response = await _proxy(auth_client, "http://intranet.example.com/mcp")

        assert response.status_code == 200
