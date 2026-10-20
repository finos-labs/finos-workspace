"""Sessions: hashed tokens, cookies, the client header, CSRF and CORS.

A session is a random token that only its client holds; the session table stores its
SHA-256 hash, and a session ends when its time is up. The web app rides an HttpOnly
cookie with its X-Workspace-Client header, and changes nothing from an origin outside
BACKEND_CORS_ORIGINS. No session is a bearer token. A pending two-factor
enrollment is a cookie of its own that only POST /totp and POST /totp/activate accept.
"""

import hashlib
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta

import pyotp
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, update
from starlette.requests import Request

from api import auth_helpers, models, sign_in_providers
from api.context import session_uuid_ctx
from api.sign_in_providers import SignInIdentity
from tests.fixtures.base import (
    _AUTH_USER,
    TEST_BASE_URL,
    TEST_ORIGIN,
    WEB_HEADERS,
    app,
    bearer_client,
    web_session_headers,
)
from tests.fixtures.organization import ADMIN_ENTITY
from utilities.config import GeneralSettings

PASSWORD = "TestPassword123!"  # noqa: S105
# A local origin that is not one of BACKEND_CORS_ORIGINS
OTHER_ORIGIN = "http://localhost:9999"
WEEK = 7 * 24 * 3600


def _login(email: str, source: str = "app", remember: bool = False, code=None) -> dict:
    return {
        "email": email,
        "password": PASSWORD,
        "remember": remember,
        "source": source,
        "totp_token": code,
        "version": "v1.0.0",
    }


def _set_cookies(response) -> dict[str, str]:
    """The response's Set-Cookie headers by cookie name, lower-cased."""
    return {
        header.split("=", 1)[0]: header.lower()
        for header in response.headers.get_list("set-cookie")
    }


def _token_of(web_client) -> str:
    return web_client.headers["Cookie"].split("=", 1)[1]


@asynccontextmanager
async def _browser(headers: dict[str, str] | None = None):
    """A client of its own, with exactly these headers and an empty cookie jar."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url=TEST_BASE_URL, headers=headers or {}
    ) as browser:
        yield browser


async def _sessions(db_session, user_uuid) -> list:
    """The user's session rows, every column."""
    return list(
        await db_session.execute(
            select(*models.Session.__table__.columns).where(
                models.Session.user_uuid == user_uuid
            )
        )
    )


class TestHashedSessions:
    @pytest.mark.asyncio
    async def test_the_session_table_holds_the_hash_and_never_the_token(
        self, organization, app_client, db_session
    ):
        user = await organization.add_user(password=PASSWORD)
        response = await app_client.post("/app/login", json=_login(user.email))
        assert response.status_code == 200, response.text
        token = app_client.cookies[auth_helpers.SESSION_COOKIE]
        # 256 random bits
        assert len(token) >= 43

        (session,) = await _sessions(db_session, user.uuid)
        assert session.token_hash == hashlib.sha256(token.encode()).hexdigest()
        for value in session:
            assert token not in str(value)

    @pytest.mark.asyncio
    async def test_an_expired_session_is_refused_and_deleted_without_grace(
        self, auth_client, db_session
    ):
        # Within the five minutes the old grace period extended
        await db_session.execute(
            update(models.Session)
            .where(models.Session.uuid == _AUTH_USER["session_uuid"])
            .values(expiration_date=datetime.now(UTC) - timedelta(seconds=5))
        )
        await db_session.commit()

        response = await auth_client.get("/app/user")
        assert response.status_code == 401
        assert await _sessions(db_session, _AUTH_USER["user_uuid"]) == []
        assert (await auth_client.get("/app/validate")).json() == {"success": False}

    @pytest.mark.asyncio
    async def test_validating_changes_nothing(self, auth_client, db_session):
        (before,) = await _sessions(db_session, _AUTH_USER["user_uuid"])

        response = await auth_client.get("/app/validate")
        assert response.json() == {"success": True}
        assert "set-cookie" not in response.headers

        (after,) = await _sessions(db_session, _AUTH_USER["user_uuid"])
        assert after.expiration_date == before.expiration_date

    @pytest.mark.asyncio
    async def test_the_audit_knows_the_session_behind_a_request(
        self, auth_client, db_session
    ):
        request = Request(
            {
                "type": "http",
                "method": "GET",
                "path": "/app/user",
                "query_string": b"",
                "headers": [
                    (name.lower().encode(), value.encode())
                    for name, value in web_session_headers(_token_of(auth_client)).items()
                ],
            }
        )
        await auth_helpers.GetCurrentUser(["uuid"], app_session=True)(request)
        assert str(session_uuid_ctx.get()) == _AUTH_USER["session_uuid"]


