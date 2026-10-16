"""Sign-in providers accept only tokens issued to this deployment's own client.

Google's access token must name our client in tokeninfo and a verified email; Microsoft's
and Okta's ID tokens must carry the issuer's signature, our client as audience, the
configured issuer, an expiry in the future and the nonce the API issued to the browser
for this sign-in, which works once. A provider that is not configured refuses every
sign-in. A Microsoft email finds an account that is not linked yet, or makes a new one,
only when Microsoft verified it. The providers' endpoints are replaced by documents the
tests serve.
"""

import hashlib
import json
import time
from uuid import uuid4

import httpx
import jwt
import pyotp
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from jwt.algorithms import RSAAlgorithm
from sqlalchemy import delete, select, update

from api import auth_helpers, models, sign_in_providers
from api.sign_in_providers import SignInIdentity
from tests.fixtures.base import TEST_BASE_URL, TEST_ORIGIN, WEB_HEADERS, app, settings


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


def _serve_issuer(served: dict, authority: str, issuer: str) -> None:
    served[f"{authority}/.well-known/openid-configuration"] = {
        "issuer": issuer,
        "jwks_uri": f"{authority}/keys",
    }
    served[f"{authority}/keys"] = {"keys": [SIGNING_JWK]}


@pytest.fixture
def providers(monkeypatch):
    """Configured providers whose discovery documents, keys, tokeninfo and userinfo the
    test serves; `served` maps URLs to documents (None: the provider answers an error)."""
    for name, value in (
        ("AZURE_CLIENT_ID", AZURE_CLIENT),
        ("AZURE_TENANT_ID", TENANT),
        ("OKTA_CLIENT_ID", OKTA_CLIENT),
        ("OKTA_DOMAIN", OKTA_ISSUER),
        ("GOOGLE_OAUTH_CLIENT_ID", GOOGLE_CLIENT),
    ):
        monkeypatch.setattr(settings, name, value)

    served: dict[str, object] = {}
    for issuer in (MICROSOFT_ISSUER, OKTA_ISSUER):
        _serve_issuer(served, issuer, issuer)

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
        identity = await sign_in_providers.microsoft_identity(_microsoft(), NONCE_HASH)
        assert identity == SignInIdentity(
            email="person@tenant.test",
            email_verified=False,
            given_name="Ada",
            family_name="Lovelace",
            microsoft_id="object-id-1",
        )

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "token",
        [
            # Issued to another application
            lambda: _id_token(MICROSOFT_ISSUER, str(uuid4()), tid=TENANT, oid="o"),
            # By another tenant
            lambda: _microsoft(tenant=str(uuid4())),
            # With the issuer of one tenant and the tenant id of another
            lambda: _microsoft(tid=str(uuid4())),
            # Expired
            lambda: _microsoft(exp=int(time.time()) - 3600, iat=int(time.time()) - 7200),
            # Signed with a key that is not the issuer's
            lambda: _id_token(MICROSOFT_ISSUER, AZURE_CLIENT, key=OTHER_KEY, tid=TENANT, oid="o"),
            # Signed with a key the issuer does not publish
            lambda: _microsoft(kid="unknown-key"),
            # Not signed with the issuer's algorithm
            lambda: jwt.encode(
                {"iss": MICROSOFT_ISSUER, "aud": AZURE_CLIENT, "tid": TENANT, "oid": "o"},
                AZURE_CLIENT * 2,
                algorithm="HS256",
            ),
            # Another sign-in's nonce, or none
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
            # Microsoft does not say the domain's owner verified it
            ({"email": "person@tenant.test"}, False),
            ({"email": "person@tenant.test", "xms_edov": False}, False),
            # The user principal name is no email Microsoft verified
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
        """Microsoft names the issuer of "organizations" and "common" with a {tenantid}
        template, which the token's tenant fills."""
        monkeypatch.setattr(settings, "AZURE_TENANT_ID", authority)
        _serve_issuer(
            providers, f"https://login.microsoftonline.com/{authority}/v2.0", MICROSOFT_TEMPLATE
        )
        tenant = str(uuid4())
        identity = await sign_in_providers.microsoft_identity(
            _microsoft(tenant=tenant), NONCE_HASH
        )
        assert identity.microsoft_id == "object-id-1"
        # The issuer must be the token's own tenant's
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
        """The configuration of a domain names the tenant's id in its issuer."""
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
        identity = await sign_in_providers.okta_identity(
            _okta(name="Grace Hopper"), NONCE_HASH
        )
        assert identity == SignInIdentity(
            email="person@okta.test",
            email_verified=True,
            given_name="Grace",
            family_name="Hopper",
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
            # Issued to another client
            ({"aud": "other", "azp": "other", "sub": "google-subject",
              "email": "person@gmail.test", "email_verified": "true"}, None),
            # An email Google has not verified
            ({"aud": GOOGLE_CLIENT, "sub": "google-subject", "email": "person@gmail.test",
              "email_verified": "false"}, None),
            # The profile of someone else
            ({"aud": GOOGLE_CLIENT, "sub": "google-subject", "email": "person@gmail.test",
              "email_verified": "true"}, {"sub": "another-subject"}),
            # Google does not know the token
            (None, None),
        ],
    )
    async def test_anything_else_is_refused(self, providers, tokeninfo, userinfo):
        self._serve(providers, tokeninfo=tokeninfo, userinfo=userinfo)
        await _refused(sign_in_providers.google_identity("google-access-token"))

    @pytest.mark.asyncio
    async def test_the_access_token_is_never_part_of_a_url(self, monkeypatch):
        """tokeninfo gets it in a POST body and userinfo in the Authorization header."""
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
    """The response's Set-Cookie headers by cookie name, lower-cased."""
    return {
        header.split("=", 1)[0]: header.lower()
        for header in response.headers.get_list("set-cookie")
    }


