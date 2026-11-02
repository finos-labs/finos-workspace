from uuid import uuid4

import pytest
from sqlalchemy import delete

from api import models
from tests.fixtures.organization import ADMIN_ENTITY, MEMBER_UUID

PASSWORD = "TestPassword123!"  # noqa: S105
SECRET = "organization-backend-key"  # noqa: S105


@pytest.fixture
async def backend(organization, db_session):
    row = models.ApiSource(
        uuid=uuid4(),
        name="Organization",
        url="https://backend.example.com/organization",
        entity_uuid=ADMIN_ENTITY,
        endpointHeaders=[{"key": "X-Api-Key", "value": SECRET, "location": "headers"}],
    )
    db_session.add(row)
    await db_session.commit()
    yield row.uuid
    await db_session.execute(
        delete(models.RoleBackend).where(models.RoleBackend.backend_uuid == row.uuid)
    )
    await db_session.execute(delete(models.ApiSource).where(models.ApiSource.uuid == row.uuid))
    await db_session.commit()


async def _granted_backends(client) -> list[dict]:
    response = await client.get("/app/resource-permissions")
    assert response.status_code == 200, response.text
    return response.json()["backends"]


async def _grant(db_session, role_uuid, backend_uuid, access: str = "access") -> None:
    db_session.add(
        models.RoleBackend(role_uuid=role_uuid, backend_uuid=backend_uuid, access=access)
    )
    await db_session.commit()


async def _sign_in(app_client, email: str) -> dict:
    response = await app_client.post(
        "/app/login",
        json={
            "email": email,
            "password": PASSWORD,
            "remember": False,
            "source": "app",
            "totp_token": None,
            "version": "v1.0.0",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


class TestOrganizationBackends:
    @pytest.mark.asyncio
    async def test_a_member_without_a_grant_is_not_given_it(
        self, organization, auth_client, backend
    ):
        await organization.role(MEMBER_UUID)

        assert await _granted_backends(auth_client) == []
        assert (await auth_client.get("/app/data-connectors/api-source")).json() == []

    @pytest.mark.asyncio
    async def test_a_role_that_grants_it_gives_it_without_the_values_of_its_credentials(
        self, organization, auth_client, db_session, backend
    ):
        role = await organization.role(MEMBER_UUID)
        await _grant(db_session, role, backend)

        [granted] = await _granted_backends(auth_client)

        assert granted["uuid"] == str(backend)
        assert granted["name"] == "Organization"
        assert granted["url"] == "https://backend.example.com/organization"
        assert granted["endpointHeaders"] == [{"key": "X-Api-Key", "location": "headers"}]
        assert SECRET not in str(granted)
        assert granted["createdBy"] == "Admin Entity"

    @pytest.mark.asyncio
    async def test_a_role_that_withholds_it_gives_nothing(
        self, organization, auth_client, db_session, backend
    ):
        role = await organization.role(MEMBER_UUID)
        await _grant(db_session, role, backend, "no-access")

        assert await _granted_backends(auth_client) == []

    @pytest.mark.asyncio
    async def test_a_role_of_somebody_else_gives_nothing(
        self, organization, auth_client, db_session, backend
    ):
        other = await organization.add_user()
        role = await organization.role(other.uuid)
        await _grant(db_session, role, backend)

        assert await _granted_backends(auth_client) == []

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("user_type", "served"),
        [(models.ADMIN_TYPE, True), (models.DEVELOPER_TYPE, False), (models.USER_TYPE, False)],
    )
    async def test_sign_in_serves_it_to_an_admin_to_manage_and_to_nobody_else(
        self, organization, app_client, db_session, backend, user_type, served
    ):
        user = await organization.add_user(user_type, password=PASSWORD)
        role = await organization.role(user.uuid)
        await _grant(db_session, role, backend)

        data = await _sign_in(app_client, user.email)

        assert [source["uuid"] for source in data["user"]["api_sources"]] == (
            [str(backend)] if served else []
        )

    @pytest.mark.asyncio
    async def test_an_admin_lists_it_among_the_backends_to_grant(
        self, organization, admin_client, backend
    ):
        response = await admin_client.get("/app/data-connectors/api-source")

        assert response.status_code == 200, response.text
        assert [item["id"] for item in response.json()] == [str(backend)]
