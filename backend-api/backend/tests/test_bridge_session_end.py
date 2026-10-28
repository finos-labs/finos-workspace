import asyncio
import importlib
from contextlib import asynccontextmanager
from datetime import timedelta
from uuid import UUID, uuid4

import pytest
from fastapi import WebSocketDisconnect
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, update

from api import auth_helpers, models
from api.base import get_now
from routers.app.workspace_mcp.bridge import (
    SESSION_ENDED_CLOSE_CODE,
    BridgeSessionManager,
    BrowserUnavailableError,
)
from routers.app.workspace_mcp.schemas import BrowserSessionStartRequest
from tests.fixtures.base import (
    TEST_BASE_URL,
    TEST_ORIGIN,
    WEB_HEADERS,
    app,
    web_session_headers,
)
from tests.test_workspace_mcp_bridge import FakeAsyncRedis, FakeSocket

bridge_router = importlib.import_module("routers.app.workspace_mcp.router")

PASSWORD = "TestPassword123!"  # noqa: S105
SNAPSHOT = {"command": "get_workspace_snapshot"}


class SessionFlag:
    def __init__(self):
        self.lasts = True

    async def __call__(self) -> bool:
        return self.lasts


def _result(request_id: str) -> dict:
    return {
        "type": "command_result",
        "result": {
            "ok": True,
            "command": "get_workspace_snapshot",
            "request_id": request_id,
            "message": "ok",
            "data": {},
        },
    }


async def _start(manager: BridgeSessionManager, user_uuid: UUID) -> str:
    started = await manager.start_session(
        user_uuid=user_uuid,
        request=BrowserSessionStartRequest(client_name="workspace-ui"),
        base_url="https://test/",
    )
    return started.session.session_id


async def _connect(
    manager: BridgeSessionManager, user_uuid: UUID, socket, authorized
) -> str:
    session_id = await _start(manager, user_uuid)
    await manager.connect_browser(
        session_id=session_id, user_uuid=user_uuid, socket=socket, authorized=authorized
    )
    return session_id


async def _sent(socket) -> list:
    for _ in range(200):
        if socket.sent:
            break
        await asyncio.sleep(0.005)
    return socket.sent


@pytest.fixture
async def manager():
    manager = BridgeSessionManager(redis_client=FakeAsyncRedis(), worker_id="test")
    yield manager
    if manager._listener_task is not None:
        manager._listener_task.cancel()


