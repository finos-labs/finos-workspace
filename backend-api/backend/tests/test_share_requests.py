import os
import sys

BACKEND_DIR = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from uuid import UUID

import pytest
from sqlalchemy import select

from api import crud, models
from tests.fixtures.base import _SECOND_USER
from tests.fixtures.organization import (
    ADMIN_EMAIL,
    ADMIN_UUID,
    MEMBER_EMAIL,
    MEMBER_UUID,
)

KINDS = ("dash", "user-apps")
PENDING = {"success": True, "pending_approval": True}
OTHER_USER = UUID(_SECOND_USER["user_uuid"])


async def _item(organization, kind: str, owner_uuid: UUID = MEMBER_UUID) -> UUID:
    if kind == "dash":
        return await organization.dashboard(owner_uuid)
    return await organization.user_app(owner_uuid)


async def _recipients(db_session, kind: str, item: UUID) -> dict[UUID, str]:
    if kind == "dash":
        table, item_column = models.DashboardShare, models.DashboardShare.dashboard_item_uuid
    else:
        table, item_column = models.UserAppShare, models.UserAppShare.user_app_uuid
    query = select(table.shared_user_uuid, table.permissions).where(
        item_column == item, table.active.is_(True)
    )
    return {
        user_uuid: permissions.value
        for user_uuid, permissions in (await db_session.execute(query)).all()
    }


async def _requests(db_session) -> list[models.ShareRequest]:
    db_session.expire_all()
    return list((await db_session.execute(select(models.ShareRequest))).scalars())


async def _entity_share(db_session, dashboard: UUID) -> bool:
    db_session.expire_all()
    query = select(models.DashboardItem.entity_share).where(
        models.DashboardItem.uuid == dashboard
    )
    return (await db_session.execute(query)).scalar_one()


async def _developer_who_may_share(organization) -> None:
    await organization.set_type(MEMBER_UUID, models.DEVELOPER_TYPE)
    await organization.role(MEMBER_UUID, sharing="share")
    await organization.role(ADMIN_UUID, sharing="receive")


async def _ask(client, kind: str, item: UUID, **shares: str):
    return await client.post(f"/app/{kind}/{item}/share", json={"shares": shares})


