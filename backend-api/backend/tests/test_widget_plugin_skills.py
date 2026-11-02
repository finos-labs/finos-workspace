import pytest
from sqlalchemy import delete

from api import models
from api.widget_plugins import service
from tests.fixtures.widget_plugins import (
    ADMIN_ENTITY,
    approve,
    enable,
    manifest,
    plugin_view,
    rescan,
    version_view,
    write_package,
)

BASE = {"entry.js": b"x", "entry.css": b"b"}
SKILL = b"# Forecast charts\n\nAsk for the region first, then draw the chart.\n"


def with_skills(*skills: dict, version: str = "1.0.0") -> dict:
    data = manifest(version=version)
    data["contributes"]["skills"] = list(skills)
    return data


def forecast() -> dict:
    return {"slug": "forecast-charts", "description": "How to draw a forecast", "file": "skills/forecast.md"}


async def package(
    plugins_dir, *skills: dict, files: dict[str, bytes] | None = None, version: str = "1.0.0", text: bytes = SKILL
):
    contents = {"entry.js": b"export default {};\n", "entry.css": b"body{}\n", "skills/forecast.md": text}
    return write_package(
        plugins_dir, with_skills(*skills, version=version), files=files if files is not None else contents
    )


async def skills_of(client) -> list[dict]:
    response = await client.request("DELETE", "/app/skills", json=[])
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture(autouse=True)
def fresh_skill_texts():
    service._skill_texts.clear()
    yield
    service._skill_texts.clear()


class TestWhoGetsThem:
    @pytest.mark.asyncio
    async def test_every_user_of_the_organization_gets_the_skills_of_an_enabled_plugin(
        self, member, superuser, plugins_dir
    ):
        await package(plugins_dir, forecast())
        await rescan(superuser)
        await approve(superuser)
        assert await skills_of(member) == []
        await enable(superuser)

        [skill] = await skills_of(member)

        assert (skill["slug"], skill["description"], skill["content"]) == (
            "forecast-charts",
            "How to draw a forecast",
            SKILL.decode(),
        )
        assert skill["pluginName"] == "Test chart"
        assert skill["id"] and skill["createdDate"] and skill["updatedDate"]

    @pytest.mark.asyncio
    async def test_the_skills_go_with_the_plugin_when_it_is_disabled(self, member, superuser, plugins_dir):
        await package(plugins_dir, forecast())
        await rescan(superuser)
        await approve(superuser)
        await enable(superuser)
        assert len(await skills_of(member)) == 1

        response = await superuser.put("/admin/plugins/test-chart", json={"enabled": False})
        assert response.status_code == 200, response.text

        assert await skills_of(member) == []

    @pytest.mark.asyncio
    async def test_a_skill_of_another_organizations_plugin_is_not_seen(
        self, member, superuser, plugins_dir, db_session
    ):
        await package(plugins_dir, forecast())
        await rescan(superuser)
        await approve(superuser)
        await enable(superuser)
        await db_session.execute(
            delete(models.EntityWidgetPlugin).where(models.EntityWidgetPlugin.entity_uuid == ADMIN_ENTITY)
        )
        await db_session.commit()

        assert await skills_of(member) == []

    @pytest.mark.asyncio
    async def test_the_plugins_off_gives_none(self, member, superuser, plugins_dir, monkeypatch):
        await package(plugins_dir, forecast())
        await rescan(superuser)
        await approve(superuser)
        await enable(superuser)
        monkeypatch.setattr("api.widget_plugins.service.settings.WIDGET_PLUGINS_DIR", None)

        assert await skills_of(member) == []


