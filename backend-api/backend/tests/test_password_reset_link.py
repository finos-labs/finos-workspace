"""An administrator resets a user's password with a link. The reset stops the password
from working and ends every session of the user; the answer is the link, which the
administrator gives the user. The user opens it in the web app and sets a new password,
which the API checks for strength. A link works once, within a day, and only the newest
link of a user works. Redis keeps only the hash of its token. A user an administrator
adds gets such a link too, and no password anyone knows until they set theirs.
"""

from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from urllib.parse import urlsplit
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select, update

from api import auth_helpers, crypto, models
from api.base import get_now
from tests.fixtures.base import TEST_BASE_URL, TEST_ORIGIN, WEB_HEADERS, app

PASSWORD = "TestPassword123!"  # noqa: S105
NEW_PASSWORD = "NewPassword456!"  # noqa: S105
EXPIRED = "This link has expired or was used already. Ask your admin for a new one."


@asynccontextmanager
async def _browser(headers: dict[str, str] | None = WEB_HEADERS):
    """A client of its own, with exactly these headers and an empty cookie jar."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url=TEST_BASE_URL, headers=headers or {}
    ) as browser:
        yield browser


async def _sign_in_with(web, email: str, password: str) -> int:
    response = await web.post(
        "/app/login",
        json={"email": email, "password": password, "source": "app", "version": "v1.0.0"},
    )
    return response.status_code


async def _sign_in(email: str, password: str) -> int:
    async with _browser() as web:
        return await _sign_in_with(web, email, password)


def _token(answer: dict) -> str:
    """The token of the link in an answer, which is all a link carries."""
    assert set(answer) == {"success", "link", "expires_at"}
    link = urlsplit(answer["link"])
    assert (link.scheme, link.netloc, link.path) == (
        "http",
        "localhost:3000",
        "/reset-password",
    )
    assert not link.query
    return link.fragment


async def _reset(admin_client, user: models.User) -> str:
    """The token of the link the administrator gets."""
    response = await admin_client.post(f"/admin/reset-password/{user.uuid}")
    assert response.status_code == 200, response.text
    return _token(response.json())


async def _set_password(token: str, password: str = NEW_PASSWORD, headers=WEB_HEADERS):
    async with _browser(headers) as web:
        return await web.post(
            "/app/reset-password", json={"token": token, "new_password": password}
        )


async def _sessions(db_session, user: models.User) -> int:
    return (
        await db_session.execute(
            select(func.count())
            .select_from(models.Session)
            .where(models.Session.user_uuid == user.uuid)
        )
    ).scalar_one()


class TestTheReset:
    @pytest.mark.asyncio
    async def test_the_password_stops_working_and_the_sessions_end(
        self, organization, admin_client, db_session
    ):
        user = await organization.add_user(password=PASSWORD)
        assert await _sign_in(user.email, PASSWORD) == 200

        response = await admin_client.post(f"/admin/reset-password/{user.uuid}")

        assert response.status_code == 200, response.text
        answer = response.json()
        assert set(answer) == {"success", "link", "expires_at"}
        expires_at = datetime.fromisoformat(answer["expires_at"])
        assert abs(expires_at - (get_now() + timedelta(days=1))) < timedelta(minutes=1)
        assert await _sign_in(user.email, PASSWORD) == 401
        assert await _sessions(db_session, user) == 0

    @pytest.mark.asyncio
    async def test_redis_keeps_only_the_hash_of_the_token(self, organization, admin_client):
        user = await organization.add_user(password=PASSWORD)
        token = await _reset(admin_client, user)

        async with auth_helpers.app_redis() as redis:
            stored = {}
            async for key in redis.scan_iter(match="*password_reset*"):
                stored[key.decode() if isinstance(key, bytes) else key] = (
                    await redis.get(key),
                    await redis.ttl(key),
                )
        token_key = auth_helpers.app_redis_key(f"password_reset:{crypto.hash_token(token)}")
        assert token_key in stored
        assert all(
            token not in key and token.encode() != value
            for key, (value, _) in stored.items()
        )
        assert (
            timedelta(hours=23)
            < timedelta(seconds=stored[token_key][1])
            <= timedelta(days=1)
        )

    @pytest.mark.asyncio
    async def test_a_superuser_is_told_of_an_unknown_user(self, organization, db_session):
        superuser = await organization.add_user(models.ADMIN_TYPE, password=PASSWORD)
        await db_session.execute(
            update(models.User)
            .where(models.User.uuid == superuser.uuid)
            .values(is_superuser=True)
        )
        await db_session.commit()
        async with _browser() as web:
            assert await _sign_in_with(web, superuser.email, PASSWORD) == 200

            response = await web.post(f"/admin/reset-password/{uuid4()}")

        assert response.status_code == 404
        assert response.json()["detail"] == "Matching user not found"


class TestANewUser:
    async def _add(self, organization, admin_client, db_session, email: str) -> dict:
        response = await admin_client.post(
            "/admin/create-user",
            json={
                "email": email,
                "first_name": "New",
                "last_name": "User",
                "permissions_uuid": str(organization.maps[models.USER_TYPE]),
            },
        )
        user_uuid = (
            await db_session.execute(
                select(models.User.uuid).where(models.User.email == email)
            )
        ).scalar_one_or_none()
        if user_uuid:
            organization.users.append(user_uuid)
        assert response.status_code == 200, response.text
        return response.json()

    @pytest.mark.asyncio
    async def test_the_admin_gets_a_link_and_no_password(
        self, organization, admin_client, db_session
    ):
        email = f"new_{uuid4().hex[:8]}@example.com"

        answer = await self._add(organization, admin_client, db_session, email)

        token = _token(answer)
        expires_at = datetime.fromisoformat(answer["expires_at"])
        assert abs(expires_at - (get_now() + timedelta(days=1))) < timedelta(minutes=1)
        user = (
            await db_session.execute(select(models.User).where(models.User.email == email))
        ).scalar_one()
        assert not user.temporary_password
        async with auth_helpers.app_redis() as redis:
            stored = await redis.get(
                auth_helpers.app_redis_key(f"password_reset:{crypto.hash_token(token)}")
            )
        assert stored is not None
        assert (stored.decode() if isinstance(stored, bytes) else stored) == str(user.uuid)

    @pytest.mark.asyncio
    async def test_the_new_user_sets_a_password_with_the_link_and_signs_in(
        self, organization, admin_client, db_session
    ):
        email = f"new_{uuid4().hex[:8]}@example.com"
        token = _token(await self._add(organization, admin_client, db_session, email))

        assert (await _set_password(token)).status_code == 200

        assert await _sign_in(email, NEW_PASSWORD) == 200
        assert (await _set_password(token, "OtherPassword789!")).status_code == 400

    @pytest.mark.asyncio
    async def test_a_reset_replaces_the_link_of_a_new_user(
        self, organization, admin_client, db_session
    ):
        email = f"new_{uuid4().hex[:8]}@example.com"
        first = _token(await self._add(organization, admin_client, db_session, email))
        user = (
            await db_session.execute(select(models.User).where(models.User.email == email))
        ).scalar_one()

        newer = await _reset(admin_client, user)

        assert (await _set_password(first)).status_code == 400
        assert (await _set_password(newer)).status_code == 200


class TestTheLink:
    @pytest.mark.asyncio
    async def test_the_user_sets_a_new_password_and_signs_in_with_it(
        self, organization, admin_client, db_session
    ):
        user = await organization.add_user(password=PASSWORD)
        await db_session.execute(
            update(models.User)
            .where(models.User.uuid == user.uuid)
            .values(temporary_password=True)
        )
        await db_session.commit()
        token = await _reset(admin_client, user)

        response = await _set_password(token)

        assert response.status_code == 200, response.text
        assert await _sign_in(user.email, NEW_PASSWORD) == 200
        assert await _sign_in(user.email, PASSWORD) == 401
        await db_session.refresh(user)
        assert user.temporary_password is False

    @pytest.mark.asyncio
    async def test_the_link_works_once(self, organization, admin_client):
        user = await organization.add_user(password=PASSWORD)
        token = await _reset(admin_client, user)
        assert (await _set_password(token)).status_code == 200

        response = await _set_password(token, "OtherPassword789!")

        assert response.status_code == 400
        assert response.json()["detail"] == EXPIRED
        assert await _sign_in(user.email, NEW_PASSWORD) == 200

    @pytest.mark.asyncio
    async def test_a_newer_link_replaces_the_older(self, organization, admin_client):
        user = await organization.add_user(password=PASSWORD)
        older = await _reset(admin_client, user)
        newer = await _reset(admin_client, user)

        assert (await _set_password(older)).status_code == 400
        assert (await _set_password(newer)).status_code == 200

    @pytest.mark.asyncio
    async def test_an_expired_link_is_refused(self, organization, admin_client):
        user = await organization.add_user(password=PASSWORD)
        token = await _reset(admin_client, user)
        async with auth_helpers.app_redis() as redis:
            await redis.delete(
                auth_helpers.app_redis_key(f"password_reset:{crypto.hash_token(token)}")
            )

        response = await _set_password(token)

        assert response.status_code == 400
        assert response.json()["detail"] == EXPIRED

    @pytest.mark.asyncio
    async def test_an_unknown_token_is_refused(self):
        response = await _set_password("not-a-token")

        assert response.status_code == 400
        assert response.json()["detail"] == EXPIRED

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "password",
        [
            "Sh0rt!a",
            "nouppercase1!",
            "NOLOWERCASE1!",
            "NoDigits!!",
            "NoSpecial12",
            "Has Space1!",
        ],
    )
    async def test_a_weak_password_is_refused_and_the_link_still_works(
        self, password, organization, admin_client
    ):
        user = await organization.add_user(password=PASSWORD)
        token = await _reset(admin_client, user)

        response = await _set_password(token, password)

        assert response.status_code == 422
        assert (await _set_password(token)).status_code == 200

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "headers",
        [
            {},
            {auth_helpers.CLIENT_HEADER: "admin", "Origin": TEST_ORIGIN},
            {auth_helpers.CLIENT_HEADER: "web", "Origin": "https://elsewhere.example"},
        ],
    )
    async def test_only_the_web_app_uses_the_link(
        self, headers, organization, admin_client
    ):
        user = await organization.add_user(password=PASSWORD)
        token = await _reset(admin_client, user)

        response = await _set_password(token, headers=headers)

        assert response.status_code in {400, 401, 403}
        assert (await _set_password(token)).status_code == 200

    @pytest.mark.asyncio
    async def test_the_link_of_a_deleted_user_is_refused(
        self, organization, admin_client, db_session
    ):
        user = await organization.add_user(password=PASSWORD)
        token = await _reset(admin_client, user)
        await db_session.execute(
            update(models.User).where(models.User.uuid == user.uuid).values(deleted=True)
        )
        await db_session.commit()

        response = await _set_password(token)

        assert response.status_code == 400
        assert response.json()["detail"] == EXPIRED

    @pytest.mark.asyncio
    async def test_every_session_ends(self, organization, admin_client, db_session):
        # A session that began after the reset, as with single sign-on
        user = await organization.add_user(password=PASSWORD)
        token = await _reset(admin_client, user)
        await auth_helpers.create_login_token(
            db_session, user.uuid, timedelta(days=1), source="app"
        )
        assert await _sessions(db_session, user) == 1

        assert (await _set_password(token)).status_code == 200

        assert await _sessions(db_session, user) == 0
