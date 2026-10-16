"""
Integration tests for Copilot metering.

An admin sets a daily Copilot query limit and a daily token limit on the roles of their
organization (``copilot_calls_day`` and ``copilot_tokens_day``). A user's limits are the
highest of their roles, a role without a limit lifts it, and a user without roles may use
nothing. The limits are checked against the usage that the service serving the Copilot
reports to ``PUT /app/usage``. Limits are changeable by that organization's admins and
usage is writable by that service, and by nobody else: a limit its own holder can raise or
a counter its own holder can reset is not a limit.
"""

import os
import sys

BACKEND_DIR = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from uuid import UUID

import jwt
import pytest

from api import models
from tests.fixtures.base import (
    _SECOND_USER,
    _build_service_jwt,
    settings,
)
from tests.fixtures.organization import MEMBER_EMAIL, MEMBER_UUID

OUTSIDER_UUID = UUID(_SECOND_USER["user_uuid"])


@pytest.fixture
async def metered(organization):
    """The role of the test user: 2 queries and 100 tokens a day."""
    return await organization.role(
        MEMBER_UUID, copilot_calls_day=2, copilot_tokens_day=100
    )


@pytest.fixture
async def member(metered, auth_client):
    """The test user, a member of the admin's organization with the metered role."""
    return auth_client


METERING = {
    "X-Metering-Authorization": "Bearer "
    + jwt.encode({"sub": "metering"}, settings.JWT_SECRET, algorithm="HS256")
}


async def _use(client, count: int = 1, **usage):
    """Report usage the way the Copilot service does."""
    return await client.put(
        "/app/usage", json={"add_copilot_count": count, **usage}, headers=METERING
    )


async def _limits(client) -> dict:
    return (await client.get("/app/usage")).json()


class TestLimitEnforcement:
    @pytest.mark.asyncio
    async def test_queries_beyond_the_limit_are_refused(self, member):
        assert (await _use(member)).status_code == 200
        assert (await _use(member)).status_code == 200

        response = await _use(member)
        assert response.status_code == 422
        body = response.json()
        assert "limit of 2" in body["message"]
        assert body["current_usage"] == 2

    @pytest.mark.asyncio
    async def test_usage_reports_the_limit(self, member):
        await _use(member)

        data = await _limits(member)
        assert data["copilot_calls_limit"] == 2
        assert data["number_copilot_calls_day_count"] == 1

    @pytest.mark.asyncio
    async def test_a_user_without_roles_may_not_query(self, organization, auth_client):
        assert (await _limits(auth_client))["copilot_calls_limit"] == 0

        response = await _use(auth_client)
        assert response.status_code == 422
        assert "limit of 0" in response.json()["message"]


class TestLimitsComeFromRoles:
    @pytest.mark.asyncio
    async def test_the_highest_limit_of_the_users_roles_applies(
        self, organization, member
    ):
        await organization.role(MEMBER_UUID, copilot_calls_day=5, copilot_tokens_day=50)

        data = await _limits(member)
        assert data["copilot_calls_limit"] == 5
        assert data["copilot_tokens_limit"] == 100

    @pytest.mark.asyncio
    async def test_a_role_without_a_limit_lifts_it(self, organization, member):
        await organization.role(MEMBER_UUID, copilot_calls_day=None)

        assert (await _limits(member))["copilot_calls_limit"] is None
        for _ in range(5):
            assert (await _use(member)).status_code == 200

    @pytest.mark.asyncio
    async def test_roles_of_other_users_do_not_count(self, organization, member):
        await organization.role(copilot_calls_day=None)

        assert (await _limits(member))["copilot_calls_limit"] == 2


