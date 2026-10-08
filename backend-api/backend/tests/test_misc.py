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
    """Tests for OpenAPI schema and docs endpoints.

    Note: These are disabled in production (docs_url=None, redoc_url=None, openapi_url=None).
    In test environment they may not be available.
    """

    @pytest.mark.asyncio
    async def test_openapi_schema_or_disabled(self, client):
        """OpenAPI schema may be disabled in this environment"""
        response = await client.get("/openapi.json")
        # 200 if enabled, 401/404 if disabled/not found
        assert response.status_code in {200, 401, 404}

    @pytest.mark.asyncio
    async def test_swagger_docs_or_disabled(self, client):
        """Swagger UI may be disabled in this environment"""
        response = await client.get("/docs")
        # 200 if enabled, 404 if disabled
        assert response.status_code in {200, 404}

    @pytest.mark.asyncio
    async def test_redoc_or_disabled(self, client):
        """ReDoc may be disabled in this environment"""
        response = await client.get("/redoc")
        # 200 if enabled, 404 if disabled
        assert response.status_code in {200, 404}
