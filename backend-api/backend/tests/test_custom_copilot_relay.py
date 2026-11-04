import asyncio
import json
import socket
from contextlib import asynccontextmanager
from uuid import uuid4

import pytest
import uvicorn
from aiohttp import web
from sqlalchemy import delete, select, update

from api import models, schemas, source_proxy
from tests.fixtures.base import TEST_ORIGIN
from tests.fixtures.organization import MEMBER_EMAIL
from tests.fixtures.widget_plugins import MEMBER
from utilities.config import settings

SECRET = "agent-secret-key"
REAL_GETADDRINFO = socket.getaddrinfo


class AgentServer:
    def __init__(self):
        self.port = 0
        self.seen: list[dict] = []
        self.closed = 0
        self.opened = 0
        self.agents_status = 200
        self.agents_file = "agents.json"

    @property
    def base(self) -> str:
        return f"http://127.0.0.1:{self.port}"


def lowered(request) -> dict[str, str]:
    return {name.lower(): value for name, value in request.headers.items()}


async def _gone(request) -> bool:
    return request.transport is None or request.transport.is_closing()


@pytest.fixture
async def agent_server():
    server = AgentServer()

    async def query(request):
        body = await request.read()
        server.seen.append(
            {"method": request.method, "path": request.path_qs, "headers": lowered(request), "size": len(body)}
        )
        delay = float(request.query.get("delay", 0))
        loop = asyncio.get_running_loop()
        deadline = loop.time() + delay
        while loop.time() < deadline:
            if await _gone(request):
                server.closed += 1
                return web.Response(status=499)
            await asyncio.sleep(0.05)
        return web.json_response({"received": len(body)}, headers={"X-Trace-Id": "t-1", "X-Completion-Id": "c-1"})

    async def stream(request):
        server.seen.append({"method": request.method, "path": request.path_qs, "headers": lowered(request)})
        response = web.StreamResponse(headers={"Content-Type": "text/event-stream", "X-Trace-Id": "t-2"})
        await response.prepare(request)
        await response.write(b"event: copilotMessageChunk\ndata: {}\n\n")
        server.opened += 1
        try:
            while not await _gone(request):
                await asyncio.sleep(0.05)
        finally:
            server.closed += 1
        return response

    async def agents(request):
        server.seen.append({"method": request.method, "path": request.path_qs, "headers": lowered(request)})
        if request.path.endswith(server.agents_file) and server.agents_status == 200:
            return web.json_response({"agent": {"name": "Agent", "endpoints": {"query": "/v1/query"}}})
        return web.json_response({}, status=server.agents_status if server.agents_status != 200 else 404)

    app = web.Application(client_max_size=128 * 1024 * 1024)
    app.router.add_route("*", "/v1/query", query)
    app.router.add_get("/v1/stream", stream)
    app.router.add_get("/agents.json", agents)
    app.router.add_get("/copilots.json", agents)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    server.port = site._server.sockets[0].getsockname()[1]
    yield server
    await runner.cleanup()


@pytest.fixture(autouse=True)
def fresh_state(monkeypatch):
    monkeypatch.setattr(settings, "MODE", "local")
    monkeypatch.setattr(source_proxy.socket, "getaddrinfo", _no_host_machine)
    for state in (source_proxy._breakers, source_proxy._awaiting, source_proxy._host_machine):
        state.clear()
    yield
    for state in (source_proxy._breakers, source_proxy._awaiting, source_proxy._host_machine):
        state.clear()
    source_proxy._buffered["bytes"] = 0


def _no_host_machine(host, *args, **kwargs):
    if host == source_proxy.HOST_MACHINE:
        raise socket.gaierror
    return REAL_GETADDRINFO(host, *args, **kwargs)


@pytest.fixture(autouse=True)
async def clean_connections(db_session):
    yield
    await db_session.execute(delete(models.CustomCopilot).where(models.CustomCopilot.user_uuid == MEMBER))
    await db_session.commit()


@pytest.fixture
async def developer(member, db_session):
    await db_session.execute(
        update(models.PermissionsEntityMap)
        .where(
            models.PermissionsEntityMap.uuid
            == select(models.User.permissions_uuid).where(models.User.uuid == MEMBER).scalar_subquery()
        )
        .values(name=models.DEVELOPER_TYPE)
    )
    await db_session.commit()
    return member


async def save(client, base: str, headers=None, copilot_uuid=None, **fields):
    holder = {
        "uuid": str(copilot_uuid or uuid4()),
        "url": base,
        "copilots": [{"id": "agent", "name": "Agent", "headers": {"X-Api-Key": SECRET}}],
        **({"headers": headers} if headers is not None else {}),
        **fields,
    }
    response = await client.put("/app/custom-copilot", json=holder)
    assert response.status_code == 200, response.text
    return holder["uuid"]


