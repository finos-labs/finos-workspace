from datetime import timedelta
from uuid import uuid4

import httpx
import jwt
import pytest
from sqlalchemy import delete, text, update

from api import base, identity, models
from tests.fixtures.base import TEST_BASE_URL, app, settings

JWKS = "/.well-known/jwks.json"
BACKEND = "https://backend.example.com"


@pytest.fixture(autouse=True)
async def fresh_keys(client, db_session):
    identity._signer.clear()
    identity._tokens.clear()
    await db_session.execute(delete(models.SigningKey))
    await db_session.commit()
    yield
    identity._signer.clear()
    identity._tokens.clear()
    await db_session.execute(delete(models.SigningKey))
    await db_session.commit()


async def _published() -> list[dict]:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=TEST_BASE_URL) as bare:
        response = await bare.get(JWKS)
    assert response.status_code == 200, response.text
    return response.json()["keys"]


def _verify(token: str, keys: list[dict], audience: str = BACKEND) -> dict:
    kid = jwt.get_unverified_header(token)["kid"]
    (jwk,) = [key for key in keys if key["kid"] == kid]
    return jwt.decode(
        token,
        jwt.PyJWK(jwk).key,
        algorithms=["ES256"],
        audience=audience,
        issuer=settings.SELFURL.rstrip("/"),
    )


class TestThePublishedKeys:
    @pytest.mark.asyncio
    async def test_anyone_may_read_them_and_they_hold_no_private_part(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=TEST_BASE_URL) as bare:
            response = await bare.get(JWKS)

        assert response.status_code == 200
        assert response.headers["cache-control"] == "public, max-age=300"
        (key,) = response.json()["keys"]
        assert (key["kty"], key["crv"], key["use"], key["alg"]) == ("EC", "P-256", "sig", "ES256")
        assert "d" not in key and key["kid"]

    @pytest.mark.asyncio
    async def test_only_a_get_is_answered_without_an_allowed_origin(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=TEST_BASE_URL) as bare:
            assert (await bare.post(JWKS)).status_code in {403, 405}
            assert (await bare.get(f"{JWKS}/other")).status_code in {403, 404}

    @pytest.mark.asyncio
    async def test_the_private_key_is_encrypted_at_rest(self, db_session):
        await _published()

        (raw,) = (await db_session.execute(text("select private_key from signing_key"))).scalars().all()
        assert "PRIVATE KEY" not in raw and "BEGIN" not in raw
        (row,) = (await db_session.execute(text("select public_jwk from signing_key"))).scalars().all()
        assert '"d"' not in str(row)


class TestTheSignedIdentity:
    @pytest.mark.asyncio
    async def test_it_verifies_with_the_published_keys_for_its_audience_only(self):
        user = uuid4()
        token = await identity.mint(user, "person@example.com", BACKEND)

        claims = _verify(token, await _published())

        assert claims["sub"] == str(user)
        assert claims["email"] == "person@example.com"
        assert claims["iss"] == settings.SELFURL.rstrip("/")
        assert claims["exp"] - claims["iat"] == 300
        assert claims["jti"]
        with pytest.raises(jwt.InvalidAudienceError):
            _verify(token, await _published(), audience="https://another.example.com")

    @pytest.mark.asyncio
    async def test_a_token_is_reused_for_the_same_user_and_audience_only(self):
        user = uuid4()
        first = await identity.mint(user, "person@example.com", BACKEND)

        assert await identity.mint(user, "person@example.com", BACKEND) == first
        assert await identity.mint(user, "person@example.com", "https://another.example.com") != first
        assert await identity.mint(user, "renamed@example.com", BACKEND) != first
        assert await identity.mint(uuid4(), "person@example.com", BACKEND) != first

    @pytest.mark.parametrize(
        ("url", "audience"),
        [
            ("https://Backend.Example.com/path?q=1", "https://backend.example.com"),
            ("http://127.0.0.1:8080/x", "http://127.0.0.1:8080"),
            ("https://user:secret@host.test:8443/a", "https://host.test:8443"),
            ("http://[::1]:9000/", "http://[::1]:9000"),
        ],
    )
    def test_the_audience_is_the_origin_of_the_connection(self, url, audience):
        assert identity.audience_of(url) == audience


class TestRotatingTheKey:
    @pytest.mark.asyncio
    async def test_a_key_signs_for_thirty_days_and_is_published_for_one_more(self, db_session):
        first = jwt.get_unverified_header(await identity.mint(uuid4(), "a@example.com", BACKEND))["kid"]

        async def age(days: float) -> None:
            await db_session.execute(
                update(models.SigningKey).values(created_date=base.get_now() - timedelta(days=days))
            )
            await db_session.commit()
            identity._signer.clear()
            identity._tokens.clear()

        await age(29)
        assert jwt.get_unverified_header(await identity.mint(uuid4(), "a@example.com", BACKEND))["kid"] == first

        await age(30.5)
        second = jwt.get_unverified_header(await identity.mint(uuid4(), "a@example.com", BACKEND))["kid"]
        assert second != first
        assert {key["kid"] for key in await _published()} == {first, second}

        await db_session.execute(
            update(models.SigningKey)
            .where(models.SigningKey.uuid == first)
            .values(created_date=base.get_now() - timedelta(days=32))
        )
        await db_session.commit()
        assert {key["kid"] for key in await _published()} == {second}
