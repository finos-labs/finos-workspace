import os
import sys

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import pytest

from tests.fixtures.base import _DEFAULT_USER_MAP_UUID
from tests.fixtures.utils import skip
from uuid import uuid4
from sqlalchemy import delete

from api.auth_helpers import SESSION_COOKIE
from api.models import User, Session as SessionModel, UserInvite


class WorkspacePayloads:
    @staticmethod
    def login(email: str, password: str, version: str = "v3.3.0"):
        return {
            "email": email,
            "password": password,
            "remember": False,
            "source": "app",
            "totp_token": None,
            "version": version,
        }

    @staticmethod
    def change_password(old_password: str, new_password: str):
        return {
            "old_password": old_password,
            "new_password": new_password,
        }


async def cleanup_test_user(
    db_session,
    user_uuid: str | None = None,
    email: str | None = None,
):
    if user_uuid:
        await db_session.execute(delete(SessionModel).where(SessionModel.user_uuid == user_uuid))
        await db_session.execute(delete(User).where(User.uuid == user_uuid))
    if email:
        await db_session.execute(delete(UserInvite).where(UserInvite.email == email))
        await db_session.execute(delete(User).where(User.email == email))
    await db_session.commit()


class TestAppLogin:
    @pytest.mark.asyncio
    async def test_login_missing_credentials(self, app_client):
        response = await app_client.post("/app/login", json={})
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_login_missing_password(self, app_client):
        response = await app_client.post("/app/login", json={"email": "test@test.com"})
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_login_invalid_credentials(self, app_client):
        response = await app_client.post(
            "/app/login", json=WorkspacePayloads.login("nonexistent@test.com", "WrongPassword123!")
        )
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_login_valid_credentials(self, app_client, db_session):
        test_password = "TestPassword123!"
        test_user_uuid = str(uuid4())
        test_email = f"login_test_{uuid4().hex[:8]}@example.com"

        test_user = User(
            uuid=test_user_uuid,
            email=test_email,
            clean_email=test_email.lower(),
            password=test_password,
            confirmed=True,
            permissions_uuid=_DEFAULT_USER_MAP_UUID,
        )
        db_session.add(test_user)
        await db_session.commit()

        try:
            response = await app_client.post("/app/login", json=WorkspacePayloads.login(test_email, test_password))

            assert response.status_code == 200
            data = response.json()
            assert "access_token" not in data
            assert app_client.cookies.get(SESSION_COOKIE)
            assert data["email"] == test_email
            assert data["uuid"] == test_user_uuid
            assert data["access"] == {"user_type": "User", "sharing": "none"}
        finally:
            await cleanup_test_user(db_session, user_uuid=test_user_uuid)

    @pytest.mark.asyncio
    async def test_login_without_an_organization(self, app_client, db_session):
        test_password = "TestPassword123!"
        test_user_uuid = str(uuid4())
        test_email = f"login_test_{uuid4().hex[:8]}@example.com"
        db_session.add(
            User(
                uuid=test_user_uuid,
                email=test_email,
                clean_email=test_email.lower(),
                password=test_password,
                confirmed=True,
            )
        )
        await db_session.commit()

        try:
            response = await app_client.post("/app/login", json=WorkspacePayloads.login(test_email, test_password))

            assert response.status_code == 401
            assert not app_client.cookies.get(SESSION_COOKIE)
        finally:
            await cleanup_test_user(db_session, user_uuid=test_user_uuid)

    @pytest.mark.asyncio
    async def test_login_unconfirmed_user(self, app_client, db_session):
        test_password = "TestPassword123!"
        test_user_uuid = str(uuid4())
        test_email = f"unconfirmed_{uuid4().hex[:8]}@example.com"

        test_user = User(
            uuid=test_user_uuid,
            email=test_email,
            clean_email=test_email.lower(),
            password=test_password,
            confirmed=False,
            permissions_uuid=_DEFAULT_USER_MAP_UUID,
        )
        db_session.add(test_user)
        await db_session.commit()

        try:
            response = await app_client.post("/app/login", json=WorkspacePayloads.login(test_email, test_password))
            assert response.status_code == 403
        finally:
            await cleanup_test_user(db_session, user_uuid=test_user_uuid)

    @pytest.mark.asyncio
    async def test_login_empty_email(self, app_client):
        response = await app_client.post("/app/login", json=WorkspacePayloads.login("", "password123"))
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_login_empty_password(self, app_client):
        response = await app_client.post("/app/login", json=WorkspacePayloads.login("test@test.com", ""))
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_login_sql_injection_attempt(self, app_client):
        response = await app_client.post(
            "/app/login", json=WorkspacePayloads.login("test@test.com' OR '1'='1", "password' OR '1'='1")
        )
        assert response.status_code in {404, 422}

    @pytest.mark.asyncio
    async def test_login_xss_attempt(self, app_client):
        response = await app_client.post(
            "/app/login", json=WorkspacePayloads.login("<script>alert('xss')</script>@test.com", "password123")
        )
        assert response.status_code in {404, 422}