async def stored_headers(db_session, copilot_uuid) -> dict:
    await db_session.commit()
    row = (
        await db_session.execute(select(models.CustomCopilot.headers).where(models.CustomCopilot.uuid == copilot_uuid))
    ).first()
    return dict(row.headers or {})


def relay(copilot_uuid, target: str) -> str:
    return f"/app/custom-copilot/{copilot_uuid}/relay?target={target}"


class TestTheCredentialsStayOnTheServer:
    @pytest.mark.asyncio
    async def test_the_listing_names_the_credentials_and_never_returns_them(self, developer, agent_server, db_session):
        copilot = await save(developer, agent_server.base, {"X-Api-Key": SECRET, "X-Other": "other-secret"})
        listing = await developer.get("/app/custom-copilot")
        assert listing.status_code == 200
        [holder] = listing.json()
        assert holder["headerNames"] == ["X-Api-Key", "X-Other"]
        assert "headers" not in holder
        assert SECRET not in listing.text
        assert "other-secret" not in listing.text
        assert "headers" not in holder["copilots"][0]
        assert await stored_headers(db_session, copilot) == {"X-Api-Key": SECRET, "X-Other": "other-secret"}
        stored = (
            await db_session.execute(select(models.CustomCopilot.copilots).where(models.CustomCopilot.uuid == copilot))
        ).scalar_one()
        assert "headers" not in stored[0]

    def test_the_schema_never_serialises_credentials(self):
        holder = schemas.CustomCopilot(
            url="https://a.example", headers={"X-Api-Key": SECRET}, copilots=[{"headers": {"a": "b"}}]
        )
        assert SECRET not in holder.model_dump_json(by_alias=True)
        assert holder.model_dump(by_alias=True)["copilots"] == [{}]

    @pytest.mark.asyncio
    async def test_a_save_that_leaves_the_headers_out_keeps_them(self, developer, agent_server, db_session):
        copilot = await save(developer, agent_server.base, {"X-Api-Key": SECRET})
        await save(developer, agent_server.base, copilot_uuid=copilot)
        assert await stored_headers(db_session, copilot) == {"X-Api-Key": SECRET}

    @pytest.mark.asyncio
    async def test_a_blank_value_keeps_the_stored_one_and_a_name_that_is_missing_is_removed(
        self, developer, agent_server, db_session
    ):
        copilot = await save(developer, agent_server.base, {"X-Api-Key": SECRET, "X-Old": "old"})
        await save(developer, agent_server.base, {"x-api-key": "", "X-New": "new"}, copilot_uuid=copilot)
        assert await stored_headers(db_session, copilot) == {"x-api-key": SECRET, "X-New": "new"}
        await save(developer, agent_server.base, {"X-Brand-New": ""}, copilot_uuid=copilot)
        assert await stored_headers(db_session, copilot) == {}

    @pytest.mark.asyncio
    async def test_an_empty_set_clears_the_credentials(self, developer, agent_server, db_session):
        copilot = await save(developer, agent_server.base, {"X-Api-Key": SECRET})
        await save(developer, agent_server.base, {}, copilot_uuid=copilot)
        assert await stored_headers(db_session, copilot) == {}

    @pytest.mark.asyncio
    async def test_credentials_that_were_not_retyped_do_not_follow_the_address_to_another_origin(
        self, developer, agent_server, db_session
    ):
        copilot = await save(developer, agent_server.base, {"X-Api-Key": SECRET, "X-Other": "other"})
        moved = f"http://localhost:{agent_server.port}"
        await save(developer, moved, {"X-Api-Key": "", "X-Other": "typed-again"}, copilot_uuid=copilot)
        assert await stored_headers(db_session, copilot) == {"X-Other": "typed-again"}
        query = select(models.CustomCopilot.url).where(models.CustomCopilot.uuid == copilot)
        url = (await db_session.execute(query)).scalar_one()
        assert url == moved

    @pytest.mark.asyncio
    async def test_credentials_stay_when_the_address_keeps_its_origin(self, developer, agent_server, db_session):
        copilot = await save(developer, agent_server.base, {"X-Api-Key": SECRET})
        await save(developer, agent_server.base + "/other/path", {"X-Api-Key": ""}, copilot_uuid=copilot)
        assert await stored_headers(db_session, copilot) == {"X-Api-Key": SECRET}

    @pytest.mark.asyncio
    async def test_a_header_that_is_not_a_header_is_refused(self, developer, agent_server):
        response = await developer.put(
            "/app/custom-copilot",
            json={"uuid": str(uuid4()), "url": agent_server.base, "headers": {"Bad Name": "x"}, "copilots": []},
        )
        assert response.status_code == 422


