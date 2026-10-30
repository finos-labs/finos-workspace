import asyncio
import time
from uuid import uuid4

import aiohttp
import pytest
from aiohttp import web

from api import source_proxy, ws_relay


class Client:
    def __init__(self, subprotocols=()):
        self.incoming: asyncio.Queue = asyncio.Queue()
        self.sent: list[tuple[str, object]] = []
        self.accepted: dict | None = None
        self.closed: int | None = None
        self.scope = {"subprotocols": list(subprotocols)}

    async def accept(self, subprotocol=None):
        self.accepted = {"subprotocol": subprotocol}

    async def receive(self):
        return await self.incoming.get()

    async def send_text(self, text):
        self.sent.append(("text", text))

    async def send_bytes(self, data):
        self.sent.append(("bytes", data))

    async def close(self, code=1000):
        self.closed = code

    def say(self, text=None, data=None):
        self.incoming.put_nowait({"type": "websocket.receive", "text": text, "bytes": data})

    def hang_up(self):
        self.incoming.put_nowait({"type": "websocket.disconnect"})


@pytest.fixture(autouse=True)
def fresh_breakers():
    source_proxy._breakers.clear()
    yield
    source_proxy._breakers.clear()


@pytest.fixture
async def upstream():
    seen: list[dict] = []

    async def echo(request):
        socket = web.WebSocketResponse(protocols=("chat",))
        await socket.prepare(request)
        seen.append({"headers": dict(request.headers), "path": request.path_qs, "protocol": socket.ws_protocol})
        async for message in socket:
            if message.type == aiohttp.WSMsgType.TEXT:
                if message.data == "close-me":
                    await socket.close(code=4001, message=b"bye")
                else:
                    await socket.send_str(f"echo:{message.data}")
            elif message.type == aiohttp.WSMsgType.BINARY:
                await socket.send_bytes(message.data[::-1])
        return socket

    async def slow(request):
        await asyncio.sleep(3)
        return await echo(request)

    where = {}

    async def redirect(request):
        raise web.HTTPFound(where["echo"])

    app = web.Application()
    app.router.add_get("/echo", echo)
    app.router.add_get("/slow", slow)
    app.router.add_get("/redirect", redirect)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]
    where["echo"] = f"http://127.0.0.1:{port}/echo"
    yield type("Upstream", (), {"port": port, "seen": seen})
    await runner.cleanup()


def start(client, upstream, *, path="/echo?token=k", trusted=True, expires_in=30, authorized=None, user=None):
    async def allowed():
        return True

    return asyncio.create_task(
        ws_relay.relay(
            client,
            f"http://127.0.0.1:{upstream.port}{path}",
            {"X-Api-Key": "the-key", "X-Workspace-User": "someone@example.com", "Accept-Encoding": "identity"},
            "http://the-backend.test",
            trusted,
            user or uuid4(),
            time.time() + expires_in,
            authorized or allowed,
        )
    )


async def settle(condition, seconds=3):
    deadline = time.time() + seconds
    while not condition() and time.time() < deadline:
        await asyncio.sleep(0.02)
    assert condition()


@pytest.mark.asyncio
async def test_messages_go_both_ways_with_the_credentials_and_the_protocol(upstream):
    client = Client(subprotocols=["chat"])
    task = start(client, upstream)
    await settle(lambda: client.accepted is not None)
    assert client.accepted == {"subprotocol": "chat"}
    client.say(text="hello")
    client.say(data=b"abc")
    await settle(lambda: len(client.sent) == 2)
    assert client.sent == [("text", "echo:hello"), ("bytes", b"cba")]
    seen = upstream.seen[0]
    assert seen["path"] == "/echo?token=k"
    assert seen["headers"]["X-Api-Key"] == "the-key"
    assert seen["headers"]["X-Workspace-User"] == "someone@example.com"
    assert seen["headers"]["Origin"] == "http://the-backend.test"
    client.hang_up()
    await asyncio.wait_for(task, 5)
    assert client.closed == 1000
    assert ws_relay._open_sockets == {}


@pytest.mark.asyncio
async def test_the_connections_close_code_reaches_the_page(upstream):
    client = Client()
    task = start(client, upstream)
    await settle(lambda: client.accepted is not None)
    client.say(text="close-me")
    await asyncio.wait_for(task, 5)
    assert client.closed == 4001


@pytest.mark.asyncio
async def test_an_unreachable_connection_is_refused_before_the_page_is_accepted():
    client = Client()
    task = asyncio.create_task(
        ws_relay.relay(
            client,
            "http://127.0.0.1:9/echo",
            {},
            "http://x",
            True,
            uuid4(),
            time.time() + 30,
            lambda: asyncio.sleep(0, True),
        )
    )
    await asyncio.wait_for(task, 10)
    assert client.accepted is None
    assert client.closed == ws_relay.FAILURE_CLOSE_CODE


async def dead_socket(client):
    async def allowed():
        return True

    relay = ws_relay.relay(client, "http://127.0.0.1:9/echo", {}, "http://x", True, uuid4(), time.time() + 30, allowed)
    await asyncio.wait_for(relay, 10)


