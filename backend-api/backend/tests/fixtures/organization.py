"""An organization to test what users may do.

The admin's organization, with sharing switched on, holds the admin and the test user,
who joins it as a "User". Tests add roles, users, dashboards and apps to it, and all of
it is removed afterwards.
"""

from uuid import UUID, uuid4

import pytest
from sqlalchemy import delete, or_, update

from api import models

from .base import _ADMIN_USER, _AUTH_USER, settings

ADMIN_ENTITY = UUID(_ADMIN_USER["entity_uuid"])
ADMIN_UUID = UUID(_ADMIN_USER["user_uuid"])
ADMIN_EMAIL = _ADMIN_USER["email"]
MEMBER_UUID = UUID(_AUTH_USER["user_uuid"])
MEMBER_EMAIL = _AUTH_USER["email"]


def admin_entity_body(sharing_enabled: bool) -> dict:
    """What a superuser puts for the admin's organization."""
    return {"name": _ADMIN_USER["entity_name"], "sharing_enabled": sharing_enabled}


def forget_usage(*user_uuids: UUID) -> None:
    """Drop the cached usage of users, which carries the limits of their roles."""
    for user_uuid in user_uuids:
        settings.redis_cache(f"usage:{user_uuid}", delete=True)


class Organization:
    def __init__(self, db):
        self.db = db
        self.maps = {models.ADMIN_TYPE: UUID(_ADMIN_USER["perm_uuid"])}
        self.users: list[UUID] = []
        self.roles: list[UUID] = []
        self.assigned: set[UUID] = set()
        self.dashboards: list[UUID] = []
        self.apps: list[UUID] = []

    async def set_up(self) -> None:
        for user_type in (models.DEVELOPER_TYPE, models.USER_TYPE):
            perm = models.PermissionsEntityMap(
                uuid=uuid4(), entity_uuid=ADMIN_ENTITY, name=user_type
            )
            self.db.add(perm)
            self.maps[user_type] = perm.uuid
        await self.db.commit()
        await self.set_type(MEMBER_UUID, models.USER_TYPE)
        await self.set_sharing_enabled(True)

    async def set_type(self, user_uuid: UUID, user_type: str) -> None:
        await self.db.execute(
            update(models.User)
            .where(models.User.uuid == user_uuid)
            .values(permissions_uuid=self.maps[user_type])
        )
        await self.db.commit()
        # The type sets the limits (a developer has none), as the API knows
        forget_usage(user_uuid)

    async def set_sharing_enabled(self, enabled: bool) -> None:
        await self.db.execute(
            update(models.Entity)
            .where(models.Entity.uuid == ADMIN_ENTITY)
            .values(sharing_enabled=enabled)
        )
        await self.db.commit()

    async def add_user(
        self, user_type: str = models.USER_TYPE, password: str = "hashedpassword"  # noqa: S107
    ) -> models.User:
        user_uuid = uuid4()
        email = f"member_{user_uuid.hex[:8]}@example.com"
        user = models.User(
            uuid=user_uuid,
            email=email,
            clean_email=email,
            password=password,
            confirmed=True,
            permissions_uuid=self.maps[user_type],
        )
        self.db.add(user)
        await self.db.commit()
        self.users.append(user_uuid)
        return user

    async def role(self, *user_uuids: UUID, entity_uuid=ADMIN_ENTITY, **settings_) -> UUID:
        """A role with the given settings, assigned to the given users. A limit that is
        not given, or given as None, is no limit."""
        role_uuid = uuid4()
        self.db.add(
            models.Role(
                uuid=role_uuid,
                name=f"Role {role_uuid.hex[:8]}",
                description="A role of the test organization",
                entity_uuid=entity_uuid,
                **settings_,
            )
        )
        await self.db.commit()
        self.roles.append(role_uuid)
        await self.assign(role_uuid, *user_uuids)
        return role_uuid

    async def assign(self, role_uuid: UUID, *user_uuids: UUID) -> None:
        for user_uuid in user_uuids:
            self.db.add(models.UserRole(user_uuid=user_uuid, role_uuid=role_uuid))
        await self.db.commit()
        self.assigned.update(user_uuids)
        forget_usage(*user_uuids)

    async def dashboard(self, owner_uuid: UUID, **values) -> UUID:
        dashboard_uuid = uuid4()
        self.db.add(
            models.DashboardItem(
                uuid=dashboard_uuid,
                creator_uuid=owner_uuid,
                owner_uuid=owner_uuid,
                entity_uuid=ADMIN_ENTITY,
                content={"name": "A dashboard of the test organization"},
                **values,
            )
        )
        await self.db.commit()
        self.dashboards.append(dashboard_uuid)
        return dashboard_uuid

    async def user_app(self, owner_uuid: UUID) -> UUID:
        app_uuid = uuid4()
        self.db.add(
            models.UserApp(
                uuid=app_uuid,
                user_uuid=owner_uuid,
                content={"name": "An app of the test organization"},
            )
        )
        await self.db.commit()
        self.apps.append(app_uuid)
        return app_uuid

    async def tear_down(self) -> None:
        db = self.db
        await db.rollback()
        people = list({MEMBER_UUID, ADMIN_UUID, *self.users, *self.assigned})
        await db.execute(
            delete(models.StoredFileShare).where(
                or_(
                    models.StoredFileShare.creater_uuid.in_(people),
                    models.StoredFileShare.shared_user_uuid.in_(people),
                )
            )
        )
        await db.execute(
            delete(models.ShareRequest).where(
                or_(
                    models.ShareRequest.requester_uuid.in_(people),
                    models.ShareRequest.recipient_uuid.in_(people),
                )
            )
        )
        await db.execute(
            delete(models.DashboardShare).where(
                models.DashboardShare.dashboard_item_uuid.in_(self.dashboards)
            )
        )
        await db.execute(
            delete(models.UserAppShare).where(
                models.UserAppShare.user_app_uuid.in_(self.apps)
            )
        )
        await db.execute(
            delete(models.DashboardItem).where(
                models.DashboardItem.uuid.in_(self.dashboards)
            )
        )
        await db.execute(delete(models.UserApp).where(models.UserApp.uuid.in_(self.apps)))
        # The connections the tests made
        await db.execute(
            delete(models.StoredFile).where(models.StoredFile.creater_uuid.in_(people))
        )
        for table in (
            models.ApiSource,
            models.FileWidget,
            models.MCPServers,
            models.CustomCopilot,
        ):
            await db.execute(delete(table).where(table.user_uuid.in_(people)))
        for table in (
            models.UserRole,
            models.RoleCopilotModel,
            models.RoleMcpAccess,
            models.AuditEntityRolesPermissions,
        ):
            await db.execute(delete(table).where(table.role_uuid.in_(self.roles)))
        await db.execute(delete(models.Role).where(models.Role.uuid.in_(self.roles)))
        await db.execute(
            delete(models.UserUsage).where(models.UserUsage.user_uuid.in_(people))
        )
        await db.execute(
            delete(models.Session).where(models.Session.user_uuid.in_(self.users))
        )
        await db.execute(delete(models.Login).where(models.Login.user_uuid.in_(self.users)))
        await db.execute(delete(models.User).where(models.User.uuid.in_(self.users)))
        await db.execute(
            update(models.User)
            .where(models.User.uuid == MEMBER_UUID)
            .values(permissions_uuid=_AUTH_USER["perm_uuid"])
        )
        # As the organization was created
        await db.execute(
            update(models.Entity)
            .where(models.Entity.uuid == ADMIN_ENTITY)
            .values(sharing_enabled=True)
        )
        await db.execute(
            delete(models.PermissionsEntityMap).where(
                models.PermissionsEntityMap.uuid.in_(
                    [self.maps[models.DEVELOPER_TYPE], self.maps[models.USER_TYPE]]
                )
            )
        )
        await db.commit()
        forget_usage(*people)


@pytest.fixture
async def organization(auth_client, admin_client, db_session):
    """The admin's organization with the test user in it as a "User"."""
    org = Organization(db_session)
    await org.set_up()
    yield org
    await org.tear_down()
