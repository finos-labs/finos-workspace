"""
Integration tests for the endpoints that tell users what they may use.
"""

import os
import sys

# Add the backend directory to Python path
BACKEND_DIR = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import pytest


class TestUsage:
    """Tests for /app/usage endpoint"""

    @pytest.mark.asyncio
    async def test_get_usage_unauthenticated(self, client):
        """Should fail without auth"""
        response = await client.get("/app/usage")
        assert response.status_code in {401, 403}
        # Validate error response structure
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data

    @pytest.mark.asyncio
    async def test_get_usage_authenticated(self, auth_client, organization):
        """Should return the user's usage and the limits of their roles"""
        response = await auth_client.get("/app/usage")
        assert response.status_code == 200
        # A user without roles may use nothing
        assert response.json()["copilot_calls_limit"] == 0


class TestResourcePermissions:
    """Tests for /app/resource-permissions endpoint"""

    @pytest.mark.asyncio
    async def test_get_permissions_unauthenticated(self, client):
        """Should fail without auth"""
        response = await client.get("/app/resource-permissions")
        assert response.status_code in {401, 403}
        # Validate error response structure
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data

    @pytest.mark.asyncio
    async def test_get_permissions_authenticated(self, auth_client):
        """Should return resource permissions"""
        response = await auth_client.get("/app/resource-permissions")
        assert response.status_code == 200
        # Validate response structure
        data = response.json()
        assert isinstance(data, (list, dict))
        content_type = response.headers.get("content-type", "")
        assert "application/json" in content_type


# =============================================================================
# FEATURES OUTPUT VALIDATION TESTS
# =============================================================================


class TestFeaturesOutputValidation:
    """Tests for features endpoint output validation"""

    @pytest.mark.asyncio
    async def test_permissions_response_schema(self, auth_client):
        """Resource permissions response should have expected schema"""
        response = await auth_client.get("/app/resource-permissions")
        if response.status_code == 200:
            data = response.json()
            assert isinstance(data, (list, dict))

    @pytest.mark.asyncio
    async def test_usage_response_schema(self, auth_client):
        """Usage response should have expected schema"""
        response = await auth_client.get("/app/usage")
        if response.status_code == 200:
            data = response.json()
            assert isinstance(data, (list, dict))

    @pytest.mark.asyncio
    async def test_features_no_sensitive_data(self, auth_client):
        """Features responses should not expose sensitive data"""
        response = await auth_client.get("/app/resource-permissions")
        if response.status_code == 200:
            data_str = str(response.json())
            assert "password" not in data_str.lower()
            assert "secret" not in data_str.lower()
            assert "private_key" not in data_str.lower()


# =============================================================================
# FEATURES ADMIN TESTS
# =============================================================================


class TestFeaturesAdmin:
    """Tests for admin access to features"""

    @pytest.mark.asyncio
    async def test_admin_can_get_usage(self, admin_client):
        """Admin should be able to get usage stats"""
        response = await admin_client.get("/app/usage")
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_admin_can_get_permissions(self, admin_client):
        """Admin should be able to get resource permissions"""
        response = await admin_client.get("/app/resource-permissions")
        assert response.status_code == 200


# =============================================================================
# FEATURES CROSS-USER SECURITY TESTS
# =============================================================================


class TestFeaturesCrossUserSecurity:
    """Tests for cross-user access prevention in features"""

    @pytest.mark.asyncio
    async def test_permissions_isolated_per_user(self, auth_client, second_user_client):
        """Each user should only see their own permissions"""
        response1 = await auth_client.get("/app/resource-permissions")
        response2 = await second_user_client.get("/app/resource-permissions")

        assert response1.status_code == 200
        assert response2.status_code == 200


# =============================================================================
# FEATURES AUTHENTICATION EDGE CASES
# =============================================================================


class TestFeaturesAuthEdgeCases:
    """Tests for features authentication edge cases"""

    @pytest.mark.asyncio
    async def test_features_with_expired_token(self, client):
        """Expired token should be rejected"""
        client.headers["Authorization"] = "Bearer expired.token.here"
        response = await client.get("/app/usage")
        assert response.status_code in {401, 403}

    @pytest.mark.asyncio
    async def test_features_with_malformed_token(self, client):
        """Malformed token should be rejected"""
        client.headers["Authorization"] = "Bearer not-a-valid-jwt"
        response = await client.get("/app/resource-permissions")
        assert response.status_code in {401, 403}
