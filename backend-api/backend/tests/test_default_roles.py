"""
The roles every organization starts with.

Agent User grants the default agent with every model it offers (a `*` model grant) and every
tool of the deployment's default MCP servers, with no daily limits; every new user of the
organization gets it. Sharer gives sharing and nothing else: it lifts no limit and switches
no web tool on. Both are roles like any other.
"""

import os
import sys

BACKEND_DIR = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from uuid import uuid4

import pytest
from sqlalchemy import select

from api import models, schemas
from routers import app_helpers
from routers.app.index import process_create_user
from scripts.create_metering_token import create_metering_token
from tests.fixtures.base import settings
from tests.fixtures.organization import ADMIN_ENTITY, MEMBER_UUID
from utilities.config import DefaultMCPServer

AGENT_USER = app_helpers.AGENT_USER_ROLE
SHARER = app_helpers.SHARER_ROLE
METERING = {"X-Metering-Authorization": "Bearer " + create_metering_token()[0]}


async def _default_roles(organization, db_session) -> dict:
    roles = await app_helpers.create_default_roles(db_session, ADMIN_ENTITY)
    await db_session.commit()
    organization.roles.extend(roles.values())
    return roles


async def _roles_of(db_session, user_uuid) -> set:
    return set(
        (
            await db_session.execute(
                select(models.UserRole.role_uuid).where(models.UserRole.user_uuid == user_uuid)
            )
        ).scalars()
    )


class TestTheDefaultRoles:
    @pytest.mark.asyncio
    async def test_an_organization_starts_with_agent_user_and_sharer(
        self, organization, db_session
    ):
        roles = await _default_roles(organization, db_session)

        agent_user = await db_session.get(models.Role, roles[AGENT_USER])
        assert (agent_user.sharing, agent_user.search_web, agent_user.fetch_from_web) == (
            "none",
            True,
            True,
        )
        assert agent_user.copilot_calls_day is None
        assert agent_user.copilot_tokens_day is None
        assert agent_user.upload_size_gb is None

        sharer = await db_session.get(models.Role, roles[SHARER])
        assert (sharer.sharing, sharer.search_web, sharer.fetch_from_web) == ("share", False, False)
        assert (sharer.copilot_calls_day, sharer.copilot_tokens_day, sharer.upload_size_gb) == (
            0,
            0,
            0,
        )

        access = await app_helpers.get_role_copilot_access(db_session, [roles[AGENT_USER]])
        assert access.models == [
            schemas.CopilotModelGrant(agent_id="default_agent", model_id=schemas.ALL_MODELS)
        ]
        assert {(grant.server_url, grant.tool_name) for grant in access.mcp} == {
            (schemas.normalize_mcp_url(server.url), schemas.ALL_MCP_TOOLS)
            for server in settings.DEFAULT_MCP_SERVERS
        }
        sharer_access = await app_helpers.get_role_copilot_access(db_session, [roles[SHARER]])
        assert (sharer_access.models, sharer_access.mcp) == ([], [])

    @pytest.mark.asyncio
    async def test_the_default_mcp_servers_are_granted(
        self, organization, db_session, monkeypatch
    ):
        monkeypatch.setattr(
            settings,
            "DEFAULT_MCP_SERVERS",
            [DefaultMCPServer(id="tools", name="Tools", url="http://Tools.example.com:8787/mcp/")],
        )
        roles = await _default_roles(organization, db_session)

        access = await app_helpers.get_role_copilot_access(db_session, [roles[AGENT_USER]])
        assert [(grant.server_url, grant.tool_name) for grant in access.mcp] == [
            ("http://tools.example.com:8787/mcp", schemas.ALL_MCP_TOOLS)
        ]

    @pytest.mark.asyncio
    async def test_a_role_of_that_name_is_kept_as_it_is(self, organization, db_session):
        mine = await organization.role(sharing="receive")
        role = await db_session.get(models.Role, mine)
        role.name = AGENT_USER
        await db_session.commit()

        roles = await _default_roles(organization, db_session)

        assert roles[AGENT_USER] == mine
        assert (await db_session.get(models.Role, mine)).sharing == "receive"
        access = await app_helpers.get_role_copilot_access(db_session, [mine])
        assert access.models == []

    @pytest.mark.asyncio
    async def test_sharer_lifts_no_limit_and_switches_no_web_tool_on(
        self, organization, db_session
    ):
        roles = await _default_roles(organization, db_session)
        await organization.role(
            MEMBER_UUID, copilot_calls_day=5, upload_size_gb=1, search_web=False
        )
        await organization.assign(roles[SHARER], MEMBER_UUID)

        assert (await app_helpers.get_user_access(db_session, MEMBER_UUID)).sharing == "share"
        limits = await app_helpers.get_user_limits(db_session, MEMBER_UUID)
        assert (limits.copilot_calls_day, limits.upload_size_gb) == (5, 1)
        access = await app_helpers.get_user_copilot_access(db_session, MEMBER_UUID)
        assert schemas.CopilotCapability.SEARCH_WEB in access.disabled_capabilities


