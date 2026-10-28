import json
import shutil
import stat

import pytest

from api.widget_plugins.discovery import inspect_version, package_checksum, sha256_file
from api.widget_plugins.service import next_version
from tests.fixtures.base import settings
from tests.fixtures.widget_plugins import (
    ENTRY,
    approve,
    enable,
    grant,
    plugin_view,
    rescan,
    user_listing,
    version_view,
    write_package,
)

PLUGIN = "test-chart"


@pytest.fixture
def local(monkeypatch):
    monkeypatch.setattr(settings, "MODE", "local")


async def _approved(superuser, plugins_dir):
    write_package(plugins_dir)
    await rescan(superuser)
    await approve(superuser)
    await enable(superuser)
    await grant(superuser)


async def _develop(superuser, version="1.0.0", bump="patch"):
    return await superuser.post(f"/plugins/{PLUGIN}/versions/{version}/develop", json={"bump": bump})


def _write_checksum(directory):
    raw = json.loads((directory / "plugin.json").read_text())
    raw["checksum"] = package_checksum(
        {
            p.relative_to(directory).as_posix(): sha256_file(p)
            for p in directory.rglob("*")
            if p.is_file() and p.name != "plugin.json"
        }
    )
    (directory / "plugin.json").write_text(json.dumps(raw))


async def _served(member):
    [plugin] = (await user_listing(member))["plugins"]
    return plugin


class TestNextVersion:
    def test_counts_from_the_highest_version(self):
        existing = ["1.0.0", "1.2.3", "0.9.9"]
        assert next_version(existing, "patch") == "1.2.4"
        assert next_version(existing, "minor") == "1.3.0"
        assert next_version(existing, "major") == "2.0.0"


class TestStartingAVersion:
    @pytest.mark.asyncio
    async def test_refused_outside_a_local_stack(self, superuser, plugins_dir):
        await _approved(superuser, plugins_dir)
        response = await _develop(superuser)
        assert response.status_code == 409
        assert "MODE is local" in response.json()["detail"]
        assert not (plugins_dir / PLUGIN / "1.0.1").exists()
        assert (await plugin_view(superuser))["versions"][0]["version"] == "1.0.0"

    @pytest.mark.asyncio
    async def test_copies_the_approved_version_to_the_next_number(self, superuser, plugins_dir, local):
        await _approved(superuser, plugins_dir)
        response = await _develop(superuser)
        assert response.status_code == 200, response.text
        assert response.json() == {"plugin_id": PLUGIN, "version": "1.0.1", "path": f"{PLUGIN}/1.0.1"}

        source, copy = plugins_dir / PLUGIN / "1.0.0", plugins_dir / PLUGIN / "1.0.1"
        assert (copy / "entry.js").read_bytes() == (source / "entry.js").read_bytes()
        assert json.loads((copy / "plugin.json").read_text())["version"] == "1.0.1"
        strict = inspect_version(
            plugins_dir, PLUGIN, "1.0.1", pins={}, require_pins=False, max_files=200, max_bytes=10**8
        )
        assert strict.errors == []

        plugin = await plugin_view(superuser)
        assert plugin["active_version"] == "1.0.0"
        view = version_view(plugin, "1.0.1")
        assert view["state"] == "development"
        assert view["checksum"] == view["declared_checksum"]
        events = [e["action"] for e in (await superuser.get(f"/plugins/{PLUGIN}/events")).json()]
        assert "development-started" in events

    @pytest.mark.asyncio
    @pytest.mark.parametrize(("bump", "version"), [("minor", "1.1.0"), ("major", "2.0.0")])
    async def test_minor_and_major(self, superuser, plugins_dir, local, bump, version):
        await _approved(superuser, plugins_dir)
        response = await _develop(superuser, bump=bump)
        assert response.status_code == 200, response.text
        assert response.json()["version"] == version

    @pytest.mark.asyncio
    async def test_only_from_an_approved_version(self, superuser, plugins_dir, local):
        write_package(plugins_dir)
        await rescan(superuser)
        response = await _develop(superuser)
        assert response.status_code == 409
        assert response.json()["detail"] == "A new version starts from an approved one"

    @pytest.mark.asyncio
    async def test_one_version_at_a_time(self, superuser, plugins_dir, local):
        await _approved(superuser, plugins_dir)
        assert (await _develop(superuser)).status_code == 200
        response = await _develop(superuser, bump="minor")
        assert response.status_code == 409
        assert response.json()["detail"].startswith("1.0.1 is in development")

    @pytest.mark.asyncio
    async def test_a_read_only_plugins_directory_is_reported(self, superuser, plugins_dir, local):
        await _approved(superuser, plugins_dir)
        plugin_dir = plugins_dir / PLUGIN
        plugin_dir.chmod(stat.S_IRUSR | stat.S_IXUSR)
        try:
            response = await _develop(superuser)
        finally:
            plugin_dir.chmod(stat.S_IRWXU)
        assert response.status_code == 409
        assert response.json()["detail"].startswith("The plugins directory cannot be written")
        assert not (plugin_dir / "1.0.1").exists()


