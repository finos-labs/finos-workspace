"""
Integration tests for Copilot metering.

An admin sets a daily Copilot query limit and a daily token limit for each user of their
organization (``number_copilot_calls_day`` and ``number_copilot_tokens_day`` on the user's
entitlement). The limits are checked against the usage that the service serving the
Copilot reports to ``PUT /app/usage``. Limits are changeable by that organization's admins
and usage is writable by that service, and by nobody else: a limit its own holder can raise
or a counter its own holder can reset is not a limit.
"""

import os
import sys

BACKEND_DIR = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from datetime import UTC, datetime, timedelta
from unittest.mock import patch
from uuid import UUID, uuid4

import pytest
from sqlalchemy import delete, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from api import models
import jwt

from scripts.create_metering_token import create_metering_token
from tests.fixtures.base import (
    _ADMIN_USER,
    _AUTH_USER,
    _SECOND_USER,
    _build_service_jwt,
    _get_test_db_url_async,
    settings,
)
from tests.fixtures.db import TestAsyncSessionLocal

MEMBER_UUID = UUID(_AUTH_USER["user_uuid"])
OUTSIDER_UUID = UUID(_SECOND_USER["user_uuid"])


@pytest.fixture(autouse=True)
async def worker_database(client):
    """Point the usage cache refresh, which opens its own sessions, at the test database."""
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


