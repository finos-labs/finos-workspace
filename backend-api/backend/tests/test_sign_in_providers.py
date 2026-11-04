import asyncio
import base64
import hashlib
import json
import time
from contextlib import asynccontextmanager
from datetime import timedelta
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import httpx
import jwt
import pyotp
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from jwt.algorithms import RSAAlgorithm
from sqlalchemy import delete, select, text, update

from api import auth_helpers, crypto, database, identity, models, provider_tokens, sign_in_providers
from api.sign_in_providers import SignInIdentity
from tests.fixtures.base import TEST_BASE_URL, TEST_ORIGIN, WEB_HEADERS, app, settings
from tests.fixtures.widget_plugins import ADMIN_ENTITY


TENANT = str(uuid4())
AZURE_CLIENT = str(uuid4())
MICROSOFT_ISSUER = f"https://login.microsoftonline.com/{TENANT}/v2.0"
MICROSOFT_TEMPLATE = "https://login.microsoftonline.com/{tenantid}/v2.0"
OKTA_ISSUER = "https://okta.test"
OKTA_CLIENT = "okta-client-under-test"
GOOGLE_CLIENT = "google-client-under-test.apps.googleusercontent.com"
NONCE = "nonce-the-api-issued"
NONCE_HASH = hashlib.sha256(NONCE.encode()).hexdigest()
PASSWORD = "TestPassword123!"  # noqa: S105


def _key_pair(kid: str):
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    jwk = json.loads(RSAAlgorithm.to_jwk(private.public_key()))
    return private, {**jwk, "kid": kid, "use": "sig", "alg": "RS256"}


SIGNING_KEY, SIGNING_JWK = _key_pair("signing-key")
OTHER_KEY, _ = _key_pair("signing-key")


def _serve_issuer(served: dict, authority: str, issuer: str, *, revocable: bool = False) -> None:
    served[f"{authority}/.well-known/openid-configuration"] = {
        "issuer": issuer,
        "jwks_uri": f"{authority}/keys",
        "authorization_endpoint": f"{authority}/authorize",
        "token_endpoint": f"{authority}/token",
        **({"revocation_endpoint": f"{authority}/revoke"} if revocable else {}),
    }
    served[f"{authority}/keys"] = {"keys": [SIGNING_JWK]}


@pytest.fixture
def providers(monkeypatch):
    for name, value in (
        ("AZURE_CLIENT_ID", AZURE_CLIENT),
        ("AZURE_TENANT_ID", TENANT),
        ("OKTA_CLIENT_ID", OKTA_CLIENT),
        ("OKTA_DOMAIN", OKTA_ISSUER),
        ("GOOGLE_OAUTH_CLIENT_ID", GOOGLE_CLIENT),
    ):
        monkeypatch.setattr(settings, name, value)

    served: dict[str, object] = {}
    _serve_issuer(served, MICROSOFT_ISSUER, MICROSOFT_ISSUER)
    _serve_issuer(served, OKTA_ISSUER, OKTA_ISSUER, revocable=True)

    async def fetch_json(url, *, form=None, headers=None):
        document = served.get(url)
        return document(form, headers) if callable(document) else document

    monkeypatch.setattr(sign_in_providers, "_fetch_json", fetch_json)
    monkeypatch.setattr(sign_in_providers, "_documents", {})
    return served


def _id_token(issuer: str, audience: str, key=SIGNING_KEY, kid="signing-key", **claims):
    now = int(time.time())
    payload = {
        "iss": issuer,
        "aud": audience,
        "sub": "subject-1",
        "iat": now,
        "exp": now + 600,
        "nonce": NONCE,
        **claims,
    }
    return jwt.encode(
        {name: value for name, value in payload.items() if value is not None},
        key,
        algorithm="RS256",
        headers={"kid": kid},
    )


def _microsoft(tenant: str = TENANT, **claims) -> str:
    return _id_token(
        f"https://login.microsoftonline.com/{tenant}/v2.0",
        AZURE_CLIENT,
        **{
            "tid": tenant,
            "oid": "object-id-1",
            "preferred_username": "person@tenant.test",
            "name": "Ada Lovelace",
            **claims,
        },
    )


def _okta(**claims) -> str:
    return _id_token(
        OKTA_ISSUER,
        OKTA_CLIENT,
        **{"email": "person@okta.test", "email_verified": True, **claims},
    )


async def _refused(coroutine) -> HTTPException:
    with pytest.raises(HTTPException) as refused:
        await coroutine
    assert refused.value.status_code == 400
    return refused.value


