import json
import time
from uuid import UUID, uuid4

import pytest

from api import models
from api.widget_plugins import backends
from api.widget_plugins.manifest import Manifest
from api.widget_plugins.proxy import CallError
from tests.fixtures.plugin_backends import (
    BACKEND_SECRET,
    ROUTE_CALL,
    SOURCE_SECRET,
    backend_manifest,
    ready_backend,
)
from tests.fixtures.base import _SECOND_USER
from tests.fixtures.upstream import Answer
from tests.fixtures.widget_plugins import (
    MEMBER,
    enable,
    plugin_view,
    rescan,
    user_listing,
    version_view,
    write_package,
)
from utilities.config import settings

BROKER = "/internal/plugin-broker/data/sales"


async def route(client, args: dict, *, widget: str = "chart", instance: str = "instance-1", path: str = ROUTE_CALL):
    return await client.post(path, json={"widget": widget, "instance": instance, "args": args})


class TestManifest:
    def test_a_plugin_with_a_backend(self):
        Manifest.model_validate(backend_manifest())

    def test_a_backend_may_declare_a_tcp_endpoint(self):
        data = backend_manifest()
        data["server"]["network"] = ["tcp://db.example.com:5432"]
        Manifest.model_validate(data)

    def test_a_route_string_may_be_longer_than_a_proxys(self):
        data = backend_manifest()
        data["server"]["backend"]["routes"][0]["args"]["region"]["maxLength"] = 32 * 1024
        Manifest.model_validate(data)
        data["server"]["backend"]["routes"][0]["args"]["region"]["maxLength"] = 32 * 1024 + 1
        with pytest.raises(ValueError, match="maxLength"):
            Manifest.model_validate(data)

    @pytest.mark.parametrize(
        ("change", "problem"),
        [
            (lambda d: d["contributes"]["widgets"][0]["permissions"].remove("core:backend:call"), "core:backend:call"),
            (lambda d: d["contributes"]["widgets"][0]["server"].update(routes=["other"]), "not a route"),
            (lambda d: d["server"]["backend"]["routes"][0].update(secrets=["other"]), "not a declared secret"),
            (lambda d: d["server"]["backend"]["routes"].append(d["server"]["backend"]["routes"][0]), "declared twice"),
            (lambda d: d["server"]["backend"].update(protocol=2), "protocol"),
            (lambda d: d["server"]["backend"].update(routes=[]), "routes"),
            (lambda d: d["server"]["backend"]["routes"][0]["response"].update(maxBytes=6 * 1024 * 1024), "maxBytes"),
        ],
        ids=["permission", "undeclared-route", "undeclared-secret", "route-twice", "protocol", "no-routes", "too-big"],
    )
    def test_invalid_backends(self, change, problem):
        data = backend_manifest()
        change(data)
        with pytest.raises(ValueError, match=problem):
            Manifest.model_validate(data)

    @pytest.mark.parametrize("key", ["dataSources", "identity"])
    def test_data_sources_and_identity_need_a_backend(self, key):
        data = backend_manifest()
        del data["server"]
        data["secrets"] = []
        data["contributes"]["widgets"][0]["permissions"].remove("core:backend:call")
        del data["contributes"]["widgets"][0]["server"]
        if key == "dataSources":
            data["identity"] = "none"
        else:
            data["dataSources"] = []
        with pytest.raises(ValueError, match="for a plugin backend"):
            Manifest.model_validate(data)


class TestToken:
    def test_a_token_is_opaque_and_authenticated(self):
        token = backends.mint_token({"u": "user-1", "p": "test-chart"})
        assert "user-1" not in token
        assert backends.read_token(token)["u"] == "user-1"
        tampered = token[:-2] + ("AA" if token[-2:] != "AA" else "BB")
        with pytest.raises(CallError, match="not valid"):
            backends.read_token(tampered)
        with pytest.raises(CallError, match="not valid"):
            backends.read_token("eyJhbGciOiJub25lIn0.e30.")

    def test_a_token_expires(self):
        with pytest.raises(CallError, match="expired"):
            backends.read_token(backends.mint_token({"u": "user-1"}, seconds=-1))

    def test_a_pseudonym_is_stable_per_plugin(self):
        assert backends.pseudonym("a-plugin", "u1") == backends.pseudonym("a-plugin", "u1")
        assert backends.pseudonym("a-plugin", "u1") != backends.pseudonym("b-plugin", "u1")
        assert "u1" not in backends.pseudonym("a-plugin", "u1")


