from uuid import uuid4

import pytest
from sqlalchemy import delete, insert, select, update

from api import base, models
from api.widget_plugins.broker import readable_backend
from tests.fixtures.base import superuser_override
from tests.fixtures.organization import ADMIN_ENTITY, MEMBER_UUID

PASSWORD = "TestPassword123!"  # noqa: S105
ENTITY_BODY = {"name": "Admin Entity", "sharing_enabled": True}


async def _sign_in(app_client, email: str):
    return await app_client.post(
        "/app/login",
        json={
            "email": email,
            "password": PASSWORD,
            "remember": False,
            "source": "app",
            "totp_token": None,
            "version": "v1.0.0",
        },
    )


async def _put_entity(client, **changes):
    return await client.put(f"/entity/entity/{ADMIN_ENTITY}", json={**ENTITY_BODY, **changes})


async def _listed(client, entity_uuid=ADMIN_ENTITY) -> dict:
    listed = (await client.get("/entity/entity", params={"size": 1000})).json()
    [entity] = [item for item in listed["items"] if item["uuid"] == str(entity_uuid)]
    return entity


@pytest.fixture
async def enabled_entity(auth_client):
    yield
    with superuser_override():
        await _put_entity(auth_client, disabled=False)


class TestDisableEntity:
    @pytest.mark.asyncio
    async def test_a_disabled_entity_is_listed_as_disabled_and_keeps_it_when_the_flag_is_left_out(
        self, organization, auth_client, enabled_entity
    ):
        with superuser_override():
            assert (await _listed(auth_client))["disabled"] is False

            assert (await _put_entity(auth_client, disabled=True)).status_code == 200
            assert (await _listed(auth_client))["disabled"] is True

            assert (await _put_entity(auth_client, sharing_enabled=False)).status_code == 200
            assert (await _listed(auth_client))["disabled"] is True

            assert (await _put_entity(auth_client, disabled=False)).status_code == 200
            assert (await _listed(auth_client))["disabled"] is False

    @pytest.mark.asyncio
    async def test_disabling_ends_the_sessions_and_refuses_sign_in_until_it_is_enabled_again(
        self, organization, auth_client, app_client, db_session, enabled_entity
    ):
        user = await organization.add_user(password=PASSWORD)
        assert (await _sign_in(app_client, user.email)).status_code == 200
        sessions = select(models.Session.uuid).where(models.Session.user_uuid == user.uuid)
        assert (await db_session.execute(sessions)).first() is not None

        with superuser_override():
            assert (await _put_entity(auth_client, disabled=True)).status_code == 200

        assert (await db_session.execute(sessions)).first() is None
        refused = await _sign_in(app_client, user.email)
        assert refused.status_code == 403
        assert refused.json()["detail"] == "Your organization is disabled"

        with superuser_override():
            assert (await _put_entity(auth_client, disabled=False)).status_code == 200
        assert (await _sign_in(app_client, user.email)).status_code == 200

    @pytest.mark.asyncio
    async def test_an_entity_with_a_superuser_is_not_disabled(
        self, organization, auth_client, db_session, enabled_entity
    ):
        await db_session.execute(
            update(models.User).where(models.User.uuid == MEMBER_UUID).values(is_superuser=True)
        )
        await db_session.commit()
        try:
            with superuser_override():
                response = await _put_entity(auth_client, disabled=True)
            assert response.status_code == 409
            assert response.json()["detail"] == "Cannot disable an entity that has a superuser"
            with superuser_override():
                assert (await _listed(auth_client))["disabled"] is False
        finally:
            await db_session.execute(
                update(models.User).where(models.User.uuid == MEMBER_UUID).values(is_superuser=False)
            )
            await db_session.commit()

    @pytest.mark.asyncio
    async def test_a_superuser_still_signs_in_to_a_disabled_entity(
        self, organization, app_client, db_session, enabled_entity
    ):
        user = await organization.add_user(password=PASSWORD)
        await db_session.execute(
            update(models.Entity).where(models.Entity.uuid == ADMIN_ENTITY).values(disabled=True)
        )
        await db_session.execute(
            update(models.User).where(models.User.uuid == user.uuid).values(is_superuser=True)
        )
        await db_session.commit()

        assert (await _sign_in(app_client, user.email)).status_code == 200

    @pytest.mark.asyncio
    async def test_a_non_superuser_cannot_disable_an_entity(self, auth_client):
        response = await _put_entity(auth_client, disabled=True)

        assert response.status_code == 403