class TestADevelopersShareWaits:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("kind", KINDS)
    async def test_it_reaches_nobody_until_approved(
        self, organization, auth_client, db_session, kind
    ):
        await _developer_who_may_share(organization)
        item = await _item(organization, kind)

        response = await _ask(auth_client, kind, item, **{ADMIN_EMAIL: "view"})

        assert response.status_code == 200, response.text
        assert response.json() == PENDING
        assert await _recipients(db_session, kind, item) == {}
        shares = (await auth_client.get(f"/app/{kind}/{item}/shares")).json()
        assert shares[ADMIN_EMAIL]["pending"] is True
        assert shares[ADMIN_EMAIL]["permissions"] == "view"

    @pytest.mark.asyncio
    @pytest.mark.parametrize("kind", KINDS)
    async def test_asking_again_keeps_one_request(
        self, organization, auth_client, db_session, kind
    ):
        await _developer_who_may_share(organization)
        item = await _item(organization, kind)

        for _ in range(2):
            response = await _ask(auth_client, kind, item, **{ADMIN_EMAIL: "view"})
            assert response.json() == PENDING

        assert len(await _requests(db_session)) == 1

    @pytest.mark.asyncio
    async def test_sharing_with_the_organization_waits_too(
        self, organization, auth_client, db_session
    ):
        await _developer_who_may_share(organization)
        dashboard = await _item(organization, "dash")

        response = await auth_client.post(f"/app/dash/{dashboard}/toggle-entity-sharing")

        assert response.status_code == 200, response.text
        assert response.json() == PENDING
        assert await _entity_share(db_session, dashboard) is False
        [request] = await _requests(db_session)
        assert request.recipient_uuid is None

    @pytest.mark.asyncio
    @pytest.mark.parametrize("kind", KINDS)
    async def test_a_new_permission_for_a_recipient_waits(
        self, organization, auth_client, db_session, kind
    ):
        await _developer_who_may_share(organization)
        item = await _item(organization, kind)
        if kind == "dash":
            db_session.add(
                models.DashboardShare(
                    dashboard_item_uuid=item, shared_user_uuid=ADMIN_UUID, permissions="view"
                )
            )
        else:
            db_session.add(
                models.UserAppShare(
                    user_app_uuid=item, shared_user_uuid=ADMIN_UUID, permissions="view"
                )
            )
        await db_session.commit()

        response = await auth_client.patch(
            f"/app/{kind}/{item}/share", json={"shares": {ADMIN_EMAIL: "comment"}}
        )

        assert response.json() == PENDING
        assert await _recipients(db_session, kind, item) == {ADMIN_UUID: "view"}
        [request] = await _requests(db_session)
        assert request.permissions == "comment"

    @pytest.mark.asyncio
    @pytest.mark.parametrize("kind", KINDS)
    async def test_removing_the_share_withdraws_the_request(
        self, organization, auth_client, db_session, kind
    ):
        await _developer_who_may_share(organization)
        item = await _item(organization, kind)
        await _ask(auth_client, kind, item, **{ADMIN_EMAIL: "view"})

        response = await auth_client.request(
            "DELETE", f"/app/{kind}/{item}/share", json={"shares": [ADMIN_EMAIL]}
        )

        assert response.status_code == 200, response.text
        assert await _requests(db_session) == []
        assert ADMIN_EMAIL not in (await auth_client.get(f"/app/{kind}/{item}/shares")).json()

    @pytest.mark.asyncio
    @pytest.mark.parametrize("kind", KINDS)
    async def test_a_developer_without_a_sharing_role_cannot_ask(
        self, organization, auth_client, db_session, kind
    ):
        await organization.set_type(MEMBER_UUID, models.DEVELOPER_TYPE)
        await organization.role(MEMBER_UUID, sharing="receive")
        await organization.role(ADMIN_UUID, sharing="receive")
        item = await _item(organization, kind)

        response = await _ask(auth_client, kind, item, **{ADMIN_EMAIL: "view"})

        assert response.status_code == 403
        assert await _requests(db_session) == []

    @pytest.mark.asyncio
    @pytest.mark.parametrize("kind", KINDS)
    async def test_nobody_is_asked_for_who_cannot_receive(
        self, organization, auth_client, db_session, kind
    ):
        await organization.set_type(MEMBER_UUID, models.DEVELOPER_TYPE)
        await organization.role(MEMBER_UUID, sharing="share")
        item = await _item(organization, kind)

        response = await _ask(auth_client, kind, item, **{ADMIN_EMAIL: "view"})

        assert response.status_code == 403
        assert await _requests(db_session) == []

    @pytest.mark.asyncio
    @pytest.mark.parametrize("kind", KINDS)
    async def test_users_who_are_not_developers_share_directly(
        self, organization, auth_client, db_session, kind
    ):
        await organization.role(MEMBER_UUID, sharing="share")
        await organization.role(ADMIN_UUID, sharing="receive")
        item = await _item(organization, kind)

        response = await _ask(auth_client, kind, item, **{ADMIN_EMAIL: "view"})

        assert response.json() == {"success": True, "pending_approval": False}
        assert await _recipients(db_session, kind, item) == {ADMIN_UUID: "view"}
        assert await _requests(db_session) == []