class TestTokenMetering:
    @pytest.mark.asyncio
    async def test_tokens_are_counted(self, member):
        response = await _use(member, 1, add_copilot_tokens=40)
        assert response.status_code == 200

        data = await _limits(member)
        assert data["copilot_tokens_limit"] == 100
        assert data["number_copilot_tokens_day_count"] == 40

        await _use(member, 0, add_copilot_tokens=25)
        data = await _limits(member)
        assert data["number_copilot_tokens_day_count"] == 65

    @pytest.mark.asyncio
    async def test_tokens_are_recorded_past_the_limit_and_block_the_next_query(
        self, member
    ):
        assert (await _use(member, 1, add_copilot_tokens=90)).status_code == 200
        # A query that is already running cannot be refused, so its tokens are recorded
        assert (await _use(member, 0, add_copilot_tokens=30)).status_code == 200
        data = await _limits(member)
        assert data["number_copilot_tokens_day_count"] == 120

        response = await _use(member)
        assert response.status_code == 422
        assert "token limit of 100" in response.json()["message"]

    @pytest.mark.asyncio
    async def test_no_token_limit_means_unlimited(self, metered, member, admin_client):
        response = await admin_client.patch(
            f"/admin/role/{metered}", json={"copilot_tokens_day": None}
        )
        assert response.status_code == 200

        assert (await _use(member, 1, add_copilot_tokens=10_000_000)).status_code == 200
        assert (await _use(member)).status_code == 200


class TestUsersCannotWriteUsage:
    @pytest.mark.asyncio
    async def test_user_cannot_reset_own_usage(self, member):
        await _use(member, 2, add_copilot_tokens=50)

        response = await member.put("/app/usage", json={"reset_copilot_count": True})
        assert response.status_code == 403

        data = await _limits(member)
        assert data["number_copilot_calls_day_count"] == 2
        assert data["number_copilot_tokens_day_count"] == 50

    @pytest.mark.asyncio
    async def test_user_cannot_subtract_own_usage(self, member):
        await _use(member, 2, add_copilot_tokens=50)

        response = await member.put("/app/usage", json={"subtract_copilot_count": 2})
        assert response.status_code == 403
        assert (await _use(member)).status_code == 422

    @pytest.mark.asyncio
    async def test_user_cannot_report_usage_at_all(self, member):
        response = await member.put("/app/usage", json={"add_copilot_count": 1})
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_other_service_tokens_do_not_meter(self, member):
        # The token every browser client carries is valid for the API but not for metering
        for token in (
            _build_service_jwt(),
            jwt.encode({"sub": "app"}, settings.JWT_SECRET, algorithm="HS256"),
            jwt.encode({"sub": "metering"}, "not-the-secret", algorithm="HS256"),
            "not-a-token",
        ):
            response = await member.put(
                "/app/usage",
                json={"reset_copilot_count": True},
                headers={"X-Metering-Authorization": f"Bearer {token}"},
            )
            assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_the_metering_service_can_reset_and_refund(self, member):
        await _use(member, 2, add_copilot_tokens=50)

        assert (await _use(member, 0, subtract_copilot_count=1)).status_code == 200
        data = await _limits(member)
        assert data["number_copilot_calls_day_count"] == 1

        response = await _use(member, 0, reset_copilot_count=True)
        assert response.status_code == 200
        data = await _limits(member)
        assert data["number_copilot_calls_day_count"] == 0
        assert data["number_copilot_tokens_day_count"] == 0