async def _create_entity(client, name: str) -> dict:
    created = await client.post(
        "/entity/entity", json={"name": name, "admin_email": "admin@example.com"}
    )
    assert created.status_code == 200, created.text
    return created.json()


@pytest.fixture
async def removed_entity(auth_client, db_session):
    name = f"Removable {uuid4().hex[:8]}"
    with superuser_override():
        created = await _create_entity(auth_client, name)
        removed = await auth_client.delete(f"/entity/entity/{created['entity_uuid']}")
    assert removed.status_code == 200, removed.text
    yield {**created, "name": name}
    await db_session.execute(
        delete(models.Entity).where(models.Entity.uuid == created["entity_uuid"])
    )
    await db_session.commit()


class TestRemoveEntity:
    @pytest.mark.asyncio
    async def test_an_entity_with_users_is_not_removed(self, organization, auth_client):
        with superuser_override():
            refused = await auth_client.delete(f"/entity/entity/{ADMIN_ENTITY}")
            still_there = await _listed(auth_client)

        assert refused.status_code == 400
        assert refused.json()["detail"] == "Cannot delete entity with existing users"
        assert still_there["uuid"] == str(ADMIN_ENTITY)

    @pytest.mark.asyncio
    async def test_a_removed_entity_leaves_the_lists_and_keeps_its_row(
        self, auth_client, db_session, removed_entity
    ):
        entity_uuid = removed_entity["entity_uuid"]
        row = (
            await db_session.execute(
                select(models.Entity.name, models.Entity.deleted_at).where(
                    models.Entity.uuid == entity_uuid
                )
            )
        ).one()
        assert row.deleted_at is not None
        assert row.name.startswith("deleted-")
        assert row.name.endswith(f"-{removed_entity['name']}")

        with superuser_override():
            entities = (await auth_client.get("/entity/entity", params={"size": 1000})).json()
            maps = (await auth_client.get("/entity/entity-map", params={"size": 1000})).json()
            again = await auth_client.delete(f"/entity/entity/{entity_uuid}")

        assert entity_uuid not in [item["uuid"] for item in entities["items"]]
        assert removed_entity["permission_map_uuid"] not in [item["uuid"] for item in maps["items"]]
        assert again.status_code == 404

    @pytest.mark.asyncio
    async def test_removing_an_entity_cancels_the_invitations_to_it(
        self, auth_client, db_session
    ):
        with superuser_override():
            created = await _create_entity(auth_client, f"Invited {uuid4().hex[:8]}")
        invite = uuid4()
        await db_session.execute(
            insert(models.UserInvite).values(
                uuid=invite,
                email=f"invited-{uuid4().hex[:8]}@example.com",
                permissions_uuid=created["permission_map_uuid"],
                data={"first_name": "In", "last_name": "Vited"},
            )
        )
        await db_session.commit()

        with superuser_override():
            removed = await auth_client.delete(f"/entity/entity/{created['entity_uuid']}")
        remaining = (
            await db_session.execute(
                select(models.UserInvite.uuid).where(models.UserInvite.uuid == invite)
            )
        ).scalar_one_or_none()
        await db_session.execute(
            delete(models.Entity).where(models.Entity.uuid == created["entity_uuid"])
        )
        await db_session.commit()

        assert removed.status_code == 200
        assert remaining is None

    @pytest.mark.asyncio
    async def test_the_name_of_a_removed_entity_is_free_again(
        self, auth_client, db_session, removed_entity
    ):
        with superuser_override():
            created = await _create_entity(auth_client, removed_entity["name"])
            await auth_client.delete(f"/entity/entity/{created['entity_uuid']}")
        await db_session.execute(
            delete(models.Entity).where(models.Entity.uuid == created["entity_uuid"])
        )
        await db_session.commit()

        assert created["entity_uuid"] != removed_entity["entity_uuid"]

    @pytest.mark.asyncio
    async def test_a_removed_entity_cannot_be_changed(self, auth_client, removed_entity):
        entity_uuid = removed_entity["entity_uuid"]
        with superuser_override():
            changed = await auth_client.put(
                f"/entity/entity/{entity_uuid}",
                json={"name": "Revived", "sharing_enabled": True},
            )
            map_added = await auth_client.post(
                "/entity/entity-map", json={"entity_uuid": entity_uuid, "name": "Admin"}
            )
            backend_added = await auth_client.post(
                f"/entity/data-backends/{entity_uuid}",
                json={"name": "Sales", "url": "https://backend.example.com/sales"},
            )
            backends = await auth_client.get(f"/entity/data-backends/{entity_uuid}")
            backend_deleted = await auth_client.delete(f"/entity/data-backends/{entity_uuid}/Sales")

        assert changed.status_code == 404
        assert map_added.status_code == 404
        assert backend_added.status_code == 404
        assert backends.status_code == 404
        assert backend_deleted.status_code == 404

    @pytest.mark.asyncio
    async def test_nobody_is_moved_or_invited_into_a_removed_entity(
        self, organization, auth_client, db_session, removed_entity
    ):
        member = await organization.add_user()
        map_uuid = removed_entity["permission_map_uuid"]
        with superuser_override():
            moved = await auth_client.put(
                f"/entity/user/{member.uuid}", json={"permissions_uuid": map_uuid}
            )
            invited = await auth_client.post(
                "/entity/register-admin",
                json={
                    "email": f"invited_{uuid4().hex[:8]}@example.com",
                    "permissions_uuid": map_uuid,
                    "first_name": "Ada",
                    "last_name": "Lovelace",
                },
            )
        kept = (
            await db_session.execute(
                select(models.User.permissions_uuid).where(models.User.uuid == member.uuid)
            )
        ).scalar_one()

        assert moved.status_code == 404
        assert invited.status_code == 404
        assert kept == organization.maps[models.USER_TYPE]


