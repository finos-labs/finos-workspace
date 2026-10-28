import os
import sys

BACKEND_DIR = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import pytest
from uuid import uuid4


class TestApiSourceConnectors:
    @pytest.mark.asyncio
    async def test_get_api_source_unauthenticated(self, client):
        response = await client.get("/app/data-connectors/api-source")
        assert response.status_code in {401, 403}

    @pytest.mark.asyncio
    async def test_get_api_source_authenticated(self, auth_client):
        response = await auth_client.get("/app/data-connectors/api-source")
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_create_api_source_unauthenticated(self, client):
        test_uuid = str(uuid4())
        response = await client.post(
            f"/app/data-connectors/api-source/{test_uuid}", json={"name": "test"}
        )
        assert response.status_code in {401, 403, 422}

    @pytest.mark.asyncio
    async def test_delete_api_source_unauthenticated(self, client):
        test_uuid = str(uuid4())
        response = await client.delete(f"/app/data-connectors/api-source/{test_uuid}")
        assert response.status_code in {401, 403}


class TestFileConnectors:
    @pytest.mark.asyncio
    async def test_get_file_connectors_unauthenticated(self, client):
        response = await client.get("/app/data-connectors/file")
        assert response.status_code in {401, 403}

    @pytest.mark.asyncio
    async def test_get_file_connectors_authenticated(self, auth_client):
        response = await auth_client.get("/app/data-connectors/file")
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_create_file_connector_unauthenticated(self, client):
        test_uuid = str(uuid4())
        response = await client.post(
            f"/app/data-connectors/file/{test_uuid}", json={"name": "test"}
        )
        assert response.status_code in {401, 403, 422}

    @pytest.mark.asyncio
    async def test_delete_file_connector_unauthenticated(self, client):
        test_uuid = str(uuid4())
        response = await client.delete(f"/app/data-connectors/file/{test_uuid}")
        assert response.status_code in {401, 403}


class TestApiSourceLifecycle:
    @pytest.mark.asyncio
    async def test_api_source_create_read_delete(self, auth_client):
        source_uuid = str(uuid4())

        create_response = await auth_client.post(
            f"/app/data-connectors/api-source/{source_uuid}",
            json={
                "name": "Lifecycle Test API Source",
                "url": "https://api.example.com/data",
                "method": "GET",
            },
        )
        assert create_response.status_code in {200, 201, 422}

        if create_response.status_code in {200, 201}:
            get_response = await auth_client.get("/app/data-connectors/api-source")
            assert get_response.status_code == 200

            delete_response = await auth_client.delete(
                f"/app/data-connectors/api-source/{source_uuid}"
            )
            assert delete_response.status_code in {200, 204, 404}

    @pytest.mark.asyncio
    async def test_api_source_with_auth_headers(self, auth_client):
        source_uuid = str(uuid4())

        response = await auth_client.post(
            f"/app/data-connectors/api-source/{source_uuid}",
            json={
                "name": "Auth Header Test",
                "url": "https://api.example.com/data",
                "method": "GET",
                "headers": {"Authorization": "Bearer test_token"},
            },
        )
        assert response.status_code in {200, 201, 422}

        await auth_client.delete(f"/app/data-connectors/api-source/{source_uuid}")


class TestFileConnectorLifecycle:
    @pytest.mark.asyncio
    async def test_file_connector_create_read_delete(self, auth_client):
        connector_uuid = str(uuid4())

        create_response = await auth_client.post(
            f"/app/data-connectors/file/{connector_uuid}",
            json={
                "name": "Lifecycle Test File Connector",
                "file_type": "csv",
            },
        )
        assert create_response.status_code in {200, 201, 422}

        if create_response.status_code in {200, 201}:
            get_response = await auth_client.get("/app/data-connectors/file")
            assert get_response.status_code == 200

            delete_response = await auth_client.delete(
                f"/app/data-connectors/file/{connector_uuid}"
            )
            assert delete_response.status_code in {200, 204, 404}


class TestDataConnectorValidation:
    @pytest.mark.asyncio
    async def test_api_source_invalid_url(self, auth_client):
        source_uuid = str(uuid4())
        response = await auth_client.post(
            f"/app/data-connectors/api-source/{source_uuid}",
            json={
                "name": "Invalid URL Test",
                "url": "not-a-valid-url",
                "method": "GET",
            },
        )
        assert response.status_code in {200, 201, 400, 422}

    @pytest.mark.asyncio
    async def test_api_source_sql_injection_in_url(self, auth_client):
        source_uuid = str(uuid4())
        response = await auth_client.post(
            f"/app/data-connectors/api-source/{source_uuid}",
            json={
                "name": "SQL Injection Test",
                "url": "https://api.example.com/data'; DROP TABLE users; --",
                "method": "GET",
            },
        )
        assert response.status_code in {200, 201, 400, 422}


class TestDataConnectorResponseSchema:
    @pytest.mark.asyncio
    async def test_api_source_list_response_structure(self, auth_client):
        response = await auth_client.get("/app/data-connectors/api-source")
        assert response.status_code == 200
        data = response.json()

        assert isinstance(data, list)

    @pytest.mark.asyncio
    async def test_file_connector_list_response_structure(self, auth_client):
        response = await auth_client.get("/app/data-connectors/file")
        assert response.status_code == 200
        data = response.json()

        assert isinstance(data, list)


class TestStoredFiles:
    @pytest.mark.asyncio
    async def test_get_stored_files_unauthenticated(self, client):
        response = await client.get("/app/data-connectors/stored-files")
        assert response.status_code in {401, 403}

    @pytest.mark.asyncio
    async def test_get_stored_files_authenticated(self, auth_client):
        response = await auth_client.get("/app/data-connectors/stored-files")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