class TestTheWebAppsCookie:
    @pytest.mark.asyncio
    @pytest.mark.parametrize(("remember", "max_age"), [(False, WEEK), (True, 30 * 24 * 3600)])
    async def test_sign_in_sets_a_host_only_http_only_secure_strict_cookie(
        self, organization, app_client, remember, max_age
    ):
        user = await organization.add_user(password=PASSWORD)
        response = await app_client.post(
            "/app/login", json=_login(user.email, remember=remember)
        )
        assert response.status_code == 200, response.text
        assert "access_token" not in response.json()

        cookie = _set_cookies(response)[auth_helpers.SESSION_COOKIE]
        for attribute in ("httponly", "secure", "samesite=strict", "path=/"):
            assert attribute in cookie
        assert f"max-age={max_age}" in cookie
        assert "domain=" not in cookie

    @pytest.mark.asyncio
    async def test_the_web_sign_in_needs_the_client_header_and_an_allowed_origin(
        self, organization, client
    ):
        user = await organization.add_user(password=PASSWORD)
        for headers, status in (
            ({"Origin": TEST_ORIGIN}, 400),
            ({auth_helpers.CLIENT_HEADER: "web"}, 403),
            ({auth_helpers.CLIENT_HEADER: "web", "Origin": OTHER_ORIGIN}, 403),
        ):
            async with _browser(headers) as browser:
                response = await browser.post("/app/login", json=_login(user.email))
                assert response.status_code == status, (headers, response.text)
                assert auth_helpers.SESSION_COOKIE not in browser.cookies

    @pytest.mark.asyncio
    async def test_a_cookie_without_the_client_header_is_no_credential(
        self, auth_client
    ):
        cookie = {"Cookie": f"{auth_helpers.SESSION_COOKIE}={_token_of(auth_client)}"}
        for headers in (cookie, {**cookie, auth_helpers.CLIENT_HEADER: "other"}):
            async with _browser({**headers, "Origin": TEST_ORIGIN}) as browser:
                assert (await browser.get("/app/user")).status_code == 401

    @pytest.mark.asyncio
    async def test_every_request_needs_an_allowed_origin(self, auth_client):
        headers = web_session_headers(_token_of(auth_client))
        del headers["Origin"]
        # A change or a read, under /app or elsewhere: another origin, or none, is refused
        for method, path in (("put", "/app/copilot-keys"), ("put", "/user"), ("get", "/app/user")):
            for origin, status in ((None, 403), (OTHER_ORIGIN, 403), (TEST_ORIGIN, 200)):
                sent = headers if origin is None else {**headers, "Origin": origin}
                async with _browser(sent) as browser:
                    kwargs = {"json": {}} if method == "put" else {}
                    response = await getattr(browser, method)(path, **kwargs)
                    assert response.status_code == status, (path, origin, response.text)

    @pytest.mark.asyncio
    async def test_a_web_session_is_never_accepted_as_a_bearer(self, auth_client):
        async with bearer_client(_token_of(auth_client)) as bearer:
            assert (await bearer.get("/app/user")).status_code == 401
            assert (await bearer.get("/admin/role")).status_code == 401
            assert (await bearer.post("/app/logout")).status_code == 401
        # And it still works as the cookie it is
        assert (await auth_client.get("/app/user")).status_code == 200

    @pytest.mark.asyncio
    async def test_the_session_bootstrap_after_a_reload(self, auth_client, client):
        response = await auth_client.get("/app/session")
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["uuid"] == _AUTH_USER["user_uuid"]
        assert data["email"] == _AUTH_USER["email"]
        assert set(data["user"]) == {"first_name", "last_name", "display_settings"}
        assert {"access", "copilot_keys", "entity_name", "role"} <= data.keys()
        assert "access_token" not in data

        async with _browser(WEB_HEADERS) as nobody:
            assert (await nobody.get("/app/session")).status_code == 401

    @pytest.mark.asyncio
    async def test_signing_out_ends_the_session_and_clears_the_cookie(
        self, organization, app_client, db_session
    ):
        user = await organization.add_user(password=PASSWORD)
        await app_client.post("/app/login", json=_login(user.email))
        token = app_client.cookies[auth_helpers.SESSION_COOKIE]

        response = await app_client.post("/app/logout")
        assert response.status_code == 200
        assert "max-age=0" in _set_cookies(response)[auth_helpers.SESSION_COOKIE]
        assert await _sessions(db_session, user.uuid) == []

        async with _browser(web_session_headers(token)) as stale:
            assert (await stale.get("/app/user")).status_code == 401
            # Signing out again only clears the cookie
            response = await stale.post("/app/logout")
            assert response.status_code == 200
            assert auth_helpers.SESSION_COOKIE in _set_cookies(response)


