"""
Integration tests for sharing.

Users share dashboards and apps with named users of their organization, and dashboards
with the whole organization. Sharing needs a role that allows it, every recipient needs a
role that lets them receive shared items, and the organization must have sharing switched
on. When a user's roles or their organization's switch no longer allow what was shared,
the shares are revoked.
"""

import os
import sys

BACKEND_DIR = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from dataclasses import dataclass
from uuid import UUID

import pytest
from sqlalchemy import select, update

from api import models
from tests.fixtures.marketplace import superuser_override
from tests.fixtures.organization import (
    ADMIN_EMAIL,
    ADMIN_ENTITY,
    ADMIN_UUID,
    MEMBER_UUID,
    admin_entity_body,
)

NOT_ALLOWED = "Sharing is not allowed for your account"
KINDS = ("dash", "user-apps")


def _cannot_receive(*emails: str) -> str:
    return "These users cannot receive shared items: " + ", ".join(sorted(emails))


async def _item(organization, kind: str, owner_uuid: UUID = MEMBER_UUID) -> UUID:
    if kind == "dash":
        return await organization.dashboard(owner_uuid)
    return await organization.user_app(owner_uuid)


def _share_table(kind: str):
    if kind == "dash":
        return models.DashboardShare, models.DashboardShare.dashboard_item_uuid
    return models.UserAppShare, models.UserAppShare.user_app_uuid


async def _recipients(db_session, kind: str, item: UUID) -> set[UUID]:
    """The users an item is actively shared with."""
    table, item_column = _share_table(kind)
    query = select(table.shared_user_uuid).where(item_column == item, table.active.is_(True))
    return set((await db_session.execute(query)).scalars())


async def _add_share_row(db_session, kind: str, item: UUID, user_uuid: UUID) -> None:
    """A share as it was made while the users' roles allowed it."""
    table, item_column = _share_table(kind)
    db_session.add(
        table(**{item_column.key: item, "shared_user_uuid": user_uuid, "permissions": "view"})
    )
    await db_session.commit()


async def _unshare(client, kind: str, item: UUID, *emails: str):
    return await client.request(
        "DELETE", f"/app/{kind}/{item}/share", json={"shares": list(emails)}
    )


async def _entity_share(db_session, dashboard: UUID) -> bool:
    query = select(models.DashboardItem.entity_share).where(
        models.DashboardItem.uuid == dashboard
    )
    return (await db_session.execute(query)).scalar_one()


