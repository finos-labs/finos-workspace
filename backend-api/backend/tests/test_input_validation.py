import os
import sys

BACKEND_DIR = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import pytest
from uuid import uuid4
from sqlalchemy import text

from tests.fixtures.base import WEB_HEADERS


class TestEmailValidation:
    @pytest.mark.asyncio
    async def test_email_invalid_format_no_at(self, client):
        response = await client.post(
            "/app/login",
            json={"email": "invalidemail.com", "password": "ValidPassword123!"},
        )
        assert response.status_code == 422
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data

    @pytest.mark.asyncio
    async def test_email_invalid_format_no_domain(self, client):
        response = await client.post(
            "/app/login",
            json={"email": "invalid@", "password": "ValidPassword123!"},
        )
        assert response.status_code == 422
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data

    @pytest.mark.asyncio
    async def test_email_invalid_format_spaces(self, client):
        response = await client.post(
            "/app/login",
            json={"email": "invalid email@test.com", "password": "ValidPassword123!"},
        )
        assert response.status_code == 422
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data

    @pytest.mark.asyncio
    async def test_email_sql_injection_in_login(self, client, db_session):
        malicious_emails = [
            "test@test.com'; DROP TABLE user; --",
            "test@test.com' OR '1'='1",
            "' UNION SELECT * FROM user --@test.com",
        ]

        for email in malicious_emails:
            response = await client.post(
                "/app/login",
                json={"email": email, "password": "ValidPassword123!"},
            )
            assert response.status_code in {400, 401, 422}, f"Failed for email: {email}"

        result = await db_session.execute(text("SELECT COUNT(*) FROM user"))
        count = result.scalar()
        assert count is not None

    @pytest.mark.asyncio
    async def test_email_xss_attempt_in_login(self, client):
        xss_emails = [
            "<script>alert('xss')</script>@test.com",
            "test@test.com<img src=x onerror=alert('xss')>",
            "javascript:alert('xss')@test.com",
        ]

        for email in xss_emails:
            response = await client.post(
                "/app/login",
                json={"email": email, "password": "ValidPassword123!"},
            )
            assert response.status_code in {400, 401, 422}, f"Failed for email: {email}"

    @pytest.mark.asyncio
    async def test_email_unicode_handling(self, client):
        unicode_emails = [
            "tëst@test.com",
            "测试@test.com",
            "test@tëst.com",
        ]

        for email in unicode_emails:
            response = await client.post(
                "/app/login",
                json={"email": email, "password": "ValidPassword123!"},
            )
            assert response.status_code in {400, 401, 422}, f"Failed for email: {email}"


class TestPasswordValidation:
    @pytest.mark.asyncio
    async def test_password_min_length_7_chars_fails(self, client):
        response = await client.post(
            "/app/login",
            json={
                "email": f"pwtest_{uuid4().hex[:8]}@example.com",
                "password": "Short1!",
            },
        )
        assert response.status_code == 422
        data = response.json()
        assert "detail" in data

    @pytest.mark.asyncio
    async def test_password_min_length_8_chars_succeeds(self, client):
        response = await client.post(
            "/app/login",
            json={
                "email": f"pwtest_{uuid4().hex[:8]}@example.com",
                "password": "Valid12!",
            },
            headers=WEB_HEADERS,
        )
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_password_empty_fails(self, client):
        response = await client.post(
            "/app/login",
            json={
                "email": f"pwtest_{uuid4().hex[:8]}@example.com",
                "password": "",
            },
        )
        assert response.status_code == 422
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data

    @pytest.mark.asyncio
    async def test_password_whitespace_only_fails(self, client):
        response = await client.post(
            "/app/login",
            json={
                "email": f"pwtest_{uuid4().hex[:8]}@example.com",
                "password": "        ",
            },
        )
        assert response.status_code in {400, 401, 422}

    @pytest.mark.asyncio
    async def test_password_unicode_characters(self, client):
        response = await client.post(
            "/app/login",
            json={
                "email": f"pwtest_{uuid4().hex[:8]}@example.com",
                "password": "Pässwörd123!",
            },
        )
        assert response.status_code in {400, 401, 422}

    @pytest.mark.asyncio
    async def test_password_very_long(self, client):
        long_password = "A" * 1000 + "1!"
        response = await client.post(
            "/app/login",
            json={
                "email": f"pwtest_{uuid4().hex[:8]}@example.com",
                "password": long_password,
            },
        )
        assert response.status_code in {400, 401, 422}