class TestAdminsApprove:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("kind", KINDS)
    async def test_admins_list_what_waits(
        self, organization, auth_client, admin_client, kind
    ):
        await _developer_who_may_share(organization)
        item = await _item(organization, kind)
        await _ask(auth_client, kind, item, **{ADMIN_EMAIL: "view"})

        response = await admin_client.get("/admin/share-requests")

        assert response.status_code == 200, response.text
        [request] = response.json()
        assert request["requester"]["email"] == MEMBER_EMAIL
        assert request["recipient"]["email"] == ADMIN_EMAIL
        assert request["item_type"] == ("dashboard" if kind == "dash" else "app")
        assert request["item_uuid"] == str(item)
        assert request["item_name"] == (
            "A dashboard of the test organization"
            if kind == "dash"
            else "An app of the test organization"
        )
        assert request["permissions"] == "view"

    @pytest.mark.asyncio
    @pytest.mark.parametrize("kind", KINDS)
    async def test_approving_makes_the_share(
        self, organization, auth_client, admin_client, db_session, kind
    ):
        await _developer_who_may_share(organization)
        item = await _item(organization, kind)
        await _ask(auth_client, kind, item, **{ADMIN_EMAIL: "view"})
        [request] = (await admin_client.get("/admin/share-requests")).json()

        response = await admin_client.post(
            f"/admin/share-requests/{request['uuid']}/approve"
        )

        assert response.status_code == 200, response.text
        assert await _recipients(db_session, kind, item) == {ADMIN_UUID: "view"}
        assert await _requests(db_session) == []
        shares = (await auth_client.get(f"/app/{kind}/{item}/shares")).json()
        assert shares[ADMIN_EMAIL]["pending"] is False

    @pytest.mark.asyncio
    async def test_approving_shares_a_dashboard_with_the_organization(
        self, organization, auth_client, admin_client, db_session
    ):
        await _developer_who_may_share(organization)
        dashboard = await _item(organization, "dash")
        await auth_client.post(f"/app/dash/{dashboard}/toggle-entity-sharing")
        [request] = (await admin_client.get("/admin/share-requests")).json()
        assert request["recipient"] is None

        response = await admin_client.post(
            f"/admin/share-requests/{request['uuid']}/approve"
        )

        assert response.status_code == 200, response.text
        assert await _entity_share(db_session, dashboard) is True

    @pytest.mark.asyncio
    @pytest.mark.parametrize("kind", KINDS)
    async def test_approving_a_new_permission_changes_the_share(
        self, organization, auth_client, admin_client, db_session, kind
    ):
        await _developer_who_may_share(organization)
        item = await _item(organization, kind)
        await _ask(auth_client, kind, item, **{ADMIN_EMAIL: "view"})
        [request] = (await admin_client.get("/admin/share-requests")).json()
        await admin_client.post(f"/admin/share-requests/{request['uuid']}/approve")
        await auth_client.patch(
            f"/app/{kind}/{item}/share", json={"shares": {ADMIN_EMAIL: "comment"}}
        )
        [request] = (await admin_client.get("/admin/share-requests")).json()

        await admin_client.post(f"/admin/share-requests/{request['uuid']}/approve")

        assert await _recipients(db_session, kind, item) == {ADMIN_UUID: "comment"}

    @pytest.mark.asyncio
    @pytest.mark.parametrize("kind", KINDS)
    async def test_declining_shares_nothing(
        self, organization, auth_client, admin_client, db_session, kind
    ):
        await _developer_who_may_share(organization)
        item = await _item(organization, kind)
        await _ask(auth_client, kind, item, **{ADMIN_EMAIL: "view"})
        [request] = (await admin_client.get("/admin/share-requests")).json()

        response = await admin_client.post(
            f"/admin/share-requests/{request['uuid']}/decline"
        )

        assert response.status_code == 200, response.text
        assert await _recipients(db_session, kind, item) == {}
        assert await _requests(db_session) == []
        assert ADMIN_EMAIL not in (await auth_client.get(f"/app/{kind}/{item}/shares")).json()

    @pytest.mark.asyncio
    async def test_only_admins_see_and_decide(
        self, organization, auth_client, db_session
    ):
        await _developer_who_may_share(organization)
        item = await _item(organization, "dash")
        await _ask(auth_client, "dash", item, **{ADMIN_EMAIL: "view"})
        [request] = await _requests(db_session)

        assert (await auth_client.get("/admin/share-requests")).status_code == 403
        for decision in ("approve", "decline"):
            response = await auth_client.post(
                f"/admin/share-requests/{request.uuid}/{decision}"
            )
            assert response.status_code == 403, decision
        assert await _recipients(db_session, "dash", item) == {}

    @pytest.mark.asyncio
    async def test_admins_decide_for_their_own_organization_only(
        self, organization, second_user_client, admin_client, db_session
    ):
        dashboard = await organization.dashboard(OTHER_USER)
        request = models.ShareRequest(
            requester_uuid=OTHER_USER,
            dashboard_item_uuid=dashboard,
            recipient_uuid=ADMIN_UUID,
            permissions="view",
        )
        db_session.add(request)
        await db_session.commit()

        assert (await admin_client.get("/admin/share-requests")).json() == []
        for decision in ("approve", "decline"):
            response = await admin_client.post(
                f"/admin/share-requests/{request.uuid}/{decision}"
            )
            assert response.status_code == 404, decision
        assert len(await _requests(db_session)) == 1

    @pytest.mark.asyncio
    async def test_approving_rechecks_the_requester_may_still_share(
        self, organization, auth_client, admin_client, db_session
    ):
        await _developer_who_may_share(organization)
        item = await _item(organization, "dash")
        await _ask(auth_client, "dash", item, **{ADMIN_EMAIL: "view"})
        [request] = await _requests(db_session)
        await organization.set_sharing_enabled(False)

        response = await admin_client.post(f"/admin/share-requests/{request.uuid}/approve")

        assert response.status_code == 409
        assert response.json()["detail"] == "The requester's roles no longer allow sharing"
        assert await _recipients(db_session, "dash", item) == {}