class TestSharingNeedsARoleThatAllowsIt:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("kind", KINDS)
    @pytest.mark.parametrize("member_sharing", [None, "none", "receive"])
    async def test_sharing_is_refused_below_share(
        self, organization, auth_client, db_session, kind, member_sharing
    ):
        if member_sharing:
            await organization.role(MEMBER_UUID, sharing=member_sharing)
        await organization.role(ADMIN_UUID, sharing="receive")
        item = await _item(organization, kind)

        for method in ("POST", "PATCH"):
            response = await auth_client.request(
                method, f"/app/{kind}/{item}/share", json={"shares": {ADMIN_EMAIL: "view"}}
            )
            assert response.status_code == 403, method
            assert response.json()["detail"] == NOT_ALLOWED

        assert await _recipients(db_session, kind, item) == set()

    @pytest.mark.asyncio
    @pytest.mark.parametrize("kind", KINDS)
    async def test_sharing_is_refused_when_the_organization_switched_it_off(
        self, organization, auth_client, db_session, kind
    ):
        await organization.role(MEMBER_UUID, sharing="share")
        await organization.role(ADMIN_UUID, sharing="receive")
        await organization.set_sharing_enabled(False)
        item = await _item(organization, kind)

        response = await auth_client.post(
            f"/app/{kind}/{item}/share", json={"shares": {ADMIN_EMAIL: "view"}}
        )

        assert response.status_code == 403
        assert response.json()["detail"] == NOT_ALLOWED
        assert await _recipients(db_session, kind, item) == set()

    @pytest.mark.asyncio
    @pytest.mark.parametrize("kind", KINDS)
    async def test_users_who_may_share_share_with_users_who_may_receive(
        self, organization, auth_client, db_session, kind
    ):
        other = await organization.add_user()
        await organization.role(MEMBER_UUID, sharing="share")
        await organization.role(ADMIN_UUID, sharing="receive")
        await organization.role(other.uuid, sharing="share")
        item = await _item(organization, kind)

        response = await auth_client.post(
            f"/app/{kind}/{item}/share",
            json={"shares": {ADMIN_EMAIL: "view", other.email: "comment"}},
        )

        assert response.status_code == 200, response.text
        shares = (await auth_client.get(f"/app/{kind}/{item}/shares")).json()
        assert {email: share["permissions"] for email, share in shares.items()} == {
            ADMIN_EMAIL: "view",
            other.email: "comment",
        }
        assert await _recipients(db_session, kind, item) == {ADMIN_UUID, other.uuid}

        response = await auth_client.patch(
            f"/app/{kind}/{item}/share", json={"shares": {ADMIN_EMAIL: "comment"}}
        )
        assert response.status_code == 200, response.text
        shares = (await auth_client.get(f"/app/{kind}/{item}/shares")).json()
        assert shares[ADMIN_EMAIL]["permissions"] == "comment"

    @pytest.mark.asyncio
    async def test_sharing_with_the_organization_needs_share(
        self, organization, auth_client, db_session
    ):
        await organization.role(MEMBER_UUID, sharing="receive")
        dashboard = await organization.dashboard(MEMBER_UUID)

        response = await auth_client.post(f"/app/dash/{dashboard}/toggle-entity-sharing")

        assert response.status_code == 403
        assert response.json()["detail"] == NOT_ALLOWED
        assert await _entity_share(db_session, dashboard) is False

    @pytest.mark.asyncio
    async def test_users_who_may_share_share_with_the_organization(
        self, organization, auth_client, db_session
    ):
        await organization.role(MEMBER_UUID, sharing="share")
        dashboard = await organization.dashboard(MEMBER_UUID)

        response = await auth_client.post(f"/app/dash/{dashboard}/toggle-entity-sharing")

        assert response.status_code == 200
        assert await _entity_share(db_session, dashboard) is True

    @pytest.mark.asyncio
    async def test_sharing_with_the_organization_can_always_be_stopped(
        self, organization, auth_client, db_session
    ):
        dashboard = await organization.dashboard(MEMBER_UUID, entity_share=True)

        response = await auth_client.post(f"/app/dash/{dashboard}/toggle-entity-sharing")

        assert response.status_code == 200
        assert await _entity_share(db_session, dashboard) is False


class TestRecipientsMustReceive:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("kind", KINDS)
    async def test_recipients_who_cannot_receive_are_refused(
        self, organization, auth_client, db_session, kind
    ):
        await organization.role(MEMBER_UUID, sharing="share")
        refused = await organization.add_user()
        await organization.role(refused.uuid, sharing="none")
        receiver = await organization.add_user()
        await organization.role(receiver.uuid, sharing="receive")
        item = await _item(organization, kind)

        response = await auth_client.post(
            f"/app/{kind}/{item}/share",
            json={
                "shares": {
                    ADMIN_EMAIL: "view",
                    refused.email: "view",
                    receiver.email: "view",
                }
            },
        )

        assert response.status_code == 403
        assert response.json()["detail"] == _cannot_receive(ADMIN_EMAIL, refused.email)
        # Nobody gets it, not even the users who could receive it
        assert await _recipients(db_session, kind, item) == set()

    @pytest.mark.asyncio
    @pytest.mark.parametrize("kind", KINDS)
    async def test_changing_a_share_needs_a_recipient_who_may_receive(
        self, organization, auth_client, db_session, kind
    ):
        await organization.role(MEMBER_UUID, sharing="share")
        item = await _item(organization, kind)
        await _add_share_row(db_session, kind, item, ADMIN_UUID)

        response = await auth_client.patch(
            f"/app/{kind}/{item}/share", json={"shares": {ADMIN_EMAIL: "comment"}}
        )
        assert response.status_code == 403
        assert response.json()["detail"] == _cannot_receive(ADMIN_EMAIL)

        await organization.role(ADMIN_UUID, sharing="receive")
        response = await auth_client.patch(
            f"/app/{kind}/{item}/share", json={"shares": {ADMIN_EMAIL: "comment"}}
        )
        assert response.status_code == 200, response.text