class TestTheUsersOwnSkills:
    @pytest.mark.asyncio
    async def test_a_skill_of_the_user_with_the_same_slug_wins(self, member, superuser, plugins_dir):
        await package(plugins_dir, forecast())
        await rescan(superuser)
        await approve(superuser)
        await enable(superuser)

        response = await member.post(
            "/app/skills", json={"slug": "forecast-charts", "description": "mine", "content": "my own"}
        )
        assert response.status_code == 200, response.text

        [skill] = response.json()
        assert (skill["description"], skill["pluginName"]) == ("mine", None)

    @pytest.mark.asyncio
    async def test_a_plugins_skill_cannot_be_deleted_or_changed_through_the_user_routes(
        self, member, superuser, plugins_dir
    ):
        await package(plugins_dir, forecast())
        await rescan(superuser)
        await approve(superuser)
        await enable(superuser)
        [skill] = await skills_of(member)

        deleted = await member.request("DELETE", "/app/skills", json=[skill["id"]])
        patched = await member.patch(
            f"/app/skills/{skill['id']}", json={"slug": "forecast-charts", "description": "x", "content": "x"}
        )

        assert [s["content"] for s in deleted.json()] == [SKILL.decode()]
        assert [s["content"] for s in patched.json()] == [SKILL.decode()]


class TestWhatAnApprovedPackageCannotBe:
    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("skills", "files", "reason"),
        [
            ([forecast()], {"entry.js": b"x", "entry.css": b"b"}, "named by a skill but missing"),
            (
                [{**forecast(), "file": "notes/forecast.md"}],
                None,
                "file",
            ),
            ([{**forecast(), "file": "skills/forecast.txt"}], None, "file"),
            ([forecast(), {**forecast(), "file": "skills/other.md"}], None, "skill slugs must be unique"),
            ([forecast(), {**forecast(), "slug": "second"}], None, "two skills name the same file"),
            ([{**forecast(), "slug": "Bad Slug"}], None, "slug"),
            ([forecast()], {**BASE, "skills/forecast.md": b"x" * (32 * 1024 + 1)}, "at most"),
            ([forecast()], {**BASE, "skills/forecast.md": b"  \n"}, "not empty"),
            ([forecast()], {**BASE, "skills/forecast.md": b"\xff\xfe"}, "UTF-8"),
        ],
    )
    async def test_it_is_blocked(self, superuser, plugins_dir, skills, files, reason):
        await package(plugins_dir, *skills, files=files)
        summary = await rescan(superuser)

        assert summary["blocked"] == ["test-chart@1.0.0"]
        view = version_view(await plugin_view(superuser))
        assert any(reason in finding for finding in [view.get("blocked_reason") or "", *(view.get("errors") or [])]), view

    @pytest.mark.asyncio
    async def test_a_skill_file_changed_after_approval_is_not_given_out(self, member, superuser, plugins_dir):
        directory = await package(plugins_dir, forecast())
        await rescan(superuser)
        await approve(superuser)
        await enable(superuser)
        (directory / "skills" / "forecast.md").write_bytes(b"# Changed after approval\n")

        assert await skills_of(member) == []


class TestTheReview:
    @pytest.mark.asyncio
    async def test_each_skill_is_listed_and_a_changed_one_is_asked_for_again(self, superuser, plugins_dir):
        await package(plugins_dir, forecast())
        await rescan(superuser)
        review = version_view(await plugin_view(superuser))["review"]
        [item] = [i for i in review if i["family"] == "skills"]
        assert item["key"] == "skill:forecast-charts" and item["added"] is True

        view = version_view(await plugin_view(superuser))
        refused = await superuser.post(
            "/plugins/test-chart/versions/1.0.0/approve",
            json={
                "digest": view["digest"],
                "acknowledged": [i["key"] for i in view["review"] if i["key"] != item["key"]],
            },
        )
        assert refused.status_code == 422
        await approve(superuser)

        await package(plugins_dir, forecast(), version="1.1.0", text=b"# Changed\n")
        await rescan(superuser)
        changed = version_view(await plugin_view(superuser), "1.1.0")["review"]
        assert next(i for i in changed if i["family"] == "skills")["added"] is True
        await approve(superuser, version="1.1.0")

        await package(plugins_dir, forecast(), version="1.2.0", text=b"# Changed\n")
        await rescan(superuser)
        same = version_view(await plugin_view(superuser), "1.2.0")["review"]
        assert next(i for i in same if i["family"] == "skills")["added"] is False