class TestMicrosoft:
    @pytest.mark.asyncio
    async def test_an_id_token_issued_to_our_client(self, providers):
        expires = int(time.time()) + 900
        identity = await sign_in_providers.microsoft_identity(_microsoft(exp=expires), NONCE_HASH)
        assert identity == SignInIdentity(
            email="person@tenant.test",
            email_verified=False,
            given_name="Ada",
            family_name="Lovelace",
            microsoft_id="object-id-1",
            expires_at=expires,
        )

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "token",
        [
            lambda: _id_token(MICROSOFT_ISSUER, str(uuid4()), tid=TENANT, oid="o"),
            lambda: _microsoft(tenant=str(uuid4())),
            lambda: _microsoft(tid=str(uuid4())),
            lambda: _microsoft(exp=int(time.time()) - 3600, iat=int(time.time()) - 7200),
            lambda: _id_token(MICROSOFT_ISSUER, AZURE_CLIENT, key=OTHER_KEY, tid=TENANT, oid="o"),
            lambda: _microsoft(kid="unknown-key"),
            lambda: jwt.encode(
                {"iss": MICROSOFT_ISSUER, "aud": AZURE_CLIENT, "tid": TENANT, "oid": "o"},
                AZURE_CLIENT * 2,
                algorithm="HS256",
            ),
            lambda: _microsoft(nonce="the-nonce-of-another-sign-in"),
            lambda: _microsoft(nonce=None),
            lambda: "not-a-token",
            lambda: None,
        ],
    )
    async def test_anything_else_is_refused(self, providers, token):
        await _refused(sign_in_providers.microsoft_identity(token(), NONCE_HASH))

    @pytest.mark.asyncio
    async def test_without_the_browsers_nonce_nothing_signs_in(self, providers):
        refused = await _refused(sign_in_providers.microsoft_identity(_microsoft(), None))
        assert refused.detail == "The sign-in has expired; please sign in again"

    @pytest.mark.asyncio
    async def test_not_configured_refuses(self, providers, monkeypatch):
        monkeypatch.setattr(settings, "AZURE_TENANT_ID", None)
        refused = await _refused(
            sign_in_providers.microsoft_identity(_microsoft(), NONCE_HASH)
        )
        assert refused.detail == "Microsoft sign-in is not configured"

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("claims", "verified"),
        [
            ({"email": "person@tenant.test", "xms_edov": True}, True),
            ({"email": "person@tenant.test"}, False),
            ({"email": "person@tenant.test", "xms_edov": False}, False),
            ({"xms_edov": True}, False),
        ],
    )
    async def test_the_email_is_verified_only_with_xms_edov(
        self, providers, claims, verified
    ):
        identity = await sign_in_providers.microsoft_identity(
            _microsoft(**claims), NONCE_HASH
        )
        assert identity.email == "person@tenant.test"
        assert identity.email_verified is verified

    @pytest.mark.asyncio
    @pytest.mark.parametrize("authority", ["organizations", "common"])
    async def test_a_multi_tenant_authority_takes_the_tokens_own_tenant(
        self, providers, monkeypatch, authority
    ):
        monkeypatch.setattr(settings, "AZURE_TENANT_ID", authority)
        _serve_issuer(
            providers, f"https://login.microsoftonline.com/{authority}/v2.0", MICROSOFT_TEMPLATE
        )
        tenant = str(uuid4())
        identity = await sign_in_providers.microsoft_identity(
            _microsoft(tenant=tenant), NONCE_HASH
        )
        assert identity.microsoft_id == "object-id-1"
        await _refused(
            sign_in_providers.microsoft_identity(
                _microsoft(tenant=tenant, tid=str(uuid4())), NONCE_HASH
            )
        )

    @pytest.mark.asyncio
    async def test_organizations_admits_no_personal_account(self, providers, monkeypatch):
        monkeypatch.setattr(settings, "AZURE_TENANT_ID", "organizations")
        _serve_issuer(
            providers, "https://login.microsoftonline.com/organizations/v2.0", MICROSOFT_TEMPLATE
        )
        personal = _microsoft(tenant=sign_in_providers.MICROSOFT_CONSUMER_TENANT)
        await _refused(sign_in_providers.microsoft_identity(personal, NONCE_HASH))

    @pytest.mark.asyncio
    async def test_a_tenant_named_by_its_domain(self, providers, monkeypatch):
        monkeypatch.setattr(settings, "AZURE_TENANT_ID", "Contoso.onmicrosoft.com")
        _serve_issuer(
            providers, "https://login.microsoftonline.com/contoso.onmicrosoft.com/v2.0",
            MICROSOFT_ISSUER,
        )
        assert await sign_in_providers.microsoft_identity(_microsoft(), NONCE_HASH)
        await _refused(
            sign_in_providers.microsoft_identity(_microsoft(tenant=str(uuid4())), NONCE_HASH)
        )


class TestOkta:
    @pytest.mark.asyncio
    async def test_an_id_token_issued_to_our_client(self, providers):
        expires = int(time.time()) + 900
        identity = await sign_in_providers.okta_identity(
            _okta(name="Grace Hopper", exp=expires), NONCE_HASH
        )
        assert identity == SignInIdentity(
            email="person@okta.test",
            email_verified=True,
            given_name="Grace",
            family_name="Hopper",
            expires_at=expires,
        )

    @pytest.mark.asyncio
    async def test_another_audience_nonce_or_an_unverified_email_is_refused(
        self, providers
    ):
        await _refused(
            sign_in_providers.okta_identity(
                _id_token(OKTA_ISSUER, "other-client"), NONCE_HASH
            )
        )
        await _refused(
            sign_in_providers.okta_identity(_okta(email_verified=False), NONCE_HASH)
        )
        await _refused(
            sign_in_providers.okta_identity(_okta(nonce="another-nonce"), NONCE_HASH)
        )
        await _refused(sign_in_providers.okta_identity(_okta(), None))

    @pytest.mark.asyncio
    async def test_not_configured_refuses(self, providers, monkeypatch):
        monkeypatch.setattr(settings, "OKTA_CLIENT_ID", "")
        await _refused(sign_in_providers.okta_identity(_okta(), NONCE_HASH))


class TestGoogle:
    def _serve(self, providers, *, tokeninfo, userinfo=None):
        providers[sign_in_providers.GOOGLE_TOKENINFO_URL] = tokeninfo
        providers[sign_in_providers.GOOGLE_USERINFO_URL] = userinfo or {
            "sub": "google-subject",
            "given_name": "Katherine",
            "family_name": "Johnson",
        }

    @pytest.mark.asyncio
    @pytest.mark.parametrize("party", ["aud", "azp"])
    async def test_a_token_issued_to_our_client(self, providers, party):
        self._serve(
            providers,
            tokeninfo={
                party: GOOGLE_CLIENT,
                "sub": "google-subject",
                "email": "person@gmail.test",
                "email_verified": "true",
            },
        )
        identity = await sign_in_providers.google_identity("google-access-token")
        assert identity == SignInIdentity(
            email="person@gmail.test",
            email_verified=True,
            given_name="Katherine",
            family_name="Johnson",
        )

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("tokeninfo", "userinfo"),
        [
            ({"aud": "other", "azp": "other", "sub": "google-subject",
              "email": "person@gmail.test", "email_verified": "true"}, None),
            ({"aud": GOOGLE_CLIENT, "sub": "google-subject", "email": "person@gmail.test",
              "email_verified": "false"}, None),
            ({"aud": GOOGLE_CLIENT, "sub": "google-subject", "email": "person@gmail.test",
              "email_verified": "true"}, {"sub": "another-subject"}),
            (None, None),
        ],
    )
    async def test_anything_else_is_refused(self, providers, tokeninfo, userinfo):
        self._serve(providers, tokeninfo=tokeninfo, userinfo=userinfo)
        await _refused(sign_in_providers.google_identity("google-access-token"))

    @pytest.mark.asyncio
    async def test_the_access_token_is_never_part_of_a_url(self, monkeypatch):
        monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_ID", GOOGLE_CLIENT)
        sent: list[httpx.Request] = []

        def google(request: httpx.Request) -> httpx.Response:
            sent.append(request)
            if request.url.path == "/tokeninfo":
                return httpx.Response(200, json={"aud": GOOGLE_CLIENT, "sub": "s",
                                                 "email": "p@gmail.test", "email_verified": "true"})
            return httpx.Response(200, json={"sub": "s"})

        monkeypatch.setattr(
            sign_in_providers, "_client", httpx.AsyncClient(transport=httpx.MockTransport(google))
        )
        await sign_in_providers.google_identity("the-access-token")

        assert [r.method for r in sent] == ["POST", "GET"]
        assert all("the-access-token" not in str(r.url) for r in sent)
        assert sent[0].content == b"access_token=the-access-token"

    @pytest.mark.asyncio
    async def test_not_configured_refuses(self, providers, monkeypatch):
        monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_ID", None)
        refused = await _refused(sign_in_providers.google_identity("google-access-token"))
        assert refused.detail == "Google sign-in is not configured"


def _set_cookies(response) -> dict[str, str]:
    return {
        header.split("=", 1)[0]: header.lower()
        for header in response.headers.get_list("set-cookie")
    }