async def _removed(client) -> list[dict]:
    listed = await client.get("/entity/entity", params={"size": 1000, "removed": True})
    assert listed.status_code == 200, listed.text
    return listed.json()["items"]


async def _restore(client, entity_uuid, **body):
    return await client.post(f"/entity/entity/{entity_uuid}/restore", json=body)


class TestRestoreEntity:
    @pytest.mark.asyncio
    async def test_removed_entities_are_listed_under_their_old_names(
        self, auth_client, removed_entity
    ):
        with superuser_override():
            removed = await _removed(auth_client)
            active = (await auth_client.get("/entity/entity", params={"size": 1000})).json()["items"]

        [listed] = [item for item in removed if item["uuid"] == removed_entity["entity_uuid"]]
        assert listed["name"] == removed_entity["name"]
        assert removed_entity["entity_uuid"] not in [item["uuid"] for item in active]

    @pytest.mark.asyncio
    async def test_a_restored_entity_comes_back_under_its_old_name_with_its_maps(
        self, auth_client, db_session, removed_entity
    ):
        entity_uuid = removed_entity["entity_uuid"]
        with superuser_override():
            restored = await _restore(auth_client, entity_uuid)
            active = (await auth_client.get("/entity/entity", params={"size": 1000})).json()["items"]
            maps = (await auth_client.get("/entity/entity-map", params={"size": 1000})).json()["items"]
            removed = await _removed(auth_client)

        assert restored.status_code == 200, restored.text
        assert [item["name"] for item in active if item["uuid"] == entity_uuid] == [removed_entity["name"]]
        assert removed_entity["permission_map_uuid"] in [item["uuid"] for item in maps]
        assert entity_uuid not in [item["uuid"] for item in removed]
        deleted_at = (
            await db_session.execute(
                select(models.Entity.deleted_at).where(models.Entity.uuid == entity_uuid)
            )
        ).scalar_one()
        assert deleted_at is None

    @pytest.mark.asyncio
    async def test_a_restored_entity_takes_the_name_it_is_given(self, auth_client, removed_entity):
        entity_uuid = removed_entity["entity_uuid"]
        name = f"Renamed {uuid4().hex[:8]}"
        with superuser_override():
            restored = await _restore(auth_client, entity_uuid, name=name)
            active = (await auth_client.get("/entity/entity", params={"size": 1000})).json()["items"]

        assert restored.status_code == 200, restored.text
        assert [item["name"] for item in active if item["uuid"] == entity_uuid] == [name]

    @pytest.mark.asyncio
    async def test_a_name_that_is_taken_is_refused_and_the_entity_stays_removed(
        self, auth_client, db_session, removed_entity
    ):
        with superuser_override():
            taken = await _create_entity(auth_client, removed_entity["name"])
            refused = await _restore(auth_client, removed_entity["entity_uuid"])
            removed = await _removed(auth_client)
            await auth_client.delete(f"/entity/entity/{taken['entity_uuid']}")
        await db_session.execute(delete(models.Entity).where(models.Entity.uuid == taken["entity_uuid"]))
        await db_session.commit()

        assert refused.status_code == 409
        assert refused.json()["detail"] == "An entity with this name already exists"
        assert removed_entity["entity_uuid"] in [item["uuid"] for item in removed]

    @pytest.mark.asyncio
    async def test_an_entity_that_was_not_removed_is_not_restored(self, auth_client):
        with superuser_override():
            active = await _restore(auth_client, ADMIN_ENTITY)
            unknown = await _restore(auth_client, uuid4())

        assert active.status_code == 404
        assert unknown.status_code == 404

    @pytest.mark.asyncio
    async def test_only_a_superuser_restores_an_entity(self, auth_client, removed_entity):
        assert (await _restore(auth_client, removed_entity["entity_uuid"])).status_code == 403