class TestBreaker:
    def test_it_opens_after_repeated_failures_and_probes_after_the_period(self, monkeypatch):
        backends.reset("p")
        monkeypatch.setattr(settings, "WIDGET_PLUGIN_BACKEND_BREAKER_FAILURES", 2)
        monkeypatch.setattr(settings, "WIDGET_PLUGIN_BACKEND_BREAKER_SECONDS", 30)
        backends.record_outcome("p", failed=True)
        assert not backends.breaker_open("p")
        backends.record_outcome("p", failed=True)
        assert backends.breaker_open("p")
        now = time.time()
        monkeypatch.setattr(backends.time, "time", lambda: now + 31)
        assert not backends.breaker_open("p")
        backends.record_outcome("p", failed=True)
        assert backends.breaker_open("p")
        monkeypatch.setattr(backends.time, "time", lambda: now + 62)
        backends.record_outcome("p", failed=False)
        assert not backends.breaker_open("p")
        backends.reset("p")


class TestReview:
    @pytest.mark.asyncio
    async def test_the_review_lists_the_backend_its_data_and_identity(self, superuser, plugins_dir, plugin_backend):
        write_package(plugins_dir, backend_manifest())
        await rescan(superuser)
        view = version_view(await plugin_view(superuser))
        items = {i["key"]: i for i in view["review"]}
        assert items["backend"]["label"].startswith("Runs code on the server")
        assert "sends the secrets api_key" in items["route:forecast"]["label"]
        assert items["data-source:sales"]["family"] == "data"
        assert items["identity:pseudonymous"]["added"] is True
        assert view["server"]["backend"]["routes"][0]["id"] == "forecast"
        assert (await plugin_view(superuser))["backend"]["registered"] is True

    @pytest.mark.asyncio
    async def test_the_deployment_names_the_database_its_backend_opens(self, superuser, plugins_dir, plugin_backend):
        write_package(plugins_dir, backend_manifest())
        await rescan(superuser)
        private = {"server_network": ["tcp://postgres:5432"]}
        assert (await superuser.put("/plugins/test-chart/overrides", json=private)).status_code == 422
        confirmed = await superuser.put(
            "/plugins/test-chart/overrides", json={**private, "confirmations": ["private-host"]}
        )
        assert confirmed.status_code == 200, confirmed.text
        view = version_view(await plugin_view(superuser))
        assert view["server"]["network"]["approved"] == ["tcp://postgres:5432"]
        assert {i["key"]: i for i in view["review"]}["server:tcp://postgres:5432"]["overridden"] is True