CALLBACK = "/app/sign-in/{provider}/callback"
SIGNED_OUT = "The sign-in has expired; please sign in again"


class TokenEndpoint:
    def __init__(self):
        self.calls: list[tuple[str, dict[str, str]]] = []
        self.answers: list[tuple[int, dict]] = []
        self.delay = 0.0

    async def __call__(self, url, form):
        self.calls.append((url, dict(form)))
        await asyncio.sleep(self.delay)
        return self.answers.pop(0) if self.answers else (400, {"error": "invalid_grant"})


@pytest.fixture(autouse=True)
async def no_provider_sessions_left(client, db_session):
    await db_session.execute(delete(models.ProviderSession))
    await db_session.commit()
    yield
    await db_session.rollback()
    await db_session.execute(delete(models.ProviderSession))
    await db_session.commit()


@pytest.fixture
def token_endpoint(providers, monkeypatch):
    endpoint = TokenEndpoint()
    monkeypatch.setattr(sign_in_providers, "_token_request", endpoint)
    return endpoint


@pytest.fixture
async def authenticator_required(organization, db_session):
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


@asynccontextmanager
async def _browser(headers: dict[str, str] | None = None, cookies=None):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url=TEST_BASE_URL,
        headers=headers or {},
        cookies=cookies,
    ) as browser:
        yield browser


def _exchange(id_token: str, refresh: str | None = "refresh-1") -> tuple[int, dict]:
    answer = {"id_token": id_token, "access_token": "not-used"}
    if refresh is not None:
        answer["refresh_token"] = refresh
    return 200, answer


async def _start(app_client, provider: str = "microsoft", **body):
    response = await app_client.post(
        f"/app/sign-in/{provider}/start", json={"version": "v1", **body}
    )
    assert response.status_code == 200, response.text
    url = urlsplit(response.json()["authorization_url"])
    query = {name: values[0] for name, values in parse_qs(url.query).items()}
    return url, query, response


async def _come_back(app_client, query, provider: str = "microsoft", **params):
    async with _browser(cookies=app_client.cookies) as browser:
        return await browser.get(
            CALLBACK.format(provider=provider),
            params={"code": "the-code", "state": query["state"], **params},
        )


def _error(response) -> str:
    assert response.status_code == 303, response.text
    location = urlsplit(response.headers["location"])
    assert f"{location.scheme}://{location.netloc}" == settings.APPURL.rstrip("/")
    assert location.path == "/login"
    assert auth_helpers.SESSION_COOKIE not in _set_cookies(response)
    assert "max-age=0" in _set_cookies(response)[sign_in_providers.SIGN_IN_COOKIE]
    return parse_qs(location.query)["error"][0]


def _signed_in(response) -> None:
    assert response.status_code == 303, response.text
    assert response.headers["location"] == settings.APPURL
    assert auth_helpers.SESSION_COOKIE in _set_cookies(response)
    assert "max-age=0" in _set_cookies(response)[sign_in_providers.SIGN_IN_COOKIE]


def _challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode()).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


def _cookie_headers(response, name: str = auth_helpers.SESSION_COOKIE) -> dict[str, str]:
    return {**WEB_HEADERS, "Cookie": f"{name}={response.cookies.get(name)}"}


async def _account(db_session, user_uuid):
    await db_session.commit()
    return (
        await db_session.execute(
            select(models.User.microsoft_id).where(models.User.uuid == user_uuid)
        )
    ).one()


async def _session_sources(db_session, user_uuid) -> list[str]:
    await db_session.commit()
    return list(
        (
            await db_session.execute(
                select(models.Session.source).where(models.Session.user_uuid == user_uuid)
            )
        ).scalars()
    )


async def _kept(db_session, user_uuid):
    await db_session.commit()
    return (
        await db_session.execute(
            select(models.ProviderSession, models.Session.source)
            .join(models.Session, models.Session.uuid == models.ProviderSession.session_uuid)
            .where(models.Session.user_uuid == user_uuid)
            .execution_options(populate_existing=True)
        )
    ).first()


async def _stored(db_session, session_uuid) -> bool:
    await db_session.commit()
    return (
        await db_session.execute(
            select(models.ProviderSession.uuid).where(
                models.ProviderSession.session_uuid == session_uuid
            )
        )
    ).first() is not None


async def _linked_user(organization, db_session, microsoft_id: str = "object-id-1"):
    user = await organization.add_user()
    await db_session.execute(
        update(models.User).where(models.User.uuid == user.uuid).values(microsoft_id=microsoft_id)
    )
    await db_session.commit()
    return user


class TestStartingASignIn:
    @pytest.mark.asyncio
    async def test_the_browser_goes_to_the_providers_page_with_a_pkce_challenge(
        self, providers, app_client
    ):
        url, query, response = await _start(app_client)

        assert f"{url.scheme}://{url.netloc}{url.path}" == f"{MICROSOFT_ISSUER}/authorize"
        assert query["client_id"] == AZURE_CLIENT
        assert query["response_type"] == "code"
        assert query["response_mode"] == "query"
        assert query["redirect_uri"] == f"{settings.SELFURL}/app/sign-in/microsoft/callback"
        assert query["scope"] == "openid profile email"
        assert query["code_challenge_method"] == "S256"
        assert len(query["state"]) >= 43 and len(query["nonce"]) >= 43
        cookie = _set_cookies(response)[sign_in_providers.SIGN_IN_COOKIE]
        for attribute in ("httponly", "secure", "samesite=lax", "path=/", "max-age=600"):
            assert attribute in cookie

    @pytest.mark.asyncio
    async def test_the_server_keeps_hashes_and_an_encrypted_verifier(self, providers, app_client):
        _, query, _ = await _start(app_client)
        binding = app_client.cookies[sign_in_providers.SIGN_IN_COOKIE]

        async with auth_helpers.app_redis() as redis:
            key = sign_in_providers._state_key(query["state"])
            raw = (await redis.get(key)).decode()
            assert 0 < await redis.ttl(key) <= 600
        record = json.loads(raw)

        assert query["state"] not in key
        assert query["nonce"] not in raw and binding not in raw
        assert record["nonce_hash"] == hashlib.sha256(query["nonce"].encode()).hexdigest()
        assert record["binding"] == hashlib.sha256(binding.encode()).hexdigest()
        assert record["version"] == "v1"
        verifier = crypto.decrypt_text(record["verifier"], sign_in_providers.VERIFIER_CONTEXT)
        assert verifier not in raw
        assert _challenge(verifier) == query["code_challenge"]

    @pytest.mark.asyncio
    async def test_a_refresh_token_is_asked_for_only_when_the_id_token_is_forwarded(
        self, providers, app_client, monkeypatch
    ):
        _, query, _ = await _start(app_client)
        assert "offline_access" not in query["scope"]

        monkeypatch.setattr(settings, "AUTHENTICATION_SEND_MICROSOFT_IDTOKEN", True)
        _, query, _ = await _start(app_client)
        assert query["scope"] == "openid profile email offline_access"

        _, query, _ = await _start(app_client, "okta")
        assert query["scope"] == "openid profile email"

    @pytest.mark.asyncio
    async def test_a_provider_that_is_not_configured_starts_nothing(
        self, providers, app_client, monkeypatch
    ):
        monkeypatch.setattr(settings, "AZURE_TENANT_ID", None)
        response = await app_client.post("/app/sign-in/microsoft/start", json={})
        assert response.status_code == 400
        assert response.json()["detail"] == "Microsoft sign-in is not configured"
        assert sign_in_providers.SIGN_IN_COOKIE not in _set_cookies(response)

    @pytest.mark.asyncio
    async def test_only_the_web_app_starts_one(self, providers, client):
        for headers in ({"Origin": TEST_ORIGIN}, {**WEB_HEADERS, "Origin": "http://localhost:9999"}):
            response = await client.post("/app/sign-in/microsoft/start", json={}, headers=headers)
            assert response.status_code in {400, 401, 403}
            assert sign_in_providers.SIGN_IN_COOKIE not in _set_cookies(response)

    @pytest.mark.asyncio
    async def test_google_has_no_server_side_flow(self, providers, app_client):
        response = await app_client.post("/app/sign-in/google/start", json={})
        assert response.status_code == 422


