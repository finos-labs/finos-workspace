from datetime import datetime
from uuid import UUID, uuid4

import pytest


class TestErrorResponseValidation:
    @pytest.mark.asyncio
    async def test_404_error_format(self, auth_client):
        fake_uuid = str(uuid4())
        response = await auth_client.get(f"/app/dashboard/{fake_uuid}")
        if response.status_code == 404:
            assert "Not Found" in response.text

    @pytest.mark.asyncio
    async def test_422_validation_error_format(self, admin_client):
        response = await admin_client.post(
            "/admin/create-user",
            json={"email": "not-a-valid-email"},
        )
        assert response.status_code == 422
        data = response.json()
        assert "detail" in data

    @pytest.mark.asyncio
    async def test_401_error_no_stacktrace(self, auth_client, client):
        no_auth_response = await client.get("/app/user")
        assert no_auth_response.status_code in {401, 403}
        no_auth_data = no_auth_response.json()
        no_auth_data_str = str(no_auth_data)
        assert "Traceback" not in no_auth_data_str
        assert ".py:line" not in no_auth_data_str.lower()
        response = await auth_client.get("/app/user")
        assert response.status_code == 200
        data = response.json()
        data_str = str(data)
        assert "Traceback" not in data_str
        assert ".py:line" not in data_str.lower()

    @pytest.mark.asyncio
    async def test_error_no_database_info(self, auth_client):
        response = await auth_client.put(
            "/user",
            json={
                "old_password": "'; DROP TABLE users; --",
                "new_password": "'; DROP TABLE users; --",
            },
        )
        data_str = str(response.json()).lower()
        assert "mysql" not in data_str
        assert "postgresql" not in data_str
        assert "sqlite" not in data_str
        assert "sqlalchemy" not in data_str


class TestListOutputValidation:
    @pytest.mark.asyncio
    async def test_dashboard_sync_carries_no_secrets(self, auth_client):
        response = await auth_client.get("/app/dash/validate-and-sync")
        assert response.status_code == 200
        data_str = str(response.json()).lower()
        secrets = ("password", "totp_secret", "openaiapikey", "perplexityapikey")
        for secret in secrets:
            assert secret not in data_str

    @pytest.mark.asyncio
    async def test_data_connectors_list_proper_format(self, auth_client):
        response = await auth_client.get("/app/data-connectors/api-source")
        assert response.status_code == 200
        assert isinstance(response.json(), list)


class TestAdminOutputValidation:
    @pytest.mark.asyncio
    async def test_admin_users_list_no_password_hashes(self, admin_client):
        response = await admin_client.get("/admin/users")
        if response.status_code == 200:
            data = response.json()
            data_str = str(data).lower()
            assert "bcrypt" not in data_str
            assert "$2b$" not in data_str
            assert "password_hash" not in data_str

    @pytest.mark.asyncio
    async def test_admin_roles_list_format(self, admin_client):
        response = await admin_client.get("/admin/roles")
        if response.status_code == 200:
            data = response.json()
            assert isinstance(data, list)


class TestSensitiveDataLeakPrevention:
    @pytest.mark.asyncio
    async def test_no_aws_credentials_in_response(self, auth_client):
        endpoints = [
            "/app/user",
            "/app/dash/validate-and-sync",
            "/app/data-connectors/api-source",
        ]
        for endpoint in endpoints:
            response = await auth_client.get(endpoint)
            assert response.status_code == 200, endpoint
            data_str = str(response.json())
            assert "AKIA" not in data_str
            assert "aws_secret" not in data_str.lower()

    @pytest.mark.asyncio
    async def test_no_internal_ips_in_response(self, auth_client):
        response = await auth_client.get("/app/user")
        assert response.status_code == 200
        data_str = str(response.json())
        assert "192.168." not in data_str
        assert "10.0." not in data_str
        assert "172.16." not in data_str

    @pytest.mark.asyncio
    async def test_no_environment_variables_in_error(self, client):
        response = await client.post(
            "/app/login",
            json={
                "email": "test@test.com",
                "password": "x" * 10000,
            },
        )
        data_str = (
            str(response.json())
            if "application/json" in response.headers.get("content-type")
            else response.text
        )
        assert "DATABASE_URL" not in data_str
        assert "SECRET_KEY" not in data_str
        assert "API_KEY" not in data_str

    @pytest.mark.asyncio
    async def test_no_jwt_secret_in_response(self, auth_client):
        response = await auth_client.get("/app/user")
        assert response.status_code == 200
        data_str = str(response.json())
        assert "jwt_secret" not in data_str.lower()
        assert "secret_key" not in data_str.lower()


class TestResponseHeaderValidation:
    @pytest.mark.asyncio
    async def test_content_type_header_present(self, auth_client):
        response = await auth_client.get("/app/user")
        assert response.status_code == 200
        assert "application/json" in response.headers["content-type"]

    @pytest.mark.asyncio
    async def test_no_server_version_leak(self, client):
        response = await client.get("/health")
        assert response.status_code == 200
        server_header = response.headers.get("server", "")
        x_powered_by = response.headers.get("x-powered-by", "")
        assert "uvicorn" not in server_header.lower() or "/" not in server_header
        assert "python" not in x_powered_by.lower()


class TestDataTypeValidation:
    @pytest.mark.asyncio
    async def test_list_fields_are_lists(self, auth_client):
        response = await auth_client.get("/app/user")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data["api_sources"], list)
        assert isinstance(data["file_widgets"], list)

    @pytest.mark.asyncio
    async def test_timestamp_fields_format(self, auth_client):
        response = await auth_client.get("/app/user")
        assert response.status_code == 200
        datetime.fromisoformat(response.json()["expiration_date"])

    @pytest.mark.asyncio
    async def test_uuid_fields_format(self, auth_client):
        response = await auth_client.get("/app/user")
        assert response.status_code == 200
        UUID(response.json()["uuid"])