class TestLogout:
    @pytest.mark.asyncio
    async def test_logout_unauthenticated(self, client):
        response = await client.post("/app/logout")
        assert response.status_code in {401, 403}
        data = response.json()
        assert "detail" in data

    @pytest.mark.asyncio
    async def test_logout_authenticated(self, auth_client):
        response = await auth_client.post("/app/logout")
        assert response.status_code == 200
        data = response.json()
        assert data.get("success") is True

    @pytest.mark.asyncio
    async def test_logout_is_not_a_get(self, auth_client):
        response = await auth_client.get("/app/logout")
        assert response.status_code in {404, 405}
        assert (await auth_client.get("/app/user")).status_code == 200


class TestUserProfile:
    @pytest.mark.asyncio
    async def test_get_user_unauthenticated(self, client):
        response = await client.get("/app/user")
        assert response.status_code in {401, 403}

    @pytest.mark.asyncio
    async def test_get_user_authenticated(self, auth_client):
        response = await auth_client.get("/app/user")
        assert response.status_code == 200

        data = response.json()
        assert "email" in data
        assert "uuid" in data
        assert data["email"] == "testrunner@example.com"

        assert "password" not in str(data).lower() or "password_hash" not in str(data)


class TestPasswordChange:
    @pytest.mark.asyncio
    async def test_change_password_unauthenticated(self, client):
        response = await client.put("/user", json=WorkspacePayloads.change_password("old", "new"))
        assert response.status_code in {401, 403}

    @pytest.mark.asyncio
    async def test_change_password_wrong_old_password(self, app_client, db_session):
        test_password = "CorrectPassword123!"
        test_user_uuid = str(uuid4())
        test_email = f"pwchange_{uuid4().hex[:8]}@example.com"

        test_user = User(
            uuid=test_user_uuid,
            email=test_email,
            clean_email=test_email.lower(),
            password=test_password,
            confirmed=True,
            permissions_uuid=_DEFAULT_USER_MAP_UUID,
        )
        db_session.add(test_user)
        await db_session.commit()

        try:
            login_response = await app_client.post("/app/login", json=WorkspacePayloads.login(test_email, test_password))
            if login_response.status_code not in {200, 206}:
                skip("Could not login for password change test")

            response = await app_client.put(
                "/user", json=WorkspacePayloads.change_password("WrongOldPassword!", "NewPassword123!")
            )
            assert response.status_code in {400, 401, 422}
        finally:
            await cleanup_test_user(db_session, user_uuid=test_user_uuid)