class TestComingBackFromTheProvider:
    @pytest.mark.asyncio
    async def test_the_user_is_signed_in_and_the_code_is_exchanged_with_the_verifier(
        self, providers, token_endpoint, organization, app_client, db_session
    ):
        user = await _linked_user(organization, db_session)
        _, query, _ = await _start(app_client)
        token_endpoint.answers.append(
            _exchange(_microsoft(nonce=query["nonce"], email=user.email, xms_edov=True))
        )

        response = await _come_back(app_client, query)

        _signed_in(response)
        for attribute in ("httponly", "secure", "samesite=strict", "path=/"):
            assert attribute in _set_cookies(response)[auth_helpers.SESSION_COOKIE]
        [(url, form)] = token_endpoint.calls
        assert url == f"{MICROSOFT_ISSUER}/token"
        assert form["grant_type"] == "authorization_code"
        assert form["code"] == "the-code"
        assert form["client_id"] == AZURE_CLIENT
        assert form["redirect_uri"] == query["redirect_uri"]
        assert _challenge(form["code_verifier"]) == query["code_challenge"]
        assert "client_secret" not in form
        async with _browser(_cookie_headers(response)) as signed_in:
            session = await signed_in.get("/app/session")
        assert session.status_code == 200, session.text
        assert session.json()["uuid"] == str(user.uuid)
        assert await _kept(db_session, user.uuid) is None

    @pytest.mark.asyncio
    async def test_a_client_secret_goes_with_the_code(
        self, providers, token_endpoint, organization, app_client, monkeypatch
    ):
        monkeypatch.setattr(settings, "OKTA_CLIENT_SECRET", "the-okta-secret")
        user = await organization.add_user()
        _, query, _ = await _start(app_client, "okta")
        token_endpoint.answers.append(_exchange(_okta(email=user.email, nonce=query["nonce"])))

        _signed_in(await _come_back(app_client, query, "okta"))

        assert token_endpoint.calls[0][0] == f"{OKTA_ISSUER}/token"
        assert token_endpoint.calls[0][1]["client_secret"] == "the-okta-secret"

    @pytest.mark.asyncio
    async def test_the_state_works_once(
        self, providers, token_endpoint, organization, app_client, db_session
    ):
        user = await _linked_user(organization, db_session)
        _, query, _ = await _start(app_client)
        token_endpoint.answers.append(
            _exchange(_microsoft(nonce=query["nonce"], email=user.email, xms_edov=True))
        )
        _signed_in(await _come_back(app_client, query))

        assert _error(await _come_back(app_client, query)) == SIGNED_OUT
        assert len(token_endpoint.calls) == 1

    @pytest.mark.asyncio
    async def test_another_browser_cannot_finish_a_sign_in_it_did_not_start(
        self, providers, token_endpoint, app_client
    ):
        _, query, _ = await _start(app_client)

        async with _browser() as stranger:
            response = await stranger.get(
                CALLBACK.format(provider="microsoft"),
                params={"code": "the-code", "state": query["state"]},
            )
        assert _error(response) == SIGNED_OUT
        assert _error(await _come_back(app_client, query)) == SIGNED_OUT
        assert token_endpoint.calls == []

    @pytest.mark.asyncio
    async def test_a_sign_in_with_one_provider_is_not_finished_with_another(
        self, providers, token_endpoint, app_client
    ):
        _, query, _ = await _start(app_client)

        assert _error(await _come_back(app_client, query, "okta")) == SIGNED_OUT
        assert token_endpoint.calls == []

    @pytest.mark.asyncio
    async def test_a_state_nobody_issued_is_refused(self, providers, token_endpoint, app_client):
        await _start(app_client)

        assert _error(await _come_back(app_client, {"state": "never-issued"})) == SIGNED_OUT
        assert token_endpoint.calls == []

    @pytest.mark.asyncio
    async def test_the_providers_refusal_is_shown_without_an_exchange(
        self, providers, token_endpoint, app_client
    ):
        _, query, _ = await _start(app_client)

        response = await _come_back(app_client, query, error="access_denied", code="")

        assert _error(response) == "Microsoft did not complete the sign-in"
        assert token_endpoint.calls == []

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "answer",
        [
            lambda nonce: (400, {"error": "invalid_grant"}),
            lambda nonce: (200, {"access_token": "no-id-token"}),
            lambda nonce: _exchange(_microsoft(nonce="the-nonce-of-another-sign-in")),
            lambda nonce: _exchange(_microsoft(nonce=None)),
            lambda nonce: _exchange(_id_token(MICROSOFT_ISSUER, str(uuid4()), nonce=nonce, tid=TENANT, oid="o")),
            lambda nonce: _exchange(_microsoft(nonce=nonce, tid=str(uuid4()))),
        ],
    )
    async def test_anything_the_provider_answers_that_does_not_verify_signs_nobody_in(
        self, providers, token_endpoint, app_client, answer
    ):
        _, query, _ = await _start(app_client)
        token_endpoint.answers.append(answer(query["nonce"]))

        assert _error(await _come_back(app_client, query)) == "Invalid Microsoft token"

    @pytest.mark.asyncio
    async def test_a_provider_that_cannot_be_reached_is_reported(
        self, providers, app_client, monkeypatch
    ):
        async def unreachable(url, form):
            raise HTTPException(502, detail="The sign-in provider could not be reached")

        monkeypatch.setattr(sign_in_providers, "_token_request", unreachable)
        _, query, _ = await _start(app_client)

        assert _error(await _come_back(app_client, query)) == "The sign-in provider could not be reached"

    @pytest.mark.asyncio
    async def test_an_unverified_microsoft_email_takes_over_no_account(
        self, providers, token_endpoint, organization, app_client, db_session
    ):
        victim = await organization.add_user(password=PASSWORD)
        for claims in ({"email": victim.email}, {"preferred_username": victim.email}):
            _, query, _ = await _start(app_client)
            token_endpoint.answers.append(
                _exchange(_microsoft(oid="attacker-object-id", **claims, nonce=query["nonce"]))
            )
            assert "not verified" in _error(await _come_back(app_client, query))
        assert (await _account(db_session, victim.uuid)).microsoft_id is None
        assert await _session_sources(db_session, victim.uuid) == []

        _, query, _ = await _start(app_client)
        token_endpoint.answers.append(
            _exchange(
                _microsoft(
                    oid="owner-object-id", email=victim.email, xms_edov=True, nonce=query["nonce"]
                )
            )
        )
        _signed_in(await _come_back(app_client, query))
        assert (await _account(db_session, victim.uuid)).microsoft_id == "owner-object-id"

    @pytest.mark.asyncio
    async def test_an_unverified_microsoft_email_claims_no_invitation(
        self, providers, token_endpoint, organization, app_client, db_session
    ):
        email = f"invited_{uuid4().hex[:8]}@example.com"
        invite = models.UserInvite(
            email=email,
            data={"first_name": "In", "last_name": "Vited"},
            permissions_uuid=organization.maps[models.ADMIN_TYPE],
        )
        db_session.add(invite)
        await db_session.commit()
        try:
            _, query, _ = await _start(app_client)
            token_endpoint.answers.append(
                _exchange(_microsoft(oid=f"object-id-{uuid4()}", email=email, nonce=query["nonce"]))
            )
            assert "not verified" in _error(await _come_back(app_client, query))
            await db_session.refresh(invite)
            assert invite.used is False
            assert (
                await db_session.execute(select(models.User).where(models.User.email == email))
            ).first() is None
        finally:
            await db_session.execute(
                delete(models.UserInvite).where(models.UserInvite.email == email)
            )
            await db_session.commit()

    @pytest.mark.asyncio
    async def test_an_unverified_microsoft_email_makes_no_new_account(
        self, providers, token_endpoint, app_client, db_session
    ):
        email = f"newcomer_{uuid4().hex[:8]}@example.com"
        _, query, _ = await _start(app_client)
        token_endpoint.answers.append(
            _exchange(_microsoft(oid=f"object-id-{uuid4()}", email=email, nonce=query["nonce"]))
        )

        assert "not verified" in _error(await _come_back(app_client, query))
        assert (
            await db_session.execute(select(models.User).where(models.User.email == email))
        ).first() is None

    @pytest.mark.asyncio
    async def test_microsoft_users_are_keyed_on_their_object_id(
        self, providers, token_endpoint, organization, app_client, db_session, monkeypatch
    ):
        linked = await _linked_user(organization, db_session, "object-id-linked")
        linked_uuid, linked_email = linked.uuid, linked.email

        async def renamed(id_token, nonce_hash):
            return SignInIdentity(
                email="renamed@tenant.test", email_verified=True, microsoft_id="object-id-linked"
            )

        monkeypatch.setattr(sign_in_providers, "microsoft_identity", renamed)
        _, query, _ = await _start(app_client)
        token_endpoint.answers.append(_exchange("any-token"))
        response = await _come_back(app_client, query)
        _signed_in(response)
        async with _browser(_cookie_headers(response)) as signed_in:
            assert (await signed_in.get("/app/session")).json()["uuid"] == str(linked_uuid)

        async def impostor(id_token, nonce_hash):
            return SignInIdentity(
                email=linked_email, email_verified=True, microsoft_id="object-id-other"
            )

        monkeypatch.setattr(sign_in_providers, "microsoft_identity", impostor)
        _, query, _ = await _start(app_client)
        token_endpoint.answers.append(_exchange("any-token"))
        response = await _come_back(app_client, query)
        assert auth_helpers.SESSION_COOKIE not in _set_cookies(response)

    @pytest.mark.asyncio
    async def test_the_link_waits_for_the_second_factor(
        self, providers, token_endpoint, organization, app_client, db_session
    ):
        user = await organization.add_user()
        await db_session.execute(
            update(models.User)
            .where(models.User.uuid == user.uuid)
            .values(totp_secret=pyotp.random_base32(), totp_active=True)
        )
        await db_session.commit()
        _, query, _ = await _start(app_client)
        token_endpoint.answers.append(
            _exchange(_microsoft(oid="object-id-new", email=user.email, xms_edov=True, nonce=query["nonce"]))
        )

        assert "authenticator code" in _error(await _come_back(app_client, query))
        assert (await _account(db_session, user.uuid)).microsoft_id is None
        assert await _session_sources(db_session, user.uuid) == []


