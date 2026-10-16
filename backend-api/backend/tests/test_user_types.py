"""
Integration tests for user types and the connections they may bring.

Admins and developers may bring their own connections: data connectors, file widgets,
uploaded files, MCP servers and custom Copilots. Users may not: the endpoints that add
connections refuse them, the connections they have are not served back to them, and the
MCP proxy does not reach their own MCP servers. They may still delete them. An admin's
uploads are limited by the upload size of their roles; a developer's are not limited.
"""

import os
import sys

BACKEND_DIR = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from datetime import timedelta
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import delete, func, select

from api import models
from api.storage import FileStorage
from routers.app.index import check_own_mcp_server
from tests.fixtures.base import settings
from tests.fixtures.organization import ADMIN_ENTITY, MEMBER_UUID

REFUSED = "Your account type cannot add connections"
MCP_URL = "https://mcp.example.com/mcp"
PASSWORD = "TestPassword123!"  # noqa: S105


@pytest.fixture
def storage():
    """File storage that keeps nothing, so uploads succeed without a bucket."""

    async def upload(_file, pending_file):
        return pending_file

    with (
        patch.object(FileStorage, "upload_pending_file", AsyncMock(side_effect=upload)),
        patch.object(FileStorage, "delete_file", AsyncMock(return_value=True)),
    ):
        yield


def _upload(client, size: int = 10):
    return client.post(
        "/app/files", files={"files": ("data.csv", b"a" * size, "text/csv")}
    )


async def _add_connections(client) -> dict:
    """Add one connection of each kind; the responses by kind."""
    pending_file = uuid4()
    settings.redis_cache(pending_file, {"pending": True}, timedelta(minutes=5))
    return {
        "api source": await client.post(
            f"/app/data-connectors/api-source/{uuid4()}",
            json={"name": "Prices", "url": "https://api.example.com/data"},
        ),
        "file widget": await client.post(
            f"/app/data-connectors/file/{uuid4()}",
            json={
                "storedFileUuid": str(pending_file),
                "url": "https://files.example.com/data.csv",
                "name": "Data",
                "extension": "csv",
                "dataKey": None,
                "originalFileName": "data.csv",
            },
        ),
        "file upload": await _upload(client),
        "mcp servers": await client.post(
            "/app/mcp-servers",
            json={
                "servers": [
                    {"id": "tools", "name": "Tools", "url": MCP_URL, "enabled": True}
                ]
            },
        ),
        "custom copilot": await client.put(
            "/app/custom-copilot",
            json={"url": "https://copilot.example.com", "headers": {}},
        ),
    }


async def _count_connections(db_session, user_uuid: UUID) -> dict:
    counts = {}
    for table in (
        models.ApiSource,
        models.FileWidget,
        models.MCPServers,
        models.CustomCopilot,
    ):
        counts[table.__tablename__] = (
            await db_session.execute(
                select(func.count()).select_from(table).where(table.user_uuid == user_uuid)
            )
        ).scalar_one()
    counts["stored_file"] = (
        await db_session.execute(
            select(func.count())
            .select_from(models.StoredFile)
            .where(models.StoredFile.creater_uuid == user_uuid)
        )
    ).scalar_one()
    return counts


async def _store_connections(db_session, user_uuid: UUID) -> None:
    """Connections a user brought while their type allowed it."""
    db_session.add_all(
        [
            models.ApiSource(
                uuid=uuid4(),
                name="Prices",
                url="https://api.example.com/data",
                user_uuid=user_uuid,
            ),
            models.FileWidget(
                uuid=uuid4(),
                user_uuid=user_uuid,
                url="https://files.example.com/data.csv",
                name="Data",
                extension="csv",
            ),
            models.StoredFile(
                uuid=uuid4(),
                creater_uuid=user_uuid,
                s3_file_name="data.csv",
                bucket="files",
                extension="csv",
                original_file_name="data.csv",
                size=10,
            ),
            models.MCPServers(
                user_uuid=user_uuid,
                servers=[
                    {"id": "tools", "name": "Tools", "url": MCP_URL, "enabled": True}
                ],
            ),
            models.CustomCopilot(
                uuid=uuid4(),
                user_uuid=user_uuid,
                url="https://copilot.example.com",
                headers={},
                copilots=[{"name": "Analyst"}],
            ),
        ]
    )
    await db_session.commit()