async def _give_limit(
    db_session, user_uuid: UUID, limit: int, token_limit: int | None = None
) -> None:
    """Give a user an entitlement with a daily Copilot query limit."""
    await _drop_limit(db_session, user_uuid)
    db_session.add(
        models.Entitlement(
            user_uuid=user_uuid,
            tier_id=models.FULL_TIER_ID,
            number_copilot_calls_day=limit,
            number_copilot_tokens_day=token_limit,
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
    settings.redis_cache(f"usage:{user_uuid}", delete=True)


async def _drop_limit(db_session, user_uuid: UUID) -> None:
    for table in (models.EntitlementUsage, models.Entitlement):
        await db_session.execute(delete(table).where(table.user_uuid == user_uuid))
    await db_session.commit()
    settings.redis_cache(f"usage:{user_uuid}", delete=True)


@pytest.fixture
async def member(auth_client, admin_client, db_session):
    """A regular user of the admin's organization, limited to 2 queries a day."""
    member_perm = models.PermissionsEntityMap(
        uuid=uuid4(), entity_uuid=_ADMIN_USER["entity_uuid"], name="User"
    )
    db_session.add(member_perm)
    await db_session.commit()
    await db_session.execute(
        update(models.User)
        .where(models.User.uuid == MEMBER_UUID)
        .values(permissions_uuid=member_perm.uuid)
    )
    await db_session.commit()
    await _give_limit(db_session, MEMBER_UUID, 2, token_limit=100)

    yield auth_client

    await _drop_limit(db_session, MEMBER_UUID)
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


METERING = {"X-Metering-Authorization": "Bearer " + create_metering_token()[0]}


async def _use(client, count: int = 1, **usage):
    """Report usage the way the Copilot service does."""
    return await client.put(
        "/app/usage", json={"add_copilot_count": count, **usage}, headers=METERING
    )


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

        data = (await member.get("/app/usage")).json()
        assert data["copilot_calls_limit"] == 2
        assert data["number_copilot_calls_day_count"] == 1


class TestTokenMetering:
    @pytest.mark.asyncio
    async def test_tokens_are_counted(self, member):
        response = await _use(member, 1, add_copilot_tokens=40)
        assert response.status_code == 200

        data = (await member.get("/app/usage")).json()
        assert data["copilot_tokens_limit"] == 100
        assert data["number_copilot_tokens_day_count"] == 40

        await _use(member, 0, add_copilot_tokens=25)
        data = (await member.get("/app/usage")).json()
        assert data["number_copilot_tokens_day_count"] == 65

    @pytest.mark.asyncio
    async def test_tokens_are_recorded_past_the_limit_and_block_the_next_query(
        self, member
    ):
        assert (await _use(member, 1, add_copilot_tokens=90)).status_code == 200
        # A query that is already running cannot be refused, so its tokens are recorded
        assert (await _use(member, 0, add_copilot_tokens=30)).status_code == 200
        data = (await member.get("/app/usage")).json()
        assert data["number_copilot_tokens_day_count"] == 120

        response = await _use(member)
        assert response.status_code == 422
        assert "token limit of 100" in response.json()["message"]

    @pytest.mark.asyncio
    async def test_no_token_limit_means_unlimited(self, member, db_session):
        await _give_limit(db_session, MEMBER_UUID, 2, token_limit=None)

        assert (await _use(member, 1, add_copilot_tokens=10_000_000)).status_code == 200
        assert (await _use(member)).status_code == 200


class TestUsersCannotWriteUsage:
    @pytest.mark.asyncio
    async def test_user_cannot_reset_own_usage(self, member):
        await _use(member, 2, add_copilot_tokens=50)

        response = await member.put("/app/usage", json={"reset_copilot_count": True})
        assert response.status_code == 403

        data = (await member.get("/app/usage")).json()
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
    async def test_a_metering_token_that_never_runs_out_is_refused(self, member):
        """A token without an expiry could only be withdrawn by changing JWT_SECRET."""
        forever = jwt.encode({"sub": "metering"}, settings.JWT_SECRET, algorithm="HS256")
        response = await member.put(
            "/app/usage",
            json={"reset_copilot_count": True},
            headers={"X-Metering-Authorization": f"Bearer {forever}"},
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_an_expired_metering_token_is_refused_and_says_so(self, member):
        expired, _ = create_metering_token(
            days=1, now=datetime.now(UTC) - timedelta(days=2)
        )
        response = await member.put(
            "/app/usage",
            json={"reset_copilot_count": True},
            headers={"X-Metering-Authorization": f"Bearer {expired}"},
        )
        assert response.status_code == 403
        # The operator has to mint a new one, so the answer says that rather than "invalid".
        assert "expired" in response.json()["detail"].lower()
        assert "create_metering_token" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_the_metering_service_can_reset_and_refund(self, member):
        await _use(member, 2, add_copilot_tokens=50)

        assert (await _use(member, 0, subtract_copilot_count=1)).status_code == 200
        data = (await member.get("/app/usage")).json()
        assert data["number_copilot_calls_day_count"] == 1

        response = await _use(member, 0, reset_copilot_count=True)
        assert response.status_code == 200
        data = (await member.get("/app/usage")).json()
        assert data["number_copilot_calls_day_count"] == 0
        assert data["number_copilot_tokens_day_count"] == 0


class TestAdminSetsLimit:
    @pytest.mark.asyncio
    async def test_admin_reads_the_limit(self, member, admin_client):
        response = await admin_client.get(f"/admin/entitlement/{MEMBER_UUID}")
        assert response.status_code == 200
        assert response.json()["number_copilot_calls_day"] == 2

    @pytest.mark.asyncio
    async def test_admin_sets_the_token_limit(self, member, admin_client):
        await _use(member, 1, add_copilot_tokens=100)
        assert (await _use(member)).status_code == 422

        response = await admin_client.patch(
            f"/admin/entitlement/{MEMBER_UUID}",
            json={"number_copilot_tokens_day": 500},
        )
        assert response.status_code == 200

        assert (await _use(member)).status_code == 200
        assert (await member.get("/app/usage")).json()["copilot_tokens_limit"] == 500

    @pytest.mark.asyncio
    async def test_admin_resets_usage(self, member, admin_client):
        await _use(member, 2, add_copilot_tokens=100)
        assert (await _use(member)).status_code == 422

        response = await admin_client.post(f"/admin/usage/{MEMBER_UUID}/reset")
        assert response.status_code == 200

        data = (await member.get("/app/usage")).json()
        assert data["number_copilot_calls_day_count"] == 0
        assert data["number_copilot_tokens_day_count"] == 0
        assert (await _use(member)).status_code == 200

    @pytest.mark.asyncio
    async def test_raised_limit_unblocks_the_user(self, member, admin_client):
        await _use(member)
        await _use(member)
        assert (await _use(member)).status_code == 422

        response = await admin_client.patch(
            f"/admin/entitlement/{MEMBER_UUID}", json={"number_copilot_calls_day": 5}
        )
        assert response.status_code == 200

        assert (await _use(member)).status_code == 200
        assert (await member.get("/app/usage")).json()["copilot_calls_limit"] == 5

    @pytest.mark.asyncio
    async def test_lowered_limit_applies_at_once(self, member, admin_client):
        assert (await _use(member)).status_code == 200
        # Warm the usage cache with the old limit
        assert (await member.get("/app/usage")).json()["copilot_calls_limit"] == 2

        response = await admin_client.patch(
            f"/admin/entitlement/{MEMBER_UUID}", json={"number_copilot_calls_day": 1}
        )
        assert response.status_code == 200

        assert (await member.get("/app/usage")).json()["copilot_calls_limit"] == 1
        assert (await _use(member)).status_code == 422


class TestOnlyOwnOrganizationAdminsSetLimits:
    @pytest.mark.asyncio
    async def test_member_cannot_patch_own_entitlement(self, member):
        response = await member.patch(
            "/app/entitlement", json={"number_copilot_calls_day": 1_000_000}
        )
        assert response.status_code in {401, 403}

        assert (await member.get("/app/usage")).json()["copilot_calls_limit"] == 2

    @pytest.mark.asyncio
    async def test_member_cannot_reset_usage_through_the_admin_endpoint(self, member):
        await _use(member, 2)

        response = await member.post(f"/admin/usage/{MEMBER_UUID}/reset")
        assert response.status_code in {401, 403}
        assert (await _use(member)).status_code == 422

    @pytest.mark.asyncio
    async def test_member_cannot_use_the_admin_endpoint(self, member):
        response = await member.patch(
            f"/admin/entitlement/{MEMBER_UUID}",
            json={"number_copilot_calls_day": 1_000_000},
        )
        assert response.status_code in {401, 403}

    @pytest.mark.asyncio
    async def test_admin_cannot_set_limits_outside_the_organization(
        self, member, admin_client, second_user_client, db_session
    ):
        await _give_limit(db_session, OUTSIDER_UUID, 2)
        try:
            path = f"/admin/entitlement/{OUTSIDER_UUID}"

            response = await admin_client.patch(
                path, json={"number_copilot_calls_day": 1_000_000}
            )
            assert response.status_code == 403

            assert (await admin_client.get(path)).status_code == 403
            response = await admin_client.post(f"/admin/usage/{OUTSIDER_UUID}/reset")
            assert response.status_code == 403
            assert (await second_user_client.get("/app/usage")).json()[
                "copilot_calls_limit"
            ] == 2
        finally:
            await _drop_limit(db_session, OUTSIDER_UUID)