class TestAnAuthenticatorIsRequired:
    @pytest.mark.asyncio
    async def test_the_web_app_is_sent_to_set_one_up_and_the_sign_in_finishes_there(
        self, providers, token_endpoint, organization, authenticator_required, app_client, db_session, monkeypatch
    ):
        monkeypatch.setattr(settings, "AUTHENTICATION_SEND_MICROSOFT_IDTOKEN", True)
        user = await _linked_user(organization, db_session)
        _, query, _ = await _start(app_client)
        id_token = _microsoft(nonce=query["nonce"], email=user.email, xms_edov=True)
        token_endpoint.answers.append(_exchange(id_token, "refresh-enrolling"))

        response = await _come_back(app_client, query)

        assert response.status_code == 303
        location = urlsplit(response.headers["location"])
        assert (location.path, parse_qs(location.query)) == ("/login", {"step": ["totp-enroll"]})
        cookies = _set_cookies(response)
        assert auth_helpers.SESSION_COOKIE not in cookies
        assert "max-age=300" in cookies[auth_helpers.TOTP_COOKIE]
        assert "max-age=0" in cookies[sign_in_providers.SIGN_IN_COOKIE]
        kept, source = await _kept(db_session, user.uuid)
        assert (source, kept.refresh_token) == ("totp-enroll-oauth", "refresh-enrolling")

        enrolling = _cookie_headers(response, auth_helpers.TOTP_COOKIE)
        async with _browser(enrolling) as browser:
            secret = (await browser.post("/totp")).json()["secret"]
            activated = await browser.post(
                "/totp/activate", json={"totp_token": int(pyotp.TOTP(secret).now())}
            )
        assert activated.status_code == 200, activated.text
        kept, source = await _kept(db_session, user.uuid)
        assert (source, kept.id_token, kept.refresh_token) == (
            "oauth-app",
            id_token,
            "refresh-enrolling",
        )