class TestClientsThatAreNotBrowsers:
    @pytest.mark.asyncio
    async def test_the_admin_cli_does_not_sign_in(self, organization, db_session):
        # It runs inside the API container and works on the database (scripts.workspace_admin)
        user = await organization.add_user(password=PASSWORD)
        async with _browser({"Origin": TEST_ORIGIN}) as cli:
            response = await cli.post("/app/login", json=_login(user.email, source="cli"))

        assert response.status_code == 422
        assert await _sessions(db_session, user.uuid) == []


class TestCORS:
    @pytest.mark.asyncio
    async def test_an_allowed_origin_passes_the_preflight_with_credentials(self, client):
        response = await client.options(
            "/app/user",
            headers={
                "Origin": TEST_ORIGIN,
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "x-workspace-client",
            },
        )
        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == TEST_ORIGIN
        assert response.headers["access-control-allow-credentials"] == "true"
        assert "x-workspace-client" in response.headers["access-control-allow-headers"].lower()

    @pytest.mark.asyncio
    async def test_any_other_origin_fails_the_preflight(self, client):
        response = await client.options(
            "/app/user",
            headers={
                "Origin": OTHER_ORIGIN,
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "x-workspace-client",
            },
        )
        assert response.status_code == 403
        assert "access-control-allow-origin" not in response.headers

    def test_the_origins_are_explicit(self):
        for origins in ([], ["*"], ["http://localhost:3000/"], ["localhost:3000"]):
            with pytest.raises(ValueError):
                GeneralSettings.check_cors_origins(origins)
        assert GeneralSettings.check_cors_origins(["https://[::1]:8443"])


@pytest.fixture
async def authenticator_required(organization, db_session):
    """The admin's organization requires an authenticator."""
    await db_session.execute(
        update(models.Entity)
        .where(models.Entity.uuid == ADMIN_ENTITY)
        .values(require_authenticator=True)
    )
    await db_session.commit()
    yield
    await db_session.execute(
        update(models.Entity)
        .where(models.Entity.uuid == ADMIN_ENTITY)
        .values(require_authenticator=False)
    )
    await db_session.commit()