class TestTheBridge:
    @pytest.mark.asyncio
    async def test_no_command_reaches_a_socket_whose_session_ended(self, manager):
        user, socket, session = uuid4(), FakeSocket(), SessionFlag()
        await _connect(manager, user, socket, session)

        session.lasts = False
        with pytest.raises(BrowserUnavailableError):
            await manager.execute_command(user, SNAPSHOT)

        assert socket.sent == []
        assert socket.close_code == SESSION_ENDED_CLOSE_CODE
        assert user not in manager._active_by_user
        assert await manager._get_presence(user) is None

    @pytest.mark.asyncio
    async def test_a_message_after_the_session_ended_closes_the_socket(self, manager):
        user, socket, session = uuid4(), FakeSocket(), SessionFlag()
        await _connect(manager, user, socket, session)
        await manager.handle_browser_message(user, {"type": "ping"}, socket)
        assert socket.sent[-1] == {"type": "pong"}

        session.lasts = False
        with pytest.raises(BrowserUnavailableError):
            await manager.handle_browser_message(user, {"type": "ping"}, socket)
        assert socket.close_code == SESSION_ENDED_CLOSE_CODE
        assert user not in manager._active_by_user

    @pytest.mark.asyncio
    async def test_a_pending_command_fails_when_the_session_ends(self, manager):
        user, socket, session = uuid4(), FakeSocket(), SessionFlag()
        await _connect(manager, user, socket, session)
        command = asyncio.create_task(manager.execute_command(user, SNAPSHOT))
        await _sent(socket)

        session.lasts = False
        with pytest.raises(BrowserUnavailableError):
            await manager.check_session(user, socket)
        result = await asyncio.wait_for(command, 1)
        assert result["ok"] is False
        assert socket.close_code == SESSION_ENDED_CLOSE_CODE

    @pytest.mark.asyncio
    async def test_the_worker_holding_the_socket_closes_it_for_another_worker(self):
        broker: dict = {"channels": {}, "store": {}}
        holder = BridgeSessionManager(redis_client=FakeAsyncRedis(broker), worker_id="h")
        caller = BridgeSessionManager(redis_client=FakeAsyncRedis(broker), worker_id="c")
        user, socket, session = uuid4(), FakeSocket(), SessionFlag()
        try:
            await _connect(holder, user, socket, session)
            await asyncio.sleep(0)

            session.lasts = False
            result = await asyncio.wait_for(caller.execute_command(user, SNAPSHOT), 2)
            assert result["ok"] is False
            assert result["error"]["code"] == "unavailable"
            assert socket.sent == []
            assert socket.close_code == SESSION_ENDED_CLOSE_CODE
        finally:
            for worker in (holder, caller):
                if worker._listener_task is not None:
                    worker._listener_task.cancel()

    @pytest.mark.asyncio
    async def test_a_new_bridge_session_closes_the_socket_it_replaces(self, manager):
        user, session = uuid4(), SessionFlag()
        old, new = FakeSocket(), FakeSocket()
        await _connect(manager, user, old, session)

        await _start(manager, user)
        assert old.closed

        await _connect(manager, user, new, session)
        command = asyncio.create_task(manager.execute_command(user, SNAPSHOT))
        request_id = (await _sent(new))[0]["command"]["request_id"]

        for message in (_result(request_id), {"type": "ping"}):
            with pytest.raises(BrowserUnavailableError):
                await manager.handle_browser_message(user, message, old)
        await manager.disconnect_browser(user, old)
        assert manager._active_by_user[user].socket is new
        assert not command.done()

        await manager.handle_browser_message(user, _result(request_id), new)
        assert (await asyncio.wait_for(command, 1))["ok"] is True

    @pytest.mark.asyncio
    async def test_a_second_socket_on_the_same_session_closes_the_first(self, manager):
        user, session = uuid4(), SessionFlag()
        first, second = FakeSocket(), FakeSocket()
        session_id = await _connect(manager, user, first, session)

        await manager.connect_browser(
            session_id=session_id, user_uuid=user, socket=second, authorized=session
        )
        assert first.closed
        with pytest.raises(BrowserUnavailableError):
            await manager.handle_browser_message(user, {"type": "ping"}, first)
        assert manager._active_by_user[user].socket is second


class BridgeTab:
    def __init__(self, cookie: str, session_id: str):
        self.headers = {"origin": TEST_ORIGIN}
        self.cookies = {auth_helpers.SESSION_COOKIE: cookie}
        self.query_params = {"session_id": session_id}
        self.accepted = False
        self.close_code: int | None = None
        self.sent: list = []
        self._closed = asyncio.Event()

    async def accept(self) -> None:
        self.accepted = True

    async def close(self, code: int = 1000) -> None:
        if self._closed.is_set():
            raise RuntimeError("The socket is closed")
        self.close_code = code
        self._closed.set()

    async def send_json(self, data) -> None:
        self.sent.append(data)

    async def receive_json(self):
        await self._closed.wait()
        raise WebSocketDisconnect(self.close_code or 1000)


@pytest.fixture
async def bridge(monkeypatch):
    manager = BridgeSessionManager(redis_client=FakeAsyncRedis(), worker_id="test")
    monkeypatch.setattr(bridge_router, "bridge_manager", manager)
    monkeypatch.setattr(bridge_router, "SESSION_CHECK_SECONDS", 0.05)
    yield manager
    if manager._listener_task is not None:
        manager._listener_task.cancel()


