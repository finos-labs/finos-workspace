"""
Integration tests for the plugin routes.

A superuser installs a released version of a plugin (pinned by its digest) or uninstalls
it, for the whole Workspace. An admin enables or disables an installed plugin for their own
organization only, and cannot enable one that is not installed. Every signed-in user reads
the installations and the plugins enabled for their organization; nobody else's.
Uninstalling a plugin takes it from every organization.
"""

import os
import sys

BACKEND_DIR = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import pytest
from sqlalchemy import delete, select, update

from api import models
from tests.fixtures.organization import ADMIN_UUID

PLUGIN = "bq-advanced-grouping"


def release(version: str = "1.0.0", digest: str = "a") -> dict:
    """A release as the plugin host's release index describes it."""
    return {
        "version": version,
        "digest": f"sha256:{digest * 64}",
        "files": {"index.html": {"sha256": "b" * 64, "bytes": 512}},
        "requests": {"network": ["https://api.example.com"], "downloads": True},
        "releaseNotes": "First.",
        "source": {"commit": "a1b2c3d4"},
    }


async def _set_superuser(db_session, value: bool) -> None:
    await db_session.execute(
        update(models.User).where(models.User.uuid == ADMIN_UUID).values(is_superuser=value)
    )
    await db_session.commit()


async def _clear_plugins(db_session) -> None:
    await db_session.execute(delete(models.EntityPlugin))
    await db_session.execute(delete(models.PluginInstallation))
    await db_session.commit()


@pytest.fixture
async def plugins(db_session, admin_client):
    """No plugin installed, and the admin a superuser until the test ends."""
    await _clear_plugins(db_session)
    await _set_superuser(db_session, True)
    yield
    await _set_superuser(db_session, False)
    await _clear_plugins(db_session)


async def _install(client, plugin: str = PLUGIN, **kwargs):
    return await client.put(f"/plugins/installations/{plugin}", json=release(**kwargs))