class TestDeveloping:
    @pytest.mark.asyncio
    async def test_the_files_on_disk_are_served_and_edits_never_block(self, member, superuser, plugins_dir, local):
        await _approved(superuser, plugins_dir)
        await _develop(superuser)
        copy = plugins_dir / PLUGIN / "1.0.1"

        first = await _served(member)
        assert first["version"] == "1.0.1"
        edited = b"export default { render({ el }) { el.textContent = 'edited'; } };\n"
        (copy / "entry.js").write_bytes(edited)
        second = await _served(member)
        assert second["digest"] != first["digest"]

        stale = await member.get(f"/app/widget-plugins/{PLUGIN}/{first['digest']}/files/entry.js")
        assert stale.status_code == 404
        fresh = await member.get(f"/app/widget-plugins/{PLUGIN}/{second['digest']}/files/entry.js")
        assert fresh.status_code == 200
        assert fresh.content == edited

        await rescan(superuser)
        view = version_view(await plugin_view(superuser), "1.0.1")
        assert view["state"] == "development"
        assert view["blocked_reason"] is None
        assert view["digest"] == second["digest"]

    @pytest.mark.asyncio
    async def test_a_stale_checksum_is_a_warning_until_approval(self, member, superuser, plugins_dir, local):
        await _approved(superuser, plugins_dir)
        await _develop(superuser)
        copy = plugins_dir / PLUGIN / "1.0.1"
        (copy / "entry.js").write_bytes(ENTRY + b"//\n")

        view = version_view(await plugin_view(superuser), "1.0.1")
        assert view["findings"]["errors"] == []
        assert any("checksum" in w for w in view["findings"]["warnings"])
        assert view["checksum"] != view["declared_checksum"]
        keys = [item["key"] for item in view["review"] if item["added"]]
        refused = await superuser.post(
            f"/plugins/{PLUGIN}/versions/1.0.1/approve", json={"digest": view["digest"], "acknowledged": keys}
        )
        assert refused.status_code == 409
        assert "checksum" in refused.json()["detail"]
        assert version_view(await plugin_view(superuser), "1.0.1")["state"] == "development"

        _write_checksum(copy)
        await approve(superuser, version="1.0.1")
        plugin = await plugin_view(superuser)
        assert plugin["active_version"] == "1.0.1"
        assert version_view(plugin, "1.0.0")["state"] == "retired"

        served = await _served(member)
        (copy / "entry.js").write_bytes(b"export default {};\n")
        blocked = await member.get(f"/app/widget-plugins/{PLUGIN}/{served['digest']}/files/entry.js")
        assert blocked.status_code == 409
        assert version_view(await plugin_view(superuser), "1.0.1")["state"] == "blocked"

    @pytest.mark.asyncio
    async def test_outside_a_local_stack_the_approved_version_is_served(
        self, member, superuser, plugins_dir, local, monkeypatch
    ):
        await _approved(superuser, plugins_dir)
        await _develop(superuser)
        assert (await _served(member))["version"] == "1.0.1"
        monkeypatch.setattr(settings, "MODE", "production")
        assert (await _served(member))["version"] == "1.0.0"
        schema = (await member.get("/app/widget-plugins/widgets-schema")).json()
        assert "test_chart" in schema["x-types"]

    @pytest.mark.asyncio
    async def test_a_broken_version_is_not_served(self, member, superuser, plugins_dir, local):
        await _approved(superuser, plugins_dir)
        await _develop(superuser)
        (plugins_dir / PLUGIN / "1.0.1" / "plugin.json").write_text("{")
        assert (await user_listing(member))["plugins"] == []
        view = version_view(await plugin_view(superuser), "1.0.1")
        assert view["state"] == "development"
        assert any("not valid JSON" in e for e in view["findings"]["errors"])

    @pytest.mark.asyncio
    async def test_the_widgets_schema_follows_the_version_in_development(self, member, superuser, plugins_dir, local):
        await _approved(superuser, plugins_dir)
        await _develop(superuser)
        manifest_path = plugins_dir / PLUGIN / "1.0.1" / "plugin.json"
        raw = json.loads(manifest_path.read_text())
        title = raw["contributes"]["widgets"][0]["handles"][0]["definition"]["properties"]["title"]
        title["maxLength"] = 120
        manifest_path.write_text(json.dumps(raw))
        schema = (await member.get("/app/widget-plugins/widgets-schema")).json()
        data = schema["definitions"]["Data_test_chart"]["properties"]["test_chart"]
        assert data["properties"]["title"]["maxLength"] == 120

    @pytest.mark.asyncio
    async def test_deleting_the_directory_ends_development(self, superuser, plugins_dir, local):
        await _approved(superuser, plugins_dir)
        await _develop(superuser)
        shutil.rmtree(plugins_dir / PLUGIN / "1.0.1")
        summary = await rescan(superuser)
        assert f"{PLUGIN}@1.0.1" in summary["missing"]
        response = await _develop(superuser)
        assert response.status_code == 200, response.text
        assert response.json()["version"] == "1.0.2"
