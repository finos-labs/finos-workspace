"""
Output Validation Tests

Tests to ensure API responses:
- Follow expected schemas
- Don't leak sensitive data (passwords, tokens, etc.)
- Have proper data types
- Contain expected fields
"""

from datetime import datetime
from uuid import UUID, uuid4

import pytest

# =============================================================================
# ERROR RESPONSE VALIDATION
# =============================================================================


class TestErrorResponseValidation:
    """Tests for error response format"""

    @pytest.mark.asyncio
    async def test_404_error_format(self, auth_client):
        """404 errors should have consistent format"""
        fake_uuid = str(uuid4())
        response = await auth_client.get(f"/app/dashboard/{fake_uuid}")
        if response.status_code == 404:
            assert "Not Found" in response.text

    @pytest.mark.asyncio
    async def test_422_validation_error_format(self, admin_client):
        """422 validation errors should have proper format"""
        # Use admin create-user endpoint with invalid email to get 422
        response = await admin_client.post(
            "/admin/create-user",
            json={"email": "not-a-valid-email"},  # Invalid email format
        )
        # Should return 422 for email validation error
        assert response.status_code == 422
        data = response.json()
        assert "detail" in data

    @pytest.mark.asyncio
    async def test_401_error_no_stacktrace(self, auth_client, client):
        """401 errors should not expose stack traces"""
        # Make a request without auth to trigger 401
        no_auth_response = await client.get("/app/user")
        assert no_auth_response.status_code in {401, 403}
        no_auth_data = no_auth_response.json()
        no_auth_data_str = str(no_auth_data)
        # Should not expose internal paths or stack traces
        assert "Traceback" not in no_auth_data_str
        assert ".py:line" not in no_auth_data_str.lower()
        # Alternative: just verify that valid auth doesn't leak stack traces
        response = await auth_client.get("/app/user")
        assert response.status_code == 200
        data = response.json()
        data_str = str(data)
        # Should not expose internal paths or stack traces
        assert "Traceback" not in data_str
        assert ".py:line" not in data_str.lower()

    @pytest.mark.asyncio
    async def test_error_no_database_info(self, auth_client):
        """Error responses should not expose database details"""
        # Try to update with invalid data
        response = await auth_client.put(
            "/user",
            json={
                "old_password": "'; DROP TABLE users; --",
                "new_password": "'; DROP TABLE users; --",
            },
        )
        data_str = str(response.json()).lower()
        # Should not expose database info
        assert "mysql" not in data_str
        assert "postgresql" not in data_str
        assert "sqlite" not in data_str
        assert "sqlalchemy" not in data_str


# =============================================================================
# LIST ENDPOINT OUTPUT VALIDATION
# =============================================================================


class TestListOutputValidation:
    """Tests for list endpoint output validation"""

    @pytest.mark.asyncio
    async def test_dashboard_sync_carries_no_secrets(self, auth_client):
        """The dashboard sync should not carry password or token material"""
        response = await auth_client.get("/app/dash/validate-and-sync")
        assert response.status_code == 200
        data_str = str(response.json()).lower()
        secrets = ("password", "totp_secret", "openaiapikey", "perplexityapikey")
        for secret in secrets:
            assert secret not in data_str

    @pytest.mark.asyncio
    async def test_data_connectors_list_proper_format(self, auth_client):
        """The data-connectors list should be a list"""
        response = await auth_client.get("/app/data-connectors/api-source")
        assert response.status_code == 200
        assert isinstance(response.json(), list)


# =============================================================================
# ADMIN OUTPUT VALIDATION (for admin users)
# =============================================================================


class TestAdminOutputValidation:
    """Tests for admin endpoint output validation"""

    @pytest.mark.asyncio
    async def test_admin_users_list_no_password_hashes(self, admin_client):
        """Admin users list should not expose password hashes"""
        response = await admin_client.get("/admin/users")
        if response.status_code == 200:
            data = response.json()
            data_str = str(data).lower()
            # Even admin shouldn't see password hashes
            assert "bcrypt" not in data_str
            assert "$2b$" not in data_str
            assert "password_hash" not in data_str

    @pytest.mark.asyncio
    async def test_admin_roles_list_format(self, admin_client):
        """Admin roles list should have proper format"""
        response = await admin_client.get("/admin/roles")
        if response.status_code == 200:
            data = response.json()
            # Should be a list
            assert isinstance(data, list)


