import os
import sys

BACKEND_DIR = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import pytest
from sqlalchemy import text


class TestDisplaySettings:
    @pytest.mark.asyncio
    async def test_display_settings_unauthenticated(self, client):
        response = await client.post("/app/display-settings", json={})
        assert response.status_code in {401, 403, 422}
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data

    @pytest.mark.asyncio
    async def test_display_settings_authenticated(self, auth_client):
        response = await auth_client.post(
            "/app/display-settings", json={"theme": "dark", "language": "en"}
        )
        assert response.status_code in {200, 422}
        data = response.json()
        assert isinstance(data, dict)
        content_type = response.headers.get("content-type", "")
        assert "application/json" in content_type


class TestDisplaySettingsDefaults:
    def test_default_landing_page_is_the_apps_page(self):
        from api.schemas import UserDisplaySettings

        assert UserDisplaySettings().lastVisitedPage == "/app"


class TestUserUpdate:
    @pytest.mark.asyncio
    async def test_update_user_unauthenticated(self, client):
        response = await client.put(
            "/user",
            json={"old_password": "OldPassword123!", "new_password": "NewPassword123!"},
        )
        assert response.status_code in {401, 403, 422}
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data


class TestUserDelete:
    @pytest.mark.asyncio
    async def test_delete_user_unauthenticated(self, client):
        response = await client.delete("/user")
        assert response.status_code in {401, 403}
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data

    @pytest.mark.asyncio
    async def test_delete_user_authenticated(self, auth_client):
        pass


class TestDisplaySettingsValidation:
    @pytest.mark.asyncio
    async def test_display_settings_invalid_theme(self, auth_client):
        response = await auth_client.post(
            "/app/display-settings",
            json={"theme": "invalid_theme_value"},
        )
        assert response.status_code in {200, 422}

    @pytest.mark.asyncio
    async def test_display_settings_sql_injection(self, auth_client, db_session):
        sql_payload = "'; DROP TABLE user; --"
        response = await auth_client.post(
            "/app/display-settings",
            json={"theme": sql_payload},
        )
        assert response.status_code in {200, 422}

        result = await db_session.execute(text("SELECT COUNT(*) FROM user"))
        count = result.scalar()
        assert count is not None

    @pytest.mark.asyncio
    async def test_display_settings_xss(self, auth_client):
        xss_payload = "<script>alert('xss')</script>"
        response = await auth_client.post(
            "/app/display-settings",
            json={"theme": xss_payload},
        )

        if response.status_code == 200:
            content_type = response.headers.get("content-type", "")
            assert "application/json" in content_type

    @pytest.mark.asyncio
    async def test_display_settings_nested_object(self, auth_client):
        response = await auth_client.post(
            "/app/display-settings",
            json={
                "theme": "dark",
                "extra": {"nested": "value", "deep": {"key": "value"}},
            },
        )
        assert response.status_code in {200, 422}


class TestUserAuthEdgeCases:
    @pytest.mark.asyncio
    async def test_user_endpoints_with_expired_token(self, client):
        client.headers["Authorization"] = "Bearer expired.token.here"
        response = await client.get("/app/user")
        assert response.status_code in {401, 403}

    @pytest.mark.asyncio
    async def test_user_endpoints_with_malformed_token(self, client):
        client.headers["Authorization"] = "Bearer not-a-valid-jwt"
        response = await client.get("/app/user")
        assert response.status_code in {401, 403}

    @pytest.mark.asyncio
    async def test_user_endpoints_with_empty_bearer(self, client):
        client.headers["Authorization"] = "Bearer "
        response = await client.get("/app/user")
        assert response.status_code in {401, 403}
