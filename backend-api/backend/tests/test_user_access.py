"""
Integration tests for what users may do.

A user's type is the name of their permissions map. What they may do with shared items
and their daily limits come from the roles an admin assigned them: the
most any role allows, and nothing that no role grants. A new role has no limits, and a
developer has none at all. An organization's sharing switch, which a superuser sets,
turns sharing off for all its users.
"""

import os
import sys

BACKEND_DIR = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from sqlalchemy import delete, select, update

from api import models, schemas
from api.events.role_permission_events import track_role_insert, track_role_update
from routers.app.helpers import (
    get_user_access,
    get_user_copilot_access,
    get_user_limits,
)
from tests.fixtures.base import _TEST_ENTITY_TYPE_UUID
from tests.fixtures.base import superuser_override
from tests.fixtures.organization import (
    ADMIN_ENTITY,
    MEMBER_UUID,
    admin_entity_body,
)

PASSWORD = "TestPassword123!"  # noqa: S105

NO_LIMITS = schemas.UserLimits(
    copilot_calls_day=None, copilot_tokens_day=None, upload_size_gb=None
)


def _login(email: str, source: str = "app", remember: bool = False) -> dict:
    return {
        "email": email,
        "password": PASSWORD,
        "remember": remember,
        "source": source,
        "totp_token": None,
        "version": "v1.0.0",
    }


