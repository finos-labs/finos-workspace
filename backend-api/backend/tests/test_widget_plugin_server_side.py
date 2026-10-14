"""The server side of widget plugins through the API (docs/widget-plugins/SERVER-SIDE.md 3
and 4): reviewing proxies and secrets, write-only secret values, the superuser's network
override, an entity's narrowing, and widget calls to a real HTTPS upstream
(tests/fixtures/plugin_proxies.py).
"""

import json

import pytest
from loguru import logger
from sqlalchemy import select, text

from api import models
from api.widget_plugins import proxy as proxy_rules
from tests.fixtures.plugin_proxies import CALL, HOST, SECRET, call, proxy_manifest, ready
from tests.fixtures.upstream import Answer
from tests.fixtures.widget_plugins import (
    approve,
    enable,
    plugin_view,
    rescan,
    user_listing,
    version_view,
    write_package,
)
from utilities.config import settings


async def secret_status(superuser, name="api_key"):
    return next(s for s in (await plugin_view(superuser))["secrets"] if s["name"] == name)


class TestReview:
    @pytest.mark.asyncio
    async def test_the_review_lists_hosts_proxies_and_secrets(self, superuser, plugins_dir):
        write_package(plugins_dir, proxy_manifest(8443))
        await rescan(superuser)
        view = version_view(await plugin_view(superuser))
        items = {i["key"]: i for i in view["review"]}
        assert items[f"server:https://{HOST}:8443"]["family"] == "network"
        assert items["proxy:quote"]["family"] == "proxies"
        assert "sends the secrets api_key" in items["proxy:quote"]["label"]
        assert items["secret:api_key"]["label"] == "api_key: Reads quotes from the quote service"
        assert view["server"]["network"] == {"declared": [f"https://{HOST}:8443"], "approved": [f"https://{HOST}:8443"]}
        assert [p["id"] for p in view["server"]["proxies"]] == ["quote"]

        response = await superuser.post(
            "/plugins/test-chart/versions/1.0.0/approve",
            json={"digest": view["digest"], "acknowledged": [k for k in items if not k.startswith("proxy:")]},
        )
        assert response.status_code == 422
        assert response.json()["detail"]["missing"] == ["proxy:quote"]

    @pytest.mark.asyncio
    async def test_a_changed_proxy_is_reviewed_again(self, superuser, plugins_dir):
        write_package(plugins_dir, proxy_manifest(8443))
        await rescan(superuser)
        await approve(superuser)
        changed = proxy_manifest(8443, version="1.1.0")
        changed["server"]["proxies"][0]["query"]["limit"] = "10"
        write_package(plugins_dir, changed)
        await rescan(superuser)
        items = {i["key"]: i for i in version_view(await plugin_view(superuser), "1.1.0")["review"]}
        assert items["proxy:quote"]["added"] is True
        assert items["proxy:quote"]["label"].endswith("(changed)")
        assert items["secret:api_key"]["added"] is False