class TestShareCandidates:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("kind", KINDS)
    async def test_only_users_who_may_receive_are_offered(
        self, organization, auth_client, kind
    ):
        await organization.role(MEMBER_UUID, sharing="share")
        await organization.role(ADMIN_UUID, sharing="receive")
        sharer = await organization.add_user()
        await organization.role(sharer.uuid, sharing="share")
        without_roles = await organization.add_user()
        refused = await organization.add_user()
        await organization.role(refused.uuid, sharing="none")
        item = await _item(organization, kind)

        response = await auth_client.get(f"/app/{kind}/{item}/shares/users")

        assert response.status_code == 200
        offered = set(response.json())
        assert offered == {ADMIN_EMAIL, sharer.email}
        assert without_roles.email not in offered

    @pytest.mark.asyncio
    async def test_nobody_is_offered_when_the_organization_switched_sharing_off(
        self, organization, auth_client
    ):
        await organization.role(MEMBER_UUID, sharing="share")
        await organization.role(ADMIN_UUID, sharing="share")
        await organization.set_sharing_enabled(False)
        dashboard = await organization.dashboard(MEMBER_UUID)

        response = await auth_client.get(f"/app/dash/{dashboard}/shares/users")

        assert response.status_code == 200
        assert response.json() == {}


class TestUnsharing:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("kind", KINDS)
    async def test_owners_unshare_without_any_role(
        self, organization, auth_client, db_session, kind
    ):
        item = await _item(organization, kind)
        await _add_share_row(db_session, kind, item, ADMIN_UUID)

        response = await _unshare(auth_client, kind, item, ADMIN_EMAIL)

        assert response.status_code == 200
        assert await _recipients(db_session, kind, item) == set()

    @pytest.mark.asyncio
    @pytest.mark.parametrize("kind", KINDS)
    async def test_recipients_leave_without_any_role(
        self, organization, admin_client, db_session, kind
    ):
        item = await _item(organization, kind)
        await _add_share_row(db_session, kind, item, ADMIN_UUID)

        response = await _unshare(admin_client, kind, item, ADMIN_EMAIL)

        assert response.status_code == 200
        assert await _recipients(db_session, kind, item) == set()


class TestOrganizationWideDashboards:
    @pytest.fixture
    async def org_wide(self, organization):
        """A dashboard the admin shared with the whole organization, and one they did not."""
        shared = await organization.dashboard(ADMIN_UUID, entity_share=True)
        private = await organization.dashboard(ADMIN_UUID)
        return shared, private

    @pytest.mark.asyncio
    @pytest.mark.parametrize("member_sharing", [None, "none"])
    async def test_users_who_cannot_receive_do_not_see_them(
        self, organization, auth_client, org_wide, member_sharing
    ):
        if member_sharing:
            await organization.role(MEMBER_UUID, sharing=member_sharing)
        shared, _ = org_wide

        listed = (await auth_client.get("/app/dash/sync/shared")).json()
        assert listed["entity_shared"] == {}
        synced = (await auth_client.get("/app/dash/validate-and-sync")).json()
        assert synced["entity_shared"] == {}
        assert (await auth_client.get(f"/app/dash/{shared}/versions")).status_code == 403

    @pytest.mark.asyncio
    @pytest.mark.parametrize("member_sharing", ["receive", "share"])
    async def test_users_who_may_receive_see_them(
        self, organization, auth_client, org_wide, member_sharing
    ):
        await organization.role(MEMBER_UUID, sharing=member_sharing)
        shared, private = org_wide

        listed = (await auth_client.get("/app/dash/sync/shared")).json()
        assert set(listed["entity_shared"]) == {str(shared)}
        synced = (await auth_client.get("/app/dash/validate-and-sync")).json()
        assert set(synced["entity_shared"]) == {str(shared)}
        assert (await auth_client.get(f"/app/dash/{shared}/versions")).status_code == 200
        # Another organization-wide dashboard does not open this one
        assert (await auth_client.get(f"/app/dash/{private}/versions")).status_code == 403

    @pytest.mark.asyncio
    async def test_nobody_sees_them_when_the_organization_switched_sharing_off(
        self, organization, auth_client, org_wide
    ):
        await organization.role(MEMBER_UUID, sharing="share")
        await organization.set_sharing_enabled(False)
        shared, _ = org_wide

        listed = (await auth_client.get("/app/dash/sync/shared")).json()
        assert listed["entity_shared"] == {}
        assert (await auth_client.get(f"/app/dash/{shared}/versions")).status_code == 403


