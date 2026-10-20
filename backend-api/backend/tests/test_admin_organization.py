"""
Integration tests for the organization boundary of the admin routes.

An admin manages the users and roles of their own organization only. They cannot create
users in another organization's maps or with its roles, cannot delete, remove or read the
permissions of its users, cannot move a user to another organization, and cannot grant
their roles the backends, files and prompts of another organization. Nor can they manage
the account of a superuser, who acts in every organization. A superuser may manage users
anywhere. A user who leaves an organization takes what they brought out of its roles.
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
from sqlalchemy import delete, select, update

from api import models
from tests.fixtures.base import _SECOND_USER
from tests.fixtures.organization import ADMIN_ENTITY, ADMIN_UUID, MEMBER_UUID

OTHER_ENTITY = UUID(_SECOND_USER["entity_uuid"])
OTHER_MAP = UUID(_SECOND_USER["perm_uuid"])
OTHER_USER = UUID(_SECOND_USER["user_uuid"])


@pytest.fixture
async def other_organization(second_user_client):
    """Another organization, with the second test user in it."""
    return second_user_client


async def _user_uuid(db_session, email: str) -> UUID | None:
    return (
        await db_session.execute(select(models.User.uuid).where(models.User.email == email))
    ).scalar_one_or_none()


async def _set_superuser(db_session, value: bool) -> None:
    await db_session.execute(
        update(models.User).where(models.User.uuid == ADMIN_UUID).values(is_superuser=value)
    )
    await db_session.commit()


async def _is_deleted(db_session, user_uuid: UUID) -> bool:
    return (
        await db_session.execute(
            select(models.User.deleted).where(models.User.uuid == user_uuid)
        )
    ).scalar_one()


class TestCreateUser:
    @pytest.mark.asyncio
    async def test_users_join_the_admins_organization_only(
        self, organization, other_organization, admin_client, db_session
    ):
        email = f"outsider_{uuid4().hex[:8]}@example.com"

        response = await admin_client.post(
            "/admin/create-user", json={"email": email, "permissions_uuid": str(OTHER_MAP)}
        )

        assert response.status_code == 403
        assert response.json()["detail"] == "Cannot add users to another organization"
        assert await _user_uuid(db_session, email) is None

    @pytest.mark.asyncio
    async def test_a_role_of_another_organization_is_refused(
        self, organization, other_organization, admin_client, db_session
    ):
        other_role = await organization.role(entity_uuid=OTHER_ENTITY)
        email = f"member_{uuid4().hex[:8]}@example.com"

        response = await admin_client.post(
            "/admin/create-user",
            json={
                "email": email,
                "permissions_uuid": str(organization.maps[models.USER_TYPE]),
                "role": str(other_role),
            },
        )

        assert response.status_code == 404
        assert response.json()["detail"] == "Role not found"
        assert await _user_uuid(db_session, email) is None

    @pytest.mark.asyncio
    async def test_a_user_joins_with_a_role_of_the_organization(
        self, organization, admin_client, db_session
    ):
        role = await organization.role()
        email = f"member_{uuid4().hex[:8]}@example.com"

        response = await admin_client.post(
            "/admin/create-user",
            json={
                "email": email,
                "permissions_uuid": str(organization.maps[models.USER_TYPE]),
                "role": str(role),
            },
        )
        user_uuid = await _user_uuid(db_session, email)
        if user_uuid:
            organization.users.append(user_uuid)

        assert response.status_code == 200, response.text
        roles = (
            await db_session.execute(
                select(models.UserRole.role_uuid).where(
                    models.UserRole.user_uuid == user_uuid
                )
            )
        ).scalars()
        assert list(roles) == [role]

    @pytest.mark.asyncio
    async def test_an_unknown_map_is_not_found(self, organization, admin_client):
        response = await admin_client.post(
            "/admin/create-user",
            json={
                "email": f"member_{uuid4().hex[:8]}@example.com",
                "permissions_uuid": str(uuid4()),
            },
        )

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_a_superuser_adds_users_to_any_organization(
        self, organization, other_organization, admin_client, db_session
    ):
        email = f"outsider_{uuid4().hex[:8]}@example.com"
        await _set_superuser(db_session, True)
        try:
            response = await admin_client.post(
                "/admin/create-user",
                json={"email": email, "permissions_uuid": str(OTHER_MAP)},
            )
        finally:
            await _set_superuser(db_session, False)
        user_uuid = await _user_uuid(db_session, email)
        if user_uuid:
            organization.users.append(user_uuid)

        assert response.status_code == 200, response.text
        assert user_uuid is not None


class TestDeleteUser:
    @pytest.mark.asyncio
    async def test_users_of_another_organization_are_not_deleted(
        self, organization, other_organization, admin_client, db_session
    ):
        response = await admin_client.delete(f"/admin/users/{OTHER_USER}")

        assert response.status_code == 403
        assert await _is_deleted(db_session, OTHER_USER) is False

    @pytest.mark.asyncio
    async def test_users_without_an_organization_are_not_deleted(
        self, organization, admin_client, db_session
    ):
        user = await organization.add_user()
        await db_session.execute(
            update(models.User)
            .where(models.User.uuid == user.uuid)
            .values(permissions_uuid=None)
        )
        await db_session.commit()

        response = await admin_client.delete(f"/admin/users/{user.uuid}")

        assert response.status_code == 404
        assert await _is_deleted(db_session, user.uuid) is False

    @pytest.mark.asyncio
    async def test_users_of_the_organization_are_deleted(
        self, organization, admin_client, db_session
    ):
        user = await organization.add_user()

        response = await admin_client.delete(f"/admin/users/{user.uuid}")

        assert response.status_code == 200, response.text
        assert await _is_deleted(db_session, user.uuid) is True

    @pytest.mark.asyncio
    async def test_a_superuser_deletes_users_of_any_organization(
        self, organization, other_organization, admin_client, db_session
    ):
        email = f"outsider_{uuid4().hex[:8]}@example.com"
        outsider = models.User(
            uuid=uuid4(),
            email=email,
            clean_email=email,
            password="hashedpassword",  # noqa: S106
            confirmed=True,
            permissions_uuid=OTHER_MAP,
        )
        db_session.add(outsider)
        await db_session.commit()
        organization.users.append(outsider.uuid)

        await _set_superuser(db_session, True)
        try:
            response = await admin_client.delete(f"/admin/users/{outsider.uuid}")
        finally:
            await _set_superuser(db_session, False)

        assert response.status_code == 200, response.text
        assert await _is_deleted(db_session, outsider.uuid) is True


class TestRemoveUser:
    @pytest.mark.asyncio
    async def test_users_of_another_organization_keep_their_dashboards_and_shares(
        self, organization, other_organization, admin_client, db_session
    ):
        dashboard_uuid = uuid4()
        db_session.add(
            models.DashboardItem(
                uuid=dashboard_uuid,
                creator_uuid=OTHER_USER,
                owner_uuid=OTHER_USER,
                entity_uuid=OTHER_ENTITY,
                content={"name": "A dashboard of the other organization"},
                is_shared=True,
            )
        )
        await db_session.commit()
        organization.dashboards.append(dashboard_uuid)
        db_session.add(
            models.DashboardShare(
                dashboard_item_uuid=dashboard_uuid,
                shared_user_uuid=MEMBER_UUID,
                permissions="view",
            )
        )
        await db_session.commit()

        response = await admin_client.delete(f"/admin/users/{OTHER_USER}/remove")

        assert response.status_code == 403
        entity_uuid = (
            await db_session.execute(
                select(models.DashboardItem.entity_uuid).where(
                    models.DashboardItem.uuid == dashboard_uuid
                )
            )
        ).scalar_one()
        assert entity_uuid == OTHER_ENTITY
        shares = (
            await db_session.execute(
                select(models.DashboardShare.uuid).where(
                    models.DashboardShare.dashboard_item_uuid == dashboard_uuid
                )
            )
        ).all()
        assert len(shares) == 1


class TestSuperuserAccounts:
    @pytest.fixture
    async def superuser(self, organization, db_session):
        """A superuser who is an admin of the organization too."""
        user = await organization.add_user(models.ADMIN_TYPE)
        await db_session.execute(
            update(models.User).where(models.User.uuid == user.uuid).values(is_superuser=True)
        )
        await db_session.commit()
        return user.uuid

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("method", "path"),
        [
            ("post", "/admin/reset-password/{uuid}"),
            ("post", "/admin/reset-2fa/{uuid}"),
            ("post", "/admin/usage/{uuid}/reset"),
            ("delete", "/admin/users/{uuid}"),
            ("delete", "/admin/users/{uuid}/remove"),
            ("patch", "/admin/users/{uuid}"),
        ],
    )
    async def test_admins_do_not_manage_superusers(
        self, organization, superuser, admin_client, db_session, method, path
    ):
        # A patch would make the superuser a plain user
        kwargs = (
            {"json": {"permissions_uuid": str(organization.maps[models.USER_TYPE])}}
            if method == "patch"
            else {}
        )

        response = await getattr(admin_client, method)(
            path.format(uuid=superuser), **kwargs
        )

        assert response.status_code == 403
        assert response.json()["detail"] == "Only superusers can manage superusers"
        user = (
            await db_session.execute(
                select(
                    models.User.deleted,
                    models.User.permissions_uuid,
                    models.User.temporary_password,
                ).where(models.User.uuid == superuser)
            )
        ).one()
        assert user.deleted is False
        assert user.permissions_uuid == organization.maps[models.ADMIN_TYPE]
        assert not user.temporary_password


class TestMoveUser:
    @pytest.mark.asyncio
    async def test_users_are_not_moved_to_another_organization(
        self, organization, other_organization, admin_client, db_session
    ):
        user = await organization.add_user()
        await _set_superuser(db_session, True)
        try:
            response = await admin_client.patch(
                f"/admin/users/{user.uuid}", json={"permissions_uuid": str(OTHER_MAP)}
            )
        finally:
            await _set_superuser(db_session, False)

        assert response.status_code == 403
        permissions_uuid = (
            await db_session.execute(
                select(models.User.permissions_uuid).where(models.User.uuid == user.uuid)
            )
        ).scalar_one()
        assert permissions_uuid == organization.maps[models.USER_TYPE]

    @pytest.mark.asyncio
    async def test_the_type_changes_inside_the_organization(
        self, organization, admin_client, db_session
    ):
        user = await organization.add_user()

        response = await admin_client.patch(
            f"/admin/users/{user.uuid}",
            json={"permissions_uuid": str(organization.maps[models.DEVELOPER_TYPE])},
        )

        assert response.status_code == 200, response.text
        permissions_uuid = (
            await db_session.execute(
                select(models.User.permissions_uuid).where(models.User.uuid == user.uuid)
            )
        ).scalar_one()
        assert permissions_uuid == organization.maps[models.DEVELOPER_TYPE]


class TestUserPermissions:
    @pytest.mark.asyncio
    async def test_the_permissions_of_another_organizations_users_are_not_shown(
        self, organization, other_organization, admin_client
    ):
        response = await admin_client.get(f"/admin/user-permissions/{OTHER_USER}")

        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_the_permissions_of_the_organizations_users_are_shown(
        self, organization, admin_client
    ):
        response = await admin_client.get(f"/admin/user-permissions/{MEMBER_UUID}")

        assert response.status_code == 200, response.text


class TestRolePermissions:
    @pytest.fixture
    async def backends(self, organization, other_organization, db_session):
        """A backend a member of the organization brought, one the organization has, and
        one of another organization."""
        own = models.ApiSource(
            uuid=uuid4(), name="Own", url="https://api.example.com/own", user_uuid=MEMBER_UUID
        )
        shared = models.ApiSource(
            uuid=uuid4(),
            name="Organization",
            url="https://api.example.com/organization",
            entity_uuid=ADMIN_ENTITY,
        )
        other = models.ApiSource(
            uuid=uuid4(),
            name="Other",
            url="https://api.example.com/other",
            user_uuid=OTHER_USER,
            endpointHeaders=[{"Authorization": "Bearer secret"}],
        )
        uuids = [own.uuid, shared.uuid, other.uuid]
        db_session.add_all([own, shared, other])
        await db_session.commit()
        yield uuids
        await db_session.rollback()
        await db_session.execute(
            delete(models.RoleBackend).where(models.RoleBackend.backend_uuid.in_(uuids))
        )
        await db_session.execute(
            delete(models.ApiSource).where(models.ApiSource.uuid.in_(uuids))
        )
        await db_session.commit()

    @staticmethod
    def _grant(backend_uuid: UUID) -> dict:
        return {
            "uuid": str(backend_uuid),
            "type": "backend",
            "access": "full-access",
            "category": "data-connectors",
        }

    @staticmethod
    async def _granted(db_session, role_uuid: UUID) -> set[UUID]:
        return set(
            (
                await db_session.execute(
                    select(models.RoleBackend.backend_uuid).where(
                        models.RoleBackend.role_uuid == role_uuid
                    )
                )
            ).scalars()
        )

    @pytest.mark.asyncio
    async def test_a_backend_of_another_organization_is_not_granted(
        self, organization, backends, admin_client, db_session
    ):
        own, _, other = backends
        role = await organization.role()

        response = await admin_client.put(
            f"/admin/role-permissions/{role}", json=[self._grant(own), self._grant(other)]
        )

        assert response.status_code == 403
        assert response.json()["detail"] == (
            "Cannot grant items from outside your organization"
        )
        assert await self._granted(db_session, role) == set()

    @pytest.fixture
    async def files_and_prompts(self, organization, other_organization, db_session):
        """A file and a prompt a member of the organization brought, and a file and a
        prompt of another organization."""
        owners = {"own": MEMBER_UUID, "other": OTHER_USER}
        files = {
            name: models.FileWidget(
                uuid=uuid4(),
                user_uuid=owner,
                url=f"https://files.example.com/{name}.csv",
                name=name,
                extension="csv",
            )
            for name, owner in owners.items()
        }
        prompts = {
            name: models.UserPrompts(
                uuid=uuid4(), user_uuid=owner, prompt={"prompt": f"A prompt ({name})"}
            )
            for name, owner in owners.items()
        }
        file_uuids = {name: file.uuid for name, file in files.items()}
        prompt_uuids = {name: prompt.uuid for name, prompt in prompts.items()}
        db_session.add_all([*files.values(), *prompts.values()])
        await db_session.commit()
        yield file_uuids, prompt_uuids
        await db_session.rollback()
        await db_session.execute(
            delete(models.RoleFile).where(
                models.RoleFile.file_uuid.in_(file_uuids.values())
            )
        )
        await db_session.execute(
            delete(models.RolePrompt).where(
                models.RolePrompt.prompt_uuid.in_(prompt_uuids.values())
            )
        )
        await db_session.execute(
            delete(models.FileWidget).where(
                models.FileWidget.uuid.in_(file_uuids.values())
            )
        )
        await db_session.execute(
            delete(models.UserPrompts).where(
                models.UserPrompts.uuid.in_(prompt_uuids.values())
            )
        )
        await db_session.commit()

    @staticmethod
    def _file(file_uuid: UUID) -> dict:
        return {
            "uuid": str(file_uuid),
            "type": "file",
            "access": "access",
            "category": "data-connectors",
        }

    @staticmethod
    def _prompt(prompt_uuid: UUID) -> dict:
        return {
            "uuid": str(prompt_uuid),
            "type": "prompt",
            "access": "access",
            "category": "prompts",
        }

    @pytest.mark.asyncio
    async def test_files_and_prompts_of_another_organization_are_not_granted(
        self, organization, files_and_prompts, admin_client, db_session
    ):
        files, prompts = files_and_prompts
        role = await organization.role()

        for item in (self._file(files["other"]), self._prompt(prompts["other"])):
            response = await admin_client.put(
                f"/admin/role-permissions/{role}", json=[item]
            )
            assert response.status_code == 403, item

        granted_files = (
            await db_session.execute(
                select(models.RoleFile.uuid).where(models.RoleFile.role_uuid == role)
            )
        ).all()
        granted_prompts = (
            await db_session.execute(
                select(models.RolePrompt.uuid).where(models.RolePrompt.role_uuid == role)
            )
        ).all()
        assert (granted_files, granted_prompts) == ([], [])

    @pytest.mark.asyncio
    async def test_the_organizations_files_and_prompts_are_granted(
        self, organization, files_and_prompts, admin_client, db_session
    ):
        files, prompts = files_and_prompts
        role = await organization.role()

        response = await admin_client.put(
            f"/admin/role-permissions/{role}",
            json=[self._file(files["own"]), self._prompt(prompts["own"])],
        )

        assert response.status_code == 200, response.text
        granted_file = (
            await db_session.execute(
                select(models.RoleFile.file_uuid).where(models.RoleFile.role_uuid == role)
            )
        ).scalar_one()
        granted_prompt = (
            await db_session.execute(
                select(models.RolePrompt.prompt_uuid).where(
                    models.RolePrompt.role_uuid == role
                )
            )
        ).scalar_one()
        assert (granted_file, granted_prompt) == (files["own"], prompts["own"])

    @pytest.mark.asyncio
    async def test_what_a_role_grants_can_always_be_taken_away(
        self, organization, backends, admin_client, db_session
    ):
        _, _, other = backends
        role = await organization.role()
        db_session.add(
            models.RoleBackend(role_uuid=role, backend_uuid=other, access="access")
        )
        await db_session.commit()
        revoke = {**self._grant(other), "access": "no-access"}

        response = await admin_client.put(f"/admin/role-permissions/{role}", json=[revoke])

        assert response.status_code == 200, response.text
        access = (
            await db_session.execute(
                select(models.RoleBackend.access).where(
                    models.RoleBackend.role_uuid == role
                )
            )
        ).scalar_one()
        assert access == "no-access"

    @pytest.mark.asyncio
    async def test_items_of_another_organization_are_not_named_even_without_access(
        self, organization, backends, admin_client, db_session
    ):
        _, _, other = backends
        role = await organization.role()

        response = await admin_client.put(
            f"/admin/role-permissions/{role}",
            json=[{**self._grant(other), "access": "no-access"}],
        )

        assert response.status_code == 403
        assert await self._granted(db_session, role) == set()

    @pytest.mark.asyncio
    async def test_a_user_who_leaves_takes_their_backends_out_of_its_roles(
        self, organization, admin_client, db_session
    ):
        developer = await organization.add_user(models.DEVELOPER_TYPE)
        backend = models.ApiSource(
            uuid=uuid4(),
            name="Brought",
            url="https://api.example.com/brought",
            user_uuid=developer.uuid,
        )
        backend_uuid = backend.uuid
        db_session.add(backend)
        await db_session.commit()
        role = await organization.role()
        response = await admin_client.put(
            f"/admin/role-permissions/{role}", json=[self._grant(backend_uuid)]
        )
        assert response.status_code == 200, response.text

        response = await admin_client.delete(f"/admin/users/{developer.uuid}/remove")

        assert response.status_code == 200, response.text
        assert await self._granted(db_session, role) == set()

    @pytest.mark.asyncio
    async def test_the_organizations_backends_are_granted(
        self, organization, backends, admin_client, db_session
    ):
        own, shared, _ = backends
        role = await organization.role()

        response = await admin_client.put(
            f"/admin/role-permissions/{role}", json=[self._grant(own), self._grant(shared)]
        )

        assert response.status_code == 200, response.text
        assert await self._granted(db_session, role) == {own, shared}
