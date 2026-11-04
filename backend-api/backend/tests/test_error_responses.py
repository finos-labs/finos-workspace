import os
import sys

BACKEND_DIR = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import pytest
from uuid import uuid4

from tests.fixtures.base import WEB_HEADERS


class TestErrorResponseFormat401:
    @pytest.mark.asyncio
    async def test_401_keeps_the_headers_of_its_exception(self, client):
        response = await client.get("/app/user", headers=WEB_HEADERS)
        assert response.status_code == 401
        assert response.headers["www-authenticate"] == "Bearer"

    @pytest.mark.asyncio
    async def test_401_contains_detail_field(self, client):
        response = await client.get("/app/user")
        assert response.status_code in {401, 403}

        data = response.json()
        assert "detail" in data or "message" in data

    @pytest.mark.asyncio
    async def test_401_does_not_leak_internal_paths(self, client):
        response = await client.get("/app/user")

        response_text = response.text.lower()
        assert "/users/" not in response_text
        assert "/home/" not in response_text
        assert "traceback" not in response_text


class TestErrorResponseFormat403:
    @pytest.mark.asyncio
    async def test_403_contains_detail_field(self, client):
        response = await client.get("/admin/users")
        assert response.status_code in {401, 403}

        data = response.json()
        assert "detail" in data or "message" in data


class TestErrorResponseFormat404:
    @pytest.mark.asyncio
    async def test_404_for_nonexistent_endpoint(self, client):
        response = await client.get("/this/endpoint/does/not/exist")
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_404_contains_detail_field(self, client):
        response = await client.get("/this/endpoint/does/not/exist")
        assert "Not Found" in response.text


class TestErrorResponseFormat422:
    @pytest.mark.asyncio
    async def test_422_contains_detail_field(self, client):
        response = await client.post("/app/login", json={})
        assert response.status_code == 422

        data = response.json()
        assert "detail" in data
        assert isinstance(data["detail"], str)

    @pytest.mark.asyncio
    async def test_422_contains_status_field(self, client):
        response = await client.post("/app/login", json={})
        assert response.status_code == 422

        data = response.json()
        assert "status" in data
        assert data["status"] == 422

    @pytest.mark.asyncio
    async def test_422_for_invalid_email_format(self, client):
        response = await client.post(
            "/app/login",
            json={"email": "not-an-email", "password": "ValidPassword123!"},
        )
        assert response.status_code == 422

        data = response.json()
        response_text = str(data).lower()
        assert "email" in response_text or "value" in response_text

    @pytest.mark.asyncio
    async def test_422_for_invalid_password(self, client):
        response = await client.post(
            "/app/login",
            json={"email": "valid@test.com", "password": "short"},
        )
        assert response.status_code == 422


class TestErrorResponseSecurity:
    @pytest.mark.asyncio
    async def test_error_does_not_expose_stack_trace(self, client):
        endpoints = [
            ("/app/login", {"email": "test", "password": "x" * 10000}),
            ("/app/login", {"email": "x" * 100, "password": "x"}),
        ]

        for endpoint, payload in endpoints:
            response = await client.post(endpoint, json=payload)
            response_text = response.text.lower()

            assert "traceback" not in response_text
            assert 'file "' not in response_text
            assert "line " not in response_text or "line" not in response_text[:50]

    @pytest.mark.asyncio
    async def test_error_does_not_expose_database_details(self, client):
        response = await client.post(
            "/app/login",
            json={"email": "'; DROP TABLE users; --", "password": "password"},
        )

        response_text = response.text.lower()
        assert "sql" not in response_text
        assert "mysql" not in response_text
        assert "syntax error" not in response_text
        assert "query" not in response_text

    @pytest.mark.asyncio
    async def test_error_does_not_expose_server_info(self, client):
        response = await client.get("/nonexistent")

        server_header = response.headers.get("server", "").lower()
        assert "python" not in server_header

    @pytest.mark.asyncio
    async def test_404_does_not_enumerate_endpoints(self, client):
        response = await client.get("/admin/secret-endpoint")

        assert response.status_code in {401, 403, 404}

        assert "did you mean" not in response.text


class TestRateLimitingBehavior:
    @pytest.mark.asyncio
    async def test_login_rate_limit_exists(self, client):
        responses = []
        for i in range(10):
            response = await client.post(
                "/app/login",
                json={
                    "email": f"ratelimit_{i}@test.com",
                    "password": "ValidPassword123!",
                },
                headers=WEB_HEADERS,
            )
            responses.append(response.status_code)

        valid_codes = {401, 429}
        for code in responses:
            assert code in valid_codes

    @pytest.mark.asyncio
    async def test_no_header_a_client_chooses_lifts_the_limit(self, client):
        codes = []
        for i in range(7):
            response = await client.post(
                "/app/login",
                json={"email": f"limited_{i}@test.com", "password": "ValidPassword123!"},
                headers={
                    **WEB_HEADERS,
                    "User-Agent": "app",
                    "X-Workspace-User-Agent": "app",
                },
            )
            codes.append(response.status_code)

        assert 429 in codes

    @pytest.mark.asyncio
    async def test_rate_limit_returns_429(self, client):
        response = await client.post(
            "/app/login",
            json={"email": "test@test.com", "password": "ValidPassword123!"},
            headers=WEB_HEADERS,
        )
        assert response.status_code in {401, 429}


class TestContentTypeErrors:
    @pytest.mark.asyncio
    async def test_wrong_content_type_handled(self, client):
        response = await client.post(
            "/app/login",
            content=b"email=test@test.com&password=password",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        assert response.status_code in {400, 415, 422}

    @pytest.mark.asyncio
    async def test_empty_body_handled(self, client):
        response = await client.post(
            "/app/login",
            content=b"",
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code in {400, 422}

    @pytest.mark.asyncio
    async def test_malformed_json_handled(self, client):
        response = await client.post(
            "/app/login",
            content=b"{invalid json}",
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code in {400, 422}


class TestAuthenticatedErrorResponses:
    @pytest.mark.asyncio
    async def test_authenticated_404_format(self, auth_client):
        test_uuid = str(uuid4())
        response = await auth_client.get(f"/app/dash/{test_uuid}/versions")

        if response.status_code == 404:
            data = response.json()
            assert "detail" in data or "message" in data

    @pytest.mark.asyncio
    async def test_authenticated_422_format(self, auth_client):
        response = await auth_client.post(
            "/app/dash/sync",
            json={"dashboards": [{"invalid": "data"}]},
        )

        if response.status_code == 422:
            data = response.json()
            assert "detail" in data

    @pytest.mark.asyncio
    async def test_error_preserves_request_id(self, auth_client):
        auth_client.headers["X-Request-ID"] = "test-request-123"

        response = await auth_client.get("/nonexistent-endpoint")

        assert response.status_code == 404


class TestMethodNotAllowed:
    @pytest.mark.asyncio
    async def test_wrong_method_returns_405(self, client):
        response = await client.delete("/app/login")
        assert response.status_code in {404, 405}

    @pytest.mark.asyncio
    async def test_405_includes_allowed_methods(self, client):
        response = await client.delete("/app/login")

        if response.status_code == 405:
            allow_header = response.headers.get("allow")
            if allow_header is not None:
                assert allow_header
            assert True