class TestTheTokensTheServerKeeps:
    @pytest.mark.asyncio
    async def test_they_are_kept_encrypted_for_the_session_only(
        self, providers, token_endpoint, organization, app_client, db_session, monkeypatch
    ):
        monkeypatch.setattr(settings, "AUTHENTICATION_SEND_MICROSOFT_IDTOKEN", True)
        user = await _linked_user(organization, db_session)
        _, query, _ = await _start(app_client)
        id_token = _microsoft(nonce=query["nonce"], email=user.email, xms_edov=True)
        token_endpoint.answers.append(_exchange(id_token, "refresh-secret"))

        response = await _come_back(app_client, query)

        _signed_in(response)
        kept, source = await _kept(db_session, user.uuid)
        assert (kept.provider, source) == ("microsoft", "oauth-app")
        assert kept.id_token == id_token and kept.refresh_token == "refresh-secret"
        stored = (
            await db_session.execute(text("select id_token, refresh_token from provider_session"))
        ).all()
        assert stored and all(id_token not in row[0] and "refresh-secret" not in row[1] for row in stored)
        assert "access_token" not in response.text

    @pytest.mark.asyncio
    async def test_a_provider_that_gives_no_refresh_token_signs_nobody_in(
        self, providers, token_endpoint, organization, app_client, db_session, monkeypatch
    ):
        monkeypatch.setattr(settings, "AUTHENTICATION_SEND_MICROSOFT_IDTOKEN", True)
        user = await _linked_user(organization, db_session)
        _, query, _ = await _start(app_client)
        token_endpoint.answers.append(
            _exchange(_microsoft(nonce=query["nonce"], email=user.email, xms_edov=True), None)
        )

        assert "did not issue a refresh token" in _error(await _come_back(app_client, query))
        assert await _session_sources(db_session, user.uuid) == []

    @pytest.mark.asyncio
    async def test_signing_out_ends_them_and_okta_is_asked_to_revoke_the_refresh_token(
        self, providers, token_endpoint, organization, app_client, db_session, monkeypatch
    ):
        monkeypatch.setattr(settings, "AUTHENTICATION_SEND_OKTA_IDTOKEN", True)
        user = await organization.add_user()
        _, query, _ = await _start(app_client, "okta")
        token_endpoint.answers.append(
            _exchange(_okta(email=user.email, nonce=query["nonce"]), "okta-refresh")
        )
        response = await _come_back(app_client, query, "okta")
        _signed_in(response)
        kept_row, _ = await _kept(db_session, user.uuid)
        session_uuid = kept_row.session_uuid

        async with _browser(_cookie_headers(response)) as signed_in:
            assert (await signed_in.post("/app/logout")).status_code == 200
            assert (await signed_in.get("/app/session")).status_code == 401

        assert not await _stored(db_session, session_uuid)
        url, form = token_endpoint.calls[-1]
        assert url == f"{OKTA_ISSUER}/revoke"
        assert form["token"] == "okta-refresh"
        assert form["token_type_hint"] == "refresh_token"
        assert form["client_id"] == OKTA_CLIENT

    @pytest.mark.asyncio
    async def test_a_provider_without_a_revocation_endpoint_is_not_called_at_sign_out(
        self, providers, token_endpoint, organization, app_client, db_session, monkeypatch
    ):
        monkeypatch.setattr(settings, "AUTHENTICATION_SEND_MICROSOFT_IDTOKEN", True)
        user = await _linked_user(organization, db_session)
        _, query, _ = await _start(app_client)
        token_endpoint.answers.append(
            _exchange(_microsoft(nonce=query["nonce"], email=user.email, xms_edov=True))
        )
        response = await _come_back(app_client, query)
        kept_row, _ = await _kept(db_session, user.uuid)
        async with _browser(_cookie_headers(response)) as signed_in:
            assert (await signed_in.post("/app/logout")).status_code == 200

        assert not await _stored(db_session, kept_row.session_uuid)
        assert len(token_endpoint.calls) == 1

    @pytest.mark.asyncio
    async def test_a_refusal_at_sign_out_does_not_keep_the_user_signed_in(
        self, providers, token_endpoint, organization, app_client, db_session, monkeypatch
    ):
        monkeypatch.setattr(settings, "AUTHENTICATION_SEND_OKTA_IDTOKEN", True)
        user = await organization.add_user()
        _, query, _ = await _start(app_client, "okta")
        token_endpoint.answers.append(_exchange(_okta(email=user.email, nonce=query["nonce"])))
        response = await _come_back(app_client, query, "okta")

        async def unreachable(url, form):
            raise HTTPException(502, detail="The sign-in provider could not be reached")

        monkeypatch.setattr(sign_in_providers, "_token_request", unreachable)
        async with _browser(_cookie_headers(response)) as signed_in:
            assert (await signed_in.post("/app/logout")).status_code == 200
            assert (await signed_in.get("/app/session")).status_code == 401


class TestSignInWithGoogle:
    @pytest.mark.asyncio
    async def test_the_web_app_gets_its_session_cookie(self, organization, app_client, monkeypatch):
        user = await organization.add_user()

        async def identity(token):
            assert token == "google-access-token"
            return SignInIdentity(email=user.email, email_verified=True)

        monkeypatch.setattr(sign_in_providers, "google_identity", identity)
        response = await app_client.post(
            "/app/google-auth", json={"token": "google-access-token", "version": "v1"}
        )
        assert response.status_code == 200, response.text
        assert response.json()["uuid"] == str(user.uuid)
        assert "access_token" not in response.json()
        assert app_client.cookies.get(auth_helpers.SESSION_COOKIE)

    @pytest.mark.asyncio
    async def test_a_user_removed_from_their_organization_does_not_sign_in(
        self, organization, app_client, admin_client, db_session, monkeypatch
    ):
        user = await organization.add_user()
        response = await admin_client.delete(f"/admin/users/{user.uuid}/remove")
        assert response.status_code == 200, response.text

        async def identity(token):
            return SignInIdentity(email=user.email, email_verified=True)

        monkeypatch.setattr(sign_in_providers, "google_identity", identity)
        response = await app_client.post(
            "/app/google-auth", json={"token": "google-access-token", "version": "v1"}
        )
        assert response.status_code == 401
        assert auth_helpers.SESSION_COOKIE not in app_client.cookies
        accounts = (
            await db_session.execute(
                select(models.User.uuid, models.User.permissions_uuid).where(
                    models.User.email == user.email
                )
            )
        ).all()
        assert [tuple(account) for account in accounts] == [(user.uuid, None)]

    @pytest.mark.asyncio
    async def test_a_provider_sign_in_needs_the_web_apps_header(self, client, monkeypatch):
        async def identity(token):
            raise AssertionError("the provider is not asked")

        monkeypatch.setattr(sign_in_providers, "google_identity", identity)
        response = await client.post(
            "/app/google-auth", json={"token": "x"}, headers={"Origin": TEST_ORIGIN}
        )
        assert response.status_code == 400


MICROSOFT_HEADER = "X-Microsoft-Id-Token"