class TestAccessFromRoles:
    @pytest.mark.asyncio
    async def test_a_user_without_roles_gets_nothing(self, organization, db_session):
        assert await get_user_access(db_session, MEMBER_UUID) == schemas.UserAccess(
            user_type="User", sharing="none"
        )
        assert await get_user_limits(db_session, MEMBER_UUID) == schemas.UserLimits(
            copilot_calls_day=0, copilot_tokens_day=0, upload_size_gb=0
        )

    @pytest.mark.asyncio
    async def test_a_role_with_default_settings_shares_nothing_and_limits_nothing(
        self, organization, db_session
    ):
        await organization.role(MEMBER_UUID)

        assert (await get_user_access(db_session, MEMBER_UUID)).sharing == "none"
        assert await get_user_limits(db_session, MEMBER_UUID) == NO_LIMITS

    @pytest.mark.asyncio
    async def test_a_developer_has_no_limits(self, organization, db_session):
        await organization.set_type(MEMBER_UUID, models.DEVELOPER_TYPE)
        assert await get_user_limits(db_session, MEMBER_UUID) == NO_LIMITS

        # Not even when a role of theirs sets limits
        await organization.role(
            MEMBER_UUID, copilot_calls_day=0, copilot_tokens_day=0, upload_size_gb=0
        )
        assert await get_user_limits(db_session, MEMBER_UUID) == NO_LIMITS

    @pytest.mark.asyncio
    async def test_admins_and_users_get_the_limits_of_their_roles(
        self, organization, db_session
    ):
        await organization.role(
            MEMBER_UUID, copilot_calls_day=0, copilot_tokens_day=0, upload_size_gb=0
        )
        for user_type in (models.ADMIN_TYPE, models.USER_TYPE):
            await organization.set_type(MEMBER_UUID, user_type)
            assert await get_user_limits(db_session, MEMBER_UUID) == schemas.UserLimits(
                copilot_calls_day=0, copilot_tokens_day=0, upload_size_gb=0
            ), user_type

    @pytest.mark.asyncio
    async def test_an_admin_making_a_user_a_developer_lifts_their_limits(
        self, organization, admin_client, auth_client
    ):
        await organization.role(
            MEMBER_UUID, copilot_calls_day=1, copilot_tokens_day=10, upload_size_gb=1
        )
        usage = (await auth_client.get("/app/usage")).json()
        assert (usage["copilot_calls_limit"], usage["copilot_tokens_limit"]) == (1, 10)

        response = await admin_client.patch(
            f"/admin/users/{MEMBER_UUID}",
            json={"permissions_uuid": str(organization.maps[models.DEVELOPER_TYPE])},
        )
        assert response.status_code == 200, response.text

        usage = (await auth_client.get("/app/usage")).json()
        assert usage["copilot_calls_limit"] is None
        assert usage["copilot_tokens_limit"] is None
        assert usage["file_upload_size_limit"] is None

    @pytest.mark.asyncio
    async def test_roles_add_up(self, organization, db_session):
        await organization.role(
            MEMBER_UUID,
            sharing="receive",
            copilot_calls_day=5,
            copilot_tokens_day=1_000,
            upload_size_gb=1,
        )
        await organization.role(
            MEMBER_UUID,
            sharing="share",
            copilot_calls_day=3,
            copilot_tokens_day=2_000,
            upload_size_gb=2,
        )
        await organization.role(
            MEMBER_UUID,
            sharing="none",
            copilot_calls_day=0,
            copilot_tokens_day=0,
            upload_size_gb=0,
        )

        assert (await get_user_access(db_session, MEMBER_UUID)).sharing == "share"
        assert await get_user_limits(db_session, MEMBER_UUID) == schemas.UserLimits(
            copilot_calls_day=5, copilot_tokens_day=2_000, upload_size_gb=2
        )

    @pytest.mark.asyncio
    async def test_receiving_is_less_than_sharing(self, organization, db_session):
        await organization.role(MEMBER_UUID, sharing="receive")

        assert (await get_user_access(db_session, MEMBER_UUID)).sharing == "receive"

    @pytest.mark.asyncio
    async def test_a_role_without_a_limit_lifts_it(self, organization, db_session):
        await organization.role(MEMBER_UUID, copilot_calls_day=5, upload_size_gb=1)
        await organization.role(
            MEMBER_UUID,
            copilot_calls_day=None,
            copilot_tokens_day=None,
            upload_size_gb=None,
        )

        assert await get_user_limits(db_session, MEMBER_UUID) == NO_LIMITS

    @pytest.mark.asyncio
    async def test_the_organization_switch_turns_sharing_off(
        self, organization, db_session
    ):
        await organization.role(MEMBER_UUID, sharing="share")
        await organization.set_sharing_enabled(False)

        assert (await get_user_access(db_session, MEMBER_UUID)).sharing == "none"

    @pytest.mark.asyncio
    async def test_deleted_roles_give_nothing(self, organization, db_session):
        role = await organization.role(
            MEMBER_UUID,
            sharing="share",
            copilot_calls_day=None,
            copilot_tokens_day=None,
            upload_size_gb=None,
        )
        await db_session.execute(
            update(models.Role)
            .where(models.Role.uuid == role)
            .values(deleted_at=datetime.now(UTC))
        )
        await db_session.commit()

        assert (await get_user_access(db_session, MEMBER_UUID)).sharing == "none"
        assert (await get_user_limits(db_session, MEMBER_UUID)).copilot_calls_day == 0

    @pytest.mark.asyncio
    async def test_roles_of_an_organization_the_user_is_not_in_give_nothing(
        self, organization, db_session
    ):
        user = await organization.add_user()
        await organization.role(
            user.uuid,
            sharing="share",
            copilot_calls_day=None,
            copilot_tokens_day=None,
            upload_size_gb=None,
        )
        await db_session.execute(
            update(models.User)
            .where(models.User.uuid == user.uuid)
            .values(permissions_uuid=None)
        )
        await db_session.commit()

        assert await get_user_access(db_session, user.uuid) == schemas.UserAccess(
            user_type=None, sharing="none"
        )
        assert await get_user_limits(db_session, user.uuid) == schemas.UserLimits(
            copilot_calls_day=0, copilot_tokens_day=0, upload_size_gb=0
        )

    @pytest.mark.asyncio
    async def test_the_user_type_is_the_name_of_the_permissions_map(
        self, organization, db_session
    ):
        for user_type in models.USER_TYPES:
            await organization.set_type(MEMBER_UUID, user_type)
            assert (await get_user_access(db_session, MEMBER_UUID)).user_type == user_type

    @pytest.mark.asyncio
    async def test_a_map_of_another_name_is_no_type(self, organization, db_session):
        other = models.PermissionsEntityMap(
            uuid=uuid4(), entity_uuid=ADMIN_ENTITY, name="Analyst"
        )
        db_session.add(other)
        await db_session.commit()
        organization.maps["Analyst"] = other.uuid
        try:
            await organization.set_type(MEMBER_UUID, "Analyst")

            assert (await get_user_access(db_session, MEMBER_UUID)).user_type is None
        finally:
            await organization.set_type(MEMBER_UUID, models.USER_TYPE)
            await db_session.execute(
                delete(models.PermissionsEntityMap).where(
                    models.PermissionsEntityMap.uuid == other.uuid
                )
            )
            await db_session.commit()


