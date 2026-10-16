"""The Workspace bridge websocket carries no token.

The web app starts a bridge session with its session cookie and opens the socket at a URL
with the session's id only. Before the handshake is accepted the socket must come from an
allowed origin with a valid web session cookie, for that user's active bridge session;
anything else is refused. The standalone sidecar admits its page by origin the same way.
"""

import importlib
from uuid import UUID, uuid4

import pytest
from fastapi import WebSocketDisconnect
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect as StarletteDisconnect

from api import auth_helpers
from routers.app.workspace_mcp.bridge import BridgeSessionManager
from routers.app.workspace_mcp.schemas import BrowserSessionStartRequest
from tests.fixtures.base import _AUTH_USER, _SECOND_USER, TEST_ORIGIN
from tests.test_workspace_mcp_bridge import FakeAsyncRedis
from workspace_mcp.app import create_app
from workspace_mcp.config import Settings as SidecarSettings

# The module: the package exports its APIRouter under the same name
bridge_router = importlib.import_module("routers.app.workspace_mcp.router")
AUTH_USER = UUID(_AUTH_USER["user_uuid"])


class FakeWebSocket:
    """A handshake as Starlette hands it to the route."""

    def __init__(self, *, origin: str | None, cookie: str | None, session_id: str):
        self.headers = {"origin": origin} if origin else {}
        self.cookies = {auth_helpers.SESSION_COOKIE: cookie} if cookie else {}
        self.query_params = {"session_id": session_id}
        self.accepted = False
        self.close_code: int | None = None
        self.sent: list = []

    async def accept(self) -> None:
        self.accepted = True

    async def close(self, code: int = 1000) -> None:
        self.close_code = code

    async def send_json(self, data) -> None:
        self.sent.append(data)

    async def receive_json(self):
        raise WebSocketDisconnect()


@pytest.fixture
async def bridge(monkeypatch):
    manager = BridgeSessionManager(redis_client=FakeAsyncRedis(), worker_id="test")
    monkeypatch.setattr(bridge_router, "bridge_manager", manager)
    yield manager
    if manager._listener_task is not None:
        manager._listener_task.cancel()


async def _start(manager: BridgeSessionManager, user_uuid: UUID) -> str:
    started = await manager.start_session(
        user_uuid=user_uuid,
        request=BrowserSessionStartRequest(client_name="workspace-ui"),
        base_url="https://test/",
    )
    return started.session.session_id


def _cookie(web_client) -> str:
    return web_client.headers["Cookie"].split("=", 1)[1]


class TestTheBridgeSocket:
    @pytest.mark.asyncio
    async def test_session_start_hands_out_no_token(self, auth_client):
        response = await auth_client.post(
            "/app/workspace-mcp/bridge/session/start", json={"client_name": "workspace-ui"}
        )
        assert response.status_code == 200, response.text
        data = response.json()
        assert "token" not in data["session"]
        assert data["websocket_url"].endswith(
            f"/app/workspace-mcp/bridge/ws?session_id={data['session']['session_id']}"
        )

    @pytest.mark.asyncio
    async def test_the_web_apps_socket_is_admitted(self, auth_client, bridge):
        session_id = await _start(bridge, AUTH_USER)
        socket = FakeWebSocket(
            origin=TEST_ORIGIN, cookie=_cookie(auth_client), session_id=session_id
        )
        await bridge_router.bridge_websocket(socket)

        assert socket.accepted
        ready = socket.sent[0]
        assert ready["type"] == "session_ready"
        assert ready["session"]["session_id"] == session_id
        assert "token" not in ready["session"]

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("origin", "with_cookie"),
        [
            ("http://localhost:9999", True),
            (None, True),
            (TEST_ORIGIN, False),
        ],
    )
    async def test_refused_before_the_handshake_is_accepted(
        self, auth_client, bridge, origin, with_cookie
    ):
        session_id = await _start(bridge, AUTH_USER)
        socket = FakeWebSocket(
            origin=origin,
            cookie=_cookie(auth_client) if with_cookie else None,
            session_id=session_id,
        )
        await bridge_router.bridge_websocket(socket)
        assert not socket.accepted
        assert socket.close_code == 1008

    @pytest.mark.asyncio
    async def test_a_cookie_opens_its_own_users_active_session_only(
        self, auth_client, second_user_client, bridge
    ):
        others = await _start(bridge, UUID(_SECOND_USER["user_uuid"]))
        socket = FakeWebSocket(origin=TEST_ORIGIN, cookie=_cookie(auth_client), session_id=others)
        await bridge_router.bridge_websocket(socket)
        assert (socket.accepted, socket.close_code) == (False, 1008)

        replaced = await _start(bridge, AUTH_USER)
        await _start(bridge, AUTH_USER)
        socket = FakeWebSocket(
            origin=TEST_ORIGIN, cookie=_cookie(auth_client), session_id=replaced
        )
        await bridge_router.bridge_websocket(socket)
        assert (socket.accepted, socket.close_code) == (False, 1008)

    @pytest.mark.asyncio
    async def test_an_unknown_or_ended_session_cookie_is_refused(self, client, bridge):
        session_id = await _start(bridge, AUTH_USER)
        socket = FakeWebSocket(origin=TEST_ORIGIN, cookie="not-a-session", session_id=session_id)
        await bridge_router.bridge_websocket(socket)
        assert (socket.accepted, socket.close_code) == (False, 1008)


class TestTheSidecar:
    ORIGIN = "http://localhost:1420"

    def _client(self) -> TestClient:
        return TestClient(create_app(SidecarSettings(cors_allow_origins=(self.ORIGIN,))))

    def test_session_start_needs_an_allowed_origin(self):
        client = self._client()
        assert client.post("/bridge/session/start", json={}).status_code == 403
        response = client.post(
            "/bridge/session/start", json={}, headers={"Origin": "http://localhost:9999"}
        )
        assert response.status_code == 403

        response = client.post("/bridge/session/start", json={}, headers={"Origin": self.ORIGIN})
        assert response.status_code == 200
        data = response.json()
        assert "token" not in data["session"]
        assert "token=" not in data["websocket_url"]

    def test_the_socket_is_admitted_by_origin_and_session(self):
        client = self._client()
        started = client.post(
            "/bridge/session/start", json={}, headers={"Origin": self.ORIGIN}
        ).json()
        session_id = started["session"]["session_id"]

        for origin, sid in (
            ("http://localhost:9999", session_id),
            (self.ORIGIN, str(uuid4())),
        ):
            with (
                pytest.raises(StarletteDisconnect) as refused,
                client.websocket_connect(
                    f"/bridge/ws?session_id={sid}", headers={"Origin": origin}
                ),
            ):
                pass
            assert refused.value.code == 1008

        with client.websocket_connect(
            f"/bridge/ws?session_id={session_id}", headers={"Origin": self.ORIGIN}
        ) as socket:
            ready = socket.receive_json()
        assert ready["type"] == "session_ready"
        assert "token" not in ready["session"]