@pytest.mark.asyncio
async def test_a_connection_that_cannot_be_reached_is_given_up_on_after_a_few_tries():
    for _ in range(source_proxy.BREAKER_FAILURES):
        client = Client()
        await dead_socket(client)
        assert client.closed == ws_relay.FAILURE_CLOSE_CODE
    client = Client()
    started = time.monotonic()
    await dead_socket(client)
    assert client.closed == ws_relay.TRY_AGAIN_CLOSE_CODE
    assert time.monotonic() - started < 0.5
    assert ws_relay._open_sockets == {}


@pytest.mark.asyncio
async def test_a_connection_that_answers_the_handshake_with_an_error_is_still_reachable(upstream):
    for _ in range(source_proxy.BREAKER_FAILURES * 2):
        client = Client()
        await asyncio.wait_for(start(client, upstream, path="/missing"), 5)
        assert client.closed == ws_relay.FAILURE_CLOSE_CODE
    assert source_proxy._breakers == {}


@pytest.mark.asyncio
async def test_a_private_or_plain_address_of_an_untrusted_connection_is_never_called(upstream):
    client = Client()
    await asyncio.wait_for(start(client, upstream, trusted=False), 5)
    assert client.accepted is None
    assert client.closed == ws_relay.POLICY_CLOSE_CODE
    assert upstream.seen == []


@pytest.mark.asyncio
async def test_the_socket_ends_when_the_token_expires(upstream):
    client = Client()
    task = start(client, upstream, expires_in=0.3)
    await asyncio.wait_for(task, 5)
    assert client.closed == ws_relay.POLICY_CLOSE_CODE
    assert ws_relay._open_sockets == {}


@pytest.mark.asyncio
async def test_the_socket_ends_when_the_user_may_no_longer_use_the_connection(upstream, monkeypatch):
    monkeypatch.setattr(ws_relay, "RECHECK_SECONDS", 0.1)
    answers = iter([True, False])

    async def authorized():
        return next(answers, False)

    client = Client()
    await asyncio.wait_for(start(client, upstream, authorized=authorized), 5)
    assert client.closed == ws_relay.POLICY_CLOSE_CODE


@pytest.mark.asyncio
async def test_a_user_has_a_limited_number_of_sockets(upstream, monkeypatch):
    monkeypatch.setattr(ws_relay, "MAX_SOCKETS_PER_USER", 1)
    user = uuid4()
    first, second = Client(), Client()
    open_task = start(first, upstream, user=user)
    await settle(lambda: first.accepted is not None)
    await asyncio.wait_for(start(second, upstream, user=user), 5)
    assert second.accepted is None
    assert second.closed == ws_relay.TRY_AGAIN_CLOSE_CODE
    first.hang_up()
    await asyncio.wait_for(open_task, 5)
    assert ws_relay._open_sockets == {}


@pytest.mark.asyncio
async def test_a_message_over_the_limit_ends_the_socket(upstream, monkeypatch):
    monkeypatch.setattr(ws_relay, "MAX_MESSAGE_BYTES", 10)
    client = Client()
    task = start(client, upstream)
    await settle(lambda: client.accepted is not None)
    client.say(text="x" * 11)
    await asyncio.wait_for(task, 5)
    assert client.sent == []


@pytest.mark.asyncio
async def test_a_backend_that_never_answers_the_upgrade_is_given_up_on(upstream, monkeypatch):
    monkeypatch.setattr(ws_relay, "HANDSHAKE_SECONDS", 0.3)
    client = Client()
    await asyncio.wait_for(start(client, upstream, path="/slow"), 5)
    assert client.accepted is None
    assert client.closed == ws_relay.FAILURE_CLOSE_CODE
    assert ws_relay._open_sockets == {}
    assert ws_relay._open_total == 0


@pytest.mark.asyncio
async def test_a_redirect_of_the_upgrade_is_never_followed(upstream):
    client = Client()
    await asyncio.wait_for(start(client, upstream, path="/redirect"), 5)
    assert client.accepted is None
    assert client.closed == ws_relay.POLICY_CLOSE_CODE
    assert [seen["path"] for seen in upstream.seen] == []


@pytest.mark.asyncio
async def test_a_busy_process_asks_the_page_to_try_again(upstream, monkeypatch):
    monkeypatch.setattr(ws_relay, "MAX_SOCKETS_PER_PROCESS", 0)
    client = Client()
    await asyncio.wait_for(start(client, upstream), 5)
    assert client.accepted is None
    assert client.closed == ws_relay.TRY_AGAIN_CLOSE_CODE


@pytest.mark.asyncio
async def test_a_failed_access_check_does_not_close_a_healthy_socket(upstream, monkeypatch):
    monkeypatch.setattr(ws_relay, "RECHECK_SECONDS", 0.1)
    calls = []

    async def authorized():
        calls.append(1)
        raise ConnectionError("the database is down")

    client = Client()
    task = start(client, upstream, authorized=authorized)
    await settle(lambda: len(calls) >= 2)
    assert client.closed is None
    client.hang_up()
    await asyncio.wait_for(task, 5)
    assert ws_relay._open_total == 0