def _renewed(exp: int, **claims) -> str:
    return _microsoft(nonce=None, exp=exp, **claims)


@pytest.fixture
async def kept(providers, token_endpoint, organization, db_session, monkeypatch):
    monkeypatch.setattr(settings, "AUTHENTICATION_SEND_MICROSOFT_IDTOKEN", True)
    provider_tokens._cache.clear()
    provider_tokens._inflight.clear()
    user = await organization.add_user()
    await auth_helpers.create_login_token(
        db_session, user.uuid, timedelta(hours=1), app_session=True, source="oauth-app"
    )

    async def keep(expires_in: int):
        await provider_tokens.store(
            db_session,
            user.email,
            ("oauth-app",),
            sign_in_providers.ProviderTokens(
                "microsoft", "old-id-token", int(time.time()) + expires_in, "refresh-old"
            ),
        )
        session = (
            await db_session.execute(
                select(models.Session.uuid).where(models.Session.user_uuid == user.uuid)
            )
        ).scalar_one()
        return SimpleNamespace(user=user, session=session)

    return keep


class TestRenewingTheIdToken:
    @pytest.mark.asyncio
    async def test_a_token_that_is_still_good_is_sent_as_it_is(self, kept, token_endpoint):
        held = await provider_tokens.current((await kept(3600)).session)

        assert (held.header, held.id_token) == (MICROSOFT_HEADER, "old-id-token")
        assert token_endpoint.calls == []

    @pytest.mark.asyncio
    async def test_an_expiring_token_is_renewed_and_the_rotated_refresh_token_replaces_the_old(
        self, kept, token_endpoint, db_session
    ):
        held = await kept(30)
        expires = int(time.time()) + 3600
        renewed = _renewed(expires)
        token_endpoint.answers.append(
            (200, {"id_token": renewed, "refresh_token": "refresh-new"})
        )

        current = await provider_tokens.current(held.session)

        assert current.id_token == renewed
        [(url, form)] = token_endpoint.calls
        assert url == f"{MICROSOFT_ISSUER}/token"
        assert form == {
            "grant_type": "refresh_token",
            "refresh_token": "refresh-old",
            "client_id": AZURE_CLIENT,
            "scope": "openid profile email offline_access",
        }
        row, _ = await _kept(db_session, held.user.uuid)
        assert (row.id_token, row.refresh_token) == (renewed, "refresh-new")
        assert row.id_token_expires_at.timestamp() == expires
        assert (await provider_tokens.current(held.session)).id_token == renewed
        assert len(token_endpoint.calls) == 1

    @pytest.mark.asyncio
    async def test_a_refresh_token_the_provider_does_not_rotate_stays(
        self, kept, token_endpoint, db_session
    ):
        held = await kept(30)
        token_endpoint.answers.append((200, {"id_token": _renewed(int(time.time()) + 3600)}))

        await provider_tokens.current(held.session)

        row, _ = await _kept(db_session, held.user.uuid)
        assert row.refresh_token == "refresh-old"

    @pytest.mark.asyncio
    async def test_a_client_secret_goes_with_the_refresh_token(self, kept, token_endpoint, monkeypatch):
        monkeypatch.setattr(settings, "AZURE_CLIENT_SECRET", "the-entra-secret")
        held = await kept(30)
        token_endpoint.answers.append((200, {"id_token": _renewed(int(time.time()) + 3600)}))

        await provider_tokens.current(held.session)

        assert token_endpoint.calls[0][1]["client_secret"] == "the-entra-secret"

    @pytest.mark.asyncio
    async def test_a_burst_of_requests_renews_once(self, kept, token_endpoint):
        held = await kept(30)
        token_endpoint.delay = 0.1
        token_endpoint.answers.append(
            (200, {"id_token": _renewed(int(time.time()) + 3600), "refresh_token": "refresh-new"})
        )

        answers = await asyncio.gather(*[provider_tokens.current(held.session) for _ in range(25)])

        assert len(token_endpoint.calls) == 1
        assert len({answer.id_token for answer in answers}) == 1

    @pytest.mark.asyncio
    async def test_another_process_renewing_is_waited_for_and_its_result_used(
        self, kept, token_endpoint
    ):
        held = await kept(30)
        lock = auth_helpers.app_redis_key(f"provider_renew:{held.session}")
        async with auth_helpers.app_redis() as redis:
            await redis.set(lock, "1", ex=20)
        renewed = _renewed(int(time.time()) + 3600)

        async def the_other_process():
            await asyncio.sleep(0.3)
            async with database.AsyncWriteSessionLocal.session() as db:
                row = await provider_tokens._row(db, held.session)
                row.id_token = renewed
                row.id_token_expires_at = identity.base.get_now() + timedelta(hours=1)
                await db.commit()
            async with auth_helpers.app_redis() as redis:
                await redis.delete(lock)

        other = asyncio.create_task(the_other_process())
        current = await provider_tokens.current(held.session)
        await other

        assert current.id_token == renewed
        assert token_endpoint.calls == []

    @pytest.mark.asyncio
    async def test_a_refresh_token_the_provider_refuses_ends_the_session(
        self, kept, token_endpoint, db_session
    ):
        held = await kept(30)
        token_endpoint.answers.append((400, {"error": "invalid_grant"}))

        assert await provider_tokens.current(held.session) is None

        assert await _session_sources(db_session, held.user.uuid) == []
        assert not await _stored(db_session, held.session)
        assert await provider_tokens.current(held.session) is None
        assert len(token_endpoint.calls) == 1

    @pytest.mark.asyncio
    async def test_a_provider_that_cannot_be_reached_sends_no_token_and_keeps_the_session(
        self, kept, token_endpoint, db_session, monkeypatch
    ):
        held = await kept(30)

        async def unreachable(url, form):
            raise HTTPException(502, detail="The sign-in provider could not be reached")

        monkeypatch.setattr(sign_in_providers, "_token_request", unreachable)

        assert await provider_tokens.current(held.session) is None
        assert await _session_sources(db_session, held.user.uuid) == ["oauth-app"]
        assert (await _kept(db_session, held.user.uuid))[0].refresh_token == "refresh-old"

    @pytest.mark.asyncio
    async def test_a_renewed_token_that_does_not_verify_replaces_nothing(
        self, kept, token_endpoint, db_session
    ):
        held = await kept(30)
        token_endpoint.answers.append(
            (200, {"id_token": _id_token(MICROSOFT_ISSUER, AZURE_CLIENT, key=OTHER_KEY, tid=TENANT, oid="o")})
        )

        assert await provider_tokens.current(held.session) is None
        assert (await _kept(db_session, held.user.uuid))[0].id_token == "old-id-token"

    @pytest.mark.asyncio
    async def test_with_the_forwarding_off_nothing_is_sent_or_renewed(
        self, kept, token_endpoint, monkeypatch
    ):
        held = await kept(30)
        monkeypatch.setattr(settings, "AUTHENTICATION_SEND_MICROSOFT_IDTOKEN", False)

        assert await provider_tokens.current(held.session) is None
        assert token_endpoint.calls == []

    @pytest.mark.asyncio
    async def test_a_session_that_did_not_sign_in_with_a_provider_has_nothing(
        self, kept, organization, db_session, token_endpoint
    ):
        await kept(3600)
        other = await organization.add_user()
        await auth_helpers.create_login_token(
            db_session, other.uuid, timedelta(hours=1), app_session=True, source="app"
        )
        session = (
            await db_session.execute(
                select(models.Session.uuid).where(models.Session.user_uuid == other.uuid)
            )
        ).scalar_one()

        assert await provider_tokens.current(session) is None