class TestDiscover:
    @pytest.mark.asyncio
    async def test_it_reads_agents_json_with_the_stored_credentials(self, developer, agent_server):
        copilot = await save(developer, agent_server.base, {"X-Api-Key": SECRET})
        response = await developer.post("/app/custom-copilot/discover", json={"id": copilot, "url": agent_server.base})
        assert response.status_code == 200, response.text
        assert response.json() == {
            "status": 200,
            "agents": {"agent": {"name": "Agent", "endpoints": {"query": "/v1/query"}}},
        }
        assert agent_server.seen[-1]["headers"]["x-api-key"] == SECRET
        assert SECRET not in response.text

    @pytest.mark.asyncio
    async def test_typed_credentials_are_tried_and_a_blank_one_keeps_the_stored_value(self, developer, agent_server):
        copilot = await save(developer, agent_server.base, {"X-Api-Key": SECRET})
        await developer.post(
            "/app/custom-copilot/discover",
            json={"id": copilot, "url": agent_server.base, "headers": {"X-Api-Key": "", "X-Typed": "typed"}},
        )
        seen = agent_server.seen[-1]["headers"]
        assert seen["x-api-key"] == SECRET
        assert seen["x-typed"] == "typed"

    @pytest.mark.asyncio
    async def test_stored_credentials_are_not_sent_to_another_origin(self, developer, agent_server):
        copilot = await save(developer, agent_server.base, {"X-Api-Key": SECRET})
        moved = f"http://localhost:{agent_server.port}"
        response = await developer.post(
            "/app/custom-copilot/discover",
            json={"id": copilot, "url": moved, "headers": {"X-Api-Key": ""}},
        )
        assert response.json()["status"] == 200
        assert "x-api-key" not in agent_server.seen[-1]["headers"]
        again = await developer.post("/app/custom-copilot/discover", json={"id": copilot, "url": moved})
        assert again.json()["status"] == 200
        assert "x-api-key" not in agent_server.seen[-1]["headers"]

    @pytest.mark.asyncio
    async def test_a_new_connection_is_tried_with_what_is_typed(self, developer, agent_server):
        response = await developer.post(
            "/app/custom-copilot/discover", json={"url": agent_server.base, "headers": {"X-Api-Key": "typed"}}
        )
        assert response.json()["status"] == 200
        assert agent_server.seen[-1]["headers"]["x-api-key"] == "typed"

    @pytest.mark.asyncio
    async def test_it_falls_back_to_copilots_json(self, developer, agent_server):
        agent_server.agents_file = "copilots.json"
        response = await developer.post("/app/custom-copilot/discover", json={"url": agent_server.base})
        assert response.json()["status"] == 200
        assert [seen["path"] for seen in agent_server.seen] == ["/agents.json", "/copilots.json"]

    @pytest.mark.asyncio
    async def test_the_status_the_agent_answered_comes_back_in_the_body(self, developer, agent_server):
        agent_server.agents_status = 401
        response = await developer.post("/app/custom-copilot/discover", json={"url": agent_server.base})
        assert response.status_code == 200
        assert response.json() == {"status": 401, "agents": None}

    @pytest.mark.asyncio
    async def test_a_private_address_is_refused_unless_the_user_may_reach_one(self, developer, agent_server, monkeypatch):
        monkeypatch.setattr(settings, "MODE", "production")
        response = await developer.post("/app/custom-copilot/discover", json={"url": agent_server.base})
        assert response.status_code == 403
        assert agent_server.seen == []

    @pytest.mark.asyncio
    async def test_another_users_connection_is_not_available(self, developer, agent_server):
        response = await developer.post(
            "/app/custom-copilot/discover", json={"id": str(uuid4()), "url": agent_server.base}
        )
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_a_user_who_may_not_add_connections_cannot_discover(self, member, agent_server):
        response = await member.post("/app/custom-copilot/discover", json={"url": agent_server.base})
        assert response.status_code == 403