class TestAccessEndpoint:
    @pytest.mark.asyncio
    async def test_access_is_served_to_the_user(self, organization, auth_client):
        await organization.role(MEMBER_UUID, sharing="receive")

        response = await auth_client.get("/app/access")

        assert response.status_code == 200
        assert response.json() == {"user_type": "User", "sharing": "receive"}

    @pytest.mark.asyncio
    async def test_access_needs_a_session(self, client):
        response = await client.get("/app/access")
        assert response.status_code in {401, 403}

    @pytest.mark.asyncio
    async def test_the_sync_carries_the_access(self, organization, auth_client):
        await organization.role(MEMBER_UUID, sharing="share")

        data = (await auth_client.get("/app/dash/validate-and-sync")).json()

        assert data["access"] == {"user_type": "User", "sharing": "share"}

    @pytest.mark.asyncio
    async def test_the_admin_changes_the_user_type(
        self, organization, admin_client, auth_client
    ):
        maps = (await admin_client.get("/admin/entity-map")).json()
        assert {item["name"] for item in maps} == set(models.USER_TYPES)
        developer = next(item for item in maps if item["name"] == "Developer")

        response = await admin_client.patch(
            f"/admin/users/{MEMBER_UUID}",
            json={"permissions_uuid": developer["uuid"]},
        )
        assert response.status_code == 200

        assert (await auth_client.get("/app/access")).json()["user_type"] == "Developer"


class TestSignIn:
    @pytest.mark.asyncio
    async def test_sign_in_returns_the_access(self, organization, app_client):
        user = await organization.add_user(password=PASSWORD)

        response = await app_client.post("/app/login", json=_login(user.email))

        assert response.status_code == 200, response.text
        data = response.json()
        assert data["access"] == {"user_type": "User", "sharing": "none"}

    @pytest.mark.asyncio
    async def test_a_new_user_lands_on_the_apps_page(self, organization, app_client):
        user = await organization.add_user(password=PASSWORD)

        response = await app_client.post("/app/login", json=_login(user.email))

        assert response.status_code == 200, response.text
        assert response.json()["user"]["display_settings"]["lastVisitedPage"] == "/app"

    @pytest.mark.asyncio
    @pytest.mark.parametrize(("remember", "days"), [(True, 30), (False, 7)])
    async def test_the_session_lasts_30_days_remembered_and_7_otherwise(
        self, organization, app_client, remember, days
    ):
        user = await organization.add_user(password=PASSWORD)

        before = datetime.now(UTC)
        response = await app_client.post(
            "/app/login", json=_login(user.email, remember=remember)
        )

        assert response.status_code == 200, response.text
        expires = datetime.fromisoformat(response.json()["expiration_date"])
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=UTC)
        assert abs(expires - (before + timedelta(days=days))) < timedelta(minutes=5)


class TestSignOut:
    @pytest.mark.asyncio
    async def test_signing_out_ends_the_web_apps_session(
        self, organization, app_client, db_session
    ):
        user = await organization.add_user(password=PASSWORD)
        response = await app_client.post("/app/login", json=_login(user.email))
        assert response.status_code == 200, response.text
        # The web app's session is the cookie only
        assert "access_token" not in response.json()

        response = await app_client.post("/app/logout")
        assert response.status_code == 200, response.text
        assert response.json() == {"success": True}

        sessions = (
            await db_session.execute(
                select(models.Session.uuid).where(
                    models.Session.user_uuid == user.uuid,
                    models.Session.app_session.is_(True),
                )
            )
        ).scalars()
        assert list(sessions) == []


