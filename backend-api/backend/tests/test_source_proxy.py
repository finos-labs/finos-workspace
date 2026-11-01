import asyncio
import json
import time
from uuid import uuid4

import jwt
import pytest
from fastapi import HTTPException
from sqlalchemy import delete, select, update

from api import identity, models, provider_tokens, sign_in_providers
from tests.fixtures.base import _ADMIN_USER, TEST_BASE_URL, settings
from tests.fixtures.plugin_backends import SOURCE_SECRET
from tests.fixtures.organization import MEMBER_EMAIL
from tests.fixtures.upstream import Answer
from tests.fixtures.widget_plugins import ADMIN, ADMIN_ENTITY, MEMBER


def route(source) -> str:
    return f"/app/data-connectors/api-source/{source.uuid}/request"


async def grant(member, db_session, source) -> None:
    role = await member.role("Sales readers")
    db_session.add(models.RoleBackend(role_uuid=role, backend_uuid=source.uuid, access="access"))
    await db_session.commit()


def call(member, source, path: str = "/api/sales", **fields):
    return member.post(
        route(source),
        json={"url": f"http://127.0.0.1:{source.server.port}{path}", **fields},
    )


async def personal_source(db_session, owner, url):
    personal = models.ApiSource(
        uuid=uuid4(),
        name="Mine",
        url=url,
        user_uuid=owner,
        endpointHeaders=[{"key": "X-Api-Key", "value": SOURCE_SECRET, "location": "headers"}],
    )
    db_session.add(personal)
    await db_session.commit()
    return personal


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


@pytest.fixture
async def source(member, data_source, db_session):
    await grant(member, db_session, data_source)
    return data_source


