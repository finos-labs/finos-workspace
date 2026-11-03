import copy

import pytest

from tests.fixtures.widget_plugins import (
    approve,
    enable,
    grant,
    manifest,
    plugin_view,
    rescan,
    user_listing,
    version_view,
    write_package,
)

DATA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["rows"],
    "properties": {
        "title": {"type": "string", "maxLength": 80},
        "rows": {
            "type": "array",
            "maxItems": 500,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {"x": {"type": "string", "maxLength": 40}, "y": {"type": "number"}},
            },
        },
    },
}
ARTIFACT = {"description": "A chart of rows with an x label and a y value", "data": DATA}


def with_artifact(artifact: dict | None = ARTIFACT, version: str = "1.0.0", **widget) -> dict:
    data = manifest(version=version)
    chart = data["contributes"]["widgets"][0]
    if artifact is not None:
        chart["artifact"] = copy.deepcopy(artifact)
    chart.update(widget)
    return data


class TestTheListing:
    @pytest.mark.asyncio
    async def test_a_user_with_the_grant_is_told_the_widget_is_an_artifact(self, member, superuser, plugins_dir):
        write_package(plugins_dir, with_artifact())
        await rescan(superuser)
        await approve(superuser)
        await enable(superuser)
        await grant(superuser)

        [plugin] = (await user_listing(member))["plugins"]

        assert plugin["widgets"][0]["artifact"] == ARTIFACT

    @pytest.mark.asyncio
    async def test_a_widget_without_one_says_none(self, member, superuser, plugins_dir):
        write_package(plugins_dir, with_artifact(None))
        await rescan(superuser)
        await approve(superuser)
        await enable(superuser)
        await grant(superuser)

        [plugin] = (await user_listing(member))["plugins"]

        assert plugin["widgets"][0]["artifact"] is None

    @pytest.mark.asyncio
    async def test_a_user_without_the_grant_is_not_told(self, member, superuser, plugins_dir):
        write_package(plugins_dir, with_artifact())
        await rescan(superuser)
        await approve(superuser)
        await enable(superuser)

        assert (await user_listing(member))["plugins"] == []


class TestTheScanner:
    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("data", "reason"),
        [
            (with_artifact(permissions=["core:params:write"]), "core:data:read"),
            (
                with_artifact(model={"traits": {"theme": {"bind": "theme"}}}),
                "binds a trait to data",
            ),
            (with_artifact({"description": "x", "data": {**DATA, "additionalProperties": True}}), "closed and bounded"),
            (
                with_artifact(
                    {
                        "description": "x",
                        "data": {**DATA, "properties": {"rows": {"type": "array", "items": {"type": "string"}}}},
                    }
                ),
                "maxItems",
            ),
            (with_artifact({"description": "", "data": DATA}), "description"),
            (with_artifact({"description": "x"}), "data"),
            (with_artifact({"description": "x", "data": DATA, "other": 1}), "other"),
        ],
    )
    async def test_it_is_blocked(self, superuser, plugins_dir, data, reason):
        write_package(plugins_dir, data)
        summary = await rescan(superuser)

        assert summary["blocked"] == ["test-chart@1.0.0"]
        view = version_view(await plugin_view(superuser))
        assert any(reason in finding for finding in [view.get("blocked_reason") or "", *(view.get("errors") or [])]), view

    @pytest.mark.asyncio
    async def test_a_widget_that_binds_data_is_accepted(self, superuser, plugins_dir):
        write_package(
            plugins_dir,
            with_artifact(model={"traits": {"rows": {"bind": "data"}, "theme": {"bind": "theme"}}}),
        )

        assert (await rescan(superuser))["blocked"] == []


class TestTheReview:
    @pytest.mark.asyncio
    async def test_the_artifact_is_asked_for_and_a_changed_one_again(self, superuser, plugins_dir):
        write_package(plugins_dir, with_artifact())
        await rescan(superuser)
        review = version_view(await plugin_view(superuser))["review"]
        [item] = [i for i in review if i["family"] == "artifacts"]
        assert item["key"] == "artifact:chart" and item["added"] is True and item["risk"] == "medium"
        await approve(superuser)

        write_package(
            plugins_dir,
            with_artifact({**ARTIFACT, "description": "A chart of rows, now with a title"}, version="1.1.0"),
        )
        await rescan(superuser)
        changed = version_view(await plugin_view(superuser), "1.1.0")["review"]
        assert next(i for i in changed if i["family"] == "artifacts")["added"] is True
        await approve(superuser, version="1.1.0")

        write_package(
            plugins_dir,
            with_artifact({**ARTIFACT, "description": "A chart of rows, now with a title"}, version="1.2.0"),
        )
        await rescan(superuser)
        same = version_view(await plugin_view(superuser), "1.2.0")["review"]
        assert next(i for i in same if i["family"] == "artifacts")["added"] is False

    @pytest.mark.asyncio
    async def test_dropping_it_is_shown_as_removed(self, superuser, plugins_dir):
        write_package(plugins_dir, with_artifact())
        await rescan(superuser)
        await approve(superuser)

        write_package(plugins_dir, with_artifact(None, version="1.1.0"))
        await rescan(superuser)
        review = version_view(await plugin_view(superuser), "1.1.0")["review"]

        assert next(i for i in review if i["key"] == "artifact:chart")["removed"] is True
