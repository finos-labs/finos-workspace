import asyncio
import json
from contextlib import asynccontextmanager

import httpx
import pytest
import uvicorn
from aiohttp import web

from api import auth_helpers, source_proxy
from routers.app import mcp_oauth
from utilities.config import settings

MCP_PATH = "/mcp"


class McpServer:
    def __init__(self):
        self.port = 0
        self.opened = 0
        self.closed = 0
        self.posts = 0
        self.answer_status = 200

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}{MCP_PATH}"


async def _gone(request) -> bool:
    return request.transport is None or request.transport.is_closing()


@pytest.fixture(autouse=True)
async def fresh_state(monkeypatch):
    monkeypatch.setattr(settings, "ALLOWED_MCP_HOSTNAMES", ["127.0.0.1"])
    client = mcp_oauth.create_mcp_http_client()
    monkeypatch.setattr(mcp_oauth, "mcp_http", client)
    source_proxy._breakers.clear()
    source_proxy._awaiting.clear()
    yield
    await client.aclose()
    source_proxy._breakers.clear()
    source_proxy._awaiting.clear()


@pytest.fixture
async def mcp_server():
    server = McpServer()

    async def stream(request):
        response = web.StreamResponse(headers={"Content-Type": "text/event-stream"})
        await response.prepare(request)
        await response.write(b"event: message\ndata: {}\n\n")
        server.opened += 1
        try:
            while not await _gone(request):
                await asyncio.sleep(0.05)
        finally:
            server.closed += 1
        return response

    async def post(request):
        server.posts += 1
        loop = asyncio.get_running_loop()
        deadline = loop.time() + float(request.query.get("delay", 0))
        while loop.time() < deadline:
            if await _gone(request):
                server.closed += 1
                return web.Response(status=499)
            await asyncio.sleep(0.05)
        if server.answer_status == 307:
            raise web.HTTPTemporaryRedirect(f"http://127.0.0.1:{server.port}/elsewhere")
        return web.json_response({"jsonrpc": "2.0", "id": 1, "result": {}}, status=server.answer_status)

    app = web.Application()
    app.router.add_get(MCP_PATH, stream)
    app.router.add_post(MCP_PATH, post)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    server.port = site._server.sockets[0].getsockname()[1]
    yield server
    await runner.cleanup()


@asynccontextmanager
async def serving():
    from main import app

    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=0, log_level="warning", lifespan="off"))
    task = asyncio.create_task(server.serve())
    while not server.started:
        await asyncio.sleep(0.02)
    try:
        yield server.servers[0].sockets[0].getsockname()[1]
    finally:
        server.should_exit = True
        await task


async def raw_call(port, client, payload):
    body = json.dumps(payload).encode()
    headers = {
        **{k: v for k, v in client.headers.items() if k.lower() not in {"content-length", "host"}},
        auth_helpers.CLIENT_HEADER: auth_helpers.WEB_CLIENT,
        "Host": f"127.0.0.1:{port}",
        "Content-Type": "application/json",
        "Content-Length": str(len(body)),
        "Cookie": "; ".join(f"{k}={v}" for k, v in client.cookies.items()),
    }
    head = "POST /app/mcp-proxy HTTP/1.1\r\n" + "".join(f"{k}: {v}\r\n" for k, v in headers.items()) + "\r\n"
    reader, writer = await asyncio.open_connection("127.0.0.1", port)
    writer.write(head.encode() + body)
    await writer.drain()
    return reader, writer


async def status_of(reader) -> tuple[int, str]:
    head = (await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 10)).decode("latin-1")
    return int(head.split(" ", 2)[1]), head.lower()


def call(server, method="GET", query="", body=None):
    return {"server_url": server.url, "url": server.url + query, "method": method, "body": body}


async def settle(condition, seconds=4.0):
    deadline = asyncio.get_running_loop().time() + seconds
    while not condition() and asyncio.get_running_loop().time() < deadline:
        await asyncio.sleep(0.05)
    return condition()


def busy() -> int:
    return len([c for c in mcp_oauth.mcp_http._transport._pool.connections if not c.is_idle()])


def web_post(client, server, **kwargs):
    return client.post(
        "/app/mcp-proxy", json=call(server, **kwargs), headers={auth_helpers.CLIENT_HEADER: auth_helpers.WEB_CLIENT}
    )