class TestInstallations:
    @pytest.mark.asyncio
    async def test_a_superuser_installs_a_pinned_release(
        self, plugins, admin_client, auth_client, db_session
    ):
        response = await _install(admin_client)

        assert response.status_code == 200
        body = response.json()
        assert body["pluginId"] == PLUGIN
        assert body["version"] == "1.0.0"
        assert body["digest"] == f"sha256:{'a' * 64}"
        assert body["files"] == {"index.html": {"sha256": "b" * 64, "bytes": 512}}
        assert body["releaseNotes"] == "First."
        assert body["source"] == {"commit": "a1b2c3d4"}
        stored = (
            await db_session.execute(
                select(models.PluginInstallation.approved_by_uuid).where(
                    models.PluginInstallation.plugin_id == PLUGIN
                )
            )
        ).scalar_one()
        assert stored == ADMIN_UUID

        # Every signed-in user reads what is installed
        listed = await auth_client.get("/plugins/installations")
        assert listed.status_code == 200
        assert [item["pluginId"] for item in listed.json()] == [PLUGIN]

    @pytest.mark.asyncio
    async def test_approving_another_version_replaces_the_installed_one(
        self, plugins, admin_client
    ):
        await _install(admin_client)
        await admin_client.put(f"/plugins/entity/{PLUGIN}")

        response = await _install(admin_client, version="1.1.0", digest="c")

        assert response.status_code == 200
        listed = (await admin_client.get("/plugins/installations")).json()
        assert [(item["version"], item["digest"]) for item in listed] == [
            ("1.1.0", f"sha256:{'c' * 64}")
        ]
        # The organizations that enabled it keep it
        enabled = await admin_client.get("/plugins/entity")
        assert enabled.json() == {"pluginIds": [PLUGIN]}

    @pytest.mark.asyncio
    async def test_only_a_superuser_installs_or_uninstalls(
        self, plugins, admin_client, auth_client, db_session
    ):
        await _set_superuser(db_session, False)

        assert (await _install(admin_client)).status_code == 403
        assert (await _install(auth_client)).status_code == 403
        assert (
            await admin_client.delete(f"/plugins/installations/{PLUGIN}")
        ).status_code == 403
        assert (await admin_client.get("/plugins/installations")).json() == []

    @pytest.mark.asyncio
    async def test_uninstalling_takes_the_plugin_from_every_organization(
        self, plugins, admin_client, db_session
    ):
        await _install(admin_client)
        await admin_client.put(f"/plugins/entity/{PLUGIN}")

        response = await admin_client.delete(f"/plugins/installations/{PLUGIN}")

        assert response.status_code == 200
        assert (await admin_client.get("/plugins/installations")).json() == []
        assert (await admin_client.get("/plugins/entity")).json() == {"pluginIds": []}
        rows = (await db_session.execute(select(models.EntityPlugin))).all()
        assert rows == []
        # Uninstalling again changes nothing
        again = await admin_client.delete(f"/plugins/installations/{PLUGIN}")
        assert again.status_code == 200

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "change",
        [
            {"digest": "sha256:short"},
            {"version": "latest"},
            {"files": {"index.html": {"sha256": "nothex", "bytes": 1}}},
            {"files": {"index.html": {"sha256": "b" * 64, "bytes": -1}}},
            {"unexpected": True},
        ],
    )
    async def test_refuses_a_release_that_is_not_well_formed(
        self, plugins, admin_client, change
    ):
        response = await admin_client.put(
            f"/plugins/installations/{PLUGIN}", json={**release(), **change}
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_refuses_a_plugin_id_that_is_not_a_registry_id(
        self, plugins, admin_client
    ):
        response = await _install(admin_client, plugin="Not_A_Slug")
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_requires_a_signed_in_user(self, app_client):
        assert (await app_client.get("/plugins/installations")).status_code == 401
        assert (await app_client.get("/plugins/entity")).status_code == 401


class TestEntityPlugins:
    @pytest.mark.asyncio
    async def test_an_admin_enables_and_disables_for_their_organization(
        self, plugins, organization, admin_client, auth_client
    ):
        await _install(admin_client)
        assert (await auth_client.get("/plugins/entity")).json() == {"pluginIds": []}

        enabled = await admin_client.put(f"/plugins/entity/{PLUGIN}")
        assert enabled.status_code == 200
        # A user of the organization gets it; enabling twice changes nothing
        assert (await auth_client.get("/plugins/entity")).json() == {
            "pluginIds": [PLUGIN]
        }
        assert (await admin_client.put(f"/plugins/entity/{PLUGIN}")).status_code == 200

        disabled = await admin_client.delete(f"/plugins/entity/{PLUGIN}")
        assert disabled.status_code == 200
        assert (await auth_client.get("/plugins/entity")).json() == {"pluginIds": []}
        # The installation itself is untouched
        assert len((await auth_client.get("/plugins/installations")).json()) == 1

    @pytest.mark.asyncio
    async def test_another_organization_does_not_get_it(
        self, plugins, admin_client, second_user_client
    ):
        await _install(admin_client)
        await admin_client.put(f"/plugins/entity/{PLUGIN}")

        response = await second_user_client.get("/plugins/entity")

        assert response.json() == {"pluginIds": []}

    @pytest.mark.asyncio
    async def test_cannot_enable_a_plugin_that_is_not_installed(
        self, plugins, admin_client, db_session
    ):
        response = await admin_client.put(f"/plugins/entity/{PLUGIN}")

        assert response.status_code == 404
        assert "not installed" in response.json()["detail"]
        assert (await db_session.execute(select(models.EntityPlugin))).all() == []

    @pytest.mark.asyncio
    async def test_only_an_admin_enables_or_disables(
        self, plugins, organization, admin_client, auth_client
    ):
        await _install(admin_client)

        assert (await auth_client.put(f"/plugins/entity/{PLUGIN}")).status_code == 403
        assert (await auth_client.delete(f"/plugins/entity/{PLUGIN}")).status_code == 403
        assert (await auth_client.get("/plugins/entity")).json() == {"pluginIds": []}