class TestTwoFactorAuth:
    @pytest.mark.asyncio
    async def test_get_2fa_unauthenticated(self, client):
        response = await client.get("/app/2fa")
        assert response.status_code in {401, 403}

    @pytest.mark.asyncio
    async def test_generate_totp_unauthenticated(self, client):
        response = await client.post("/totp", json={})
        assert response.status_code in {401, 403, 422}

    @pytest.mark.asyncio
    async def test_activate_totp_unauthenticated(self, client):
        response = await client.post("/totp/activate", json={"totp_token": 123456})
        assert response.status_code in {401, 403}

    @pytest.mark.asyncio
    async def test_activate_totp_without_secret(self, auth_client):
        response = await auth_client.post("/totp/activate", json={"totp_token": 123456})
        assert response.status_code in {400, 401}

    @pytest.mark.asyncio
    async def test_activate_totp_wrong_code(self, auth_client):
        generate_response = await auth_client.post("/totp", json={})
        if generate_response.status_code == 200:
            response = await auth_client.post("/totp/activate", json={"totp_token": 0})
            assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_totp_full_flow(self, app_client, db_session):
        import pyotp

        test_user_uuid = str(uuid4())
        test_email = f"totp_{uuid4().hex[:8]}@example.com"
        test_password = "TotpTestPassword123!"

        test_user = User(
            uuid=test_user_uuid,
            email=test_email,
            clean_email=test_email.lower(),
            password=test_password,
            confirmed=True,
            permissions_uuid=_DEFAULT_USER_MAP_UUID,
        )
        db_session.add(test_user)
        await db_session.commit()

        try:
            login_response = await app_client.post("/app/login", json=WorkspacePayloads.login(test_email, test_password))
            if login_response.status_code not in {200, 206}:
                skip("Could not login for TOTP test")

            generate_response = await app_client.post("/totp", json={})
            if generate_response.status_code == 200:
                secret = generate_response.json()["secret"]

                totp = pyotp.TOTP(secret)
                valid_code = int(totp.now())

                activate_response = await app_client.post("/totp/activate", json={"totp_token": valid_code})
                assert activate_response.status_code == 200
                assert activate_response.json().get("success") is True
        finally:
            await cleanup_test_user(db_session, user_uuid=test_user_uuid)


class TestUserDeletion:
    @pytest.mark.asyncio
    async def test_delete_user_unauthenticated(self, client):
        response = await client.delete("/user")
        assert response.status_code in {401, 403}

    @pytest.mark.asyncio
    async def test_delete_user_full_flow(self, app_client, db_session):
        test_user_uuid = str(uuid4())
        test_email = f"delete_{uuid4().hex[:8]}@example.com"
        test_password = "DeleteTestPassword123!"

        test_user = User(
            uuid=test_user_uuid,
            email=test_email,
            clean_email=test_email.lower(),
            password=test_password,
            confirmed=True,
            permissions_uuid=_DEFAULT_USER_MAP_UUID,
        )
        db_session.add(test_user)
        await db_session.commit()

        try:
            login_response = await app_client.post("/app/login", json=WorkspacePayloads.login(test_email, test_password))
            if login_response.status_code not in {200, 206}:
                skip("Could not login for delete test")

            delete_response = await app_client.delete("/user")
            assert delete_response.status_code == 200
            assert delete_response.json().get("success") is True

            login_again = await app_client.post("/app/login", json=WorkspacePayloads.login(test_email, test_password))
            assert login_again.status_code == 401
        finally:
            await db_session.execute(delete(SessionModel).where(SessionModel.user_uuid == test_user_uuid))
            await db_session.commit()


class TestOAuthErrorHandling:
    @pytest.mark.asyncio
    async def test_google_auth_missing_token(self, app_client):
        response = await app_client.post("/app/google-auth", json={})
        assert response.status_code in {400, 401, 422}

    @pytest.mark.asyncio
    async def test_google_auth_invalid_token(self, app_client):
        response = await app_client.post("/app/google-auth", json={"token": "invalid_token"})
        assert response.status_code in {400, 401, 422}
        assert response.status_code != 500

    @pytest.mark.asyncio
    async def test_microsoft_sign_in_that_is_not_configured_is_refused(self, app_client):
        response = await app_client.post("/app/sign-in/microsoft/start", json={})
        assert response.status_code in {400, 401, 422}

    @pytest.mark.asyncio
    async def test_oauth_sql_injection_attempt(self, app_client):
        response = await app_client.post("/app/google-auth", json={"token": "'; DROP TABLE users; --"})
        assert response.status_code in {400, 401, 422}
        assert response.status_code != 500

    @pytest.mark.asyncio
    async def test_oauth_no_token_leakage(self, app_client):
        test_token = "secret_test_token_12345"
        response = await app_client.post("/app/google-auth", json={"token": test_token})
        assert test_token not in response.text


class TestSessionValidation:
    @pytest.mark.asyncio
    async def test_validate_unauthenticated(self, client):
        response = await client.get("/app/validate")
        assert response.status_code == 200
        assert response.json()["success"] is False

    @pytest.mark.asyncio
    async def test_validate_authenticated(self, auth_client):
        response = await auth_client.get("/app/validate")
        assert response.status_code == 200