@dataclass
class Shared:
    """What the test user shared: a dashboard with the admin, another user and the whole
    organization, and an app with the admin."""

    sharers: UUID
    receivers: UUID
    other: models.User
    dashboard: UUID
    app: UUID


@pytest.fixture
async def shared(organization, auth_client) -> Shared:
    other = await organization.add_user()
    sharers = await organization.role(MEMBER_UUID, sharing="share")
    receivers = await organization.role(ADMIN_UUID, other.uuid, sharing="receive")
    dashboard = await organization.dashboard(MEMBER_UUID)
    app = await organization.user_app(MEMBER_UUID)

    response = await auth_client.post(
        f"/app/dash/{dashboard}/share",
        json={"shares": {ADMIN_EMAIL: "view", other.email: "view"}},
    )
    assert response.status_code == 200, response.text
    response = await auth_client.post(f"/app/dash/{dashboard}/toggle-entity-sharing")
    assert response.status_code == 200, response.text
    response = await auth_client.post(
        f"/app/user-apps/{app}/share", json={"shares": {ADMIN_EMAIL: "view"}}
    )
    assert response.status_code == 200, response.text

    return Shared(sharers, receivers, other, dashboard, app)


async def _state(db_session, shared: Shared) -> dict:
    """Who the test user's items are shared with, and their sharing flags."""
    dashboard = (
        await db_session.execute(
            select(models.DashboardItem.entity_share, models.DashboardItem.is_shared).where(
                models.DashboardItem.uuid == shared.dashboard
            )
        )
    ).one()
    app_is_shared = (
        await db_session.execute(
            select(models.UserApp.is_shared).where(models.UserApp.uuid == shared.app)
        )
    ).scalar_one()
    files = (
        await db_session.execute(
            select(
                models.StoredFileShare.creater_uuid, models.StoredFileShare.shared_user_uuid
            ).where(models.StoredFileShare.creater_uuid == MEMBER_UUID)
        )
    ).all()
    return {
        "dashboard": await _recipients(db_session, "dash", shared.dashboard),
        "app": await _recipients(db_session, "user-apps", shared.app),
        "files": {recipient for _, recipient in files},
        "entity_share": dashboard.entity_share,
        "dashboard_is_shared": dashboard.is_shared,
        "app_is_shared": app_is_shared,
    }


def _everything(shared: Shared) -> dict:
    return {
        "dashboard": {ADMIN_UUID, shared.other.uuid},
        "app": {ADMIN_UUID},
        "files": {ADMIN_UUID, shared.other.uuid},
        "entity_share": True,
        "dashboard_is_shared": True,
        "app_is_shared": True,
    }


NOTHING = {
    "dashboard": set(),
    "app": set(),
    "files": set(),
    "entity_share": False,
    "dashboard_is_shared": False,
    "app_is_shared": False,
}

# What is left when the recipients lose what they received: the test user still shares
# the dashboard with the organization
NOTHING_RECEIVED = {**NOTHING, "entity_share": True}