class TestTheRelay:
    @pytest.mark.asyncio
    async def test_the_stored_credentials_are_added_and_the_body_and_trace_id_go_through(
        self, developer, agent_server
    ):
        copilot = await save(developer, agent_server.base, {"X-Api-Key": SECRET})
        response = await developer.post(
            relay(copilot, f"{agent_server.base}/v1/query?a=1"),
            content=b'{"messages": []}',
            headers={"Content-Type": "application/json", "X-Trace-Id": "chat-1"},
        )
        assert response.status_code == 200, response.text
        assert response.json() == {"received": 16}
        seen = agent_server.seen[-1]
        assert (seen["method"], seen["path"], seen["size"]) == ("POST", "/v1/query?a=1", 16)
        assert seen["headers"]["x-api-key"] == SECRET
        assert seen["headers"]["x-trace-id"] == "chat-1"
        assert seen["headers"]["content-type"] == "application/json"
        assert seen["headers"]["x-workspace-user"] == MEMBER_EMAIL
        assert SECRET not in response.text
        assert SECRET not in json.dumps(dict(response.headers))
        assert response.headers["x-trace-id"] == "t-1"
        assert "X-Completion-Id" in response.headers["access-control-expose-headers"]

    @pytest.mark.asyncio
    async def test_the_browsers_preflight_for_a_relayed_call_is_answered(self, developer):
        response = await developer.options(
            relay(uuid4(), "https://agent.example/v1/query"),
            headers={
                "Origin": TEST_ORIGIN,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type,x-trace-id,x-workspace-client",
            },
        )
        assert response.status_code == 200
        allowed = response.headers["access-control-allow-headers"].lower()
        assert all(name in allowed for name in ("content-type", "x-trace-id", "x-workspace-client"))
        assert response.headers["access-control-allow-credentials"] == "true"

    @pytest.mark.asyncio
    async def test_a_stored_credential_wins_over_a_header_the_browser_sends(self, developer, agent_server):
        copilot = await save(developer, agent_server.base, {"Accept": "application/vnd.agent+json"})
        await developer.post(
            relay(copilot, f"{agent_server.base}/v1/query"), content=b"{}", headers={"Accept": "text/plain"}
        )
        assert agent_server.seen[-1]["headers"]["accept"] == "application/vnd.agent+json"

    @pytest.mark.asyncio
    async def test_a_target_off_the_connections_origin_is_refused_and_nothing_is_sent(self, developer, agent_server):
        copilot = await save(developer, agent_server.base, {"X-Api-Key": SECRET})
        for target in (
            f"http://127.0.0.1:{agent_server.port + 1}/v1/query",
            f"http://user:pw@127.0.0.1:{agent_server.port}/v1/query",
            f"https://127.0.0.1:{agent_server.port}/v1/query",
        ):
            response = await developer.post(relay(copilot, target), content=b"{}")
            assert response.status_code in {403, 400}, response.text
        assert agent_server.seen == []

    @pytest.mark.asyncio
    async def test_a_connection_that_is_not_the_users_gets_404(self, developer, agent_server):
        response = await developer.post(relay(uuid4(), f"{agent_server.base}/v1/query"), content=b"{}")
        assert response.status_code == 404
        assert response.headers["x-workspace-proxy-error"] == "1"
        assert agent_server.seen == []

    @pytest.mark.asyncio
    async def test_a_user_who_may_not_add_connections_cannot_use_one(self, member, agent_server, db_session):
        connection = models.CustomCopilot(
            uuid=uuid4(), user_uuid=MEMBER, url=agent_server.base, headers={"X-Api-Key": SECRET}, copilots=[]
        )
        db_session.add(connection)
        await db_session.commit()
        try:
            response = await member.post(relay(connection.uuid, f"{agent_server.base}/v1/query"), content=b"{}")
            assert response.status_code == 404
            assert agent_server.seen == []
        finally:
            await db_session.delete(connection)
            await db_session.commit()

    @pytest.mark.asyncio
    async def test_a_body_larger_than_a_data_call_may_carry_goes_through(self, developer, agent_server):
        copilot = await save(developer, agent_server.base)
        response = await developer.post(
            relay(copilot, f"{agent_server.base}/v1/query"), content=b"x" * (3 * 1024 * 1024)
        )
        assert response.status_code == 200
        assert response.json() == {"received": 3 * 1024 * 1024}

    @pytest.mark.asyncio
    async def test_a_body_over_the_limit_is_refused_before_it_is_read(self, developer, agent_server):
        copilot = await save(developer, agent_server.base)
        response = await developer.post(
            relay(copilot, f"{agent_server.base}/v1/query"), content=b"x" * (64 * 1024 * 1024 + 1)
        )
        assert response.status_code == 413
        assert agent_server.seen == []

    @pytest.mark.asyncio
    async def test_bodies_that_do_not_fit_the_process_budget_are_turned_away_and_the_budget_comes_back(
        self, developer, agent_server, monkeypatch
    ):
        copilot = await save(developer, agent_server.base)
        monkeypatch.setattr(source_proxy, "BODY_BUDGET_BYTES", 100)
        refused = await developer.post(relay(copilot, f"{agent_server.base}/v1/query"), content=b"x" * 101)
        assert refused.status_code == 503
        assert refused.headers["retry-after"] == "5"
        served = await developer.post(relay(copilot, f"{agent_server.base}/v1/query"), content=b"x" * 100)
        assert served.status_code == 200
        assert source_proxy._buffered["bytes"] == 0

    @pytest.mark.asyncio
    async def test_the_agent_gets_the_longer_wait_for_its_first_byte(self, developer, agent_server, monkeypatch):
        copilot = await save(developer, agent_server.base)
        monkeypatch.setattr(source_proxy, "AGENT_WAITS", (0.2, 600.0))
        response = await developer.post(relay(copilot, f"{agent_server.base}/v1/query?delay=1.5"), content=b"{}")
        assert response.status_code == 504
        assert source_proxy.AGENT_WAITS == (0.2, 600.0)


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