async def _served(client) -> dict:
    """What the listings serve back to the user."""
    user = (await client.get("/app/user")).json()
    sync = (await client.get("/app/dash/validate-and-sync")).json()
    return {
        "api sources": (await client.get("/app/data-connectors/api-source")).json(),
        "file widgets": (await client.get("/app/data-connectors/file")).json(),
        "stored files": (await client.get("/app/data-connectors/stored-files")).json(),
        "custom copilots": (await client.get("/app/custom-copilot")).json(),
        "user api sources": user["api_sources"],
        "user file widgets": user["file_widgets"],
        "sync mcp servers": sync["mcp_servers"],
        "sync file widgets": sync["file_widgets"],
    }


class TestAddingConnections:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("user_type", models.CONNECTION_TYPES)
    async def test_admins_and_developers_add_connections(
        self, organization, auth_client, db_session, storage, user_type
    ):
        await organization.set_type(MEMBER_UUID, user_type)
        await organization.role(MEMBER_UUID, upload_size_gb=None)

        for kind, response in (await _add_connections(auth_client)).items():
            assert response.status_code == 200, (kind, response.text)

        assert await _count_connections(db_session, MEMBER_UUID) == {
            "api_source": 1,
            "file_widget": 1,
            "mcp_servers": 1,
            "custom_copilot": 1,
            "stored_file": 1,
        }

    @pytest.mark.asyncio
    async def test_users_cannot_add_connections(
        self, organization, auth_client, db_session, storage
    ):
        await organization.role(MEMBER_UUID, upload_size_gb=None)

        for kind, response in (await _add_connections(auth_client)).items():
            assert response.status_code == 403, kind
            assert response.json()["detail"] == REFUSED, kind

        assert set((await _count_connections(db_session, MEMBER_UUID)).values()) == {0}


class TestServingConnections:
    @pytest.mark.asyncio
    async def test_developers_are_served_their_connections(
        self, organization, auth_client, db_session
    ):
        await organization.set_type(MEMBER_UUID, models.DEVELOPER_TYPE)
        await _store_connections(db_session, MEMBER_UUID)

        served = await _served(auth_client)

        assert {kind: len(items) for kind, items in served.items()} == dict.fromkeys(
            served, 1
        )

    @pytest.mark.asyncio
    async def test_users_are_not_served_their_connections(
        self, organization, auth_client, db_session
    ):
        await _store_connections(db_session, MEMBER_UUID)

        served = await _served(auth_client)

        assert served == dict.fromkeys(served, [])

    @pytest.mark.asyncio
    async def test_users_are_served_the_backends_of_their_organization(
        self, organization, auth_client, db_session
    ):
        await _store_connections(db_session, MEMBER_UUID)
        backend = models.ApiSource(
            uuid=uuid4(),
            name="Organization backend",
            url="https://backend.example.com",
            entity_uuid=ADMIN_ENTITY,
        )
        db_session.add(backend)
        await db_session.commit()
        try:
            with patch.object(settings, "MODE", "onprem"):
                response = await auth_client.get("/app/data-connectors/api-source")
        finally:
            await db_session.execute(
                delete(models.ApiSource).where(models.ApiSource.uuid == backend.uuid)
            )
            await db_session.commit()

        assert response.status_code == 200
        assert [item["id"] for item in response.json()] == [str(backend.uuid)]

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("user_type", "served"),
        [(models.DEVELOPER_TYPE, True), (models.USER_TYPE, False)],
    )
    async def test_sign_in_serves_connections_by_type(
        self, organization, app_client, db_session, user_type, served
    ):
        user = await organization.add_user(user_type, password=PASSWORD)
        await _store_connections(db_session, user.uuid)

        response = await app_client.post(
            "/app/login",
            json={
                "email": user.email,
                "password": PASSWORD,
                "remember": False,
                "source": "app",
                "totp_token": None,
                "version": "v1.0.0",
            },
        )

        assert response.status_code == 200, response.text
        data = response.json()
        count = 1 if served else 0
        assert len(data["mcp_servers"] or []) == count
        assert len(data["custom_copilots"] or []) == count
        assert len(data["user"]["api_sources"]) == count
        assert len(data["user"]["file_widgets"]) == count