class TestRevocation:
    @pytest.mark.asyncio
    async def test_the_shares_are_in_place(self, shared, db_session):
        assert await _state(db_session, shared) == _everything(shared)

    @pytest.mark.asyncio
    async def test_a_user_who_may_no_longer_share_loses_what_they_shared(
        self, shared, admin_client, db_session
    ):
        response = await admin_client.patch(
            f"/admin/role/{shared.sharers}", json={"sharing": "receive"}
        )
        assert response.status_code == 200

        assert await _state(db_session, shared) == NOTHING

    @pytest.mark.asyncio
    async def test_users_who_may_no_longer_receive_lose_what_they_received(
        self, shared, admin_client, db_session
    ):
        response = await admin_client.patch(
            f"/admin/role/{shared.receivers}", json={"sharing": "none"}
        )
        assert response.status_code == 200

        assert await _state(db_session, shared) == NOTHING_RECEIVED

    @pytest.mark.asyncio
    async def test_more_sharing_revokes_nothing(self, shared, admin_client, db_session):
        response = await admin_client.patch(
            f"/admin/role/{shared.receivers}", json={"sharing": "share"}
        )
        assert response.status_code == 200
        response = await admin_client.patch(
            f"/admin/role/{shared.sharers}", json={"description": "Still sharing"}
        )
        assert response.status_code == 200

        assert await _state(db_session, shared) == _everything(shared)

    @pytest.mark.asyncio
    async def test_leaving_a_role_revokes_what_it_allowed(
        self, shared, admin_client, db_session
    ):
        response = await admin_client.patch(
            f"/admin/role/{shared.receivers}", json={"users": [shared.other.email]}
        )
        assert response.status_code == 200

        assert await _state(db_session, shared) == {
            **_everything(shared),
            "dashboard": {shared.other.uuid},
            "app": set(),
            "files": {shared.other.uuid},
            "app_is_shared": False,
        }

    @pytest.mark.asyncio
    async def test_deleting_the_sharers_role_revokes_what_they_shared(
        self, shared, admin_client, db_session
    ):
        response = await admin_client.delete(f"/admin/role/{shared.sharers}")
        assert response.status_code == 200

        assert await _state(db_session, shared) == NOTHING

    @pytest.mark.asyncio
    async def test_deleting_the_receivers_role_revokes_what_they_received(
        self, shared, admin_client, db_session
    ):
        response = await admin_client.delete(f"/admin/role/{shared.receivers}")
        assert response.status_code == 200

        assert await _state(db_session, shared) == NOTHING_RECEIVED

    @pytest.mark.asyncio
    async def test_the_superusers_role_endpoints_revoke_too(
        self, shared, admin_client, db_session
    ):
        await db_session.execute(
            update(models.User)
            .where(models.User.uuid == ADMIN_UUID)
            .values(is_superuser=True)
        )
        await db_session.commit()
        try:
            response = await admin_client.patch(
                f"/entity/role/{shared.receivers}", json={"sharing": "none"}
            )
            assert response.status_code == 200, response.text
            assert await _state(db_session, shared) == NOTHING_RECEIVED

            response = await admin_client.delete(f"/entity/role/{shared.sharers}")
            assert response.status_code == 200, response.text
            assert await _state(db_session, shared) == NOTHING
        finally:
            await db_session.execute(
                update(models.User)
                .where(models.User.uuid == ADMIN_UUID)
                .values(is_superuser=False)
            )
            await db_session.commit()

    @pytest.mark.asyncio
    async def test_switching_the_organization_off_revokes_every_share(
        self, shared, auth_client, db_session
    ):
        with superuser_override():
            response = await auth_client.put(
                f"/entity/entity/{ADMIN_ENTITY}", json=admin_entity_body(False)
            )
        assert response.status_code == 200, response.text

        assert await _state(db_session, shared) == NOTHING

    @pytest.mark.asyncio
    async def test_saving_the_organization_with_sharing_on_revokes_nothing(
        self, shared, auth_client, db_session
    ):
        with superuser_override():
            response = await auth_client.put(
                f"/entity/entity/{ADMIN_ENTITY}", json=admin_entity_body(True)
            )
        assert response.status_code == 200, response.text

        assert await _state(db_session, shared) == _everything(shared)