class TestUUIDValidation:
    @pytest.mark.asyncio
    async def test_invalid_uuid_format_returns_422(self, auth_client):
        invalid_uuids = [
            "not-a-uuid",
            "12345",
            "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
            "",
        ]

        for uuid in invalid_uuids:
            response = await auth_client.get(f"/app/dash/{uuid}/shares")
            assert response.status_code in {400, 422, 404}, f"Failed for UUID: {uuid}"

    @pytest.mark.asyncio
    async def test_uuid_sql_injection(self, auth_client, db_session):
        malicious_uuids = [
            "'; DROP TABLE dashboard; --",
            "' OR '1'='1",
            "1; DELETE FROM user WHERE 1=1; --",
        ]

        for uuid in malicious_uuids:
            response = await auth_client.delete(f"/app/files/{uuid}")
            assert response.status_code in {400, 404, 422}, f"Failed for UUID: {uuid}"

        result = await db_session.execute(text("SELECT COUNT(*) FROM user"))
        count = result.scalar()
        assert count is not None

    @pytest.mark.asyncio
    async def test_valid_uuid_nonexistent_resource(self, auth_client):
        valid_uuid = str(uuid4())
        response = await auth_client.get(f"/app/dash/{valid_uuid}/shares")
        assert response.status_code in {200, 400, 404}


class TestJSONPayloadValidation:
    @pytest.mark.asyncio
    async def test_missing_required_fields(self, client):
        response = await client.post("/app/login", json={})
        assert response.status_code == 422
        data = response.json()
        assert "detail" in data

    @pytest.mark.asyncio
    async def test_extra_fields_handling(self, auth_client):
        response = await auth_client.put(
            "/user",
            json={
                "old_password": "OldPassword123!",
                "new_password": "NewPassword123!",
                "unknown_field": "should_be_ignored",
                "another_unknown": 12345,
            },
        )
        assert response.status_code in {200, 422}

    @pytest.mark.asyncio
    async def test_wrong_type_for_field(self, client):
        response = await client.post(
            "/app/login",
            json={
                "email": 12345,
                "password": ["array", "not", "string"],
            },
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_null_values_for_required_fields(self, client):
        response = await client.post(
            "/app/login",
            json={"email": None, "password": None},
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_deeply_nested_json(self, auth_client):
        nested = {"level": 0}
        current = nested
        for i in range(20):
            current["nested"] = {"level": i + 1}
            current = current["nested"]

        response = await auth_client.post(
            "/app/display-settings",
            json=nested,
        )
        assert response.status_code in {200, 400, 422}

    @pytest.mark.asyncio
    async def test_large_array_in_payload(self, auth_client):
        large_array = list(range(100))

        response = await auth_client.post(
            "/app/display-settings",
            json={"gridCorners": large_array},
        )
        assert response.status_code in {200, 400, 413, 422}

    @pytest.mark.asyncio
    async def test_invalid_json_syntax(self, client):
        response = await client.post(
            "/app/login",
            content=b'{"email": "test@test.com", "password": }',
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code in {400, 422}


class TestContentTypeValidation:
    @pytest.mark.asyncio
    async def test_missing_content_type_for_json_endpoint(self, client):
        response = await client.post(
            "/app/login",
            content=b'{"email": "test@test.com", "password": "password123"}',
        )
        assert response.status_code in {200, 400, 401, 415, 422}

    @pytest.mark.asyncio
    async def test_wrong_content_type(self, client):
        response = await client.post(
            "/app/login",
            content=b'{"email": "test@test.com", "password": "password123"}',
            headers={"Content-Type": "text/plain"},
        )
        assert response.status_code in {400, 415, 422}


class TestPathParameterValidation:
    @pytest.mark.asyncio
    async def test_path_traversal_attempt(self, auth_client):
        malicious_paths = [
            "../../../etc/passwd",
            "..\\..\\..\\windows\\system32",
            "%2e%2e%2f%2e%2e%2f",
        ]

        for path in malicious_paths:
            response = await auth_client.get(f"/app/files/{path}")
            assert response.status_code in {400, 404, 422}, f"Failed for path: {path}"

    @pytest.mark.asyncio
    async def test_null_byte_injection(self, auth_client):
        response = await auth_client.get("/app/files/test%00.txt")
        assert response.status_code in {400, 404, 422}