class TestSecrets:
    @pytest.mark.asyncio
    async def test_a_value_is_write_only_and_encrypted(self, superuser, plugins_dir, db_session):
        write_package(plugins_dir, proxy_manifest(8443))
        await rescan(superuser)
        assert (await secret_status(superuser))["set"] is False

        response = await superuser.put("/plugins/test-chart/secrets/api_key", json={"value": SECRET})
        assert response.status_code == 200, response.text
        status = await secret_status(superuser)
        assert (status["set"], status["source"], status["declared"]) == (True, "admin", True)
        assert status["set_by_uuid"] and status["set_at"]
        for path in ("/plugins", "/plugins/test-chart", "/plugins/test-chart/events"):
            assert SECRET not in (await superuser.get(path)).text

        stored = (await db_session.execute(text("SELECT value FROM widget_plugin_secret"))).scalar_one()
        assert SECRET.encode() not in (stored if isinstance(stored, bytes) else str(stored).encode())

        events = (await superuser.get("/plugins/test-chart/events")).json()
        assert [e["details"] for e in events if e["action"] == "secret-set"] == [{"name": "api_key"}]

        assert (await superuser.delete("/plugins/test-chart/secrets/api_key")).status_code == 200
        assert (await secret_status(superuser))["set"] is False
        assert (await superuser.delete("/plugins/test-chart/secrets/api_key")).status_code == 404

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("path", "body", "status"),
        [
            ("/plugins/test-chart/secrets/other", {"value": SECRET}, 404),
            ("/plugins/test-chart/secrets/Bad-Name", {"value": SECRET}, 404),
            ("/plugins/test-chart/secrets/api_key", {"value": ""}, 422),
            ("/plugins/test-chart/secrets/api_key", {"value": SECRET + "\n"}, 422),
            ("/plugins/test-chart/secrets/api_key", {"value": SECRET, "extra": SECRET}, 422),
            ("/plugins/test-chart/secrets/api_key", [SECRET], 422),
        ],
        ids=["undeclared", "bad-name", "empty", "line-break", "extra-key", "not-an-object"],
    )
    async def test_refusals_never_repeat_the_value(self, superuser, plugins_dir, path, body, status):
        write_package(plugins_dir, proxy_manifest(8443))
        await rescan(superuser)
        lines: list[str] = []
        sink = logger.add(lines.append, level="DEBUG")
        try:
            response = await superuser.put(path, json=body)
        finally:
            logger.remove(sink)
        assert response.status_code == status, response.text
        assert SECRET not in response.text
        assert not [line for line in lines if SECRET in line]

    @pytest.mark.asyncio
    async def test_only_superusers_set_secrets(self, admin_client, plugins_dir):
        response = await admin_client.put("/plugins/test-chart/secrets/api_key", json={"value": SECRET})
        assert response.status_code in {401, 403}

    @pytest.mark.asyncio
    async def test_the_deployments_value_wins_and_cannot_be_changed_here(self, superuser, plugins_dir, secrets_dir):
        write_package(plugins_dir, proxy_manifest(8443))
        await rescan(superuser)
        (secrets_dir / "test-chart").mkdir()
        (secrets_dir / "test-chart" / "api_key").write_text(SECRET + "\n")
        status = await secret_status(superuser)
        assert (status["set"], status["source"], status["problem"]) == (True, "configuration", None)
        response = await superuser.put("/plugins/test-chart/secrets/api_key", json={"value": "another"})
        assert response.status_code == 409

    @pytest.mark.asyncio
    async def test_forgetting_a_plugin_deletes_its_secrets(self, superuser, plugins_dir, db_session):
        directory = write_package(plugins_dir, proxy_manifest(8443))
        await rescan(superuser)
        await superuser.put("/plugins/test-chart/secrets/api_key", json={"value": SECRET})
        for path in sorted(directory.rglob("*"), reverse=True):
            path.unlink() if path.is_file() else path.rmdir()
        directory.rmdir()
        await rescan(superuser)
        assert (await superuser.delete("/plugins/test-chart")).status_code == 200
        assert (await db_session.execute(select(models.WidgetPluginSecret))).scalars().all() == []


