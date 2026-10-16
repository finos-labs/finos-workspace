"""The agent token of the default Copilot.

The web app mints it with its session cookie (POST /app/copilot/token) and sends it to the
default Copilot only, which calls the API with it server to server: GET /app/user (who the
user is, without anything they keep), PUT /app/usage and POST /app/copilot/authorize (with
the user's own provider keys). Every other route refuses it. Redis keeps its hash for 30
minutes at most; signing out revokes it, and it ends with its session.
"""

import hashlib
import json
from datetime import UTC, datetime, timedelta

import jwt
import pytest
from sqlalchemy import delete, update

from api import auth_helpers, models
from tests.fixtures.base import _AUTH_USER, bearer_client, settings, web_session_headers

METERING = {
    "X-Metering-Authorization": "Bearer "
    + jwt.encode({"sub": "metering"}, settings.JWT_SECRET, algorithm="HS256")
}


def _redis():
    return settings.get_redis_session("app")


@pytest.fixture
async def agent_token(auth_client):
    response = await auth_client.post("/app/copilot/token")
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture
async def stored_backend(auth_client, db_session):
    """A data backend of the test user, with a key in its headers."""
    source = models.ApiSource(
        name="Backend with a key",
        url="http://localhost:8001",
        user_uuid=_AUTH_USER["user_uuid"],
        endpointHeaders=[{"key": "X-Api-Key", "value": "sk-backend-key"}],
    )
    db_session.add(source)
    await db_session.commit()
    yield source
    await db_session.execute(delete(models.ApiSource).where(models.ApiSource.uuid == source.uuid))
    await db_session.commit()


class TestMinting:
    @pytest.mark.asyncio
    async def test_a_token_for_thirty_minutes_kept_as_a_hash(self, agent_token):
        token = agent_token["token"]
        assert len(token) >= 43
        assert agent_token["expires_in"] == 30 * 60

        redis = _redis()
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        record = json.loads(redis.get(f"agent_token:{token_hash}"))
        assert record["user_uuid"] == _AUTH_USER["user_uuid"]
        assert 0 < redis.ttl(f"agent_token:{token_hash}") <= 30 * 60
        assert redis.get(f"agent_token:{token}") is None
        assert token.encode() not in b"".join(redis.keys("agent_token*"))

    @pytest.mark.asyncio
    async def test_it_ends_with_the_session_at_the_latest(self, auth_client, db_session):
        await db_session.execute(
            update(models.Session)
            .where(models.Session.uuid == _AUTH_USER["session_uuid"])
            .values(expiration_date=datetime.now(UTC) + timedelta(minutes=10))
        )
        await db_session.commit()
        response = await auth_client.post("/app/copilot/token")
        assert 9 * 60 < response.json()["expires_in"] <= 10 * 60

    @pytest.mark.asyncio
    async def test_only_the_web_app_mints_it(self, auth_client, client, organization):
        headers = web_session_headers(auth_client.headers["Cookie"].split("=", 1)[1])
        client.headers.update(headers)
        del client.headers["Origin"]
        # Without an allowed origin: no
        assert (await client.post("/app/copilot/token")).status_code == 403

        # Nor with a bearer, nor with an agent token
        user = await organization.add_user(password="TestPassword123!")  # noqa: S106
        await organization.role(user.uuid, excel_add_in=True)
        excel = await auth_helpers.create_login_token(
            organization.db, user.uuid, timedelta(hours=1), app_session=True, source="excel"
        )
        async with bearer_client(excel) as add_in:
            assert (await add_in.get("/app/user")).status_code == 200
            assert (await add_in.post("/app/copilot/token")).status_code == 401


class TestItsThreeRoutes:
    @pytest.mark.asyncio
    async def test_who_the_user_is_and_nothing_they_keep(
        self, auth_client, agent_token, stored_backend
    ):
        own = (await auth_client.get("/app/user")).json()
        assert own["api_sources"], "the web app gets the user's backends"

        # The default Copilot calls server to server: its configured origin, no cookie
        async with bearer_client(agent_token["token"]) as agent:
            response = await agent.get("/app/user")
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["uuid"] == _AUTH_USER["user_uuid"]
        assert data["api_sources"] == []
        assert data["file_widgets"] == []
        assert "sk-backend-key" not in response.text

    @pytest.mark.asyncio
    async def test_usage_and_authorize_with_the_users_own_keys(
        self, auth_client, agent_token
    ):
        response = await auth_client.put(
            "/app/copilot-keys", json={"openai_api_key": "sk-user-openai-key"}
        )
        assert response.status_code == 200, response.text

        async with bearer_client(agent_token["token"]) as agent:
            usage = await agent.put(
                "/app/usage",
                json={"add_copilot_count": 0, "add_copilot_tokens": 0},
                headers=METERING,
            )
            assert usage.status_code == 200, usage.text

            authorized = await agent.post(
                "/app/copilot/authorize",
                json={"agent_id": "default-copilot"},
                headers=METERING,
            )
        assert authorized.status_code == 200, authorized.text
        assert authorized.json()["provider_keys"] == {
            "openai_api_key": "sk-user-openai-key",
            "perplexity_api_key": None,
        }

        # The browser never receives them
        from_browser = await auth_client.post(
            "/app/copilot/authorize", json={"agent_id": "default-copilot"}, headers=METERING
        )
        assert "provider_keys" not in from_browser.json()
        assert "sk-user-openai-key" not in (await auth_client.get("/app/session")).text

    @pytest.mark.asyncio
    async def test_every_other_route_refuses_it(self, agent_token):
        async with bearer_client(agent_token["token"]) as agent:
            for method, path in (
                ("GET", "/app/access"),
                ("GET", "/app/usage"),
                ("GET", "/app/session"),
                ("GET", "/app/copilot-keys"),
                ("GET", "/app/dash/sync"),
                ("POST", "/app/copilot/token"),
                ("GET", "/admin/role"),
                ("GET", "/entity/entity-type"),
                ("POST", "/logout"),
            ):
                response = await agent.request(method, path)
                assert response.status_code == 401, (method, path, response.text)

        # Nor is it a cookie
        async with bearer_client("unused") as browser:
            browser.headers.update(web_session_headers(agent_token["token"]))
            del browser.headers["Authorization"]
            assert (await browser.get("/app/user")).status_code == 401


class TestRevocation:
    @pytest.mark.asyncio
    async def test_signing_out_revokes_it(self, auth_client, agent_token):
        token = agent_token["token"]
        assert (await auth_client.post("/app/logout")).status_code == 200

        token_hash = hashlib.sha256(token.encode()).hexdigest()
        assert _redis().get(f"agent_token:{token_hash}") is None
        async with bearer_client(token) as agent:
            assert (await agent.get("/app/user")).status_code == 401

    @pytest.mark.asyncio
    async def test_it_ends_with_its_session(self, auth_client, agent_token, db_session):
        # As when an administrator resets the user's password
        await db_session.execute(
            delete(models.Session).where(models.Session.uuid == _AUTH_USER["session_uuid"])
        )
        await db_session.commit()
        async with bearer_client(agent_token["token"]) as agent:
            assert (await agent.get("/app/user")).status_code == 401

    @pytest.mark.asyncio
    async def test_it_ends_when_its_session_expires(
        self, auth_client, agent_token, db_session
    ):
        await db_session.execute(
            update(models.Session)
            .where(models.Session.uuid == _AUTH_USER["session_uuid"])
            .values(expiration_date=datetime.now(UTC) - timedelta(seconds=1))
        )
        await db_session.commit()
        async with bearer_client(agent_token["token"]) as agent:
            assert (await agent.get("/app/user")).status_code == 401