class TestRequestsEndWithAccess:
    @pytest.mark.asyncio
    async def test_a_role_that_no_longer_shares_drops_the_developers_requests(
        self, organization, auth_client, admin_client, db_session
    ):
        await organization.set_type(MEMBER_UUID, models.DEVELOPER_TYPE)
        role_uuid = await organization.role(MEMBER_UUID, sharing="share")
        await organization.role(ADMIN_UUID, sharing="receive")
        item = await _item(organization, "dash")
        await _ask(auth_client, "dash", item, **{ADMIN_EMAIL: "view"})

        response = await admin_client.patch(
            f"/admin/role/{role_uuid}", json={"sharing": "receive"}
        )

        assert response.status_code == 200, response.text
        assert await _requests(db_session) == []

    @pytest.mark.asyncio
    async def test_a_recipient_who_may_no_longer_receive_drops_out(
        self, organization, auth_client, admin_client, db_session
    ):
        await organization.set_type(MEMBER_UUID, models.DEVELOPER_TYPE)
        await organization.role(MEMBER_UUID, sharing="share")
        receiving = await organization.role(ADMIN_UUID, sharing="receive")
        item = await _item(organization, "dash")
        await _ask(auth_client, "dash", item, **{ADMIN_EMAIL: "view"})

        response = await admin_client.patch(
            f"/admin/role/{receiving}", json={"sharing": "none"}
        )

        assert response.status_code == 200, response.text
        assert await _requests(db_session) == []

    @pytest.mark.asyncio
    async def test_deleting_the_dashboard_drops_its_requests(
        self, organization, auth_client, db_session
    ):
        await _developer_who_may_share(organization)
        item = await _item(organization, "dash")
        await _ask(auth_client, "dash", item, **{ADMIN_EMAIL: "view"})

        response = await auth_client.post(
            "/app/dash/sync", json={"items": {str(item): "DELETE"}}
        )

        assert response.status_code == 200, response.text
        assert await _requests(db_session) == []

    @pytest.mark.asyncio
    async def test_leaving_the_organization_drops_the_requests(
        self, organization, auth_client, db_session
    ):
        await _developer_who_may_share(organization)
        item = await _item(organization, "dash")
        await _ask(auth_client, "dash", item, **{ADMIN_EMAIL: "view"})

        await crud.remove_shares_both_ways(db_session, MEMBER_UUID)
        await db_session.commit()

        assert await _requests(db_session) == []