async def _nonce(web_client) -> str:
    response = await web_client.post("/app/sign-in/nonce")
    assert response.status_code == 200, response.text
    return response.json()["nonce"]


async def _account(db_session, user_uuid):
    return (
        await db_session.execute(
            select(models.User.microsoft_id).where(models.User.uuid == user_uuid)
        )
    ).one()


async def _session_sources(db_session, user_uuid) -> list[str]:
    return list(
        (
            await db_session.execute(
                select(models.Session.source).where(models.Session.user_uuid == user_uuid)
            )
        ).scalars()
    )


class TestTheSignInNonce:
    @pytest.mark.asyncio
    async def test_the_browser_holds_an_opaque_id_and_redis_the_nonces_hash(
        self, app_client
    ):
        response = await app_client.post("/app/sign-in/nonce")
        assert response.status_code == 200, response.text
        nonce = response.json()["nonce"]
        assert len(nonce) >= 43

        cookie = _set_cookies(response)[sign_in_providers.SIGN_IN_COOKIE]
        for attribute in ("httponly", "secure", "samesite=strict", "path=/", "max-age=300"):
            assert attribute in cookie
        sign_in_id = app_client.cookies[sign_in_providers.SIGN_IN_COOKIE]
        assert nonce not in cookie and sign_in_id != nonce

        async with auth_helpers.app_redis() as redis:
            key = sign_in_providers._nonce_key(sign_in_id)
            stored = await redis.get(key)
            assert 0 < await redis.ttl(key) <= 300
            assert sign_in_id not in key
        assert stored.decode() == hashlib.sha256(nonce.encode()).hexdigest()

    @pytest.mark.asyncio
    async def test_only_the_web_app_gets_one(self, client):
        for headers in ({"Origin": TEST_ORIGIN}, {**WEB_HEADERS, "Origin": "http://localhost:9999"}):
            response = await client.post("/app/sign-in/nonce", headers=headers)
            assert response.status_code in {400, 401, 403}
            assert sign_in_providers.SIGN_IN_COOKIE not in _set_cookies(response)


