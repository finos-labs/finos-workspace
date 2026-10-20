"""
A superuser's All users: GET /entity/user and PUT /entity/user/{user_uuid}.

The list holds the users of every organization that are not deleted, by email, and a
search narrows it to the emails that contain the text. A move puts a user in another
permission map: into another organization, they leave its roles and get the new one's
Agent User, as a new user of it does; within the organization, they keep their roles.
Only superusers do either.
"""

import os
import sys

BACKEND_DIR = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from uuid import UUID, uuid4

import pytest
from sqlalchemy import select, update

from api import models
from routers import app_helpers
from tests.fixtures.base import _SECOND_USER, superuser_override
from tests.fixtures.organization import ADMIN_ENTITY, MEMBER_EMAIL

OTHER_ENTITY = UUID(_SECOND_USER["entity_uuid"])
OTHER_MAP = UUID(_SECOND_USER["perm_uuid"])


@pytest.fixture
def as_superuser():
    with superuser_override():
        yield


async def _listed(client, email: str) -> list[dict]:
    response = await client.get("/entity/user", params={"email": email, "size": 1000})
    assert response.status_code == 200, response.text
    return response.json()["items"]


async def _roles_of(db_session, user_uuid: UUID) -> set[UUID]:
    return set(
        (
            await db_session.execute(
                select(models.UserRole.role_uuid).where(models.UserRole.user_uuid == user_uuid)
            )
        ).scalars()
    )


async def _map_of(db_session, user_uuid: UUID) -> UUID | None:
    return (
        await db_session.execute(
            select(models.User.permissions_uuid)
            .where(models.User.uuid == user_uuid)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


async def _default_roles(organization, db_session, entity_uuid: UUID) -> dict[str, UUID]:
    roles = await app_helpers.create_default_roles(db_session, entity_uuid)
    await db_session.commit()
    organization.roles.extend(roles.values())
    return roles


class TestTheList:
    @pytest.mark.asyncio
    async def test_it_holds_the_users_of_every_organization(
        self, organization, second_user_client, auth_client, as_superuser
    ):
        listed = {item["email"]: item for item in await _listed(auth_client, "")}

        member = listed[MEMBER_EMAIL]
        assert member["permissions"]["name"] == models.USER_TYPE
        assert member["permissions"]["entity"]["uuid"] == str(ADMIN_ENTITY)
        second = listed[_SECOND_USER["email"]]
        assert second["permissions"]["uuid"] == str(OTHER_MAP)
        assert second["permissions"]["entity"]["uuid"] == str(OTHER_ENTITY)

    @pytest.mark.asyncio
    async def test_a_search_matches_part_of_the_email(
        self, organization, auth_client, as_superuser
    ):
        user = await organization.add_user()

        listed = await _listed(auth_client, user.email[3:12])

        assert user.email in [item["email"] for item in listed]

    @pytest.mark.asyncio
    async def test_a_deleted_user_is_not_listed(
        self, organization, auth_client, db_session, as_superuser
    ):
        user = await organization.add_user()
        await db_session.execute(
            update(models.User).where(models.User.uuid == user.uuid).values(deleted=True)
        )
        await db_session.commit()

        assert await _listed(auth_client, user.email) == []

    @pytest.mark.asyncio
    async def test_only_superusers_list_users(self, organization, auth_client):
        response = await auth_client.get("/entity/user")

        assert response.status_code == 403


class TestTheMove:
    @pytest.mark.asyncio
    async def test_into_another_organization_gives_its_agent_user(
        self, organization, second_user_client, auth_client, db_session, as_superuser
    ):
        user = await organization.add_user()
        theirs = await organization.role(user.uuid)
        other = await _default_roles(organization, db_session, OTHER_ENTITY)

        response = await auth_client.put(
            f"/entity/user/{user.uuid}", json={"permissions_uuid": str(OTHER_MAP)}
        )

        assert response.status_code == 200, response.text
        assert await _map_of(db_session, user.uuid) == OTHER_MAP
        roles = await _roles_of(db_session, user.uuid)
        assert theirs not in roles
        assert roles == {other[app_helpers.AGENT_USER_ROLE]}

    @pytest.mark.asyncio
    async def test_within_the_organization_keeps_the_roles(
        self, organization, auth_client, db_session, as_superuser
    ):
        user = await organization.add_user()
        theirs = await organization.role(user.uuid)
        await _default_roles(organization, db_session, ADMIN_ENTITY)

        response = await auth_client.put(
            f"/entity/user/{user.uuid}",
            json={"permissions_uuid": str(organization.maps[models.DEVELOPER_TYPE])},
        )

        assert response.status_code == 200, response.text
        assert await _map_of(db_session, user.uuid) == organization.maps[models.DEVELOPER_TYPE]
        assert await _roles_of(db_session, user.uuid) == {theirs}

    @pytest.mark.asyncio
    async def test_an_unknown_permission_map_is_refused(
        self, organization, auth_client, db_session, as_superuser
    ):
        user = await organization.add_user()

        response = await auth_client.put(
            f"/entity/user/{user.uuid}", json={"permissions_uuid": str(uuid4())}
        )

        assert response.status_code == 404
        assert response.json()["detail"] == "Permission map not found"
        assert await _map_of(db_session, user.uuid) == organization.maps[models.USER_TYPE]

    @pytest.mark.asyncio
    @pytest.mark.parametrize("body", [{}, {"permissions_uuid": None}, {"permissions_uuid": "x"}])
    async def test_a_move_names_a_permission_map(
        self, organization, auth_client, db_session, as_superuser, body
    ):
        user = await organization.add_user()

        response = await auth_client.put(f"/entity/user/{user.uuid}", json=body)

        assert response.status_code == 422
        assert await _map_of(db_session, user.uuid) == organization.maps[models.USER_TYPE]

    @pytest.mark.asyncio
    async def test_a_deleted_user_is_not_moved(
        self, organization, auth_client, db_session, as_superuser
    ):
        user = await organization.add_user()
        await db_session.execute(
            update(models.User).where(models.User.uuid == user.uuid).values(deleted=True)
        )
        await db_session.commit()

        response = await auth_client.put(
            f"/entity/user/{user.uuid}",
            json={"permissions_uuid": str(organization.maps[models.DEVELOPER_TYPE])},
        )

        assert response.status_code == 404
        assert await _map_of(db_session, user.uuid) == organization.maps[models.USER_TYPE]

    @pytest.mark.asyncio
    async def test_only_superusers_move_users(self, organization, auth_client, db_session):
        user = await organization.add_user()

        response = await auth_client.put(
            f"/entity/user/{user.uuid}",
            json={"permissions_uuid": str(organization.maps[models.DEVELOPER_TYPE])},
        )

        assert response.status_code == 403
        assert await _map_of(db_session, user.uuid) == organization.maps[models.USER_TYPE]