async def raw_relay(port, client, copilot, target, method="GET", body=b""):
    headers = {
        **{k: v for k, v in client.headers.items() if k.lower() not in {"content-length", "host"}},
        "Host": f"127.0.0.1:{port}",
        "Content-Type": "application/json",
        "Content-Length": str(len(body)),
        "Cookie": "; ".join(f"{k}={v}" for k, v in client.cookies.items()),
    }
    lines = "".join(f"{k}: {v}\r\n" for k, v in headers.items())
    head = f"{method} {relay(copilot, target)} HTTP/1.1\r\n{lines}\r\n"
    reader, writer = await asyncio.open_connection("127.0.0.1", port)
    writer.write(head.encode() + body)
    await writer.drain()
    return reader, writer


async def settle(condition, seconds=4.0):
    deadline = asyncio.get_running_loop().time() + seconds
    while not condition() and asyncio.get_running_loop().time() < deadline:
        await asyncio.sleep(0.05)
    return condition()


class TestTheRelayAtScale:
    @pytest.mark.asyncio
    async def test_a_stream_reaches_the_browser_as_it_is_written_and_ends_when_the_browser_leaves(
        self, developer, agent_server
    ):
        copilot = await save(developer, agent_server.base, {"X-Api-Key": SECRET})
        async with serving() as port:
            reader, writer = await raw_relay(port, developer, copilot, f"{agent_server.base}/v1/stream")
            head = (await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 10)).decode("latin-1").lower()
            assert " 200 " in head.split("\r\n")[0]
            assert "text/event-stream" in head
            assert "x-trace-id: t-2" in head
            assert b"copilotMessageChunk" in await asyncio.wait_for(reader.read(200), 10)
            assert agent_server.seen[-1]["headers"]["x-api-key"] == SECRET
            assert source_proxy._open_total == 1
            writer.close()
            assert await settle(lambda: agent_server.closed == 1)
            assert await settle(lambda: source_proxy._open_total == 0)

    @pytest.mark.asyncio
    async def test_a_question_the_browser_stopped_waiting_for_is_cancelled_at_the_agent(self, developer, agent_server):
        copilot = await save(developer, agent_server.base)
        async with serving() as port:
            _reader, writer = await raw_relay(
                port, developer, copilot, f"{agent_server.base}/v1/query?delay=30", "POST", b"{}"
            )
            assert await settle(lambda: len(agent_server.seen) == 1)
            writer.close()
            assert await settle(lambda: agent_server.closed == 1)
            assert await settle(lambda: source_proxy._open_total == 0)
            assert source_proxy._awaiting == {}

    @pytest.mark.asyncio
    async def test_a_stream_counts_against_the_users_open_requests(self, developer, agent_server, monkeypatch):
        copilot = await save(developer, agent_server.base)
        monkeypatch.setattr(source_proxy, "MAX_OPEN_PER_USER", 1)
        async with serving() as port:
            first, held = await raw_relay(port, developer, copilot, f"{agent_server.base}/v1/stream")
            await asyncio.wait_for(first.readuntil(b"\r\n\r\n"), 10)
            second, refused = await raw_relay(port, developer, copilot, f"{agent_server.base}/v1/stream")
            head = (await asyncio.wait_for(second.readuntil(b"\r\n\r\n"), 10)).decode("latin-1").lower()
            assert " 429 " in head.split("\r\n")[0]
            assert "retry-after: 5" in head
            refused.close()
            held.close()
            assert await settle(lambda: source_proxy._open_total == 0)