class TestSignInWithAProvider:
    @pytest.mark.asyncio
    async def test_the_web_app_gets_its_session_cookie(
        self, organization, app_client, monkeypatch
    ):
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
    async def test_a_provider_sign_in_needs_the_web_apps_header(self, client, monkeypatch):
        async def identity(token):
            raise AssertionError("the provider is not asked")

        monkeypatch.setattr(sign_in_providers, "google_identity", identity)
        response = await client.post(
            "/app/google-auth", json={"token": "x"}, headers={"Origin": TEST_ORIGIN}
        )
        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_an_id_token_signs_in_once_and_only_the_browser_it_was_issued_to(
        self, providers, organization, app_client, db_session
    ):
        """A forwarded or replayed ID token creates no session: its nonce was issued to
        another browser, and is used up."""
        user = await organization.add_user()
        await db_session.execute(
            update(models.User)
            .where(models.User.uuid == user.uuid)
            .values(microsoft_id="object-id-1")
        )
        await db_session.commit()

        id_token = _microsoft(nonce=await _nonce(app_client))
        response = await app_client.post("/app/microsoft-auth", json={"id_token": id_token})
        assert response.status_code == 200, response.text
        assert response.json()["uuid"] == str(user.uuid)
        assert "max-age=0" in _set_cookies(response)[sign_in_providers.SIGN_IN_COOKIE]
        assert sign_in_providers.SIGN_IN_COOKIE not in app_client.cookies

        # Someone the token was forwarded to: no nonce of theirs
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url=TEST_BASE_URL, headers=WEB_HEADERS
        ) as attacker:
            response = await attacker.post("/app/microsoft-auth", json={"id_token": id_token})
            assert response.status_code == 400
            # A nonce of their own is not the token's
            await _nonce(attacker)
            response = await attacker.post("/app/microsoft-auth", json={"id_token": id_token})
            assert response.status_code == 400
            assert auth_helpers.SESSION_COOKIE not in attacker.cookies
        # The same browser again: its nonce is used up
        response = await app_client.post("/app/microsoft-auth", json={"id_token": id_token})
        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_okta_needs_the_nonce_too(self, providers, organization, app_client):
        user = await organization.add_user()
        id_token = _okta(email=user.email, nonce=await _nonce(app_client))
        response = await app_client.post("/app/okta-auth", json={"id_token": id_token})
        assert response.status_code == 200, response.text
        assert response.json()["uuid"] == str(user.uuid)
        response = await app_client.post("/app/okta-auth", json={"id_token": id_token})
        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_an_unverified_microsoft_email_takes_over_no_account(
        self, providers, organization, app_client, db_session
    ):
        """An account with a password, not linked to a Microsoft user, is not signed in
        to, or linked, by an email Microsoft did not verify."""
        victim = await organization.add_user(password=PASSWORD)
        for claims in ({"email": victim.email}, {"preferred_username": victim.email}):
            id_token = _microsoft(oid="attacker-object-id", **claims, nonce=await _nonce(app_client))
            response = await app_client.post(
                "/app/microsoft-auth", json={"id_token": id_token}
            )
            assert response.status_code == 403, response.text
            assert "not verified" in response.json()["detail"]
            assert auth_helpers.SESSION_COOKIE not in app_client.cookies
        assert (await _account(db_session, victim.uuid)).microsoft_id is None
        assert await _session_sources(db_session, victim.uuid) == []

        # Verified by the owner of its domain, the email links the account
        id_token = _microsoft(
            oid="owner-object-id", email=victim.email, xms_edov=True,
            nonce=await _nonce(app_client),
        )
        response = await app_client.post("/app/microsoft-auth", json={"id_token": id_token})
        assert response.status_code == 200, response.text
        assert response.json()["uuid"] == str(victim.uuid)
        assert (await _account(db_session, victim.uuid)).microsoft_id == "owner-object-id"

    @pytest.mark.asyncio
    async def test_an_unverified_microsoft_email_claims_no_invitation(
        self, providers, organization, app_client, db_session
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
            id_token = _microsoft(
                oid=f"object-id-{uuid4()}", email=email, nonce=await _nonce(app_client)
            )
            response = await app_client.post(
                "/app/microsoft-auth", json={"id_token": id_token}
            )
            assert response.status_code == 403, response.text
            await db_session.refresh(invite)
            assert invite.used is False
            assert (
                await db_session.execute(select(models.User).where(models.User.email == email))
            ).first() is None
        finally:
            await db_session.execute(delete(models.UserInvite).where(models.UserInvite.email == email))
            await db_session.commit()

    @pytest.mark.asyncio
    async def test_an_unverified_microsoft_email_makes_no_new_account(
        self, providers, app_client, db_session
    ):
        """No account is made under an address Microsoft did not verify: its owner's later
        sign-in (with Google, or a Microsoft account that does verify it) would land in it."""
        email = f"newcomer_{uuid4().hex[:8]}@example.com"
        id_token = _microsoft(
            oid=f"object-id-{uuid4()}", email=email, nonce=await _nonce(app_client)
        )
        response = await app_client.post("/app/microsoft-auth", json={"id_token": id_token})
        assert response.status_code == 403, response.text
        assert "not verified" in response.json()["detail"]
        assert auth_helpers.SESSION_COOKIE not in app_client.cookies
        assert (
            await db_session.execute(select(models.User).where(models.User.email == email))
        ).first() is None
        assert (
            await db_session.execute(
                select(models.UserInvite).where(models.UserInvite.email == email)
            )
        ).first() is None

    @pytest.mark.asyncio
    async def test_a_refused_sign_in_clears_the_nonce_cookie(self, providers, app_client):
        """A refused attempt uses the browser's nonce up too, and its cookie goes with it."""
        await _nonce(app_client)
        assert sign_in_providers.SIGN_IN_COOKIE in app_client.cookies
        response = await app_client.post(
            "/app/microsoft-auth", json={"id_token": _microsoft(nonce="another-nonce")}
        )
        assert response.status_code == 400, response.text
        assert "max-age=0" in _set_cookies(response)[sign_in_providers.SIGN_IN_COOKIE]
        assert sign_in_providers.SIGN_IN_COOKIE not in app_client.cookies

    @pytest.mark.asyncio
    async def test_microsoft_users_are_keyed_on_their_object_id(
        self, organization, app_client, db_session, monkeypatch
    ):
        linked = await organization.add_user()
        linked.microsoft_id = "object-id-linked"
        await db_session.commit()
        linked_uuid, linked_email = linked.uuid, linked.email

        async def identity(id_token, nonce_hash):
            return SignInIdentity(
                email=id_token, email_verified=True, microsoft_id="object-id-linked"
            )

        monkeypatch.setattr(sign_in_providers, "microsoft_identity", identity)
        # The email changed at Microsoft: the object id still finds the account
        response = await app_client.post(
            "/app/microsoft-auth", json={"token": "graph", "id_token": "renamed@tenant.test"}
        )
        assert response.status_code == 200, response.text
        assert response.json()["uuid"] == str(linked_uuid)

        async def impostor(id_token, nonce_hash):
            return SignInIdentity(
                email=linked_email, email_verified=True, microsoft_id="object-id-other"
            )

        monkeypatch.setattr(sign_in_providers, "microsoft_identity", impostor)
        # Another Microsoft user with the same email does not get the linked account
        response = await app_client.post(
            "/app/microsoft-auth", json={"token": "graph", "id_token": "x"}
        )
        assert response.status_code != 200 or response.json()["uuid"] != str(linked_uuid)

    @pytest.mark.asyncio
    async def test_the_link_waits_for_the_second_factor(
        self, organization, app_client, db_session, monkeypatch
    ):
        """An account whose authenticator is active is not linked by a sign-in that did
        not pass it."""
        user = await organization.add_user()
        await db_session.execute(
            update(models.User)
            .where(models.User.uuid == user.uuid)
            .values(totp_secret=pyotp.random_base32(), totp_active=True)
        )
        await db_session.commit()

        async def identity(id_token, nonce_hash):
            return SignInIdentity(
                email=user.email, email_verified=True, microsoft_id="object-id-new"
            )

        monkeypatch.setattr(sign_in_providers, "microsoft_identity", identity)
        response = await app_client.post("/app/microsoft-auth", json={"id_token": "x"})
        assert response.status_code == 202
        assert (await _account(db_session, user.uuid)).microsoft_id is None