class TestAgentUser:
    @pytest.mark.asyncio
    async def test_it_may_use_every_model_of_the_default_agent_and_no_other(
        self, organization, auth_client, db_session
    ):
        roles = await _default_roles(organization, db_session)
        await organization.assign(roles[AGENT_USER], MEMBER_UUID)

        access = (await auth_client.get("/app/copilot/access")).json()
        assert access["models"] == [{"agent_id": "default_agent", "model_id": "*"}]

        for model in ("ollama:stub", "openai:gpt-5"):
            result = await auth_client.post(
                "/app/copilot/authorize",
                json={"agent_id": "default_agent", "model": model},
                headers=METERING,
            )
            assert result.json()["allowed"] is True, model
        other = await auth_client.post(
            "/app/copilot/authorize",
            json={"agent_id": "custom", "model": "ollama:stub"},
            headers=METERING,
        )
        assert other.json()["allowed"] is False

    @pytest.mark.asyncio
    async def test_it_has_no_daily_limits(self, organization, auth_client, db_session):
        roles = await _default_roles(organization, db_session)
        await organization.assign(roles[AGENT_USER], MEMBER_UUID)

        usage = (await auth_client.get("/app/usage")).json()
        assert usage["copilot_calls_limit"] is None
        assert usage["copilot_tokens_limit"] is None
        assert usage["file_upload_size_limit"] is None


class TestNewUsersGetAgentUser:
    @pytest.mark.asyncio
    async def test_a_user_an_admin_adds(self, organization, admin_client, db_session):
        roles = await _default_roles(organization, db_session)
        email = f"new_{uuid4().hex[:8]}@example.com"

        response = await admin_client.post(
            "/admin/create-user",
            json={"email": email, "permissions_uuid": str(organization.maps[models.USER_TYPE])},
        )
        user_uuid = (
            await db_session.execute(select(models.User.uuid).where(models.User.email == email))
        ).scalar_one_or_none()
        if user_uuid:
            organization.users.append(user_uuid)

        assert response.status_code == 200, response.text
        assert await _roles_of(db_session, user_uuid) == {roles[AGENT_USER]}

    @pytest.mark.asyncio
    async def test_with_the_role_the_admin_chose_too(
        self, organization, admin_client, db_session
    ):
        roles = await _default_roles(organization, db_session)
        chosen = await organization.role()
        email = f"new_{uuid4().hex[:8]}@example.com"

        await admin_client.post(
            "/admin/create-user",
            json={
                "email": email,
                "permissions_uuid": str(organization.maps[models.USER_TYPE]),
                "role": str(chosen),
            },
        )
        user_uuid = (
            await db_session.execute(select(models.User.uuid).where(models.User.email == email))
        ).scalar_one()
        organization.users.append(user_uuid)

        assert await _roles_of(db_session, user_uuid) == {roles[AGENT_USER], chosen}

    @pytest.mark.asyncio
    async def test_a_user_who_takes_up_an_invite(self, organization, db_session):
        roles = await _default_roles(organization, db_session)
        email = f"invited_{uuid4().hex[:8]}@example.com"
        invite = models.UserInvite(
            uuid=uuid4(),
            email=email,
            permissions_uuid=organization.maps[models.USER_TYPE],
            data={"first_name": "In", "last_name": "Vited"},
        )
        db_session.add(invite)
        await db_session.commit()
        try:
            user_uuid = await process_create_user(invite.uuid, email, db_session)
            assert user_uuid
            organization.users.append(user_uuid)

            assert await _roles_of(db_session, user_uuid) == {roles[AGENT_USER]}
        finally:
            await db_session.delete(await db_session.get(models.UserInvite, invite.uuid))
            await db_session.commit()

    @pytest.mark.asyncio
    async def test_not_once_an_admin_has_deleted_the_role(
        self, organization, admin_client, db_session
    ):
        roles = await _default_roles(organization, db_session)
        assert (await admin_client.delete(f"/admin/role/{roles[AGENT_USER]}")).status_code == 200
        email = f"new_{uuid4().hex[:8]}@example.com"

        await admin_client.post(
            "/admin/create-user",
            json={"email": email, "permissions_uuid": str(organization.maps[models.USER_TYPE])},
        )
        user_uuid = (
            await db_session.execute(select(models.User.uuid).where(models.User.email == email))
        ).scalar_one()
        organization.users.append(user_uuid)

        assert await _roles_of(db_session, user_uuid) == set()