class TestTheServerCallsTheConnection:
    @pytest.mark.asyncio
    async def test_the_stored_credentials_are_added_and_never_returned(self, member, source):
        response = await call(member, source, "/api/sales?region=emea", headers={"X-Region": "emea"})
        assert response.status_code == 200, response.text
        assert response.json() == {"rows": [{"region": "emea", "sales": 10}]}
        [received] = source.server.received
        assert received.method == "GET"
        assert received.target == f"/api/sales?token={SOURCE_SECRET}&region=emea"
        assert received.headers["x-api-key"] == SOURCE_SECRET
        assert received.headers["x-region"] == "emea"
        assert received.headers["x-workspace-user"] == MEMBER_EMAIL
        assert received.headers["accept-encoding"] == "identity"
        assert SOURCE_SECRET not in response.text
        assert SOURCE_SECRET not in json.dumps(dict(response.headers))

    @pytest.mark.asyncio
    async def test_the_answer_is_the_connections_own(self, member, source):
        source.server.answer = lambda _r: Answer(
            status=418,
            content_type="text/plain",
            body=b"short and stout",
            headers={"Set-Cookie": "session=1", "X-Internal": "x", "Cache-Control": "no-store"},
        )
        response = await call(member, source)
        assert (response.status_code, response.text) == (418, "short and stout")
        assert response.headers["content-type"].startswith("text/plain")
        assert response.headers["cache-control"] == "no-store"
        assert "set-cookie" not in response.headers
        assert response.headers["x-internal"] == "x"
        assert response.headers["x-content-type-options"] == "nosniff"
        assert "sandbox" in response.headers["content-security-policy"]

    @pytest.mark.asyncio
    async def test_a_body_goes_as_json(self, member, source):
        response = await call(member, source, "/api/query", method="POST", body='{"n": 1}')
        assert response.status_code == 200
        [received] = source.server.received
        assert received.method == "POST"
        assert received.body == b'{"n": 1}'
        assert received.headers["content-type"] == "application/json"

    @pytest.mark.asyncio
    async def test_the_caller_says_what_it_accepts(self, member, source):
        await call(member, source, accept="application/x-ndjson")
        assert source.server.received[0].headers["accept"] == "application/x-ndjson"

    @pytest.mark.asyncio
    @pytest.mark.parametrize("method", ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
    async def test_every_method_of_http_reaches_the_connection(self, member, source, method):
        response = await call(member, source, "/other/path", method=method)
        assert response.status_code == 200, response.text
        assert source.server.received[-1].method == method
        assert source.server.received[-1].target.startswith(f"/other/path?token={SOURCE_SECRET}")

    @pytest.mark.asyncio
    async def test_a_path_outside_the_connections_own_path_is_still_its_origin(self, member, source):
        response = await call(member, source, "/elsewhere/on/the/same/origin")
        assert response.status_code == 200
        assert source.server.received[-1].headers["x-api-key"] == SOURCE_SECRET

    @pytest.mark.asyncio
    async def test_headers_the_connection_sets_are_not_overridden_by_the_proxy(self, member, source, db_session):
        await db_session.execute(
            update(models.ApiSource)
            .where(models.ApiSource.uuid == source.uuid)
            .values(
                endpointHeaders=[
                    {"key": "X-Api-Key", "value": SOURCE_SECRET, "location": "headers"},
                    {"key": "Accept", "value": "application/vnd.custom+json", "location": "headers"},
                    {"key": "Accept-Encoding", "value": "gzip", "location": "headers"},
                    {"key": "Content-Type", "value": "application/vnd.custom+json", "location": "headers"},
                ]
            )
        )
        await db_session.commit()
        await call(member, source, "/api/x", method="POST", body="{}", accept="application/json")
        received = source.server.received[-1].headers
        assert received["accept"] == "application/vnd.custom+json"
        assert received["accept-encoding"] == "gzip"
        assert received["content-type"] == "application/vnd.custom+json"

    @pytest.mark.asyncio
    async def test_the_connections_answer_headers_come_back_except_cookies_and_hop_by_hop(self, member, source):
        source.server.answer = lambda _r: Answer(
            headers={"Set-Cookie": "a=1", "X-Total-Count": "42", "Link": "<next>; rel=next", "Vary": "Origin"}
        )
        response = await call(member, source)
        assert response.headers["x-total-count"] == "42"
        assert response.headers["link"] == "<next>; rel=next"
        assert "set-cookie" not in response.headers

    @pytest.mark.asyncio
    async def test_a_redirect_on_the_same_origin_is_followed_with_the_credentials(self, member, source):
        base = f"http://127.0.0.1:{source.server.port}"
        source.server.answer = lambda r: (
            Answer(status=307, headers={"Location": f"{base}/api/items/"})
            if r.target.startswith("/api/items?") or r.target == "/api/items"
            else Answer(body=b'{"ok": true}')
        )
        response = await call(member, source, "/api/items", method="POST", body='{"n": 1}')
        assert response.status_code == 200, response.text
        first, second = source.server.received[-2:]
        assert (first.method, second.method) == ("POST", "POST")
        assert second.target.startswith("/api/items/")
        assert second.headers["x-api-key"] == SOURCE_SECRET
        assert second.body == b'{"n": 1}'

    @pytest.mark.asyncio
    @pytest.mark.parametrize("status", [301, 302, 307, 308])
    async def test_a_redirect_keeps_the_method_and_the_body(self, member, source, status):
        base = f"http://127.0.0.1:{source.server.port}"
        source.server.answer = lambda r: (
            Answer(status=status, headers={"Location": f"{base}/api/moved"}) if "/api/save" in r.target else Answer()
        )
        await call(member, source, "/api/save", method="PATCH", body='{"n": 2}')
        assert (source.server.received[-1].method, source.server.received[-1].body) == ("PATCH", b'{"n": 2}')

    @pytest.mark.asyncio
    async def test_a_303_becomes_a_get(self, member, source):
        base = f"http://127.0.0.1:{source.server.port}"
        source.server.answer = lambda r: (
            Answer(status=303, headers={"Location": f"{base}/api/done"}) if "/api/save" in r.target else Answer()
        )
        await call(member, source, "/api/save", method="POST", body="{}")
        assert source.server.received[-1].method == "GET"
        assert source.server.received[-1].body == b""

    @pytest.mark.asyncio
    async def test_a_redirect_to_another_origin_is_not_followed(self, member, source):
        source.server.answer = lambda _r: Answer(status=302, headers={"Location": "http://169.254.169.254/latest/"})
        response = await call(member, source)
        assert response.status_code == 302
        assert len(source.server.received) == 1


async def _verified(token: str, audience: str) -> dict:
    kid = jwt.get_unverified_header(token)["kid"]
    (jwk,) = [key for key in (await identity.jwks())["keys"] if key["kid"] == kid]
    return jwt.decode(
        token,
        jwt.PyJWK(jwk).key,
        algorithms=["ES256"],
        audience=audience,
        issuer=settings.SELFURL.rstrip("/"),
    )


@pytest.fixture
async def no_provider_sessions_left(db_session):
    yield
    await db_session.rollback()
    await db_session.execute(delete(models.ProviderSession))
    await db_session.commit()


class TestTheServerSaysWhoIsCalling:
    @pytest.mark.asyncio
    async def test_the_signed_identity_is_made_for_that_connection(self, member, source):
        response = await call(member, source)

        assert response.status_code == 200, response.text
        token = source.server.received[-1].headers["x-workspace-identity"]
        claims = await _verified(token, f"http://127.0.0.1:{source.server.port}")
        assert (claims["sub"], claims["email"]) == (str(MEMBER), MEMBER_EMAIL)

    @pytest.mark.asyncio
    async def test_a_connection_that_names_a_header_the_server_sets_does_not_override_it(
        self, member, source, db_session
    ):
        await db_session.execute(
            update(models.ApiSource)
            .where(models.ApiSource.uuid == source.uuid)
            .values(
                endpointHeaders=[
                    {"key": "x-workspace-identity", "value": "forged", "location": "headers"},
                    {"key": "X-Workspace-User", "value": "forged@example.com", "location": "headers"},
                ]
            )
        )
        await db_session.commit()

        response = await call(member, source)

        assert response.status_code == 200, response.text
        sent = source.server.received[-1].headers
        assert sent["x-workspace-identity"] != "forged"
        assert sent["x-workspace-user"] == MEMBER_EMAIL

    @pytest.mark.asyncio
    async def test_the_providers_id_token_goes_to_saved_connections_and_not_to_one_being_tried(
        self, member, superuser, source, db_session, monkeypatch, no_provider_sessions_left
    ):
        for name, value in (
            ("AZURE_CLIENT_ID", "client"),
            ("AZURE_TENANT_ID", "tenant"),
            ("AUTHENTICATION_SEND_MICROSOFT_IDTOKEN", True),
        ):
            monkeypatch.setattr(settings, name, value)
        provider_tokens._cache.clear()
        for email in (MEMBER_EMAIL, _ADMIN_USER["email"]):
            await provider_tokens.store(
                db_session,
                email,
                ("app",),
                sign_in_providers.ProviderTokens("microsoft", f"id-token-of-{email}", int(time.time()) + 3600, "refresh"),
            )
        base = f"http://127.0.0.1:{source.server.port}"

        saved = await call(member, source)
        trying = await superuser.post(
            "/app/data-connectors/api-source-test/request",
            json={"url": base, "endpointHeaders": [], "request": {"url": f"{base}/api/sales"}},
        )

        assert saved.status_code == 200 and trying.status_code == 200, (saved.text, trying.text)
        first, second = source.server.received[-2:]
        assert first.headers["x-microsoft-id-token"] == f"id-token-of-{MEMBER_EMAIL}"
        assert "x-microsoft-id-token" not in second.headers
        assert second.headers["x-workspace-identity"]


class TestWhatItRefuses:
    @pytest.mark.asyncio
    async def test_a_user_without_access_reaches_nothing(self, member, data_source, db_session):
        await db_session.execute(
            update(models.ApiSource).where(models.ApiSource.uuid == data_source.uuid).values(entity_uuid=None)
        )
        await db_session.commit()
        response = await call(member, data_source)
        assert response.status_code == 404
        assert response.headers["x-workspace-proxy-error"] == "1"
        assert data_source.server.received == []

    @pytest.mark.asyncio
    async def test_an_unknown_connection(self, member, source):
        response = await member.post(
            f"/app/data-connectors/api-source/{uuid4()}/request", json={"url": "http://127.0.0.1:1/api"}
        )
        assert response.status_code == 404

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "url",
        [
            "http://127.0.0.1:{other}/api/sales",
            "http://localhost:{port}/api/sales",
            "https://127.0.0.1:{port}/api/sales",
            "http://user:pass@127.0.0.1:{port}/api/sales",
            "http://127.0.0.1:{port}\\@evil.example/api/sales",
        ],
    )
    async def test_a_url_on_another_origin(self, member, source, url):
        response = await member.post(
            route(source), json={"url": url.format(port=source.server.port, other=source.server.port + 1)}
        )
        assert response.status_code in {400, 403, 422, 502}, response.text
        assert source.server.received == []

    @pytest.mark.asyncio
    async def test_a_query_value_the_connection_sets(self, member, source):
        response = await call(member, source, "/api/sales?token=mine")
        assert response.status_code == 400
        assert source.server.received == []

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "name",
        [
            "Authorization",
            "Cookie",
            "Host",
            "X-Workspace-User",
            "X-Workspace-Identity",
            "x-workspace-identity",
            "X-Microsoft-Id-Token",
            "X-Okta-Id-Token",
            "X-Api-Key",
            "x-api-key",
            "Proxy-Thing",
            "Sec-Thing",
            "Bad Name",
        ],
    )
    async def test_a_header_the_caller_may_not_set(self, member, source, name):
        response = await call(member, source, headers={name: "x"})
        assert response.status_code == 400, name
        assert source.server.received == []

    @pytest.mark.asyncio
    async def test_a_method_the_contract_does_not_name_and_an_unknown_field(self, member, source):
        assert (await call(member, source, method="TRACE")).status_code == 422
        assert (await call(member, source, credentials={"k": "v"})).status_code == 422
        assert source.server.received == []

    @pytest.mark.asyncio
    async def test_an_unreachable_connection(self, member, db_session):
        closed = models.ApiSource(
            uuid=uuid4(), name="Closed", url="http://127.0.0.1:9/api", user_uuid=ADMIN, entity_uuid=ADMIN_ENTITY
        )
        db_session.add(closed)
        await db_session.commit()
        await grant(member, db_session, closed)
        response = await member.post(route(closed), json={"url": "http://127.0.0.1:9/api/x"})
        assert response.status_code == 502
        assert response.headers["x-workspace-proxy-error"] == "1"

    @pytest.mark.asyncio
    async def test_a_developers_own_connection_must_be_a_public_https_address(self, developer, db_session):
        personal = await personal_source(db_session, MEMBER, "http://127.0.0.1:9/api")
        response = await developer.post(route(personal), json={"url": "http://127.0.0.1:9/api/x"})
        assert response.status_code == 403, response.text
        assert "public https" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_a_superusers_own_connection_may_be_private_and_plain(self, superuser, db_session, data_source):
        base = f"http://127.0.0.1:{data_source.server.port}"
        personal = await personal_source(db_session, ADMIN, base)
        response = await superuser.post(route(personal), json={"url": f"{base}/api/sales"})
        assert response.status_code == 200, response.text
        assert data_source.server.received[-1].headers["x-api-key"] == SOURCE_SECRET

    @pytest.mark.asyncio
    async def test_a_developers_connection_stays_untrusted_when_a_superuser_uses_it(
        self, superuser, developer, db_session
    ):
        personal = await personal_source(db_session, MEMBER, "http://127.0.0.1:9/api")
        db_session.add(models.RoleBackend(role_uuid=superuser.plugin_role, backend_uuid=personal.uuid, access="access"))
        await db_session.commit()
        response = await superuser.post(route(personal), json={"url": "http://127.0.0.1:9/api/x"})
        assert response.status_code == 403, response.text

    @pytest.mark.asyncio
    async def test_a_personal_connection_may_be_private_and_plain_on_a_local_machine(
        self, developer, db_session, monkeypatch, data_source
    ):
        from api import source_proxy
        from utilities.config import settings

        def refuse(*args, **kwargs):
            raise source_proxy.socket.gaierror

        monkeypatch.setattr(settings, "MODE", "local")
        monkeypatch.setattr(source_proxy.socket, "getaddrinfo", refuse)
        source_proxy._host_machine.clear()
        base = f"http://127.0.0.1:{data_source.server.port}"
        personal = await personal_source(db_session, MEMBER, base)
        response = await developer.post(route(personal), json={"url": f"{base}/api/sales"})
        assert response.status_code == 200, response.text
        assert data_source.server.received[-1].headers["x-api-key"] == SOURCE_SECRET

    @pytest.mark.asyncio
    async def test_signed_out(self, client):
        response = await client.post(
            f"/app/data-connectors/api-source/{uuid4()}/request", json={"url": "http://127.0.0.1:1/x"}
        )
        assert response.status_code in {401, 403}