@pytest.fixture
async def user_backend(organization, db_session):
    owner = await organization.add_user(models.DEVELOPER_TYPE, password=PASSWORD)
    row = models.ApiSource(
        uuid=uuid4(),
        name="Prices",
        url="https://backend.example.com/prices",
        user_uuid=owner.uuid,
    )
    db_session.add(row)
    await db_session.commit()
    yield owner, row.uuid
    await db_session.execute(delete(models.ApiSource).where(models.ApiSource.uuid == row.uuid))
    await db_session.commit()


@pytest.fixture
async def organization_backend(organization, db_session):
    row = models.ApiSource(
        uuid=uuid4(),
        name="Shared prices",
        url="https://backend.example.com/shared",
        entity_uuid=ADMIN_ENTITY,
    )
    db_session.add(row)
    await db_session.commit()
    yield row.uuid
    await db_session.execute(delete(models.ApiSource).where(models.ApiSource.uuid == row.uuid))
    await db_session.commit()


async def _admin_apps(client) -> dict:
    response = await client.get("/admin/apps")
    assert response.status_code == 200, response.text
    return {item["uuid"]: item for item in response.json()}


class TestDisableApp:
    @pytest.mark.asyncio
    async def test_an_app_is_enabled_until_an_admin_disables_it(
        self, admin_client, user_backend
    ):
        _, backend = user_backend
        assert (await _admin_apps(admin_client))[str(backend)]["enabled"] is True

        response = await admin_client.patch(f"/admin/apps/{backend}", json={"enabled": False})
        assert response.status_code == 200, response.text
        assert (await _admin_apps(admin_client))[str(backend)]["enabled"] is False

        response = await admin_client.patch(f"/admin/apps/{backend}", json={"enabled": True})
        assert response.status_code == 200, response.text
        assert (await _admin_apps(admin_client))[str(backend)]["enabled"] is True

    @pytest.mark.asyncio
    async def test_a_disabled_app_is_unavailable_to_its_owner(
        self, admin_client, app_client, db_session, user_backend
    ):
        owner, backend = user_backend
        assert await readable_backend(db_session, owner.uuid, ADMIN_ENTITY, backend) is not None
        signed_in = await _sign_in(app_client, owner.email)
        assert [source["uuid"] for source in signed_in.json()["user"]["api_sources"]] == [str(backend)]

        await admin_client.patch(f"/admin/apps/{backend}", json={"enabled": False})

        assert await readable_backend(db_session, owner.uuid, ADMIN_ENTITY, backend) is None
        signed_in = await _sign_in(app_client, owner.email)
        assert signed_in.json()["user"]["api_sources"] == []

        await admin_client.patch(f"/admin/apps/{backend}", json={"enabled": True})

        assert await readable_backend(db_session, owner.uuid, ADMIN_ENTITY, backend) is not None

    @pytest.mark.asyncio
    async def test_an_unknown_app_is_not_found(self, admin_client):
        missing = uuid4()

        assert (await admin_client.patch(f"/admin/apps/{missing}", json={"enabled": False})).status_code == 404
        assert (await admin_client.delete(f"/admin/apps/{missing}")).status_code == 404

    @pytest.mark.asyncio
    async def test_a_member_cannot_disable_or_remove_an_app(self, auth_client, user_backend):
        _, backend = user_backend

        assert (await auth_client.patch(f"/admin/apps/{backend}", json={"enabled": False})).status_code == 403
        assert (await auth_client.delete(f"/admin/apps/{backend}")).status_code == 403

    @pytest.mark.asyncio
    async def test_an_admin_cannot_reach_the_app_of_another_entity(
        self, admin_client, auth_client, db_session
    ):
        with superuser_override():
            created = await auth_client.post(
                "/entity/entity",
                json={"name": f"Other {uuid4().hex[:8]}", "admin_email": "admin@example.com"},
            )
        entity_uuid = created.json()["entity_uuid"]
        email = f"other_{uuid4().hex[:8]}@example.com"
        outsider = models.User(
            uuid=uuid4(),
            email=email,
            clean_email=email,
            password=base.random_password(),
            confirmed=True,
            permissions_uuid=created.json()["permission_map_uuid"],
        )
        row = models.ApiSource(
            uuid=uuid4(),
            name="Elsewhere",
            url="https://backend.example.com/elsewhere",
            user_uuid=outsider.uuid,
        )
        db_session.add(outsider)
        await db_session.commit()
        db_session.add(row)
        await db_session.commit()
        try:
            patched = await admin_client.patch(f"/admin/apps/{row.uuid}", json={"enabled": False})
            deleted = await admin_client.delete(f"/admin/apps/{row.uuid}")
            enabled = (
                await db_session.execute(
                    select(models.ApiSource.enabled).where(models.ApiSource.uuid == row.uuid)
                )
            ).scalar_one()
        finally:
            await db_session.execute(delete(models.ApiSource).where(models.ApiSource.uuid == row.uuid))
            await db_session.execute(delete(models.User).where(models.User.uuid == outsider.uuid))
            await db_session.commit()
            with superuser_override():
                await auth_client.delete(f"/entity/entity/{entity_uuid}")

        assert patched.status_code == 404
        assert deleted.status_code == 404
        assert enabled is True