async def _open_tab(manager, user_uuid: UUID, cookie: str) -> tuple[BridgeTab, asyncio.Task]:
    tab = BridgeTab(cookie, await _start(manager, user_uuid))
    serving = asyncio.create_task(bridge_router.bridge_websocket(tab))
    assert (await _sent(tab))[0]["type"] == "session_ready"
    assert tab.accepted
    return tab, serving


@asynccontextmanager
async def _browser(headers: dict[str, str] | None = None):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url=TEST_BASE_URL, headers=headers or {}
    ) as browser:
        yield browser


async def _sign_in(browser, email: str):
    response = await browser.post(
        "/app/login",
        json={"email": email, "password": PASSWORD, "source": "app", "version": "v1.0.0"},
    )
    assert response.status_code == 200, response.text
    return response


class TestTheSocketClosesWhenItsSessionEnds:
    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "how", ["sign-out", "new sign-in", "password change", "password reset"]
    )
    async def test_the_socket_closes(self, how, organization, admin_client, bridge):
        user = await organization.add_user(password=PASSWORD)
        async with _browser(WEB_HEADERS) as web:
            await _sign_in(web, user.email)
            tab, serving = await _open_tab(
                bridge, user.uuid, web.cookies[auth_helpers.SESSION_COOKIE]
            )

            if how == "sign-out":
                assert (await web.post("/app/logout")).status_code == 200
            elif how == "new sign-in":
                async with _browser(WEB_HEADERS) as other:
                    await _sign_in(other, user.email)
            elif how == "password change":
                other = await auth_helpers.create_login_token(
                    organization.db, user.uuid, timedelta(hours=1), app_session=True, source="app"
                )
                async with _browser(web_session_headers(other)) as elsewhere:
                    response = await elsewhere.put(
                        "/user",
                        json={"old_password": PASSWORD, "new_password": "NewPassword456!"},
                    )
                    assert response.status_code == 200, response.text
            else:
                response = await admin_client.post(f"/admin/reset-password/{user.uuid}")
                assert response.status_code == 200, response.text

            await asyncio.wait_for(serving, 3)
        assert tab.close_code == SESSION_ENDED_CLOSE_CODE
        assert user.uuid not in bridge._active_by_user

    @pytest.mark.asyncio
    async def test_the_socket_closes_when_the_session_expires(
        self, organization, db_session, bridge, monkeypatch
    ):
        monkeypatch.setattr(bridge_router, "SESSION_CHECK_SECONDS", 60.0)
        user = await organization.add_user(password=PASSWORD)
        async with _browser(WEB_HEADERS) as web:
            await _sign_in(web, user.email)
            cookie = web.cookies[auth_helpers.SESSION_COOKIE]
        await db_session.execute(
            update(models.Session)
            .where(models.Session.user_uuid == user.uuid)
            .values(expiration_date=get_now().replace(microsecond=0) + timedelta(seconds=2))
        )
        await db_session.commit()
        tab, serving = await _open_tab(bridge, user.uuid, cookie)

        assert not serving.done()
        await asyncio.wait_for(serving, 6)
        assert tab.close_code == SESSION_ENDED_CLOSE_CODE

    @pytest.mark.asyncio
    async def test_the_socket_serves_while_its_session_lasts(
        self, organization, db_session, bridge
    ):
        user = await organization.add_user(password=PASSWORD)
        async with _browser(WEB_HEADERS) as web:
            await _sign_in(web, user.email)
            tab, serving = await _open_tab(
                bridge, user.uuid, web.cookies[auth_helpers.SESSION_COOKIE]
            )

        await asyncio.sleep(0.3)
        assert not serving.done()
        assert tab.close_code is None
        session_uuid = (
            await db_session.execute(
                select(models.Session.uuid).where(models.Session.user_uuid == user.uuid)
            )
        ).scalar_one()
        assert await auth_helpers.web_session_alive(session_uuid)

        await tab.close()
        await asyncio.wait_for(serving, 3)
        assert user.uuid not in bridge._active_by_user