class TestSecretsStayOnTheServer:
    @pytest.mark.asyncio
    async def test_a_listing_names_the_headers_and_never_their_values(self, superuser, db_session):
        uid = uuid4()
        saved = await superuser.post(
            f"/app/data-connectors/api-source/{uid}",
            json={
                "name": "Mine",
                "url": "https://example.org/api",
                "endpointHeaders": [
                    {"key": "X-Api-Key", "value": "s3cret-header", "location": "headers"},
                    {"key": "token", "value": "s3cret-query", "location": "query"},
                ],
            },
        )
        assert saved.status_code == 200, saved.text
        listing = await superuser.get("/app/data-connectors/api-source")
        mine = next(item for item in listing.json() if item["id"] == str(uid))
        assert mine["endpointHeaders"] == [
            {"key": "X-Api-Key", "location": "headers"},
            {"key": "token", "location": "query"},
        ]
        assert "s3cret" not in listing.text
        await db_session.execute(delete(models.ApiSource).where(models.ApiSource.uuid == uid))
        await db_session.commit()

    @pytest.mark.asyncio
    async def test_saving_a_blank_value_keeps_the_stored_one(self, superuser, db_session):
        uid = uuid4()
        url = f"/app/data-connectors/api-source/{uid}"
        body = {
            "name": "Mine",
            "url": "https://example.org/api",
            "endpointHeaders": [
                {"key": "X-Api-Key", "value": "first", "location": "headers"},
                {"key": "token", "value": "second", "location": "query"},
            ],
        }
        assert (await superuser.post(url, json=body)).status_code == 200
        body["endpointHeaders"] = [
            {"key": "X-Api-Key", "value": "", "location": "headers"},
            {"key": "token", "value": "changed", "location": "query"},
            {"key": "X-New", "value": "", "location": "headers"},
        ]
        assert (await superuser.post(url, json=body)).status_code == 200
        stored = (
            await db_session.execute(select(models.ApiSource.endpointHeaders).where(models.ApiSource.uuid == uid))
        ).scalar_one()
        assert {(row["key"], row["value"]) for row in stored} == {
            ("X-Api-Key", "first"),
            ("token", "changed"),
            ("X-New", ""),
        }
        await db_session.execute(delete(models.ApiSource).where(models.ApiSource.uuid == uid))
        await db_session.commit()

    @pytest.mark.asyncio
    async def test_a_blank_value_is_not_kept_when_the_address_moves_to_another_origin(self, superuser, db_session):
        uid = uuid4()
        url = f"/app/data-connectors/api-source/{uid}"
        body = {
            "name": "Mine",
            "url": "https://example.org/api",
            "endpointHeaders": [{"key": "X-Api-Key", "value": "first", "location": "headers"}],
        }
        assert (await superuser.post(url, json=body)).status_code == 200
        body["url"] = "https://elsewhere.example/api"
        body["endpointHeaders"] = [{"key": "X-Api-Key", "value": "", "location": "headers"}]
        assert (await superuser.post(url, json=body)).status_code == 200
        stored = (
            await db_session.execute(select(models.ApiSource.endpointHeaders).where(models.ApiSource.uuid == uid))
        ).scalar_one()
        assert {(row["key"], row["value"]) for row in stored} == {("X-Api-Key", "")}
        await db_session.execute(delete(models.ApiSource).where(models.ApiSource.uuid == uid))
        await db_session.commit()

    @pytest.mark.asyncio
    async def test_a_candidate_on_another_origin_does_not_get_the_stored_value(self, superuser, data_source):
        other = f"http://localhost:{data_source.server.port}"
        response = await superuser.post(
            "/app/data-connectors/api-source-test/request",
            json={
                "id": str(data_source.uuid),
                "url": other,
                "endpointHeaders": [{"key": "X-Api-Key", "value": "", "location": "headers"}],
                "request": {"url": f"{other}/api/sales"},
            },
        )
        assert response.status_code == 200, response.text
        assert data_source.server.received[-1].headers.get("x-api-key") != SOURCE_SECRET