class TestOrganizations:
    @pytest.mark.asyncio
    async def test_a_new_organization_gets_the_three_types_and_sharing_on(
        self, auth_client, db_session
    ):
        with (
            superuser_override(),
            patch("routers.administration.notify_admins", AsyncMock(return_value=None)),
        ):
            response = await auth_client.post(
                "/entity/entity",
                json={
                    "name": f"Typed Entity {uuid4().hex[:8]}",
                    "entity_code": _TEST_ENTITY_TYPE_UUID,
                    "email": "typed-entity@example.com",
                    "company_type": "other",
                    "organization_size": "1-10",
                    "aum": 0,
                    "country": "US",
                    "admin_email": "typed-entity-admin@example.com",
                },
            )
            assert response.status_code == 200, response.text
            entity_uuid = response.json()["entity_uuid"]
            try:
                maps = (
                    await db_session.execute(
                        select(models.PermissionsEntityMap.name).where(
                            models.PermissionsEntityMap.entity_uuid == entity_uuid
                        )
                    )
                ).scalars()
                assert sorted(maps) == sorted(models.USER_TYPES)
                sharing_enabled = (
                    await db_session.execute(
                        select(models.Entity.sharing_enabled).where(
                            models.Entity.uuid == entity_uuid
                        )
                    )
                ).scalar_one()
                # Its roles decide who shares, and a new role shares nothing
                assert sharing_enabled is True
            finally:
                await db_session.execute(
                    delete(models.PermissionsEntityMap).where(
                        models.PermissionsEntityMap.entity_uuid == entity_uuid
                    )
                )
                await db_session.commit()
                await auth_client.delete(f"/entity/entity/{entity_uuid}")

    @pytest.mark.asyncio
    async def test_a_superuser_switches_sharing(
        self, organization, auth_client, db_session
    ):
        body = admin_entity_body(sharing_enabled=False)
        with superuser_override():
            # The switch has to be given
            response = await auth_client.put(
                f"/entity/entity/{ADMIN_ENTITY}",
                json={key: value for key, value in body.items() if key != "sharing_enabled"},
            )
            assert response.status_code == 422

            response = await auth_client.put(f"/entity/entity/{ADMIN_ENTITY}", json=body)
            assert response.status_code == 200, response.text

        sharing_enabled = (
            await db_session.execute(
                select(models.Entity.sharing_enabled).where(
                    models.Entity.uuid == ADMIN_ENTITY
                )
            )
        ).scalar_one()
        assert sharing_enabled is False

    @pytest.mark.asyncio
    @pytest.mark.parametrize("name", ["admin", "Viewer", ""])
    async def test_permissions_maps_are_named_after_the_types(
        self, auth_client, name
    ):
        with superuser_override():
            response = await auth_client.post(
                "/entity/entity-map",
                json={"entity_uuid": str(ADMIN_ENTITY), "name": name},
            )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_an_organization_has_one_map_of_each_type(
        self, organization, auth_client
    ):
        user_map = organization.maps[models.USER_TYPE]
        with superuser_override():
            response = await auth_client.post(
                "/entity/entity-map",
                json={"entity_uuid": str(ADMIN_ENTITY), "name": models.USER_TYPE},
            )
            assert response.status_code == 409
            assert response.json()["detail"] == "The organization already has a User map"

            response = await auth_client.put(
                f"/entity/entity-map/{user_map}",
                json={"entity_uuid": str(ADMIN_ENTITY), "name": models.DEVELOPER_TYPE},
            )
            assert response.status_code == 409

            response = await auth_client.put(
                f"/entity/entity-map/{user_map}",
                json={"entity_uuid": str(ADMIN_ENTITY), "name": models.USER_TYPE},
            )
            assert response.status_code == 200, response.text