# =============================================================================
# SENSITIVE DATA LEAK PREVENTION
# =============================================================================


class TestSensitiveDataLeakPrevention:
    """Tests to ensure sensitive data is not leaked in responses"""

    @pytest.mark.asyncio
    async def test_no_aws_credentials_in_response(self, auth_client):
        """Responses should never contain AWS credentials"""
        endpoints = [
            "/app/user",
            "/app/dash/validate-and-sync",
            "/app/data-connectors/api-source",
        ]
        for endpoint in endpoints:
            response = await auth_client.get(endpoint)
            assert response.status_code == 200, endpoint
            data_str = str(response.json())
            assert "AKIA" not in data_str  # AWS access key prefix
            assert "aws_secret" not in data_str.lower()

    @pytest.mark.asyncio
    async def test_no_internal_ips_in_response(self, auth_client):
        """Responses should not expose internal IPs"""
        response = await auth_client.get("/app/user")
        assert response.status_code == 200
        data_str = str(response.json())
        # Common internal IP patterns
        assert "192.168." not in data_str
        assert "10.0." not in data_str
        assert "172.16." not in data_str

    @pytest.mark.asyncio
    async def test_no_environment_variables_in_error(self, client):
        """Error responses should not expose environment variables"""
        response = await client.post(
            "/login",
            json={
                "email": "test@test.com",
                "password": "x" * 10000,
            },  # Trigger potential error
        )
        data_str = (
            str(response.json())
            if "application/json" in response.headers.get("content-type")
            else response.text
        )
        # Should not expose env vars
        assert "DATABASE_URL" not in data_str
        assert "SECRET_KEY" not in data_str
        assert "API_KEY" not in data_str

    @pytest.mark.asyncio
    async def test_no_jwt_secret_in_response(self, auth_client):
        """Responses should never contain JWT secret"""
        response = await auth_client.get("/app/user")
        assert response.status_code == 200
        data_str = str(response.json())
        # JWT secret patterns
        assert "jwt_secret" not in data_str.lower()
        assert "secret_key" not in data_str.lower()


# =============================================================================
# RESPONSE HEADER VALIDATION
# =============================================================================


class TestResponseHeaderValidation:
    """Tests for response header security"""

    @pytest.mark.asyncio
    async def test_content_type_header_present(self, auth_client):
        """Responses should have Content-Type header"""
        response = await auth_client.get("/app/user")
        assert response.status_code == 200
        assert "application/json" in response.headers["content-type"]

    @pytest.mark.asyncio
    async def test_no_server_version_leak(self, client):
        """Server header should not expose version info"""
        response = await client.get("/health")
        assert response.status_code == 200
        # Check various server headers
        server_header = response.headers.get("server", "")
        x_powered_by = response.headers.get("x-powered-by", "")
        # Should not expose detailed version info
        assert "uvicorn" not in server_header.lower() or "/" not in server_header
        assert "python" not in x_powered_by.lower()


# =============================================================================
# DATA TYPE VALIDATION
# =============================================================================


class TestDataTypeValidation:
    """Tests for correct data types in responses"""

    @pytest.mark.asyncio
    async def test_list_fields_are_lists(self, auth_client):
        """List fields should be actual lists"""
        response = await auth_client.get("/app/user")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data["api_sources"], list)
        assert isinstance(data["file_widgets"], list)

    @pytest.mark.asyncio
    async def test_timestamp_fields_format(self, auth_client):
        """Timestamp fields should be ISO format strings"""
        response = await auth_client.get("/app/user")
        assert response.status_code == 200
        datetime.fromisoformat(response.json()["expiration_date"])

    @pytest.mark.asyncio
    async def test_uuid_fields_format(self, auth_client):
        """UUID fields should have proper format"""
        response = await auth_client.get("/app/user")
        assert response.status_code == 200
        UUID(response.json()["uuid"])