class TestCleanup:
    @pytest.mark.asyncio
    async def test_a_stream_that_is_cancelled_closes_the_upstream_and_frees_its_slot(self):
        import asyncio

        from api import source_proxy

        closed = []

        class Response:
            async def aiter_raw(self):
                yield b"first"
                await asyncio.sleep(3600)
                yield b"never"

            async def aclose(self):
                closed.append("response")

        class Client:
            async def aclose(self):
                closed.append("client")

        user = uuid4()
        source_proxy.acquire(user)
        relayed = source_proxy.Relayed(Response(), Client(), user, None)
        sent = []

        async def send(message):
            sent.append(message)

        async def receive():
            await asyncio.sleep(3600)

        task = asyncio.ensure_future(relayed({"type": "http", "asgi": {"spec_version": "2.3"}}, receive, send))
        await asyncio.sleep(0.2)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert closed == ["response", "client"]
        assert user not in source_proxy._open_streams
        assert source_proxy._open_total == 0

    @pytest.mark.asyncio
    async def test_a_response_that_never_started_still_frees_its_slot(self):
        from api import source_proxy

        closed = []

        class Response:
            async def aclose(self):
                closed.append("response")

        user = uuid4()
        source_proxy.acquire(user)
        relayed = source_proxy.Relayed(Response(), None, user, None)

        async def receive():
            return {"type": "http.disconnect"}

        async def send(message):
            raise OSError("the client is gone")

        with pytest.raises(Exception):
            await relayed({"type": "http", "asgi": {"spec_version": "2.3"}}, receive, send)
        assert closed == ["response"]
        assert source_proxy._open_total == 0

    @pytest.mark.asyncio
    async def test_a_response_over_the_limit_is_cut_with_an_error_not_a_clean_end(self):
        from api import source_proxy

        class Response:
            async def aiter_raw(self):
                yield b"x" * 10
                yield b"y" * 10

            async def aclose(self):
                return None

        relayed = source_proxy.Relayed(Response(), None, uuid4(), 15)
        source_proxy._open_total += 1
        source_proxy._open_streams[relayed._user] = 1
        seen = []
        with pytest.raises(RuntimeError):
            async for chunk in relayed._body():
                seen.append(chunk)
        assert seen == [b"x" * 10]
        await relayed.close()

    @pytest.mark.asyncio
    async def test_a_stream_is_cut_at_its_time_limit_unless_it_has_none(self):
        import asyncio

        from api import source_proxy

        class Response:
            async def aiter_raw(self):
                yield b"first"
                await asyncio.sleep(0.5)
                yield b"second"

            async def aclose(self):
                return None

        limited = source_proxy.Relayed(Response(), None, uuid4(), None, seconds=0.1)
        with pytest.raises(TimeoutError):
            async for _chunk in limited._body():
                pass
        unlimited = source_proxy.Relayed(Response(), None, uuid4(), None, seconds=None)
        assert [chunk async for chunk in unlimited._body()] == [b"first", b"second"]


class TestALocalMachine:
    @pytest.mark.asyncio
    async def test_a_loopback_address_reaches_the_host_machine_when_the_container_can_resolve_it(self, monkeypatch):
        from api import source_proxy

        monkeypatch.setattr(source_proxy.socket, "getaddrinfo", lambda *a, **k: [("x",)])
        assert await source_proxy.reach_host_machine("http://localhost:9000/api/x?a=1") == (
            "http://host.docker.internal:9000/api/x?a=1",
            "localhost:9000",
        )
        assert (await source_proxy.reach_host_machine("http://127.0.0.1/api"))[0] == "http://host.docker.internal/api"
        assert await source_proxy.reach_host_machine("http://example.org:9000/api") == (
            "http://example.org:9000/api",
            None,
        )

    @pytest.mark.asyncio
    async def test_an_address_stays_as_it_is_where_the_host_machine_has_no_name(self, monkeypatch):
        from api import source_proxy

        def refuse(*args, **kwargs):
            raise source_proxy.socket.gaierror

        monkeypatch.setattr(source_proxy.socket, "getaddrinfo", refuse)
        assert await source_proxy.reach_host_machine("http://localhost:9000/api") == ("http://localhost:9000/api", None)

    @pytest.mark.asyncio
    async def test_the_name_lookup_does_not_block_the_event_loop(self, monkeypatch):
        import time

        from api import source_proxy

        def slow(*args, **kwargs):
            time.sleep(0.5)
            return [("x",)]

        monkeypatch.setattr(source_proxy.socket, "getaddrinfo", slow)
        ticks = []

        async def ticker():
            while True:
                ticks.append(1)
                await asyncio.sleep(0.05)

        task = asyncio.create_task(ticker())
        await source_proxy.reach_host_machine("http://localhost:9000/api")
        task.cancel()
        assert len(ticks) >= 5


class TestACandidateConnection:
    @pytest.mark.asyncio
    async def test_a_private_or_plain_address_is_refused_for_a_developer(self, developer):
        for address in ("http://127.0.0.1:9/api", "https://127.0.0.1:9/api", "https://localhost/api"):
            response = await developer.post(
                "/app/data-connectors/api-source-test/request",
                json={
                    "url": address,
                    "endpointHeaders": [{"key": "X-Api-Key", "value": "typed", "location": "headers"}],
                    "request": {"url": f"{address}/widgets.json"},
                },
            )
            assert response.status_code == 403, address
            assert response.headers["x-workspace-proxy-error"] == "1"
            assert "typed" not in response.text

    @pytest.mark.asyncio
    async def test_a_superuser_may_try_a_private_address(self, superuser, data_source):
        base = f"http://127.0.0.1:{data_source.server.port}"
        response = await superuser.post(
            "/app/data-connectors/api-source-test/request",
            json={
                "url": base,
                "endpointHeaders": [{"key": "X-Api-Key", "value": "typed", "location": "headers"}],
                "request": {"url": f"{base}/api/sales"},
            },
        )
        assert response.status_code == 200, response.text
        assert data_source.server.received[-1].headers["x-api-key"] == "typed"

    @pytest.mark.asyncio
    async def test_a_saved_connection_that_is_not_yours_is_not_found(self, superuser):
        response = await superuser.post(
            "/app/data-connectors/api-source-test/request",
            json={"id": str(uuid4()), "url": "https://example.org/api", "request": {"url": "https://example.org/api/x"}},
        )
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_signed_out(self, client):
        response = await client.post(
            "/app/data-connectors/api-source-test/request",
            json={"url": "https://example.org/api", "request": {"url": "https://example.org/api/x"}},
        )
        assert response.status_code in {401, 403}