class TestNetwork:
    @pytest.mark.asyncio
    async def test_the_override_replaces_the_hosts_and_private_hosts_need_the_confirmation(self, superuser, plugins_dir):
        write_package(plugins_dir, proxy_manifest(8443))
        await rescan(superuser)
        bad = await superuser.put("/plugins/test-chart/overrides", json={"server_network": ["https://10.0.0.8"]})
        assert bad.status_code == 422
        good = await superuser.put(
            "/plugins/test-chart/overrides",
            json={
                "csp": {"img-src": ["https://tiles.example.org"]},
                "server_network": ["https://10.0.0.8"],
                "confirmations": ["private-host"],
            },
        )
        assert good.status_code == 200, good.text
        view = version_view(await plugin_view(superuser))
        assert view["server"]["network"]["approved"] == ["https://10.0.0.8"]
        assert view["server"]["private"] is True
        assert view["csp"]["approved"]["img-src"] == ["https://tiles.example.org"]
        items = {i["key"]: i for i in view["review"]}
        assert items["server:https://10.0.0.8"]["overridden"] is True
        assert items["server:https://10.0.0.8"]["risk"] == "critical"

        # The override is replaced whole: without server_network the declared hosts apply again
        await superuser.put("/plugins/test-chart/overrides", json={"csp": {"img-src": ["https://tiles.example.org"]}})
        assert "server_network" not in (await plugin_view(superuser))["overrides"]
        view = version_view(await plugin_view(superuser))
        assert view["server"]["network"]["approved"] == [f"https://{HOST}:8443"]
        assert view["server"]["private"] is False

    @pytest.mark.asyncio
    async def test_a_tcp_endpoint_is_for_a_backend(self, superuser, plugins_dir):
        write_package(plugins_dir, proxy_manifest(8443))
        await rescan(superuser)
        response = await superuser.put(
            "/plugins/test-chart/overrides",
            json={"server_network": ["tcp://postgres:5432"], "confirmations": ["private-host"]},
        )
        assert response.status_code == 422
        assert "for a plugin backend" in response.text

    def test_the_apis_own_calls_never_use_a_tcp_endpoint(self):
        assert proxy_rules.host_allowed("db.example.com", 443, ["https://db.example.com"])
        assert not proxy_rules.host_allowed("db.example.com", 443, ["tcp://db.example.com:443"])

    @pytest.mark.asyncio
    async def test_an_entity_can_only_remove_approved_hosts(self, member, superuser, plugins_dir):
        await ready(superuser, plugins_dir, 8443, secret=False, private=False)
        widen = await superuser.put(
            "/admin/plugins/test-chart", json={"server_network_narrow": ["https://other.example.org"]}
        )
        assert widen.status_code == 422
        await enable(superuser, server_network_narrow=[f"https://{HOST}:8443"])
        [entry] = [p for p in (await superuser.get("/admin/plugins")).json()["plugins"] if p["plugin_id"] == "test-chart"]
        assert entry["server"]["network"] == {"approved": [f"https://{HOST}:8443"], "effective": []}


