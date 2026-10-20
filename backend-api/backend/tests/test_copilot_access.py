"""
Integration tests for admin-assigned access to Copilot models and MCP tools.

Roles grant models and MCP tools. A user whose roles grant nothing of a kind is not
restricted in it, and once a role grants something the user may use what their roles
grant and nothing else. The service that serves the Copilot enforces this through
``POST /app/copilot/authorize``, and the MCP proxy refuses tool calls that are not granted.
"""

import os
import sys

BACKEND_DIR = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from unittest.mock import patch
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from api import models
from routers.app.index import MCPProxyRequest, check_mcp_tool_calls
from scripts.create_metering_token import create_metering_token
from tests.fixtures.base import (
    _ADMIN_USER,
    _AUTH_USER,
    _get_test_db_url_async,
    settings,
    superuser_override,
)
from tests.fixtures.db import TestAsyncSessionLocal

MEMBER_UUID = UUID(_AUTH_USER["user_uuid"])
ADMIN_ENTITY = _ADMIN_USER["entity_uuid"]
METERING = {"X-Metering-Authorization": "Bearer " + create_metering_token()[0]}

MCP_URL = "https://mcp.example.com/mcp"
OTHER_MCP_URL = "https://tools.example.com/mcp"


@pytest.fixture(autouse=True)
async def worker_database(client):
    """Point the code that opens its own database sessions at the test database."""
    engine = create_async_engine(_get_test_db_url_async(), pool_pre_ping=True)
    sessions = TestAsyncSessionLocal(
        async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    )
    with (
        patch("api.worker_tasks.AsyncReadSessionLocal", sessions),
        patch("api.worker_tasks.AsyncWriteSessionLocal", sessions),
    ):
        yield
    await engine.dispose()


async def _make_role(db_session, name: str, entity_uuid=ADMIN_ENTITY) -> UUID:
    role = models.Role(uuid=uuid4(), name=name, description=name, entity_uuid=entity_uuid)
    db_session.add(role)
    await db_session.commit()
    return role.uuid


async def _assign(db_session, role_uuid: UUID, user_uuid: UUID = MEMBER_UUID) -> None:
    db_session.add(models.UserRole(user_uuid=user_uuid, role_uuid=role_uuid))
    await db_session.commit()


@pytest.fixture
async def organization(auth_client, admin_client, db_session):
    """The test user as a regular member of the admin's organization, plus its roles."""
    member_perm = models.PermissionsEntityMap(
        uuid=uuid4(), entity_uuid=ADMIN_ENTITY, name="User"
    )
    db_session.add(member_perm)
    await db_session.commit()
    await db_session.execute(
        update(models.User)
        .where(models.User.uuid == MEMBER_UUID)
        .values(permissions_uuid=member_perm.uuid)
    )
    await db_session.commit()

    roles: list[UUID] = []

    async def new_role(name: str) -> UUID:
        role_uuid = await _make_role(db_session, name)
        roles.append(role_uuid)
        return role_uuid

    yield new_role

    for table in (models.UserRole, models.RoleCopilotModel, models.RoleMcpAccess):
        await db_session.execute(
            delete(table).where(table.role_uuid.in_(roles))
            if table is not models.UserRole
            else delete(table).where(
                table.role_uuid.in_(roles), table.user_uuid == MEMBER_UUID
            )
        )
    await db_session.execute(delete(models.Role).where(models.Role.uuid.in_(roles)))
    await db_session.execute(
        update(models.User)
        .where(models.User.uuid == MEMBER_UUID)
        .values(permissions_uuid=_AUTH_USER["perm_uuid"])
    )
    await db_session.execute(
        delete(models.PermissionsEntityMap).where(
            models.PermissionsEntityMap.uuid == member_perm.uuid
        )
    )
    await db_session.commit()


def _grants(models_=(), mcp=()):
    return {
        "models": [{"agent_id": a, "model_id": m} for a, m in models_],
        "mcp": [{"server_url": u, "tool_name": t} for u, t in mcp],
    }


async def _authorize(client, **request):
    return await client.post("/app/copilot/authorize", json=request, headers=METERING)