class TestUsersOwnMcpServers:
    @pytest.mark.asyncio
    async def test_the_proxy_does_not_reach_a_users_own_servers(
        self, organization, auth_client, db_session
    ):
        await _store_connections(db_session, MEMBER_UUID)

        response = await auth_client.post(
            "/app/mcp-proxy",
            json={
                "server_url": "https://MCP.example.com/mcp/",
                "url": "https://mcp.example.com/mcp",
                "method": "POST",
                "body": {"method": "tools/list"},
            },
        )

        assert response.status_code == 403
        assert response.json()["detail"] == REFUSED

    @pytest.mark.asyncio
    async def test_the_check_lets_other_servers_and_developers_through(
        self, organization, db_session
    ):
        await _store_connections(db_session, MEMBER_UUID)

        await check_own_mcp_server(db_session, MEMBER_UUID, "https://other.example.com/mcp")
        with pytest.raises(HTTPException) as refused:
            await check_own_mcp_server(db_session, MEMBER_UUID, MCP_URL)
        assert refused.value.status_code == 403

        await organization.set_type(MEMBER_UUID, models.DEVELOPER_TYPE)
        await check_own_mcp_server(db_session, MEMBER_UUID, MCP_URL)


class TestUsersDeleteTheirConnections:
    @pytest.mark.asyncio
    async def test_users_may_delete_what_they_brought(
        self, organization, auth_client, db_session, storage
    ):
        await _store_connections(db_session, MEMBER_UUID)

        def owned(table, column="user_uuid"):
            return select(table.uuid).where(getattr(table, column) == MEMBER_UUID)

        api_source = (await db_session.execute(owned(models.ApiSource))).scalar_one()
        file_widget = (await db_session.execute(owned(models.FileWidget))).scalar_one()
        stored_file = (
            await db_session.execute(owned(models.StoredFile, "creater_uuid"))
        ).scalar_one()
        copilot = (await db_session.execute(owned(models.CustomCopilot))).scalar_one()

        for path in (
            f"/app/data-connectors/api-source/{api_source}",
            f"/app/data-connectors/file/{file_widget}",
            f"/app/files/{stored_file}",
            f"/app/custom-copilot/{copilot}",
        ):
            response = await auth_client.delete(path)
            assert response.status_code == 200, (path, response.text)

        counts = await _count_connections(db_session, MEMBER_UUID)
        assert counts == {
            "api_source": 0,
            "file_widget": 0,
            "mcp_servers": 1,
            "custom_copilot": 0,
            "stored_file": 0,
        }


class TestUploadLimit:
    # Admins upload within the limits of their roles; developers have none
    @pytest.mark.asyncio
    async def test_a_user_without_an_upload_allowance_cannot_upload(
        self, organization, auth_client, storage
    ):
        await organization.set_type(MEMBER_UUID, models.ADMIN_TYPE)

        response = await _upload(auth_client)

        assert response.status_code == 413
        assert response.json()["detail"] == (
            "The upload size limit of 0 GB would be exceeded"
        )

    @pytest.mark.asyncio
    async def test_uploads_count_against_the_files_already_stored(
        self, organization, auth_client, db_session, storage
    ):
        await organization.set_type(MEMBER_UUID, models.ADMIN_TYPE)
        await organization.role(MEMBER_UUID, upload_size_gb=1)
        db_session.add(
            models.StoredFile(
                uuid=uuid4(),
                creater_uuid=MEMBER_UUID,
                s3_file_name="large.csv",
                bucket="files",
                extension="csv",
                original_file_name="large.csv",
                size=1024**3 - 5,
            )
        )
        await db_session.commit()

        assert (await _upload(auth_client, size=5)).status_code == 200
        response = await _upload(auth_client, size=5)
        assert response.status_code == 413
        assert "1 GB" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_a_developer_uploads_without_a_limit(
        self, organization, auth_client, storage
    ):
        await organization.set_type(MEMBER_UUID, models.DEVELOPER_TYPE)
        await organization.role(MEMBER_UUID, upload_size_gb=0)

        assert (await _upload(auth_client)).status_code == 200

    @pytest.mark.asyncio
    async def test_a_role_without_an_upload_limit_lifts_it(
        self, organization, auth_client, db_session, storage
    ):
        await organization.set_type(MEMBER_UUID, models.DEVELOPER_TYPE)
        await organization.role(MEMBER_UUID, upload_size_gb=0)
        await organization.role(MEMBER_UUID, upload_size_gb=None)

        response = await _upload(auth_client)

        assert response.status_code == 200, response.text
        assert len(response.json()) == 1