WIDGETS = {
    "framed": {"name": "Framed", "type": "iframe", "endpoint": "/dash/index.html", "requires_auth": True},
    "plain": {"name": "Plain", "type": "iframe", "endpoint": "/dash/index.html"},
    "not_a_page": {"name": "Rows", "type": "markdown", "endpoint": "/rows", "requires_auth": True},
    "elsewhere": {"name": "Away", "type": "iframe", "endpoint": "https://example.org/x/", "requires_auth": True},
}


def page_server(source):
    def answer(received):
        if received.target.startswith("/api/widgets.json"):
            return Answer(body=json.dumps(WIDGETS).encode())
        return Answer(status=200, content_type="text/html", body=b"<html>page</html>", headers={"Set-Cookie": "a=1"})

    source.server.answer = answer


async def grant_frame(member, source, widget="framed"):
    return await member.post(f"/app/data-connectors/api-source/{source.uuid}/frame", json={"widgetId": widget})


class TestAFramedPage:
    @pytest.mark.asyncio
    async def test_only_an_iframe_widget_that_declares_requires_auth_gets_a_token(self, member, source):
        page_server(source)
        granted = await grant_frame(member, source)
        assert granted.status_code == 200, granted.text
        body = granted.json()
        assert body["token"].startswith("ws_frame_")
        assert body["prefix"] == "/api/dash/"
        assert body["expiresIn"] == 3600
        for widget in ("plain", "not_a_page", "elsewhere", "missing"):
            assert (await grant_frame(member, source, widget)).status_code == 403, widget

    @pytest.mark.asyncio
    async def test_a_connection_the_user_cannot_read_grants_nothing(self, member, data_source, db_session):
        await db_session.execute(
            update(models.ApiSource).where(models.ApiSource.uuid == data_source.uuid).values(entity_uuid=None)
        )
        await db_session.commit()
        page_server(data_source)
        assert (await grant_frame(member, data_source)).status_code == 404

    @pytest.mark.asyncio
    async def test_the_page_opens_with_the_token_alone_and_the_credentials_are_added(self, member, source):
        from httpx import ASGITransport, AsyncClient

        from main import app

        page_server(source)
        token = (await grant_frame(member, source)).json()["token"]
        async with AsyncClient(transport=ASGITransport(app=app), base_url=TEST_BASE_URL) as bare:
            response = await bare.get(f"/app/data-connectors/frame/{token}/api/dash/index.html?x=1")
        assert response.status_code == 200, response.text
        assert response.text == "<html>page</html>"
        upstream = source.server.received[-1]
        assert upstream.headers["x-api-key"] == SOURCE_SECRET
        assert upstream.headers["x-workspace-user"] == MEMBER_EMAIL
        claims = await _verified(upstream.headers["x-workspace-identity"], f"http://127.0.0.1:{source.server.port}")
        assert claims["sub"] == str(MEMBER)
        assert upstream.target.startswith("/api/dash/index.html?token=")
        assert "x=1" in upstream.target
        csp = response.headers["content-security-policy"]
        assert "allow-same-origin" not in csp and csp.startswith("sandbox allow-scripts")
        assert response.headers["referrer-policy"] == "no-referrer"
        assert "set-cookie" not in response.headers

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "path",
        ["/api/other/x", "/api/dash/../secret", "/api/dash/%2e%2e/secret", "/api/dashboard", "/etc"],
    )
    async def test_the_token_opens_nothing_outside_its_widgets_directory(self, member, source, path):
        page_server(source)
        token = (await grant_frame(member, source)).json()["token"]
        before = len(source.server.received)
        response = await member.get(f"/app/data-connectors/frame/{token}{path}")
        assert response.status_code == 403, path
        assert len(source.server.received) == before

    @pytest.mark.asyncio
    async def test_a_forged_or_expired_token_is_refused(self, member, source, monkeypatch):
        from api import frame_proxy

        page_server(source)
        token = (await grant_frame(member, source)).json()["token"]
        assert (await member.get(f"/app/data-connectors/frame/{token}x/api/dash/a")).status_code == 401
        assert (await member.get("/app/data-connectors/frame/ws_frame_nope/api/dash/a")).status_code == 401
        monkeypatch.setattr(frame_proxy, "TTL_SECONDS", -60)
        expired = (await grant_frame(member, source)).json()["token"]
        assert (await member.get(f"/app/data-connectors/frame/{expired}/api/dash/a")).status_code == 401

    @pytest.mark.asyncio
    async def test_a_token_stops_working_when_the_connection_is_no_longer_the_users(
        self, member, data_source, db_session
    ):
        await grant(member, db_session, data_source)
        page_server(data_source)
        token = (await grant_frame(member, data_source)).json()["token"]
        await db_session.execute(delete(models.RoleBackend).where(models.RoleBackend.backend_uuid == data_source.uuid))
        await db_session.execute(
            update(models.ApiSource).where(models.ApiSource.uuid == data_source.uuid).values(entity_uuid=None)
        )
        await db_session.commit()
        assert (await member.get(f"/app/data-connectors/frame/{token}/api/dash/a")).status_code == 404

    @pytest.mark.asyncio
    async def test_a_post_with_a_body_and_its_content_type_reaches_the_connection(self, member, source):
        page_server(source)
        token = (await grant_frame(member, source)).json()["token"]
        response = await member.post(
            f"/app/data-connectors/frame/{token}/api/dash/save",
            content=b"a=1&b=2",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        assert response.status_code == 200
        sent = source.server.received[-1]
        assert (sent.method, sent.body) == ("POST", b"a=1&b=2")
        assert sent.headers["content-type"] == "application/x-www-form-urlencoded"


class TestAFramedPageAsAnOpaqueOrigin:
    @pytest.mark.asyncio
    async def test_a_sandboxed_page_may_call_its_own_paths_with_cors(self, member, source):
        from httpx import ASGITransport, AsyncClient

        from main import app

        page_server(source)
        source.server.answer = lambda r: (
            Answer(body=json.dumps(WIDGETS).encode())
            if r.target.startswith("/api/widgets.json")
            else Answer(
                headers={
                    "Access-Control-Allow-Origin": "https://elsewhere.test",
                    "Access-Control-Allow-Credentials": "true",
                }
            )
        )
        token = (await grant_frame(member, source)).json()["token"]
        base = f"/app/data-connectors/frame/{token}/api/dash/data"
        async with AsyncClient(transport=ASGITransport(app=app), base_url=TEST_BASE_URL) as bare:
            preflight = await bare.options(
                base,
                headers={
                    "Origin": "null",
                    "Access-Control-Request-Method": "POST",
                    "Access-Control-Request-Headers": "content-type,x-custom",
                },
            )
            answer = await bare.get(base, headers={"Origin": "null"})
        assert preflight.status_code == 204
        assert preflight.headers["access-control-allow-origin"] == "*"
        assert preflight.headers["access-control-allow-headers"] == "content-type,x-custom"
        assert "PATCH" in preflight.headers["access-control-allow-methods"]
        assert answer.status_code == 200
        assert answer.headers.get_list("access-control-allow-origin") == ["*"]
        assert not [r for r in source.server.received if r.method == "OPTIONS"]


@pytest.fixture(autouse=True)
def fresh_caches():
    from api import frame_proxy, source_proxy

    for cache in (
        source_proxy._json_cache,
        source_proxy._json_pending,
        source_proxy._decisions,
        source_proxy._breakers,
        source_proxy._awaiting,
        source_proxy._host_machine,
        frame_proxy._access,
    ):
        cache.clear()
    source_proxy._limiter_down_until = 0.0
    yield


@pytest.fixture(autouse=True)
async def fresh_rates():
    from api import auth_helpers

    async with auth_helpers.app_redis() as redis:
        keys = [key async for key in redis.scan_iter(match="*proxy-rate:*")]
        if keys:
            await redis.delete(*keys)
    yield


def checked_out(db_session) -> int:
    return db_session.get_bind().pool.checkedout()


class TestAtScale:
    @pytest.mark.asyncio
    async def test_no_database_connection_is_held_while_the_backend_answers(self, member, source, db_session):
        source.server.answer = lambda _r: Answer(delay=1.0)
        baseline = checked_out(db_session)
        task = asyncio.create_task(call(member, source))
        await asyncio.sleep(0.5)
        assert checked_out(db_session) == baseline
        assert (await task).status_code == 200

    @pytest.mark.asyncio
    async def test_a_hostile_location_header_still_frees_the_slot(self, member, source):
        from api import source_proxy

        source.server.answer = lambda _r: Answer(status=302, headers={"Location": "http://[::1"})
        response = await call(member, source)
        assert response.status_code == 502
        assert source_proxy._open_total == 0
        assert source_proxy._open_streams == {}

    @pytest.mark.asyncio
    async def test_a_backend_that_is_too_slow_gets_a_504_and_frees_the_slot(self, member, source, monkeypatch):
        from api import source_proxy

        monkeypatch.setattr(source_proxy, "HEADERS_SECONDS", 0.3)
        source.server.answer = lambda _r: Answer(delay=1.5)
        response = await call(member, source)
        assert response.status_code == 504
        assert source_proxy._open_total == 0

    @pytest.mark.asyncio
    async def test_a_rate_limiter_that_is_down_does_not_take_the_proxy_with_it(self, member, source, monkeypatch):
        from api import source_proxy

        async def down(*args, **kwargs):
            raise ConnectionError("valkey is down")

        monkeypatch.setattr(source_proxy, "_hit", down)
        assert (await call(member, source)).status_code == 200
        assert source_proxy._limiter_down_until > 0
        assert (await call(member, source)).status_code == 200

    @pytest.mark.asyncio
    async def test_a_request_over_the_rate_limit_is_told_when_to_come_back(self, member, source, monkeypatch):
        from api import source_proxy

        async def over(*args, **kwargs):
            return False

        monkeypatch.setattr(source_proxy, "_hit", over)
        response = await call(member, source)
        assert response.status_code == 429
        assert response.headers["retry-after"] == "5"
        assert source.server.received == []

    @pytest.mark.asyncio
    async def test_a_busy_process_says_so_instead_of_taking_more(self, member, source, monkeypatch):
        from api import source_proxy

        monkeypatch.setattr(source_proxy, "MAX_OPEN_PER_PROCESS", 0)
        response = await call(member, source)
        assert response.status_code == 503
        assert response.headers["retry-after"] == "5"

    @pytest.mark.asyncio
    async def test_a_body_over_the_limit_is_refused_before_it_is_read(self, member, source):
        response = await member.post(
            route(source),
            content=b" " * (2 * 1024 * 1024 + 1),
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code == 413
        assert source.server.received == []

    @pytest.mark.asyncio
    async def test_the_answer_is_the_connections_bytes_and_the_api_does_not_compress_it(self, member, source):
        source.server.answer = lambda _r: Answer(body=b'{"rows": "' + b"a" * 50000 + b'"}')
        response = await member.post(
            route(source),
            json={"url": f"http://127.0.0.1:{source.server.port}/api/big"},
            headers={"Accept-Encoding": "gzip"},
        )
        assert response.status_code == 200
        assert "content-encoding" not in response.headers
        assert len(response.content) == 50012

    @pytest.mark.asyncio
    async def test_a_refusal_by_the_proxy_is_not_written_to_the_database_log(self, member, source, monkeypatch):
        from api import helpers

        written = []
        monkeypatch.setattr(helpers, "add_log", lambda *args, **kwargs: written.append(args))
        response = await member.post(
            f"/app/data-connectors/api-source/{uuid4()}/request", json={"url": "http://127.0.0.1:1/api"}
        )
        assert response.status_code == 404
        assert response.headers["x-workspace-proxy-error"] == "1"
        assert written == []


class TestTheAccessDecision:
    @pytest.mark.asyncio
    async def test_who_may_read_a_connection_is_worked_out_once_for_many_calls(self, member, source, monkeypatch):
        from routers.app import data_connectors

        asked = []
        original = data_connectors.readable_backend

        async def counting(*args, **kwargs):
            asked.append(1)
            return await original(*args, **kwargs)

        monkeypatch.setattr(data_connectors, "readable_backend", counting)
        for _ in range(5):
            assert (await call(member, source)).status_code == 200
        assert len(asked) == 1

    @pytest.mark.asyncio
    async def test_a_changed_credential_applies_to_the_very_next_call(self, member, source, db_session):
        assert (await call(member, source)).status_code == 200
        await db_session.execute(
            update(models.ApiSource)
            .where(models.ApiSource.uuid == source.uuid)
            .values(endpointHeaders=[{"key": "X-Api-Key", "value": "rotated", "location": "headers"}])
        )
        await db_session.commit()
        assert (await call(member, source)).status_code == 200
        assert source.server.received[-1].headers["x-api-key"] == "rotated"

    @pytest.mark.asyncio
    async def test_a_deleted_connection_is_gone_at_once(self, member, source, db_session):
        assert (await call(member, source)).status_code == 200
        await db_session.execute(delete(models.RoleBackend).where(models.RoleBackend.backend_uuid == source.uuid))
        await db_session.execute(delete(models.ApiSource).where(models.ApiSource.uuid == source.uuid))
        await db_session.commit()
        assert (await call(member, source)).status_code == 404

    @pytest.mark.asyncio
    async def test_access_taken_away_is_noticed_when_the_decision_expires(self, member, source, db_session, monkeypatch):
        from api import source_proxy

        monkeypatch.setattr(source_proxy, "DECISION_SECONDS", 0.0)
        assert (await call(member, source)).status_code == 200
        await db_session.execute(
            update(models.ApiSource).where(models.ApiSource.uuid == source.uuid).values(entity_uuid=None)
        )
        await db_session.execute(delete(models.RoleBackend).where(models.RoleBackend.backend_uuid == source.uuid))
        await db_session.commit()
        assert (await call(member, source)).status_code == 404

    def test_a_full_cache_drops_its_oldest_entry_and_keeps_the_rest(self):
        from api import source_proxy

        cache: dict = {}
        for key in "abcd":
            source_proxy.remember(cache, 3, key, key.upper())
        assert cache == {"b": "B", "c": "C", "d": "D"}
        source_proxy.remember(cache, 3, "c", "again")
        assert cache == {"b": "B", "c": "again", "d": "D"}


def direct(server, **kwargs):
    from api import source_proxy

    return source_proxy.send(
        None, "GET", f"http://127.0.0.1:{server.port}/api/x", {}, None, None, uuid4(), trusted=True, **kwargs
    )


class Gone:
    def __init__(self, after: float = 0.1):
        self.after = after

    async def receive(self) -> dict:
        await asyncio.sleep(self.after)
        return {"type": "http.disconnect"}


class TestASlowOrDeadBackend:
    @pytest.mark.asyncio
    async def test_a_backend_that_stops_answering_is_not_asked_again_for_a_while(self, member, source, monkeypatch):
        from api import source_proxy

        monkeypatch.setattr(source_proxy, "HEADERS_SECONDS", 0.2)
        source.server.answer = lambda _r: Answer(delay=1.5)
        for _ in range(source_proxy.BREAKER_FAILURES):
            assert (await call(member, source)).status_code == 504
        started = time.monotonic()
        response = await call(member, source)
        assert response.status_code == 503
        assert response.headers["retry-after"] == "5"
        assert response.headers["x-workspace-proxy-error"] == "1"
        assert time.monotonic() - started < source_proxy.HEADERS_SECONDS
        assert len(source.server.received) == source_proxy.BREAKER_FAILURES
        assert source_proxy._open_total == 0

    @pytest.mark.asyncio
    async def test_an_answer_in_between_starts_the_count_again(self, member, source, monkeypatch):
        from api import source_proxy

        monkeypatch.setattr(source_proxy, "HEADERS_SECONDS", 0.2)
        source.server.answer = lambda r: Answer(delay=1.5) if "/slow" in r.target else Answer()
        for _ in range(source_proxy.BREAKER_FAILURES - 1):
            assert (await call(member, source, "/api/slow")).status_code == 504
        assert (await call(member, source, "/api/fast")).status_code == 200
        for _ in range(source_proxy.BREAKER_FAILURES):
            assert (await call(member, source, "/api/slow")).status_code == 504
        assert len(source.server.received) == 2 * source_proxy.BREAKER_FAILURES

    @pytest.mark.asyncio
    async def test_a_backend_that_answers_with_errors_is_still_asked(self, member, source):
        from api import source_proxy

        source.server.answer = lambda _r: Answer(status=500, body=b"broken")
        for _ in range(source_proxy.BREAKER_FAILURES * 2):
            assert (await call(member, source)).status_code == 500
        assert source_proxy._breakers == {}

    @pytest.mark.asyncio
    async def test_after_the_pause_one_request_tries_again_and_an_answer_reopens_the_backend(
        self, member, source, monkeypatch
    ):
        from api import source_proxy

        monkeypatch.setattr(source_proxy, "HEADERS_SECONDS", 0.2)
        monkeypatch.setattr(source_proxy, "BREAKER_SECONDS", 0.3)
        source.server.answer = lambda _r: Answer(delay=1.5)
        for _ in range(source_proxy.BREAKER_FAILURES):
            await call(member, source)
        assert (await call(member, source)).status_code == 503
        await asyncio.sleep(0.35)
        source.server.answer = lambda _r: Answer()
        assert (await call(member, source)).status_code == 200
        assert source_proxy._breakers == {}
        assert (await call(member, source)).status_code == 200

    @pytest.mark.asyncio
    async def test_a_backend_that_refuses_connections_is_given_up_on_after_a_few_tries(self):
        from api import source_proxy

        for _ in range(source_proxy.BREAKER_FAILURES):
            with pytest.raises(HTTPException) as error:
                await source_proxy.send(None, "GET", "http://127.0.0.1:9/api", {}, None, None, uuid4(), trusted=True)
            assert error.value.status_code == 502
        with pytest.raises(HTTPException) as error:
            await source_proxy.send(None, "GET", "http://127.0.0.1:9/api", {}, None, None, uuid4(), trusted=True)
        assert error.value.status_code == 503
        assert source_proxy._open_total == 0

    @pytest.mark.asyncio
    async def test_requests_waiting_on_one_slow_backend_are_capped(self, data_source, monkeypatch):
        from api import source_proxy

        monkeypatch.setattr(source_proxy, "MAX_AWAITING_PER_ORIGIN", 3)
        data_source.server.answer = lambda _r: Answer(delay=0.6)
        results = await asyncio.gather(*[direct(data_source.server) for _ in range(6)], return_exceptions=True)
        refused = [r for r in results if isinstance(r, HTTPException)]
        served = [r for r in results if not isinstance(r, Exception)]
        assert (len(served), len(refused)) == (3, 3)
        assert {r.status_code for r in refused} == {503}
        assert {r.headers["Retry-After"] for r in refused} == {"5"}
        for relayed in served:
            await relayed.close()
        assert source_proxy._awaiting == {}
        assert source_proxy._open_total == 0

    @pytest.mark.asyncio
    async def test_a_request_that_has_its_headers_no_longer_counts_as_waiting(self, data_source, monkeypatch):
        from api import source_proxy

        monkeypatch.setattr(source_proxy, "MAX_AWAITING_PER_ORIGIN", 1)
        first = await direct(data_source.server)
        second = await direct(data_source.server)
        assert source_proxy._awaiting == {}
        await first.close()
        await second.close()

    def test_one_origins_waiting_requests_do_not_count_against_another(self, monkeypatch):
        from api import source_proxy

        monkeypatch.setattr(source_proxy, "MAX_AWAITING_PER_ORIGIN", 1)
        source_proxy.admit("http://a:1")
        with pytest.raises(HTTPException):
            source_proxy.admit("http://a:1")
        source_proxy.admit("http://b:1")
        source_proxy.left("http://a:1")
        source_proxy.admit("http://a:1")

    @pytest.mark.asyncio
    async def test_a_request_the_browser_gave_up_on_is_cancelled_and_frees_its_place(self, data_source):
        from api import source_proxy

        data_source.server.answer = lambda _r: Answer(delay=5.0)
        started = time.monotonic()
        with pytest.raises(HTTPException) as error:
            await direct(data_source.server, request=Gone())
        assert error.value.status_code == 499
        assert time.monotonic() - started < 2.0
        assert source_proxy._open_total == 0
        assert source_proxy._open_streams == {}
        assert source_proxy._awaiting == {}
        assert source_proxy._breakers == {}

    @pytest.mark.asyncio
    async def test_a_browser_that_closes_its_connection_frees_the_place_through_the_real_server(
        self, member, source
    ):
        import uvicorn

        from api import source_proxy
        from main import app

        source.server.answer = lambda _r: Answer(delay=20.0)
        server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=0, log_level="warning", lifespan="off"))
        serving = asyncio.create_task(server.serve())
        while not server.started:
            await asyncio.sleep(0.02)
        port = server.servers[0].sockets[0].getsockname()[1]
        body = json.dumps({"url": f"http://127.0.0.1:{source.server.port}/api/slow"}).encode()
        headers = {
            **{k: v for k, v in member.headers.items() if k.lower() != "content-length"},
            "Host": f"127.0.0.1:{port}",
            "Content-Type": "application/json",
            "Content-Length": str(len(body)),
            "Cookie": "; ".join(f"{k}={v}" for k, v in member.cookies.items()),
        }
        head = f"POST {route(source)} HTTP/1.1\r\n" + "".join(f"{k}: {v}\r\n" for k, v in headers.items()) + "\r\n"
        _reader, writer = await asyncio.open_connection("127.0.0.1", port)
        try:
            writer.write(head.encode() + body)
            await writer.drain()
            for _ in range(100):
                if source.server.received and source_proxy._open_total == 1:
                    break
                await asyncio.sleep(0.05)
            assert source_proxy._open_total == 1
            writer.close()
            for _ in range(80):
                if source_proxy._open_total == 0:
                    break
                await asyncio.sleep(0.05)
            assert source_proxy._open_total == 0
            assert source_proxy._awaiting == {}
        finally:
            server.should_exit = True
            await serving