class TestLeavingTheOrganization:
    @pytest.mark.asyncio
    async def test_a_user_removed_from_the_organization_leaves_its_roles(
        self, organization, admin_client, db_session
    ):
        user = await organization.add_user()
        role_uuid = await organization.role(
            user.uuid, sharing="share", copilot_calls_day=None
        )
        db_session.add(
            models.RoleCopilotModel(role_uuid=role_uuid, agent_id="agent", model_id="m")
        )
        await db_session.commit()

        response = await admin_client.delete(f"/admin/users/{user.uuid}/remove")
        assert response.status_code == 200, response.text

        user_roles = (
            await db_session.execute(
                select(models.UserRole.role_uuid).where(
                    models.UserRole.user_uuid == user.uuid
                )
            )
        ).all()
        assert user_roles == []
        assert (await get_user_access(db_session, user.uuid)).sharing == "none"
        assert (await get_user_limits(db_session, user.uuid)).copilot_calls_day == 0
        assert (await get_user_copilot_access(db_session, user.uuid)).models == []

        # Nor is the user listed among the role's members
        members = (await admin_client.get(f"/admin/role/{role_uuid}")).json()["users"]
        assert user.email not in members

    @pytest.mark.asyncio
    async def test_a_removed_user_is_signed_out_and_signs_in_no_more(
        self, organization, app_client, admin_client, db_session
    ):
        user = await organization.add_user(password=PASSWORD)
        response = await app_client.post("/app/login", json=_login(user.email))
        assert response.status_code == 200, response.text
        assert (await app_client.get("/app/user")).status_code == 200

        response = await admin_client.delete(f"/admin/users/{user.uuid}/remove")
        assert response.status_code == 200, response.text

        # Every session of theirs ended at once
        assert (await app_client.get("/app/user")).status_code == 401
        sessions = (
            await db_session.execute(
                select(models.Session.uuid).where(models.Session.user_uuid == user.uuid)
            )
        ).scalars()
        assert list(sessions) == []

        # They are no user any more: the right password signs nobody in, and puts them nowhere
        response = await app_client.post("/app/login", json=_login(user.email))
        assert response.status_code == 401
        permissions = (
            await db_session.execute(
                select(models.User.permissions_uuid).where(models.User.uuid == user.uuid)
            )
        ).scalar_one()
        assert permissions is None


class TestRoleAudit:
    def test_a_new_role_is_recorded_with_its_settings(self):
        role = models.Role(
            uuid=uuid4(),
            name="Analysts",
            description="Read and share",
            sharing="share",
            copilot_calls_day=None,
            copilot_tokens_day=1000,
            upload_size_gb=2,
            search_web=True,
            fetch_from_web=False,
        )
        with patch("api.events.role_permission_events._create_role_audit_entry") as audit:
            track_role_insert(None, None, role)

        assert audit.call_args.args[4] == {
            "name": "Analysts",
            "description": "Read and share",
            "sharing": "share",
            "copilot_calls_day": None,
            "copilot_tokens_day": 1000,
            "upload_size_gb": 2,
            "search_web": True,
            "fetch_from_web": False,
        }

    @pytest.mark.asyncio
    async def test_changed_settings_are_recorded(self, organization, db_session):
        role_uuid = await organization.role(sharing="receive", copilot_calls_day=5)
        role = await db_session.get(models.Role, role_uuid)
        role.sharing = "share"
        role.copilot_calls_day = None
        role.search_web = False
        try:
            with patch(
                "api.events.role_permission_events._create_role_audit_entry"
            ) as audit:
                track_role_update(None, None, role)
        finally:
            await db_session.rollback()

        assert audit.call_args.args[4] == {
            "sharing": {"old": "receive", "new": "share"},
            "copilot_calls_day": {"old": 5, "new": None},
            "search_web": {"old": True, "new": False},
        }