class TestCalls:
    @pytest.mark.asyncio
    async def test_a_call_reaches_the_backend_with_its_token_secret_and_caller(
        self, member, superuser, plugins_dir, plugin_backend
    ):
        await ready_backend(superuser, plugins_dir, plugin_backend)
        [plugin] = (await user_listing(member))["plugins"]
        assert plugin["widgets"][0]["routes"] == ["forecast"]

        response = await route(member, {"region": "emea"})
        assert response.status_code == 200, response.text
        assert response.json() == {"body": {"forecast": [1, 2, 3]}}
        [received] = plugin_backend.calls
        assert received.target == "/.workspace/routes/forecast"
        assert received.headers["x-workspace-secret-api-key"] == BACKEND_SECRET
        body = json.loads(received.body)
        assert body["args"] == {"region": "emea"}
        assert body["widget"] == {"id": "chart", "instanceId": "instance-1"}
        assert body["caller"]["id"] == backends.pseudonym("test-chart", str(MEMBER))
        assert str(MEMBER) not in received.body.decode()
        claims = backends.read_token(received.headers["x-workspace-call"])
        assert (claims["p"], claims["w"], claims["d"]) == ("test-chart", "chart", ["sales"])
        assert BACKEND_SECRET not in response.text

    @pytest.mark.asyncio
    async def test_without_an_approved_identity_the_backend_learns_nothing_of_the_caller(
        self, member, superuser, plugins_dir, plugin_backend
    ):
        await ready_backend(superuser, plugins_dir, plugin_backend, identity="none")
        assert (await route(member, {"region": "emea"})).status_code == 200
        assert json.loads(plugin_backend.calls[0].body)["caller"] == {}

    @pytest.mark.asyncio
    async def test_an_unregistered_backend_is_not_called(
        self, member, superuser, plugins_dir, plugin_backend, monkeypatch
    ):
        await ready_backend(superuser, plugins_dir, plugin_backend)
        monkeypatch.setattr(settings, "WIDGET_PLUGIN_BACKENDS", {})
        response = await route(member, {"region": "emea"})
        assert (response.status_code, response.json()["detail"]["code"]) == (503, "backend_unregistered")

    @pytest.mark.asyncio
    async def test_another_version_stops_routing_and_is_recorded_once(
        self, member, superuser, plugins_dir, plugin_backend
    ):
        await ready_backend(superuser, plugins_dir, plugin_backend)
        plugin_backend.identity = {**plugin_backend.identity, "digest": "sha256-" + "F" * 43}
        for _ in range(2):
            response = await route(member, {"region": "emea"})
            assert (response.status_code, response.json()["detail"]["code"]) == (503, "backend_mismatch")
        assert plugin_backend.calls == []
        events = (await superuser.get("/plugins/test-chart/events")).json()
        assert [e["details"]["digest"] for e in events if e["action"] == "backend-mismatch"] == ["sha256-" + "F" * 43]

        plugin_backend.identity = {
            **plugin_backend.identity,
            "digest": version_view(await plugin_view(superuser))["digest"],
        }
        status = (await superuser.post("/plugins/test-chart/backend/check")).json()
        assert status["identity"]["state"] == "ok"
        assert (await route(member, {"region": "emea"})).status_code == 200

    @pytest.mark.asyncio
    async def test_an_unreachable_backend(self, member, superuser, plugins_dir, plugin_backend, monkeypatch):
        await ready_backend(superuser, plugins_dir, plugin_backend)
        monkeypatch.setattr(settings, "WIDGET_PLUGIN_BACKENDS", {"test-chart": "http://127.0.0.1:9"})
        response = await route(member, {"region": "emea"})
        assert (response.status_code, response.json()["detail"]["code"]) == (503, "backend_unreachable")

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("args", "path", "status", "code"),
        [
            ({"region": "x" * 9}, ROUTE_CALL, 422, "invalid_args"),
            ({"region": "emea", "other": 1}, ROUTE_CALL, 422, "invalid_args"),
            ({"region": "emea"}, ROUTE_CALL.replace("forecast", "other"), 403, "unknown_route"),
            ({"region": "emea"}, ROUTE_CALL.replace("test-chart", "other-plugin"), 404, "not_available"),
        ],
        ids=["too-long", "unknown-arg", "unknown-route", "unknown-plugin"],
    )
    async def test_refused_calls_reach_nothing(  # noqa: PLR0913
        self, member, superuser, plugins_dir, plugin_backend, args, path, status, code
    ):
        await ready_backend(superuser, plugins_dir, plugin_backend)
        response = await route(member, args, path=path)
        assert (response.status_code, response.json()["detail"]["code"]) == (status, code)
        assert plugin_backend.calls == []

    @pytest.mark.asyncio
    async def test_a_missing_secret_narrowing_and_revoking(self, member, superuser, plugins_dir, plugin_backend):
        await ready_backend(superuser, plugins_dir, plugin_backend, secret=False)
        assert (await route(member, {"region": "emea"})).json()["detail"]["code"] == "secret_missing"
        await superuser.put("/plugins/test-chart/secrets/api_key", json={"value": BACKEND_SECRET})
        await enable(superuser, narrowed_permissions=["core:backend:call"])
        assert (await route(member, {"region": "emea"})).json()["detail"]["code"] == "permission_denied"
        await enable(superuser, narrowed_permissions=[])
        assert (await route(member, {"region": "emea"})).status_code == 200
        await superuser.post("/plugins/test-chart/revoke")
        assert (await route(member, {"region": "emea"})).status_code == 404
        assert len(plugin_backend.calls) == 1

    @pytest.mark.asyncio
    async def test_failures_open_the_breaker_and_refusals_do_not(
        self, member, superuser, plugins_dir, plugin_backend, monkeypatch
    ):
        monkeypatch.setattr(settings, "WIDGET_PLUGIN_BACKEND_BREAKER_FAILURES", 2)
        await ready_backend(superuser, plugins_dir, plugin_backend)
        plugin_backend.route_answer = Answer(status=400, body=b'{"detail": "bad region"}')
        for _ in range(3):
            assert (await route(member, {"region": "emea"})).json()["detail"]["code"] == "backend_refused"
        plugin_backend.route_answer = Answer(status=500, body=b"{}")
        for _ in range(2):
            assert (await route(member, {"region": "emea"})).json()["detail"]["code"] == "backend_error"
        before = len(plugin_backend.calls)
        response = await route(member, {"region": "emea"})
        assert (response.status_code, response.json()["detail"]["code"]) == (503, "backend_unavailable")
        assert len(plugin_backend.calls) == before

    @pytest.mark.asyncio
    async def test_a_slow_backend_times_out(self, member, superuser, plugins_dir, plugin_backend):
        await ready_backend(superuser, plugins_dir, plugin_backend)
        plugin_backend.route_answer = Answer(delay=2)
        response = await route(member, {"region": "emea"})
        assert (response.status_code, response.json()["detail"]["code"]) == (504, "timeout")


async def _token(member, superuser, plugins_dir, plugin_backend) -> str:
    await ready_backend(superuser, plugins_dir, plugin_backend)
    assert (await route(member, {"region": "emea"})).status_code == 200
    return plugin_backend.calls[-1].headers["x-workspace-call"]