class TestRemoveApp:
    @pytest.mark.asyncio
    async def test_an_admin_removes_an_app_and_the_grants_of_roles_to_it(
        self, organization, admin_client, db_session, user_backend
    ):
        _, backend = user_backend
        role = await organization.role()
        db_session.add(models.RoleBackend(role_uuid=role, backend_uuid=backend, access="access"))
        await db_session.commit()

        response = await admin_client.delete(f"/admin/apps/{backend}")

        assert response.status_code == 200, response.text
        assert str(backend) not in await _admin_apps(admin_client)
        granted = await db_session.execute(
            select(models.RoleBackend.uuid).where(models.RoleBackend.backend_uuid == backend)
        )
        assert granted.first() is None


class TestOrganizationBackendInAppManagement:
    @pytest.mark.asyncio
    async def test_a_backend_of_the_organization_is_listed_without_an_owner(
        self, admin_client, organization_backend
    ):
        listed = (await _admin_apps(admin_client))[str(organization_backend)]

        assert listed["name"] == "Shared prices"
        assert listed["user_uuid"] is None
        assert listed["user_email"] is None
        assert listed["enabled"] is True

    @pytest.mark.asyncio
    async def test_disabling_it_takes_it_from_the_users_a_role_gave_it_to(
        self, organization, admin_client, db_session, organization_backend
    ):
        member = await organization.add_user(models.USER_TYPE)
        role = await organization.role(member.uuid)
        db_session.add(
            models.RoleBackend(role_uuid=role, backend_uuid=organization_backend, access="access")
        )
        await db_session.commit()
        assert await readable_backend(db_session, member.uuid, ADMIN_ENTITY, organization_backend) is not None

        disabled = await admin_client.patch(
            f"/admin/apps/{organization_backend}", json={"enabled": False}
        )

        assert disabled.status_code == 200, disabled.text
        assert (await _admin_apps(admin_client))[str(organization_backend)]["enabled"] is False
        assert await readable_backend(db_session, member.uuid, ADMIN_ENTITY, organization_backend) is None

        enabled = await admin_client.patch(
            f"/admin/apps/{organization_backend}", json={"enabled": True}
        )

        assert enabled.status_code == 200, enabled.text
        assert await readable_backend(db_session, member.uuid, ADMIN_ENTITY, organization_backend) is not None

    @pytest.mark.asyncio
    async def test_removing_it_removes_the_grants_of_roles_to_it(
        self, organization, admin_client, db_session, organization_backend
    ):
        role = await organization.role()
        db_session.add(
            models.RoleBackend(role_uuid=role, backend_uuid=organization_backend, access="access")
        )
        await db_session.commit()

        response = await admin_client.delete(f"/admin/apps/{organization_backend}")

        assert response.status_code == 200, response.text
        assert str(organization_backend) not in await _admin_apps(admin_client)
        granted = await db_session.execute(
            select(models.RoleBackend.uuid).where(models.RoleBackend.backend_uuid == organization_backend)
        )
        assert granted.first() is None
        kept = await db_session.execute(
            select(models.ApiSource.uuid).where(models.ApiSource.uuid == organization_backend)
        )
        assert kept.first() is None

    @pytest.mark.asyncio
    async def test_an_admin_cannot_reach_the_backend_of_another_organization(
        self, admin_client, auth_client, db_session
    ):
        with superuser_override():
            created = await auth_client.post(
                "/entity/entity",
                json={"name": f"Other {uuid4().hex[:8]}", "admin_email": "admin@example.com"},
            )
        entity_uuid = created.json()["entity_uuid"]
        row = models.ApiSource(
            uuid=uuid4(),
            name="Elsewhere",
            url="https://backend.example.com/elsewhere",
            entity_uuid=entity_uuid,
        )
        db_session.add(row)
        await db_session.commit()
        try:
            listed = await _admin_apps(admin_client)
            patched = await admin_client.patch(f"/admin/apps/{row.uuid}", json={"enabled": False})
            deleted = await admin_client.delete(f"/admin/apps/{row.uuid}")
            enabled = (
                await db_session.execute(
                    select(models.ApiSource.enabled).where(models.ApiSource.uuid == row.uuid)
                )
            ).scalar_one()
        finally:
            await db_session.execute(delete(models.ApiSource).where(models.ApiSource.uuid == row.uuid))
            await db_session.commit()
            with superuser_override():
                await auth_client.delete(f"/entity/entity/{entity_uuid}")

        assert str(row.uuid) not in listed
        assert patched.status_code == 404
        assert deleted.status_code == 404
        assert enabled is True
