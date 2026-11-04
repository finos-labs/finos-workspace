import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import {
  developPluginVersion,
  getPlatformPlugins,
  type PlatformPlugin,
  type PlatformVersion,
} from "~/api/plugins.api";
import { DeploymentTab } from "~/components/AdminPlugins/DeploymentTab";

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));

vi.mock("~/api/plugins.api", () => ({
  getPlatformPlugins: vi.fn(),
  developPluginVersion: vi.fn(),
  rescanPlugins: vi.fn(),
  setPluginRevoked: vi.fn(),
  forgetPlugin: vi.fn(),
}));

vi.mock("~/routes/admin", () => ({ RenderNoData: () => null }));
vi.mock("~/components/AdminPlugins/TrustSummary", () => ({ TrustSummary: () => null }));
vi.mock("~/components/AdminPlugins/PluginEntities", () => ({
  PluginEntities: () => null,
}));
vi.mock("~/components/AdminPlugins/PluginSecrets", () => ({
  PluginSecrets: () => null,
}));
vi.mock("~/components/AdminPlugins/PluginBackend", () => ({
  PluginBackend: () => null,
}));
vi.mock("~/components/AdminPlugins/OverrideEditor", () => ({
  OverrideEditor: () => null,
}));
vi.mock("~/components/AdminPlugins/PluginActivity", () => ({
  BlockedRequests: () => null,
  PluginEvents: () => null,
}));

function version(number: string, state: PlatformVersion["state"]): PlatformVersion {
  return {
    version: number,
    state,
    blocked_reason: null,
    digest: `sha256-${number}`,
    declared_checksum: null,
    checksum: null,
    pin_status: "unpinned",
    path: `test-chart/${number}`,
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
    review: null,
  };
}

function plugin(versions: PlatformVersion[]): PlatformPlugin {
  return {
    plugin_id: "test-chart",
    name: "Test chart",
    status: "enabled",
    active_version: "1.0.0",
    update_available: null,
    overrides: {},
    enabled_entities: 1,
    enabled_for: [],
    versions,
    secrets: [],
    backend: { registered: false, identity: null, breaker: "closed" },
  };
}

async function openPlugin(development: boolean, versions: PlatformVersion[]) {
  (getPlatformPlugins as Mock).mockResolvedValue({
    enabled: true,
    development,
    plugins: [plugin(versions)],
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DeploymentTab />
    </QueryClientProvider>,
  );
  await userEvent.click(await screen.findByText("test-chart"));
}

describe("DeploymentTab on a local stack", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts a patch, minor or major version from the active one", async () => {
    (developPluginVersion as Mock).mockResolvedValue({
      plugin_id: "test-chart",
      version: "1.1.0",
      path: "test-chart/1.1.0",
    });
    await openPlugin(true, [version("1.0.0", "active")]);

    expect(screen.getByText("Develop a new version from 1.0.0:")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Patch" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Major" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Minor" }));

    await waitFor(() =>
      expect(developPluginVersion).toHaveBeenCalledWith("test-chart", "1.0.0", "minor"),
    );
    expect(toastSuccess).toHaveBeenCalledWith("1.1.0 is in development", {
      description:
        "Edit test-chart/1.1.0 in the plugins directory. The app serves its files as they are on disk.",
    });
  });

  it("says why a version could not be started", async () => {
    (developPluginVersion as Mock).mockRejectedValue({
      response: {
        data: {
          detail: "The plugins directory cannot be written: Read-only file system",
        },
      },
    });
    await openPlugin(true, [version("1.0.0", "active")]);
    await userEvent.click(screen.getByRole("button", { name: "Patch" }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "The plugins directory cannot be written: Read-only file system",
      ),
    );
  });

  it("offers no new version while one is in development, and offers it for review", async () => {
    await openPlugin(true, [
      version("1.0.1", "development"),
      version("1.0.0", "active"),
    ]);

    expect(screen.queryByRole("button", { name: "Patch" })).not.toBeInTheDocument();
    expect(screen.getByText("Review 1.0.1 (in development)")).toBeInTheDocument();
  });

  it("offers no new version outside a local stack", async () => {
    await openPlugin(false, [version("1.0.0", "active")]);

    expect(screen.getByRole("heading", { name: "Versions" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Patch" })).not.toBeInTheDocument();
  });
});