class TestCalls:
    @pytest.mark.asyncio
    async def test_a_call_reaches_the_upstream_with_the_secret(self, member, superuser, plugins_dir, upstream):
        await ready(superuser, plugins_dir, upstream.port)
        [plugin] = (await user_listing(member))["plugins"]
        assert plugin["widgets"][0]["proxies"] == ["quote"]

        response = await call(member, {"symbol": "BRK/B", "period": "week"})
        assert response.status_code == 200, response.text
        assert response.json() == {"content_type": "application/json", "body": {"price": 101.5}}
        assert SECRET not in response.text
        [received] = upstream.received
        assert received.target == "/quotes/BRK%2FB?period=week"
        assert received.headers["authorization"] == f"Bearer {SECRET}"
        assert received.headers["host"] == f"{HOST}:{upstream.port}"

    @pytest.mark.asyncio
    async def test_a_private_address_needs_the_superusers_override(self, member, superuser, plugins_dir, upstream):
        await ready(superuser, plugins_dir, upstream.port, private=False)
        response = await call(member, {"symbol": "IBM"})
        assert response.status_code == 403
        assert response.json()["detail"]["code"] == "egress_refused"
        assert upstream.received == []

    @pytest.mark.asyncio
    async def test_a_missing_secret_sends_nothing(self, member, superuser, plugins_dir, upstream):
        await ready(superuser, plugins_dir, upstream.port, secret=False)
        response = await call(member, {"symbol": "IBM"})
        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "secret_missing"
        assert upstream.received == []

    @pytest.mark.asyncio
    async def test_the_deployments_value_is_sent(self, member, superuser, plugins_dir, upstream, secrets_dir):
        await ready(superuser, plugins_dir, upstream.port, secret=False)
        (secrets_dir / "test-chart").mkdir()
        (secrets_dir / "test-chart" / "api_key").write_text("from-the-deployment\n")
        response = await call(member, {"symbol": "IBM"})
        assert response.status_code == 200, response.text
        assert upstream.received[0].headers["authorization"] == "Bearer from-the-deployment"

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("path", "widget", "args", "status", "code"),
        [
            (CALL, "chart", {"symbol": "IBM", "other": 1}, 422, "invalid_args"),
            (CALL, "chart", {"symbol": "X" * 13}, 422, "invalid_args"),
            (CALL, "chart", {}, 422, "invalid_args"),
            (CALL.replace("/quote", "/other"), "chart", {}, 403, "unknown_proxy"),
            (CALL, "other", {}, 404, "not_available"),
            (CALL.replace("test-chart", "other-plugin"), "chart", {}, 404, "not_available"),
        ],
        ids=["unknown-arg", "too-long", "required", "undeclared-proxy", "unknown-widget", "unknown-plugin"],
    )
    async def test_refused_calls_send_nothing(  # noqa: PLR0913 - the case's parts
        self, member, superuser, plugins_dir, upstream, path, widget, args, status, code
    ):
        await ready(superuser, plugins_dir, upstream.port)
        response = await call(member, args, widget=widget, path=path)
        assert response.status_code == status, response.text
        assert response.json()["detail"]["code"] == code
        assert upstream.received == []

    @pytest.mark.asyncio
    async def test_a_malformed_body_is_refused_without_its_values(self, member, superuser, plugins_dir, upstream):
        await ready(superuser, plugins_dir, upstream.port)
        lines: list[str] = []
        sink = logger.add(lines.append, level="DEBUG")
        try:
            for body in (
                {"widget": "chart", "args": ["IBM-SECRET-ARG"]},
                {"widget": "chart", "args": {}, "url": "IBM-SECRET-ARG"},
                {"widget": ["IBM-SECRET-ARG"], "args": {}},
            ):
                response = await member.post(CALL, json=body)
                assert response.status_code == 422
            response = await member.post(CALL, content=b"IBM-SECRET-ARG", headers={"Content-Type": "application/json"})
            assert response.status_code == 422
            await call(member, {"symbol": "IBM-SECRET-ARG"})
        finally:
            logger.remove(sink)
        assert not [line for line in lines if "IBM-SECRET-ARG" in line or SECRET in line]
        assert any("proxy=quote outcome=invalid_args" in line for line in lines)

    @pytest.mark.asyncio
    async def test_narrowing_and_revoking_stop_calls(self, member, superuser, plugins_dir, upstream):
        await ready(superuser, plugins_dir, upstream.port)
        await enable(superuser, narrowed_permissions=["core:proxy:call"])
        assert (await user_listing(member))["plugins"][0]["widgets"][0]["proxies"] == []
        assert (await call(member, {"symbol": "IBM"})).json()["detail"]["code"] == "permission_denied"

        await enable(superuser, narrowed_permissions=[], server_network_narrow=[f"https://{HOST}:{upstream.port}"])
        assert (await call(member, {"symbol": "IBM"})).json()["detail"]["code"] == "egress_refused"

        await enable(superuser, server_network_narrow=[])
        assert (await call(member, {"symbol": "IBM"})).status_code == 200
        assert (await superuser.post("/plugins/test-chart/revoke")).status_code == 200
        assert (await call(member, {"symbol": "IBM"})).status_code == 404
        assert len(upstream.received) == 1

    @pytest.mark.asyncio
    async def test_users_without_access_cannot_call(self, second_user_client, superuser, plugins_dir, upstream):
        await ready(superuser, plugins_dir, upstream.port)
        response = await call(second_user_client, {"symbol": "IBM"})
        assert response.status_code == 404
        assert upstream.received == []

    @pytest.mark.asyncio
    async def test_the_rate_limit_per_user(self, member, superuser, plugins_dir, upstream, monkeypatch):
        monkeypatch.setattr(settings, "WIDGET_PLUGIN_PROXY_RATE_PER_USER", "2/minute")
        await ready(superuser, plugins_dir, upstream.port)
        statuses = [(await call(member, {"symbol": "IBM"})).status_code for _ in range(3)]
        assert statuses == [200, 200, 429]

    @pytest.mark.asyncio
    async def test_the_upstreams_failure_is_a_status_class(self, member, superuser, plugins_dir, upstream):
        await ready(superuser, plugins_dir, upstream.port)
        upstream.answer = lambda _r: Answer(status=503, body=json.dumps({"trace": SECRET}).encode())
        response = await call(member, {"symbol": "IBM"})
        assert response.status_code == 502
        assert response.json()["detail"] == {"code": "upstream_error", "message": "the upstream answered 5xx"}
