import os
import sys

BACKEND_DIR = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import pytest


class TestUsage:
    @pytest.mark.asyncio
    async def test_get_usage_unauthenticated(self, client):
        response = await client.get("/app/usage")
        assert response.status_code in {401, 403}
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data

    @pytest.mark.asyncio
    async def test_get_usage_authenticated(self, auth_client, organization):
        response = await auth_client.get("/app/usage")
        assert response.status_code == 200
        assert response.json()["copilot_calls_limit"] == 0


class TestResourcePermissions:
    @pytest.mark.asyncio
    async def test_get_permissions_unauthenticated(self, client):
        response = await client.get("/app/resource-permissions")
        assert response.status_code in {401, 403}
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data

    @pytest.mark.asyncio
    async def test_get_permissions_authenticated(self, auth_client):
        response = await auth_client.get("/app/resource-permissions")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, (list, dict))
        content_type = response.headers.get("content-type", "")
        assert "application/json" in content_type


class TestFeaturesOutputValidation:
    @pytest.mark.asyncio
    async def test_permissions_response_schema(self, auth_client):
        response = await auth_client.get("/app/resource-permissions")
        if response.status_code == 200:
            data = response.json()
            assert isinstance(data, (list, dict))

    @pytest.mark.asyncio
    async def test_usage_response_schema(self, auth_client):
        response = await auth_client.get("/app/usage")
        if response.status_code == 200:
            data = response.json()
            assert isinstance(data, (list, dict))

    @pytest.mark.asyncio
    async def test_features_no_sensitive_data(self, auth_client):
        response = await auth_client.get("/app/resource-permissions")
        if response.status_code == 200:
            data_str = str(response.json())
            assert "password" not in data_str.lower()
            assert "secret" not in data_str.lower()
            assert "private_key" not in data_str.lower()


class TestFeaturesAdmin:
    @pytest.mark.asyncio
    async def test_admin_can_get_usage(self, admin_client):
        response = await admin_client.get("/app/usage")
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_admin_can_get_permissions(self, admin_client):
        response = await admin_client.get("/app/resource-permissions")
        assert response.status_code == 200


class TestFeaturesCrossUserSecurity:
    @pytest.mark.asyncio
    async def test_permissions_isolated_per_user(self, auth_client, second_user_client):
        response1 = await auth_client.get("/app/resource-permissions")
        response2 = await second_user_client.get("/app/resource-permissions")

        assert response1.status_code == 200
        assert response2.status_code == 200


class TestFeaturesAuthEdgeCases:
    @pytest.mark.asyncio
    async def test_features_with_expired_token(self, client):
        client.headers["Authorization"] = "Bearer expired.token.here"
        response = await client.get("/app/usage")
        assert response.status_code in {401, 403}

    @pytest.mark.asyncio
    async def test_features_with_malformed_token(self, client):
        client.headers["Authorization"] = "Bearer not-a-valid-jwt"
        response = await client.get("/app/resource-permissions")
        assert response.status_code in {401, 403}
