"""The Prometheus metrics of widget plugins (docs/widget-plugins/DESIGN.md 11), through the
API: what a rescan found and blocked, approvals, file fetches, blocked-request reports,
frame failures and proxy calls. Labels are only counted for plugins of the deployment."""

import pytest
from prometheus_client import REGISTRY

from tests.fixtures.plugin_proxies import CALL, call, ready
from tests.fixtures.upstream import Answer
from tests.fixtures.widget_plugins import approve, enable, manifest, plugin_view, rescan, version_view, write_package


def value(name: str, **labels: str) -> float:
    return REGISTRY.get_sample_value(name, labels) or 0.0


class Counted:
    """The change of a sample over a block of the test."""

    def __init__(self, name: str, **labels: str) -> None:
        self.name, self.labels = name, labels
        self.before = value(name, **labels)

    @property
    def change(self) -> float:
        return value(self.name, **self.labels) - self.before


class TestDiscoveryAndApproval:
    @pytest.mark.asyncio
    async def test_a_rescan_counts_what_it_found_and_blocked(self, superuser, plugins_dir):
        discovered = Counted("widget_plugin_discoveries_total", outcome="discovered")
        blocked = Counted("widget_plugin_discoveries_total", outcome="blocked")
        checksum = Counted("widget_plugin_blocks_total", reason="checksum")
        write_package(plugins_dir)
        other = manifest("other-chart")
        other["contributes"]["widgets"][0]["handles"][0]["type"] = "other_chart"
        write_package(plugins_dir, other, checksum="sha256-" + "B" * 43)
        await rescan(superuser)
        assert (discovered.change, blocked.change, checksum.change) == (1, 1, 1)

        approvals = Counted("widget_plugin_approvals_total")
        await approve(superuser)
        assert approvals.change == 1

    @pytest.mark.asyncio
    async def test_files_served_refused_and_changed(self, member, superuser, plugins_dir):
        directory = write_package(plugins_dir)
        await rescan(superuser)
        await approve(superuser)
        await enable(superuser, access_mode="everyone")
        digest = version_view(await plugin_view(superuser))["digest"]
        base = f"/app/widget-plugins/test-chart/{digest}/files"

        served = Counted("widget_plugin_file_fetches_total", outcome="served")
        refused = Counted("widget_plugin_file_fetches_total", outcome="refused")
        changed = Counted("widget_plugin_file_fetches_total", outcome="changed")
        blocks = Counted("widget_plugin_blocks_total", reason="changed")
        assert (await member.get(f"{base}/entry.js")).status_code == 200
        assert (await member.get(f"{base}/plugin.json")).status_code == 404
        (directory / "entry.css").write_bytes(b"body{color:red}\n")
        assert (await member.get(f"{base}/entry.css")).status_code == 409
        assert (served.change, refused.change, changed.change, blocks.change) == (1, 1, 1, 1)


class TestReports:
    @pytest.mark.asyncio
    async def test_blocked_requests_and_frame_failures_are_counted(self, member, superuser, plugins_dir):
        write_package(plugins_dir)
        await rescan(superuser)
        await approve(superuser)
        await enable(superuser, access_mode="everyone")

        img = Counted("widget_plugin_csp_reports_total", directive="img-src")
        failures = Counted(
            "widget_plugin_frame_failures_total", plugin="test-chart", version="1.0.0", kind="unresponsive"
        )
        response = await member.post(
            "/app/widget-plugins/report",
            json={
                "plugin_id": "test-chart",
                "version": "1.0.0",
                "reports": [{"directive": "img-src", "origin": "https://tiles.example.org"}],
                "failure": "unresponsive",
            },
        )
        assert response.status_code == 200, response.text
        assert (img.change, failures.change) == (1, 1)

    @pytest.mark.asyncio
    async def test_a_failure_of_a_plugin_the_user_cannot_use_is_not_counted(self, member, superuser, plugins_dir):
        write_package(plugins_dir)
        await rescan(superuser)
        failures = Counted("widget_plugin_frame_failures_total", plugin="test-chart", version="1.0.0", kind="ended")
        response = await member.post(
            "/app/widget-plugins/report",
            json={"plugin_id": "test-chart", "version": "1.0.0", "failure": "ended"},
        )
        assert response.status_code == 200, response.text
        assert failures.change == 0
        bad = await member.post(
            "/app/widget-plugins/report",
            json={"plugin_id": "test-chart", "version": "1.0.0", "failure": "<script>"},
        )
        assert bad.status_code == 422


class TestProxyCalls:
    @pytest.mark.asyncio
    async def test_calls_are_counted_by_outcome_and_status_class(self, member, superuser, plugins_dir, upstream):
        await ready(superuser, plugins_dir, upstream.port)
        ok = Counted("widget_plugin_proxy_calls_total", plugin="test-chart", outcome="ok", status_class="2xx")
        failed = Counted(
            "widget_plugin_proxy_calls_total", plugin="test-chart", outcome="upstream_error", status_class="5xx"
        )
        refused = Counted(
            "widget_plugin_proxy_calls_total", plugin="test-chart", outcome="invalid_args", status_class="none"
        )
        timed = Counted("widget_plugin_proxy_call_seconds_count", plugin="test-chart")
        assert (await call(member, {"symbol": "IBM"})).status_code == 200
        assert (await call(member, {"symbol": "X" * 13})).status_code == 422
        upstream.answer = lambda _r: Answer(status=503)
        assert (await call(member, {"symbol": "IBM"})).status_code == 502
        assert (ok.change, failed.change, refused.change, timed.change) == (1, 1, 1, 3)

        # A plugin that is not available is not a label
        unknown = await call(member, {"symbol": "IBM"}, path=CALL.replace("test-chart", "not-a-plugin"))
        assert unknown.status_code == 404
        assert value("widget_plugin_proxy_call_seconds_count", plugin="not-a-plugin") == 0
