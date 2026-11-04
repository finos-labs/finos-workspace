import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PlatformPlugin, PlatformVersion } from "~/api/plugins.api";
import { TrustSummary } from "~/components/AdminPlugins/TrustSummary";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("~/api/plugins.api", () => ({ approvePluginVersion: vi.fn() }));

function version(overrides: Partial<PlatformVersion>): PlatformVersion {
  return {
    version: "1.0.1",
    state: "development",
    blocked_reason: null,
    digest: "sha256-current",
    declared_checksum: "sha256-declared",
    checksum: "sha256-declared",
    pin_status: "unpinned",
    path: "test-chart/1.0.1",
    files: {},
    findings: { errors: [], warnings: [] },
    discovered_at: null,
    approved_at: null,
    approved_by_uuid: null,
    manifest: { name: "Test chart" },
    csp: { declared: {}, notes: {}, approved: {}, effective: {}, egress: [], risk: {} },
    server: {
      network: { declared: [], approved: [] },
      private: false,
      proxies: [],
      secrets: [],
      backend: null,
      data_sources: [],
      identity: "none",
    },
    review: [],
    ...overrides,
  };
}

const plugin: PlatformPlugin = {
  plugin_id: "test-chart",
  name: "Test chart",
  status: "enabled",
  active_version: "1.0.0",
  update_available: null,
  overrides: {},
  enabled_entities: 1,
  enabled_for: [],
  versions: [],
  secrets: [],
  backend: { registered: false, identity: null, breaker: "closed" },
};

function renderSummary(shown: PlatformVersion) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TrustSummary plugin={plugin} version={shown} />
    </QueryClientProvider>,
  );
}

describe("TrustSummary integrity", () => {
  it("says the checksum matches when the computed one is the declared one", () => {
    renderSummary(version({}));

    expect(screen.getByText("matches the manifest")).toBeInTheDocument();
  });

  it("says a version in development needs its current checksum before approval", () => {
    renderSummary(version({ checksum: "sha256-computed" }));

    expect(
      screen.getByText(
        "does not match the manifest: write the current checksum before approving",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("matches the manifest")).not.toBeInTheDocument();
  });

  it("describes server-side code without internal labels", () => {
    renderSummary(
      version({
        server: {
          network: { declared: [], approved: [] },
          private: false,
          proxies: [],
          secrets: [],
          backend: { protocol: 1, routes: [] },
          data_sources: [],
          identity: "none",
        },
      }),
    );

    expect(
      screen.getByText("Yes, in a separate process the deployer runs and isolates"),
    ).toBeInTheDocument();
  });
});