class TestOpenByDefault:
    @pytest.mark.asyncio
    async def test_nothing_is_restricted_until_an_admin_grants_something(
        self, organization, auth_client
    ):
        access = (await auth_client.get("/app/copilot/access")).json()
        assert access["models_restricted"] is False
        assert access["mcp_restricted"] is False

        result = await _authorize(
            auth_client,
            agent_id="default-copilot",
            model="any-model",
            tools=[{"url": MCP_URL, "tool_name": "any_tool"}],
        )
        assert result.status_code == 200
        assert result.json()["allowed"] is True

    @pytest.mark.asyncio
    async def test_a_role_without_grants_restricts_nothing(
        self, organization, auth_client, db_session
    ):
        await _assign(db_session, await organization("Analysts"))

        access = (await auth_client.get("/app/copilot/access")).json()
        assert access["models_restricted"] is False
        assert access["mcp_restricted"] is False


class TestAdminAssignsAccess:
    @pytest.mark.asyncio
    async def test_admin_sets_and_reads_a_roles_grants(
        self, organization, admin_client
    ):
        role = await organization("Analysts")
        grants = _grants(
            models_=[("default-copilot", "fast"), ("default-copilot", "smart")],
            mcp=[("https://MCP.example.com/mcp/", "*"), (OTHER_MCP_URL, "search")],
        )

        response = await admin_client.put(
            f"/admin/role/{role}/copilot-access", json=grants
        )
        assert response.status_code == 200

        stored = (await admin_client.get(f"/admin/role/{role}/copilot-access")).json()
        assert {(m["agent_id"], m["model_id"]) for m in stored["models"]} == {
            ("default-copilot", "fast"),
            ("default-copilot", "smart"),
        }
        # Server URLs are kept in one form, so they compare equal whatever the spelling
        assert {(m["server_url"], m["tool_name"]) for m in stored["mcp"]} == {
            (MCP_URL, "*"),
            (OTHER_MCP_URL, "search"),
        }

    @pytest.mark.asyncio
    async def test_putting_replaces_the_grants(self, organization, admin_client):
        role = await organization("Analysts")
        path = f"/admin/role/{role}/copilot-access"
        await admin_client.put(
            path, json=_grants(models_=[("a", "one")], mcp=[(MCP_URL, "*")])
        )

        await admin_client.put(path, json=_grants(models_=[("a", "two")]))

        stored = (await admin_client.get(path)).json()
        assert stored["models"] == [{"agent_id": "a", "model_id": "two"}]
        assert stored["mcp"] == []

    @pytest.mark.asyncio
    async def test_grants_are_validated(self, organization, admin_client):
        role = await organization("Analysts")

        response = await admin_client.put(
            f"/admin/role/{role}/copilot-access",
            json=_grants(models_=[("default-copilot", "")]),
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_only_admins_set_grants(self, organization, auth_client):
        role = await organization("Analysts")

        response = await auth_client.put(
            f"/admin/role/{role}/copilot-access", json=_grants(models_=[("a", "m")])
        )
        assert response.status_code in {401, 403}

    @pytest.mark.asyncio
    async def test_admins_only_set_grants_of_their_own_roles(
        self, organization, admin_client, db_session
    ):
        outside = await _make_role(
            db_session, "Elsewhere", entity_uuid=_AUTH_USER["entity_uuid"]
        )
        try:
            path = f"/admin/role/{outside}/copilot-access"
            response = await admin_client.put(path, json=_grants(models_=[("a", "m")]))
            assert response.status_code == 404
            assert (await admin_client.get(path)).status_code == 404
        finally:
            await db_session.execute(delete(models.Role).where(models.Role.uuid == outside))
            await db_session.commit()


class TestUsersGetWhatTheirRolesGrant:
    @pytest.mark.asyncio
    async def test_models_are_limited_to_the_granted_ones(
        self, organization, admin_client, auth_client, db_session
    ):
        role = await organization("Analysts")
        await _assign(db_session, role)
        await admin_client.put(
            f"/admin/role/{role}/copilot-access",
            json=_grants(models_=[("default-copilot", "fast")]),
        )

        access = (await auth_client.get("/app/copilot/access")).json()
        assert access["models_restricted"] is True
        assert access["models"] == [{"agent_id": "default-copilot", "model_id": "fast"}]
        assert access["mcp_restricted"] is False

        allowed = await _authorize(auth_client, agent_id="default-copilot", model="fast")
        assert allowed.json()["allowed"] is True

        denied = await _authorize(auth_client, agent_id="default-copilot", model="smart")
        assert denied.json() == {
            "allowed": False,
            "denied_model": "smart",
            "denied_tools": [],
            "disabled_capabilities": [],
        }

        # The same model id of another agent is another model
        other_agent = await _authorize(auth_client, agent_id="custom", model="fast")
        assert other_agent.json()["allowed"] is False

    @pytest.mark.asyncio
    async def test_tools_are_limited_to_the_granted_servers_and_tools(
        self, organization, admin_client, auth_client, db_session
    ):
        role = await organization("Analysts")
        await _assign(db_session, role)
        await admin_client.put(
            f"/admin/role/{role}/copilot-access",
            json=_grants(mcp=[(MCP_URL, "*"), (OTHER_MCP_URL, "search")]),
        )

        result = await _authorize(
            auth_client,
            tools=[
                {"url": MCP_URL, "tool_name": "anything"},
                {"url": "https://MCP.example.com/mcp/", "tool_name": "other"},
                {"url": OTHER_MCP_URL, "tool_name": "search"},
                {"url": OTHER_MCP_URL, "tool_name": "delete"},
                {"url": "https://elsewhere.example.com/mcp", "tool_name": "search"},
            ],
        )

        body = result.json()
        assert body["allowed"] is False
        assert body["denied_model"] is None
        assert body["denied_tools"] == [
            {"url": OTHER_MCP_URL, "tool_name": "delete"},
            {"url": "https://elsewhere.example.com/mcp", "tool_name": "search"},
        ]

    @pytest.mark.asyncio
    async def test_roles_add_up(
        self, organization, admin_client, auth_client, db_session
    ):
        first = await organization("Analysts")
        second = await organization("Researchers")
        await _assign(db_session, first)
        await _assign(db_session, second)
        await admin_client.put(
            f"/admin/role/{first}/copilot-access", json=_grants(models_=[("a", "fast")])
        )
        await admin_client.put(
            f"/admin/role/{second}/copilot-access", json=_grants(models_=[("a", "smart")])
        )

        for model in ("fast", "smart"):
            result = await _authorize(auth_client, agent_id="a", model=model)
            assert result.json()["allowed"] is True
        assert (
            await _authorize(auth_client, agent_id="a", model="huge")
        ).json()["allowed"] is False

    @pytest.mark.asyncio
    async def test_users_outside_the_role_are_not_restricted(
        self, organization, admin_client, auth_client, db_session
    ):
        role = await organization("Analysts")
        await admin_client.put(
            f"/admin/role/{role}/copilot-access", json=_grants(models_=[("a", "fast")])
        )

        access = (await auth_client.get("/app/copilot/access")).json()
        assert access["models_restricted"] is False

    @pytest.mark.asyncio
    async def test_deleted_roles_grant_nothing(
        self, organization, admin_client, auth_client, db_session
    ):
        role = await organization("Analysts")
        await _assign(db_session, role)
        await admin_client.put(
            f"/admin/role/{role}/copilot-access", json=_grants(models_=[("a", "fast")])
        )
        assert (await admin_client.delete(f"/admin/role/{role}")).status_code == 200

        access = (await auth_client.get("/app/copilot/access")).json()
        assert access["models_restricted"] is False


class TestSync:
    @pytest.mark.asyncio
    async def test_the_sync_carries_what_the_user_may_use(
        self, organization, admin_client, auth_client, db_session
    ):
        role = await organization("Analysts")
        await _assign(db_session, role)
        await admin_client.put(
            f"/admin/role/{role}/copilot-access",
            json=_grants(models_=[("default-copilot", "fast")]),
        )

        db_session.add(
            models.Entitlement(
                user_uuid=MEMBER_UUID,
                tier_id=models.FULL_TIER_ID,
                number_copilot_calls_day=10,
                total_file_upload_size_gb=1,
                share_widgets="private",
                bring_your_own_data=False,
                bring_your_own_copilot=False,
                admin_access=False,
                support=False,
                data_add_ons_redistribution=False,
            )
        )
        await db_session.commit()
        try:
            response = await auth_client.get("/app/dash/validate-and-sync")
        finally:
            for table in (models.EntitlementUsage, models.Entitlement):
                await db_session.execute(
                    delete(table).where(table.user_uuid == MEMBER_UUID)
                )
            await db_session.commit()
            settings.redis_cache(f"usage:{MEMBER_UUID}", delete=True)

        assert response.status_code == 200
        access = response.json()["copilot_access"]
        assert access["models_restricted"] is True
        assert access["models"] == [{"agent_id": "default-copilot", "model_id": "fast"}]


class TestEnforcement:
    @pytest.mark.asyncio
    async def test_users_cannot_authorize_themselves(self, organization, auth_client):
        response = await auth_client.post(
            "/app/copilot/authorize", json={"agent_id": "a", "model": "m"}
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_the_proxy_refuses_tool_calls_that_are_not_granted(
        self, organization, admin_client, auth_client, db_session
    ):
        role = await organization("Analysts")
        await _assign(db_session, role)
        await admin_client.put(
            f"/admin/role/{role}/copilot-access",
            json=_grants(mcp=[(MCP_URL, "search")]),
        )

        response = await auth_client.post(
            "/app/mcp-proxy",
            json={
                "url": MCP_URL,
                "method": "POST",
                "body": {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "tools/call",
                    "params": {"name": "delete", "arguments": {}},
                },
            },
        )
        assert response.status_code == 403
        assert "delete" in response.json()["detail"]

        batch = await auth_client.post(
            "/app/mcp-proxy",
            json={
                "url": MCP_URL,
                "method": "POST",
                "body": [
                    {"method": "tools/call", "params": {"name": "search"}},
                    {"method": "tools/call", "params": {"name": "delete"}},
                ],
            },
        )
        assert batch.status_code == 403

    @pytest.mark.asyncio
    async def test_the_proxy_check_lets_granted_calls_and_other_requests_through(
        self, organization, admin_client, db_session
    ):
        role = await organization("Analysts")
        await _assign(db_session, role)
        await admin_client.put(
            f"/admin/role/{role}/copilot-access",
            json=_grants(mcp=[(MCP_URL, "search")]),
        )

        def request(body):
            return MCPProxyRequest(url=MCP_URL, method="POST", body=body)

        calls = [
            request({"method": "tools/call", "params": {"name": "search"}}),
            # The same proxy carries the handshake and the OAuth traffic of any server
            request({"method": "tools/list"}),
            request({"method": "initialize", "params": {}}),
            request(None),
        ]
        for call in calls:
            await check_mcp_tool_calls(db_session, MEMBER_UUID, call)

        with pytest.raises(HTTPException) as refused:
            await check_mcp_tool_calls(
                db_session,
                MEMBER_UUID,
                request({"method": "tools/call", "params": {"name": "delete"}}),
            )
        assert refused.value.status_code == 403


async def _entitle(db_session, **flags) -> None:
    """Give the test user an entitlement, with the flags of the Copilot's web tools as asked (on if not)."""
    await _drop_entitlement(db_session)
    db_session.add(
        models.Entitlement(
            user_uuid=MEMBER_UUID,
            tier_id=models.FULL_TIER_ID,
            number_copilot_calls_day=10,
            total_file_upload_size_gb=1,
            share_widgets="private",
            bring_your_own_data=False,
            bring_your_own_copilot=False,
            admin_access=False,
            support=False,
            data_add_ons_redistribution=False,
            **flags,
        )
    )
    await db_session.commit()


async def _drop_entitlement(db_session) -> None:
    for table in (models.EntitlementUsage, models.Entitlement):
        await db_session.execute(delete(table).where(table.user_uuid == MEMBER_UUID))
    await db_session.commit()
    settings.redis_cache(f"usage:{MEMBER_UUID}", delete=True)


WEB_SEARCH = {"url": MCP_URL, "tool_name": "web_search"}
FETCH_PAGE = {"url": MCP_URL, "tool_name": "fetch_webpage"}
OTHER_TOOL = {"url": MCP_URL, "tool_name": "execute_sql"}


@pytest.fixture
async def entitled(organization, db_session):
    """The test user in the admin's organization with an entitlement, whose web tools are on."""
    await _entitle(db_session)
    yield
    await _drop_entitlement(db_session)


class TestWebToolsOfTheCopilot:
    """SEARCH_WEB and FETCH_FROM_WEB: on for everyone, until an administrator switches them off for a user."""

    @pytest.mark.asyncio
    async def test_both_are_on_by_default(self, entitled, admin_client, auth_client):
        entitlement = (await admin_client.get(f"/admin/entitlement/{MEMBER_UUID}")).json()
        assert entitlement["search_web"] is True
        assert entitlement["fetch_from_web"] is True

        access = (await auth_client.get("/app/copilot/access")).json()
        assert access["disabled_capabilities"] == []
        result = (
            await _authorize(auth_client, tools=[WEB_SEARCH, FETCH_PAGE, OTHER_TOOL])
        ).json()
        assert result["allowed"] is True
        assert result["disabled_capabilities"] == []

    @pytest.mark.asyncio
    async def test_an_admin_switches_one_off_for_a_user_and_the_other_stays(
        self, entitled, admin_client, auth_client
    ):
        response = await admin_client.patch(
            f"/admin/entitlement/{MEMBER_UUID}", json={"search_web": False}
        )
        assert response.status_code == 200

        entitlement = (await admin_client.get(f"/admin/entitlement/{MEMBER_UUID}")).json()
        assert entitlement["search_web"] is False
        assert entitlement["fetch_from_web"] is True

        access = (await auth_client.get("/app/copilot/access")).json()
        assert access["disabled_capabilities"] == ["SEARCH_WEB"]

        result = (
            await _authorize(auth_client, tools=[WEB_SEARCH, FETCH_PAGE, OTHER_TOOL])
        ).json()
        assert result["allowed"] is False
        assert result["denied_tools"] == [WEB_SEARCH]
        assert result["disabled_capabilities"] == ["SEARCH_WEB"]

    @pytest.mark.asyncio
    async def test_both_can_be_off_and_can_be_switched_back_on(
        self, entitled, admin_client, auth_client
    ):
        await admin_client.patch(
            f"/admin/entitlement/{MEMBER_UUID}",
            json={"search_web": False, "fetch_from_web": False},
        )
        result = (await _authorize(auth_client, tools=[WEB_SEARCH, FETCH_PAGE])).json()
        assert result["denied_tools"] == [WEB_SEARCH, FETCH_PAGE]
        assert result["disabled_capabilities"] == ["SEARCH_WEB", "FETCH_FROM_WEB"]

        await admin_client.patch(
            f"/admin/entitlement/{MEMBER_UUID}",
            json={"search_web": True, "fetch_from_web": True},
        )
        result = (await _authorize(auth_client, tools=[WEB_SEARCH, FETCH_PAGE])).json()
        assert result["allowed"] is True
        assert result["disabled_capabilities"] == []

    @pytest.mark.asyncio
    async def test_a_patch_of_something_else_leaves_them_as_they_are(
        self, entitled, admin_client
    ):
        await admin_client.patch(
            f"/admin/entitlement/{MEMBER_UUID}", json={"fetch_from_web": False}
        )
        await admin_client.patch(
            f"/admin/entitlement/{MEMBER_UUID}", json={"number_copilot_calls_day": 5}
        )
        entitlement = (await admin_client.get(f"/admin/entitlement/{MEMBER_UUID}")).json()
        assert entitlement["fetch_from_web"] is False
        assert entitlement["search_web"] is True
        assert entitlement["number_copilot_calls_day"] == 5

    @pytest.mark.asyncio
    async def test_switched_off_beats_what_roles_grant_and_whichever_server_has_the_tool(
        self, entitled, organization, admin_client, auth_client, db_session
    ):
        role = await organization("Analysts")
        await _assign(db_session, role)
        await admin_client.put(
            f"/admin/role/{role}/copilot-access", json=_grants(mcp=[(MCP_URL, "*")])
        )
        await admin_client.patch(
            f"/admin/entitlement/{MEMBER_UUID}", json={"search_web": False}
        )

        result = (
            await _authorize(
                auth_client,
                tools=[
                    WEB_SEARCH,
                    # The same tool on another server, as a user who adds it again would have it
                    {"url": OTHER_MCP_URL, "tool_name": "web_search"},
                    OTHER_TOOL,
                ],
            )
        ).json()
        assert result["denied_tools"] == [
            WEB_SEARCH,
            {"url": OTHER_MCP_URL, "tool_name": "web_search"},
        ]

    @pytest.mark.asyncio
    async def test_on_changes_nothing_a_role_that_does_not_grant_the_tool_still_refuses_it(
        self, entitled, organization, admin_client, auth_client, db_session
    ):
        role = await organization("Analysts")
        await _assign(db_session, role)
        await admin_client.put(
            f"/admin/role/{role}/copilot-access",
            json=_grants(mcp=[(MCP_URL, "execute_sql")]),
        )
        result = (await _authorize(auth_client, tools=[WEB_SEARCH, OTHER_TOOL])).json()
        assert result["denied_tools"] == [WEB_SEARCH]
        assert result["disabled_capabilities"] == []

    @pytest.mark.asyncio
    async def test_the_proxy_refuses_a_call_of_a_tool_that_is_switched_off(
        self, entitled, admin_client, db_session
    ):
        await admin_client.patch(
            f"/admin/entitlement/{MEMBER_UUID}", json={"fetch_from_web": False}
        )

        def call(name, url=MCP_URL):
            return MCPProxyRequest(
                url=url,
                method="POST",
                body={"method": "tools/call", "params": {"name": name}},
            )

        # Reading a page that was fetched is the same capability as fetching it.
        for url in (MCP_URL, OTHER_MCP_URL):
            for name in ("fetch_webpage", "inspect_webpage"):
                with pytest.raises(HTTPException) as refused:
                    await check_mcp_tool_calls(
                        db_session, MEMBER_UUID, call(name, url)
                    )
                assert refused.value.status_code == 403
        await check_mcp_tool_calls(db_session, MEMBER_UUID, call("web_search"))
        await check_mcp_tool_calls(db_session, MEMBER_UUID, call("execute_sql"))

    @pytest.mark.asyncio
    async def test_a_user_cannot_switch_it_back_on_themselves(
        self, entitled, admin_client, auth_client
    ):
        await admin_client.patch(
            f"/admin/entitlement/{MEMBER_UUID}", json={"search_web": False}
        )
        response = await auth_client.patch(
            f"/admin/entitlement/{MEMBER_UUID}", json={"search_web": True}
        )
        assert response.status_code == 403
        access = (await auth_client.get("/app/copilot/access")).json()
        assert access["disabled_capabilities"] == ["SEARCH_WEB"]

    @pytest.mark.asyncio
    async def test_the_sync_carries_what_is_switched_off(
        self, entitled, admin_client, auth_client
    ):
        await admin_client.patch(
            f"/admin/entitlement/{MEMBER_UUID}", json={"search_web": False}
        )
        response = await auth_client.get("/app/dash/validate-and-sync")
        assert response.status_code == 200
        body = response.json()
        assert body["copilot_access"]["disabled_capabilities"] == ["SEARCH_WEB"]
        assert body["feature_entitlements"]["search_web"] is False
        assert body["feature_entitlements"]["fetch_from_web"] is True

    @pytest.mark.asyncio
    async def test_a_flag_that_was_never_set_is_on(self, entitled, db_session, auth_client):
        await db_session.execute(
            update(models.Entitlement)
            .where(models.Entitlement.user_uuid == MEMBER_UUID)
            .values(search_web=None, fetch_from_web=None)
        )
        await db_session.commit()
        access = (await auth_client.get("/app/copilot/access")).json()
        assert access["disabled_capabilities"] == []

    @pytest.mark.asyncio
    async def test_a_user_without_an_entitlement_follows_the_entity(
        self, organization, admin_client, auth_client, db_session
    ):
        await _drop_entitlement(db_session)
        entity_entitlement = models.EntityEntitlement(
            entity_uuid=ADMIN_ENTITY,
            tier_id=models.FULL_TIER_ID,
            number_copilot_calls_day=10,
            total_file_upload_size_gb=1,
            share_widgets="private",
            bring_your_own_data=False,
            bring_your_own_copilot=False,
            admin_access=False,
            support=False,
            data_add_ons_redistribution=False,
            search_web=False,
        )
        existing = (
            await db_session.execute(
                select(models.EntityEntitlement).where(
                    models.EntityEntitlement.entity_uuid == ADMIN_ENTITY
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            pytest.skip("The test organization has an entitlement of its own")
        db_session.add(entity_entitlement)
        await db_session.commit()
        try:
            access = (await auth_client.get("/app/copilot/access")).json()
            assert access["disabled_capabilities"] == ["SEARCH_WEB"]
        finally:
            await db_session.execute(
                delete(models.EntityEntitlement).where(
                    models.EntityEntitlement.entity_uuid == ADMIN_ENTITY
                )
            )
            await db_session.commit()


class TestWebToolsOfAnEntity:
    """An entity switches them off for its users; a user an administrator set differently keeps their own."""

    @pytest.fixture
    async def entity_entitlement(self, db_session):
        existing = (
            await db_session.execute(
                select(models.EntityEntitlement).where(
                    models.EntityEntitlement.entity_uuid == ADMIN_ENTITY
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            pytest.skip("The test organization has an entitlement of its own")
        db_session.add(
            models.EntityEntitlement(
                entity_uuid=ADMIN_ENTITY,
                tier_id=models.FULL_TIER_ID,
                number_copilot_calls_day=10,
                total_file_upload_size_gb=1,
                share_widgets="private",
                bring_your_own_data=False,
                bring_your_own_copilot=False,
                admin_access=False,
                support=False,
                data_add_ons_redistribution=False,
            )
        )
        await db_session.commit()
        yield
        await db_session.execute(
            delete(models.EntityEntitlement).where(
                models.EntityEntitlement.entity_uuid == ADMIN_ENTITY
            )
        )
        await db_session.commit()

    @pytest.mark.asyncio
    async def test_a_change_of_the_entity_reaches_the_users_who_follow_it_and_not_the_others(
        self, entity_entitlement, entitled, auth_client, admin_client, db_session
    ):
        # The user's own setting: fetching is off, as an administrator set it for them.
        await admin_client.patch(
            f"/admin/entitlement/{MEMBER_UUID}", json={"fetch_from_web": False}
        )
        with superuser_override():
            response = await auth_client.patch(
                f"/entity/entitlement/{ADMIN_ENTITY}",
                json={"search_web": False, "fetch_from_web": False},
            )
        assert response.status_code == 200

        stored = (await admin_client.get(f"/admin/entitlement/{MEMBER_UUID}")).json()
        # Search followed the entity; fetching was already off, as the user's own, and stays so.
        assert stored["search_web"] is False
        assert stored["fetch_from_web"] is False

        with superuser_override():
            await auth_client.patch(
                f"/entity/entitlement/{ADMIN_ENTITY}",
                json={"search_web": True, "fetch_from_web": True},
            )
        stored = (await admin_client.get(f"/admin/entitlement/{MEMBER_UUID}")).json()
        assert stored["search_web"] is True
        assert stored["fetch_from_web"] is True

    @pytest.mark.asyncio
    async def test_a_user_with_a_setting_of_their_own_keeps_it_unless_all_are_updated(
        self, entity_entitlement, entitled, auth_client, admin_client
    ):
        await admin_client.patch(
            f"/admin/entitlement/{MEMBER_UUID}", json={"search_web": False}
        )
        # The entity's was on and stays on: nothing changes for anyone, and the user's own stays.
        with superuser_override():
            await auth_client.patch(
                f"/entity/entitlement/{ADMIN_ENTITY}", json={"fetch_from_web": False}
            )
        stored = (await admin_client.get(f"/admin/entitlement/{MEMBER_UUID}")).json()
        assert stored["search_web"] is False
        assert stored["fetch_from_web"] is False

        # Switched on for the whole entity, whatever the users had.
        with superuser_override():
            await auth_client.patch(
                f"/entity/entitlement/{ADMIN_ENTITY}",
                params={"update_all": "true"},
                json={"search_web": False, "fetch_from_web": True},
            )
        stored = (await admin_client.get(f"/admin/entitlement/{MEMBER_UUID}")).json()
        assert stored["search_web"] is False
        assert stored["fetch_from_web"] is True

    @pytest.mark.asyncio
    async def test_a_user_who_gets_their_entitlement_gets_the_entitys_switches(
        self, entity_entitlement, organization, admin_client, db_session
    ):
        from routers.app import helpers as app_helpers

        await db_session.execute(
            update(models.EntityEntitlement)
            .where(models.EntityEntitlement.entity_uuid == ADMIN_ENTITY)
            .values(search_web=False, fetch_from_web=True)
        )
        await db_session.commit()
        await _drop_entitlement(db_session)
        try:
            await app_helpers.update_user_entitlement_with_entity_entitlement(
                db_session, MEMBER_UUID
            )
            stored = (await admin_client.get(f"/admin/entitlement/{MEMBER_UUID}")).json()
            assert stored["search_web"] is False
            assert stored["fetch_from_web"] is True
        finally:
            await _drop_entitlement(db_session)

    @pytest.mark.asyncio
    async def test_the_defaults_of_a_tier_are_on_so_new_entities_and_users_start_with_both(
        self, db_session
    ):
        tier = (
            await db_session.execute(
                select(models.TierDefaults).where(
                    models.TierDefaults.tier_id == models.FULL_TIER_ID
                )
            )
        ).scalar_one()
        assert tier.search_web is True
        assert tier.fetch_from_web is True