class TestTheHeadersADataConnectionGets:
    @pytest.mark.asyncio
    async def test_the_signed_identity_and_the_providers_id_token(self, kept):
        held = await kept(3600)

        headers = await identity.headers_for(
            held.user.uuid, held.user.email, held.session, "https://backend.example.com/api"
        )

        assert set(headers) == {identity.IDENTITY_HEADER, MICROSOFT_HEADER}
        assert headers[MICROSOFT_HEADER] == "old-id-token"
        claims = jwt.decode(headers[identity.IDENTITY_HEADER], options={"verify_signature": False})
        assert claims["aud"] == "https://backend.example.com"

    @pytest.mark.asyncio
    async def test_a_connection_that_is_only_being_tried_gets_no_id_token(self, kept):
        held = await kept(3600)

        headers = await identity.headers_for(
            held.user.uuid, held.user.email, held.session, "https://backend.example.com", provider_token=False
        )

        assert set(headers) == {identity.IDENTITY_HEADER}

    @pytest.mark.asyncio
    async def test_with_the_forwarding_off_only_the_signed_identity_goes(self, kept, monkeypatch):
        held = await kept(3600)
        monkeypatch.setattr(settings, "AUTHENTICATION_SEND_MICROSOFT_IDTOKEN", False)

        headers = await identity.headers_for(
            held.user.uuid, held.user.email, held.session, "https://backend.example.com"
        )

        assert set(headers) == {identity.IDENTITY_HEADER}

    @pytest.mark.asyncio
    async def test_a_page_opened_without_a_session_gets_no_id_token(self, kept):
        held = await kept(3600)

        headers = await identity.headers_for(
            held.user.uuid, held.user.email, None, "https://backend.example.com"
        )

        assert set(headers) == {identity.IDENTITY_HEADER}


class TestWhenASessionEndsOtherwise:
    @pytest.fixture
    async def okta_session(self, providers, token_endpoint, organization, db_session, monkeypatch):
        monkeypatch.setattr(settings, "AUTHENTICATION_SEND_OKTA_IDTOKEN", True)
        provider_tokens._cache.clear()
        provider_tokens._inflight.clear()
        user = await organization.add_user()
        await auth_helpers.create_login_token(
            db_session, user.uuid, timedelta(hours=1), app_session=True, source="oauth-app"
        )

        async def keep(refresh: str = "okta-refresh-kept"):
            await provider_tokens.store(
                db_session,
                user.email,
                ("oauth-app",),
                sign_in_providers.ProviderTokens(
                    "okta", _okta(email=user.email), int(time.time()) + 3600, refresh
                ),
            )
            session = (
                await db_session.execute(
                    select(models.Session.uuid).where(models.Session.user_uuid == user.uuid)
                )
            ).scalar_one()
            return SimpleNamespace(user=user, session=session)

        return keep

    @pytest.mark.asyncio
    @pytest.mark.parametrize("ending", ["deleted", "expired"])
    async def test_the_refresh_token_is_revoked_and_the_copy_deleted(
        self, okta_session, token_endpoint, db_session, ending
    ):
        held = await okta_session()
        token_endpoint.answers.append((200, {}))
        if ending == "deleted":
            await db_session.execute(
                delete(models.Session).where(models.Session.user_uuid == held.user.uuid)
            )
        else:
            await db_session.execute(
                update(models.Session)
                .where(models.Session.user_uuid == held.user.uuid)
                .values(expiration_date=identity.base.get_now() - timedelta(minutes=1))
            )
        await db_session.commit()
        assert await _stored(db_session, held.session)

        assert await provider_tokens.sweep() == 1

        assert not await _stored(db_session, held.session)
        [(url, form)] = token_endpoint.calls
        assert url == f"{OKTA_ISSUER}/revoke"
        assert form["token"] == "okta-refresh-kept"
        assert await provider_tokens.sweep() == 0
        assert len(token_endpoint.calls) == 1

    @pytest.mark.asyncio
    async def test_a_live_session_keeps_its_tokens(self, okta_session, token_endpoint, db_session):
        held = await okta_session()

        assert await provider_tokens.sweep() == 0

        assert await _stored(db_session, held.session)
        assert token_endpoint.calls == []

    @pytest.mark.asyncio
    async def test_two_processes_sweeping_revoke_once(self, okta_session, token_endpoint, db_session):
        held = await okta_session()
        token_endpoint.answers.extend([(200, {}), (200, {})])
        await db_session.execute(delete(models.Session).where(models.Session.user_uuid == held.user.uuid))
        await db_session.commit()

        released = await asyncio.gather(provider_tokens.sweep(), provider_tokens.sweep())

        assert sorted(released) == [0, 1]
        assert len(token_endpoint.calls) == 1

    @pytest.mark.asyncio
    async def test_a_provider_that_cannot_be_reached_does_not_keep_the_copy(
        self, okta_session, db_session, monkeypatch
    ):
        held = await okta_session()

        async def unreachable(url, form):
            raise HTTPException(502, detail="The sign-in provider could not be reached")

        monkeypatch.setattr(sign_in_providers, "_token_request", unreachable)
        await db_session.execute(delete(models.Session).where(models.Session.user_uuid == held.user.uuid))
        await db_session.commit()

        assert await provider_tokens.sweep() == 1
        assert not await _stored(db_session, held.session)

    @pytest.mark.asyncio
    async def test_a_provider_without_a_revocation_endpoint_only_loses_the_copy(
        self, kept, token_endpoint, db_session
    ):
        held = await kept(3600)
        await db_session.execute(delete(models.Session).where(models.Session.user_uuid == held.user.uuid))
        await db_session.commit()

        assert await provider_tokens.sweep() == 1

        assert not await _stored(db_session, held.session)
        assert token_endpoint.calls == []

    @pytest.mark.asyncio
    async def test_a_session_that_has_ended_sends_nothing_before_the_sweep(
        self, okta_session, db_session
    ):
        held = await okta_session()
        assert await provider_tokens.current(held.session) is not None
        provider_tokens._cache.clear()
        await db_session.execute(delete(models.Session).where(models.Session.user_uuid == held.user.uuid))
        await db_session.commit()

        assert await provider_tokens.current(held.session) is None