class TestAdminSetsLimit:
    @pytest.mark.asyncio
    async def test_admin_reads_the_limit(self, metered, admin_client):
        response = await admin_client.get(f"/admin/role/{metered}")
        assert response.status_code == 200
        assert response.json()["copilot_calls_day"] == 2
        assert response.json()["copilot_tokens_day"] == 100

    @pytest.mark.asyncio
    async def test_admin_sets_the_token_limit(self, metered, member, admin_client):
        await _use(member, 1, add_copilot_tokens=100)
        assert (await _use(member)).status_code == 422

        response = await admin_client.patch(
            f"/admin/role/{metered}", json={"copilot_tokens_day": 500}
        )
        assert response.status_code == 200

        assert (await _use(member)).status_code == 200
        assert (await _limits(member))["copilot_tokens_limit"] == 500

    @pytest.mark.asyncio
    async def test_admin_resets_usage(self, member, admin_client):
        await _use(member, 2, add_copilot_tokens=100)
        assert (await _use(member)).status_code == 422

        response = await admin_client.post(f"/admin/usage/{MEMBER_UUID}/reset")
        assert response.status_code == 200

        data = await _limits(member)
        assert data["number_copilot_calls_day_count"] == 0
        assert data["number_copilot_tokens_day_count"] == 0
        assert (await _use(member)).status_code == 200

    @pytest.mark.asyncio
    async def test_raised_limit_unblocks_the_user(self, metered, member, admin_client):
        await _use(member)
        await _use(member)
        assert (await _use(member)).status_code == 422

        response = await admin_client.patch(
            f"/admin/role/{metered}", json={"copilot_calls_day": 5}
        )
        assert response.status_code == 200

        assert (await _use(member)).status_code == 200
        assert (await _limits(member))["copilot_calls_limit"] == 5

    @pytest.mark.asyncio
    async def test_lowered_limit_applies_at_once(self, metered, member, admin_client):
        assert (await _use(member)).status_code == 200
        # Warm the usage cache with the old limit
        assert (await _limits(member))["copilot_calls_limit"] == 2

        response = await admin_client.patch(
            f"/admin/role/{metered}", json={"copilot_calls_day": 1}
        )
        assert response.status_code == 200

        assert (await _limits(member))["copilot_calls_limit"] == 1
        assert (await _use(member)).status_code == 422

    @pytest.mark.asyncio
    async def test_joining_a_role_applies_at_once(
        self, organization, member, admin_client
    ):
        generous = await organization.role(copilot_calls_day=10)
        assert (await _limits(member))["copilot_calls_limit"] == 2

        response = await admin_client.patch(
            f"/admin/role/{generous}", json={"users": [MEMBER_EMAIL]}
        )
        assert response.status_code == 200

        assert (await _limits(member))["copilot_calls_limit"] == 10

    @pytest.mark.asyncio
    async def test_leaving_the_role_applies_at_once(self, metered, member, admin_client):
        assert (await _limits(member))["copilot_calls_limit"] == 2

        response = await admin_client.patch(f"/admin/role/{metered}", json={"users": []})
        assert response.status_code == 200

        assert (await _limits(member))["copilot_calls_limit"] == 0
        assert (await _use(member)).status_code == 422

    @pytest.mark.asyncio
    async def test_deleting_the_role_applies_at_once(
        self, metered, member, admin_client
    ):
        assert (await _limits(member))["copilot_calls_limit"] == 2

        assert (await admin_client.delete(f"/admin/role/{metered}")).status_code == 200

        assert (await _limits(member))["copilot_calls_limit"] == 0


class TestOnlyOwnOrganizationAdminsSetLimits:
    @pytest.mark.asyncio
    async def test_member_cannot_change_the_limits_of_their_role(self, metered, member):
        response = await member.patch(
            f"/admin/role/{metered}", json={"copilot_calls_day": 1_000_000}
        )
        assert response.status_code in {401, 403}

        assert (await _limits(member))["copilot_calls_limit"] == 2

    @pytest.mark.asyncio
    async def test_member_cannot_reset_usage_through_the_admin_endpoint(self, member):
        await _use(member, 2)

        response = await member.post(f"/admin/usage/{MEMBER_UUID}/reset")
        assert response.status_code in {401, 403}
        assert (await _use(member)).status_code == 422

    @pytest.mark.asyncio
    async def test_admin_cannot_set_limits_outside_the_organization(
        self, organization, member, admin_client, second_user_client, db_session
    ):
        outside = await organization.role(
            OUTSIDER_UUID, entity_uuid=_SECOND_USER["entity_uuid"], copilot_calls_day=2
        )
        path = f"/admin/role/{outside}"

        response = await admin_client.patch(path, json={"copilot_calls_day": 1_000_000})
        assert response.status_code == 404

        assert (await admin_client.get(path)).status_code == 404
        response = await admin_client.post(f"/admin/usage/{OUTSIDER_UUID}/reset")
        assert response.status_code == 403
        # The outside role still allows 2 calls a day (the outsider, a developer, has
        # no limits whatever their roles say)
        db_session.expire_all()
        assert (await db_session.get(models.Role, outside)).copilot_calls_day == 2