async def _grant(member, db_session, source_uuid) -> None:
    role = await member.role("Sales readers")
    db_session.add(models.RoleBackend(role_uuid=role, backend_uuid=source_uuid, access="access"))
    await db_session.commit()


class TestBroker:
    @pytest.mark.asyncio
    async def test_the_broker_reads_for_the_user_with_the_backends_credentials(  # noqa: PLR0913
        self, member, superuser, plugins_dir, plugin_backend, data_source, db_session
    ):
        token = await _token(member, superuser, plugins_dir, plugin_backend)
        await enable(superuser, data_sources={"sales": str(data_source.uuid)})
        await _grant(member, db_session, data_source.uuid)

        response = await member.post(
            BROKER,
            headers={"X-Workspace-Call": token},
            json={"path": "/sales", "method": "GET", "query": {"region": "emea"}},
        )
        assert response.status_code == 200, response.text
        assert response.json() == {
            "status": 200,
            "content_type": "application/json",
            "body": {"rows": [{"region": "emea", "sales": 10}]},
        }
        [received] = data_source.server.received
        assert received.target == f"/api/sales?token={SOURCE_SECRET}&region=emea"
        assert received.headers["x-api-key"] == SOURCE_SECRET
        assert SOURCE_SECRET not in response.text

    @pytest.mark.asyncio
    async def test_the_users_access_applies(  # noqa: PLR0913
        self, member, superuser, plugins_dir, plugin_backend, data_source, db_session
    ):
        token = await _token(member, superuser, plugins_dir, plugin_backend)
        await enable(superuser, data_sources={"sales": str(data_source.uuid)})
        call = lambda: member.post(BROKER, headers={"X-Workspace-Call": token}, json={"path": "/sales"})  # noqa: E731

        response = await call()
        assert (response.status_code, response.json()["detail"]["code"]) == (403, "not_permitted")
        assert data_source.server.received == []
        await _grant(member, db_session, data_source.uuid)
        assert (await call()).status_code == 200

    @pytest.mark.asyncio
    async def test_refusals(self, member, superuser, plugins_dir, plugin_backend, data_source, db_session):  # noqa: PLR0913
        token = await _token(member, superuser, plugins_dir, plugin_backend)
        call = lambda path="/sales", url=BROKER, headers=None: member.post(  # noqa: E731
            url, headers=headers if headers is not None else {"X-Workspace-Call": token}, json={"path": path}
        )
        assert (await call()).json()["detail"]["code"] == "data_source_unmapped"
        await enable(superuser, data_sources={"sales": str(data_source.uuid)})
        await _grant(member, db_session, data_source.uuid)
        assert (await call(url=BROKER.replace("sales", "other"))).json()["detail"]["code"] == "undeclared_data_source"
        assert (await call(headers={})).status_code == 401
        expired = backends.mint_token(backends.read_token(token), seconds=-1)
        assert (await call(headers={"X-Workspace-Call": expired})).status_code == 401
        for path in ("/../admin", "//elsewhere.example.org/x", "sales", "/a/./b"):
            assert (await call(path=path)).json()["detail"]["code"] == "invalid_args", path
        assert data_source.server.received == []
        await superuser.post("/plugins/test-chart/revoke")
        assert (await call()).json()["detail"]["code"] == "not_available"

    @pytest.mark.asyncio
    async def test_an_entity_maps_only_its_own_backends(
        self, superuser, second_user_client, plugins_dir, plugin_backend, data_source, db_session
    ):
        await ready_backend(superuser, plugins_dir, plugin_backend)
        other = models.ApiSource(uuid=uuid4(), name="Elsewhere", url="http://127.0.0.1:9/x", user_uuid=None)
        other.entity_uuid = UUID(_SECOND_USER["entity_uuid"])
        db_session.add(other)
        await db_session.commit()
        try:
            wrong = await superuser.put("/admin/plugins/test-chart", json={"data_sources": {"sales": str(other.uuid)}})
            assert wrong.status_code == 422
            unknown = await superuser.put("/admin/plugins/test-chart", json={"data_sources": {"other": None}})
            assert unknown.status_code == 422
            await enable(superuser, data_sources={"sales": str(data_source.uuid)})
            entry = next(p for p in (await superuser.get("/admin/plugins")).json()["plugins"])
            assert entry["data_sources"] == [
                {"id": "sales", "purpose": "The sales of the user's organization", "backend_uuid": str(data_source.uuid)}
            ]
            await enable(superuser, data_sources={"sales": None})
            entry = next(p for p in (await superuser.get("/admin/plugins")).json()["plugins"])
            assert entry["data_sources"][0]["backend_uuid"] is None
        finally:
            await db_session.delete(other)
            await db_session.commit()