class TestRoleSettings:
    @pytest.mark.asyncio
    async def test_the_settings_round_trip(self, organization, admin_client):
        role_uuid = uuid4()
        organization.roles.append(role_uuid)
        response = await admin_client.post(
            "/admin/role",
            json={
                "uuid": str(role_uuid),
                "name": f"Analysts {role_uuid.hex[:8]}",
                "description": "Read and share",
                "sharing": "share",
                "copilot_calls_day": 10,
                "copilot_tokens_day": None,
                "upload_size_gb": 5,
                "search_web": False,
            },
        )
        assert response.status_code == 200, response.text

        role = (await admin_client.get(f"/admin/role/{role_uuid}")).json()
        assert {key: role[key] for key in ("sharing", *schemas.ROLE_LIMITS, "search_web")} == {
            "sharing": "share",
            "copilot_calls_day": 10,
            "copilot_tokens_day": None,
            "upload_size_gb": 5,
            "search_web": False,
        }
        listed = next(
            item
            for item in (await admin_client.get("/admin/role")).json()
            if item["uuid"] == str(role_uuid)
        )
        assert listed == role

    @pytest.mark.asyncio
    async def test_a_new_role_shares_nothing_and_has_no_limits_by_default(
        self, organization, admin_client
    ):
        role_uuid = uuid4()
        organization.roles.append(role_uuid)
        response = await admin_client.post(
            "/admin/role",
            json={
                "uuid": str(role_uuid),
                "name": f"Plain {role_uuid.hex[:8]}",
                "description": "Nothing",
            },
        )
        assert response.status_code == 200, response.text

        role = (await admin_client.get(f"/admin/role/{role_uuid}")).json()
        assert role["sharing"] == "none"
        assert role["copilot_calls_day"] is None
        assert role["copilot_tokens_day"] is None
        assert role["upload_size_gb"] is None
        assert (role["search_web"], role["fetch_from_web"]) == (True, True)

    @pytest.mark.asyncio
    async def test_patching_sets_what_is_sent_and_a_limit_back_to_none(
        self, organization, admin_client
    ):
        role_uuid = await organization.role(
            sharing="receive", copilot_calls_day=4, upload_size_gb=2, search_web=False
        )
        path = f"/admin/role/{role_uuid}"

        response = await admin_client.patch(path, json={"copilot_calls_day": None})
        assert response.status_code == 200
        role = (await admin_client.get(path)).json()
        assert role["copilot_calls_day"] is None
        assert (role["sharing"], role["upload_size_gb"], role["search_web"]) == (
            "receive",
            2,
            False,
        )

        response = await admin_client.patch(
            path, json={"sharing": "share", "upload_size_gb": 3, "search_web": True}
        )
        assert response.status_code == 200
        role = (await admin_client.get(path)).json()
        assert (role["sharing"], role["upload_size_gb"], role["search_web"]) == (
            "share",
            3,
            True,
        )
        assert role["copilot_calls_day"] is None

        response = await admin_client.patch(path, json={"copilot_calls_day": 7})
        assert response.status_code == 200
        assert (await admin_client.get(path)).json()["copilot_calls_day"] == 7

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "settings_",
        [
            {"sharing": "everyone"},
            {"copilot_calls_day": -1},
            {"copilot_tokens_day": -1},
            {"upload_size_gb": -1},
        ],
    )
    async def test_settings_are_validated(self, organization, admin_client, settings_):
        role_uuid = await organization.role()

        response = await admin_client.patch(f"/admin/role/{role_uuid}", json=settings_)
        assert response.status_code == 422

        response = await admin_client.post(
            "/admin/role",
            json={"name": f"Invalid {uuid4().hex[:8]}", "description": "", **settings_},
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_only_admins_change_role_settings(self, organization, auth_client):
        role_uuid = await organization.role(MEMBER_UUID)

        response = await auth_client.patch(
            f"/admin/role/{role_uuid}", json={"sharing": "share", "search_web": False}
        )
        assert response.status_code in {401, 403}
        assert (await auth_client.get("/app/access")).json()["sharing"] == "none"