class TestTwoFactorEnrollment:
    @pytest.mark.asyncio
    async def test_enrollment_rides_a_cookie_of_its_own(
        self, organization, authenticator_required, app_client, db_session
    ):
        user = await organization.add_user(password=PASSWORD)

        response = await app_client.post("/app/login", json=_login(user.email))
        assert response.status_code == 202, response.text
        assert response.json() == {
            "two_factor_required": True,
            "message": "Two-factor authentication is required",
        }
        cookies = _set_cookies(response)
        assert auth_helpers.SESSION_COOKIE not in cookies
        assert "max-age=300" in cookies[auth_helpers.TOTP_COOKIE]
        assert "httponly" in cookies[auth_helpers.TOTP_COOKIE]
        (pending,) = await _sessions(db_session, user.uuid)
        assert (pending.source, pending.app_session) == ("totp-enroll", False)

        # Accepted by the two enrollment routes only
        enrollment = app_client.cookies[auth_helpers.TOTP_COOKIE]
        assert (await app_client.get("/app/user")).status_code == 401
        assert (await app_client.get("/app/session")).status_code == 401
        assert (await app_client.post("/app/copilot/token")).status_code == 401
        async with _browser(web_session_headers(enrollment)) as smuggled:
            assert (await smuggled.get("/app/user")).status_code == 401
        async with bearer_client(enrollment) as bearer:
            assert (await bearer.post("/totp")).status_code == 401

        response = await app_client.post("/totp")
        assert response.status_code == 200, response.text
        totp = pyotp.TOTP(response.json()["secret"])
        response = await app_client.post(
            "/totp/activate",
            json={"totp_token": int(totp.now()), "remember": True, "version": "v1.0.0"},
        )
        # Activating the authenticator finishes the sign-in as POST /app/login does: the
        # web app does not send the code again
        assert response.status_code == 200, response.text
        assert response.json()["uuid"] == str(user.uuid)
        assert response.json()["force_2fa"] is False
        assert "access_token" not in response.json()
        cookies = _set_cookies(response)
        assert "max-age=0" in cookies[auth_helpers.TOTP_COOKIE]
        assert f"max-age={30 * 24 * 3600}" in cookies[auth_helpers.SESSION_COOKIE]
        (session,) = await _sessions(db_session, user.uuid)
        assert (session.source, session.app_session) == ("app", True)
        assert (await app_client.get("/app/session")).status_code == 200
        async with _browser(
            {**WEB_HEADERS, "Cookie": f"{auth_helpers.TOTP_COOKIE}={enrollment}"}
        ) as stale:
            assert (await stale.post("/totp")).status_code == 401

        # The next sign-in takes the authenticator's code; a code counts once
        code = int(totp.at(datetime.now(UTC) + timedelta(seconds=30)))
        response = await app_client.post("/app/login", json=_login(user.email, code=code))
        assert response.status_code == 200, response.text
        assert auth_helpers.SESSION_COOKIE in _set_cookies(response)
        response = await app_client.post("/app/login", json=_login(user.email, code=code))
        assert response.status_code == 202
        assert response.json() == {"message": "Invalid TOTP token"}

    @pytest.mark.asyncio
    async def test_activating_the_authenticator_finishes_a_provider_sign_in(
        self, organization, authenticator_required, app_client, db_session, monkeypatch
    ):
        user = await organization.add_user()
        await db_session.execute(
            update(models.User)
            .where(models.User.uuid == user.uuid)
            .values(temporary_password=True)
        )
        await db_session.commit()

        async def identity(token):
            return SignInIdentity(email=user.email, email_verified=True)

        monkeypatch.setattr(sign_in_providers, "google_identity", identity)
        response = await app_client.post("/app/google-auth", json={"token": "t"})
        assert response.status_code == 202, response.text
        (pending,) = await _sessions(db_session, user.uuid)
        assert pending.source == "totp-enroll-oauth"

        secret = (await app_client.post("/totp")).json()["secret"]
        response = await app_client.post(
            "/totp/activate", json={"totp_token": int(pyotp.TOTP(secret).now())}
        )
        assert response.status_code == 200, response.text
        assert response.json()["uuid"] == str(user.uuid)
        # The session is a provider's: there is no password to change
        assert response.json()["temporary_password"] is False
        (session,) = await _sessions(db_session, user.uuid)
        assert session.source == "oauth-app"
        assert (await app_client.get("/app/session")).status_code == 200