class TestTheRateLimitIsAsync:
    @pytest.mark.asyncio
    async def test_the_count_lives_in_valkey_so_every_replica_shares_it(self):
        from limits import parse

        from api import auth_helpers, source_proxy

        user = uuid4()
        limit = parse("3/minute")
        for _ in range(3):
            await source_proxy.count(user, "probe", limit)
        with pytest.raises(HTTPException) as error:
            await source_proxy.count(user, "probe", limit)
        assert error.value.status_code == 429
        async with auth_helpers.app_redis() as redis:
            ttl = await redis.ttl(auth_helpers.app_redis_key(f"proxy-rate:probe:{user}"))
        assert 0 < ttl <= 60

    @pytest.mark.asyncio
    async def test_a_user_is_counted_apart_from_another(self):
        from limits import parse

        from api import source_proxy

        limit = parse("1/minute")
        await source_proxy.count(uuid4(), "probe", limit)
        await source_proxy.count(uuid4(), "probe", limit)


class TestAFramedPageAtScale:
    @pytest.mark.asyncio
    async def test_the_assets_of_a_page_do_not_ask_the_database_each_time(self, member, source, monkeypatch):
        from routers.app import data_connectors

        page_server(source)
        token = (await grant_frame(member, source)).json()["token"]
        looked_up = []
        original = data_connectors.readable_backend

        async def counting(*args, **kwargs):
            looked_up.append(1)
            return await original(*args, **kwargs)

        monkeypatch.setattr(data_connectors, "readable_backend", counting)
        for name in ("a.js", "b.css", "c.png", "d.json"):
            assert (await member.get(f"/app/data-connectors/frame/{token}/api/dash/{name}")).status_code == 200
        assert len(looked_up) == 1

    @pytest.mark.asyncio
    async def test_the_connections_widgets_are_read_once_for_many_grants(self, member, source):
        page_server(source)
        for _ in range(4):
            assert (await grant_frame(member, source)).status_code == 200
        assert len([r for r in source.server.received if r.target.startswith("/api/widgets.json")]) == 1

    @pytest.mark.asyncio
    async def test_grants_asked_for_at_the_same_moment_share_one_read(self, source):
        from types import SimpleNamespace

        from api import source_proxy

        page_server(source)
        stub = SimpleNamespace(
            uuid=uuid4(),
            url=f"http://127.0.0.1:{source.server.port}/api",
            endpointHeaders=[],
            entity_uuid=uuid4(),
            user_uuid=None,
        )
        results = await asyncio.gather(*[source_proxy.fetch_json(stub, "a@b.c", True, {}) for _ in range(8)])
        assert all(result == WIDGETS for result in results)
        assert len([r for r in source.server.received if r.target.startswith("/api/widgets.json")]) == 1

    @pytest.mark.asyncio
    async def test_a_frame_request_over_the_limit_is_refused_before_it_is_read(self, member, source):
        from api import frame_proxy

        page_server(source)
        token = (await grant_frame(member, source)).json()["token"]
        response = await member.post(
            f"/app/data-connectors/frame/{token}/api/dash/save",
            content=b"x" * (frame_proxy.MAX_BODY_BYTES + 1),
            headers={"Content-Type": "application/octet-stream"},
        )
        assert response.status_code == 413
        assert not [r for r in source.server.received if r.method == "POST"]

    @pytest.mark.asyncio
    async def test_a_page_load_is_not_limited_by_the_data_calls_budget(self, member, source, monkeypatch):
        from api import source_proxy

        seen = []

        async def hit(limit, bucket, key):
            seen.append(bucket)
            return True

        monkeypatch.setattr(source_proxy, "_hit", hit)
        page_server(source)
        token = (await grant_frame(member, source)).json()["token"]
        await member.get(f"/app/data-connectors/frame/{token}/api/dash/a.js")
        assert seen == ["frame-grant", "frame-request"]


class TestAFramedPageAndTheSession:
    @pytest.mark.asyncio
    async def test_a_framed_page_ends_with_the_session_that_opened_it(self, member, source, db_session):
        from api import frame_proxy

        page_server(source)
        token = (await grant_frame(member, source)).json()["token"]
        assert frame_proxy.read(token)["sid"]
        url = f"/app/data-connectors/frame/{token}/api/dash/a.js"
        assert (await member.get(url)).status_code == 200

        await db_session.execute(delete(models.Session).where(models.Session.user_uuid == MEMBER))
        await db_session.commit()
        frame_proxy._access.clear()
        assert (await member.get(url)).status_code == 401
