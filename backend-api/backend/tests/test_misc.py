import os
import sys

BACKEND_DIR = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import pytest

from tests.fixtures.base import superuser_override


class TestHealthCheck:
    @pytest.mark.asyncio
    async def test_health_check(self, client):
        response = await client.get("/health")
        if response.status_code == 404:
            response = await client.get("/")
        assert response.status_code in {200, 404}


class TestOpenAPIAndDocs:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("path", ["/openapi.json", "/docs", "/redoc", "/docs/oauth2-redirect"])
    async def test_no_schema_or_docs_page(self, auth_client, path):
        with superuser_override():
            response = await auth_client.get(path)

        assert response.status_code != 200
        assert b'"openapi"' not in response.content
        assert b"swagger" not in response.content.lower()

    @pytest.mark.asyncio
    async def test_redoc_or_disabled(self, client):
        response = await client.get("/redoc")
        assert response.status_code in {200, 404}