class TestAnMcpCallAtScale:
    @pytest.mark.asyncio
    async def test_no_database_connection_is_held_while_the_server_answers(self, auth_client, db_session, mcp_server):
        baseline = db_session.get_bind().pool.checkedout()
        task = asyncio.create_task(web_post(auth_client, mcp_server, method="POST", query="?delay=1.0", body={}))
        assert await settle(lambda: mcp_server.posts == 1)
        assert db_session.get_bind().pool.checkedout() == baseline
        assert (await task).status_code == 200

    @pytest.mark.asyncio
    async def test_a_stream_the_browser_closes_gives_back_its_connection(self, auth_client, mcp_server):
        async with serving() as port:
            reader, writer = await raw_call(port, auth_client, call(mcp_server))
            assert (await status_of(reader))[0] == 200
            assert await settle(lambda: mcp_server.opened == 1)
            assert busy() == 1
            writer.close()
            assert await settle(lambda: mcp_server.closed == 1)
            assert await settle(lambda: busy() == 0)
            assert source_proxy._open_total == 0

    @pytest.mark.asyncio
    async def test_a_call_the_browser_gave_up_on_is_cancelled(self, auth_client, mcp_server):
        async with serving() as port:
            reader, writer = await raw_call(port, auth_client, call(mcp_server, "POST", "?delay=30", {}))
            assert await settle(lambda: mcp_server.posts == 1)
            writer.close()
            assert await settle(lambda: mcp_server.closed == 1)
            assert await settle(lambda: busy() == 0)
            assert source_proxy._open_total == 0
            assert source_proxy._awaiting == {}

    @pytest.mark.asyncio
    async def test_the_open_streams_of_one_user_are_capped(self, auth_client, mcp_server, monkeypatch):
        monkeypatch.setattr(source_proxy, "MAX_OPEN_PER_USER", 2)
        async with serving() as port:
            held = []
            for expected in (1, 2):
                reader, writer = await raw_call(port, auth_client, call(mcp_server))
                assert (await status_of(reader))[0] == 200
                assert await settle(lambda expected=expected: mcp_server.opened == expected)
                held.append(writer)
            reader, writer = await raw_call(port, auth_client, call(mcp_server))
            code, head = await status_of(reader)
            assert code == 429
            assert "retry-after: 5" in head
            writer.close()
            for writer in held:
                writer.close()
            assert await settle(lambda: source_proxy._open_total == 0)

    @pytest.mark.asyncio
    async def test_a_server_that_stops_answering_is_not_asked_again_for_a_while(
        self, auth_client, mcp_server, monkeypatch
    ):
        monkeypatch.setattr(mcp_oauth.mcp_http, "timeout", httpx.Timeout(0.2, connect=1.0))
        for _ in range(source_proxy.BREAKER_FAILURES):
            slow = await web_post(auth_client, mcp_server, method="POST", query="?delay=1.5", body={})
            assert slow.status_code == 504
        posts = mcp_server.posts
        response = await web_post(auth_client, mcp_server, method="POST", body={})
        assert response.status_code == 503
        assert response.headers["retry-after"] == "5"
        assert mcp_server.posts == posts
        assert source_proxy._open_total == 0

    @pytest.mark.asyncio
    async def test_a_body_over_the_limit_is_refused_before_it_is_read(self, auth_client, mcp_server):
        response = await auth_client.post(
            "/app/mcp-proxy",
            content=b" " * (11 * 1024 * 1024),
            headers={auth_helpers.CLIENT_HEADER: auth_helpers.WEB_CLIENT, "Content-Type": "application/json"},
        )
        assert response.status_code == 413
        assert mcp_server.posts == 0

    @pytest.mark.asyncio
    async def test_the_answers_that_are_not_streamed_give_their_place_back(self, auth_client, mcp_server):
        mcp_server.answer_status = 401
        response = await web_post(auth_client, mcp_server, method="POST", body={})
        assert response.status_code == 401
        assert source_proxy._open_total == 0
        mcp_server.answer_status = 307
        response = await web_post(auth_client, mcp_server, method="POST", body={})
        assert response.status_code == 502
        assert source_proxy._open_total == 0
        assert busy() == 0

    @pytest.mark.asyncio
    async def test_a_plain_call_still_works(self, auth_client, mcp_server):
        ping = {"jsonrpc": "2.0", "id": 1, "method": "ping"}
        response = await web_post(auth_client, mcp_server, method="POST", body=ping)
        assert response.status_code == 200
        assert response.json() == {"jsonrpc": "2.0", "id": 1, "result": {}}
        assert response.headers["content-type"].startswith("application/json")
        assert source_proxy._open_total == 0

    def test_the_pool_is_not_smaller_than_what_a_process_admits(self):
        pool = mcp_oauth.create_mcp_http_client()._transport._pool
        assert pool._max_connections >= source_proxy.MAX_OPEN_PER_PROCESS
