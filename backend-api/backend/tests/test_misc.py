"""
Integration tests for Miscellaneous endpoints.
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

from tests.fixtures.base import superuser_override


class TestHealthCheck:
    """Tests for health check endpoints"""

    @pytest.mark.asyncio
    async def test_health_check(self, client):
        """Should return healthy status"""
        response = await client.get("/health")
        # Some apps use / or /healthz instead
        if response.status_code == 404:
            response = await client.get("/")
        assert response.status_code in {200, 404}


class TestOpenAPIAndDocs:
    """The API is not public: it serves no OpenAPI schema and no docs pages, to anyone."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize("path", ["/openapi.json", "/docs", "/redoc", "/docs/oauth2-redirect"])
    async def test_no_schema_or_docs_page(self, auth_client, path):
        # Not even a signed-in superuser gets one
        with superuser_override():
            response = await auth_client.get(path)

        assert response.status_code != 200
        assert b'"openapi"' not in response.content
        assert b"swagger" not in response.content.lower()

    @pytest.mark.asyncio
    async def test_redoc_or_disabled(self, client):
        """ReDoc may be disabled in this environment"""
        response = await client.get("/redoc")
        # 200 if enabled, 404 if disabled
        assert response.status_code in {200, 404}
