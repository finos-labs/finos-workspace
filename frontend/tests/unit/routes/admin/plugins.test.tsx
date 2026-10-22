// Tests the Admin Portal Plugins page and the plugin runtime page against a mocked
// plugin host (MSW): listing, global enable/disable, opening, the old /app/plugins
// redirect, empty/error states, unknown, inactive or disabled plugins, and enabled
// plugins appearing in (and leaving) the widget library every dashboard uses.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, Navigate, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useEnabledPluginWidgets,
  usePluginFrameStatus,
} from "~/hooks/usePluginManager";
import { PLUGIN_APPROVALS_STORAGE_KEY, type PluginRelease } from "~/lib/plugins";
import AdminPluginsPage from "~/routes/admin/plugins";
import PluginRuntimePage from "~/routes/pluginRuntime";
import { HttpResponse, http, server, setupMSW } from "../../../mocks/msw-utils";
import { fakeSha, makeRelease } from "../../lib/plugins/releaseFixtures";

const HOST = "http://localhost:5173";
const pluginHost = vi.hoisted(() => ({ value: "http://localhost:5173" }));

vi.mock("~/lib/runtimeConfig", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/runtimeConfig")>();
  return {
    ...actual,
    getConfig: () => {
      const config = actual.getConfig();
      return { ...config, urls: { ...config.urls, pluginHost: pluginHost.value } };
    },
  };
});

const registry = [
  {
    id: "bq-advanced-grouping",
    name: "BQ Advanced Grouping",
    description: "Advanced grouping and aggregation capabilities for data grids.",
    version: "1.0.0",
    category: "Data Grid",
    route: "/plugins/advanced-grouping",
    status: "active",
    // Declared by the registry; Workspace no longer collects them.
    settings: [{ key: "apiUrl", label: "API URL", type: "url" }],
    requests: { network: ["https://api.example.com"], downloads: true },
  },
  {
    id: "bq-pivot",
    name: "BQ Pivot",
    description: "Pivot tables.",
    version: "0.1.0",
    category: "Data Grid",
    route: "/plugins/pivot",
    status: "inactive",
  },
];

const v1 = makeRelease({
  requests: {
    network: ["https://api.example.com"],
    storage: false,
    downloads: true,
    popups: false,
  },
});
const v2 = makeRelease({
  version: "1.1.0",
  requests: {
    network: ["https://api.example.com"],
    storage: false,
    downloads: true,
    popups: true,
  },
  releaseNotes: "Adds pop-out charts.",
  source: { commit: "a1b2c3d4e5f6a7b8" },
  files: {
    ...v1.files,
    "assets/app.js": { sha256: fakeSha("app-1.1.0"), bytes: 4096 },
    "assets/popout.js": { sha256: fakeSha("popout"), bytes: 1024 },
  },
});
/** Releases the mocked plugin host publishes; tests replace it as needed. */
let releases: PluginRelease[] = [v1];

/** Stores approvals as an administrator's Enable would have, for each release. */
function setApproved(approved: PluginRelease[]) {
  localStorage.setItem(
    PLUGIN_APPROVALS_STORAGE_KEY,
    JSON.stringify(
      approved.map((release) => ({
        pluginId: release.id,
        version: release.version,
        digest: release.digest,
        files: release.files,
        requests: release.requests,
        releaseNotes: release.releaseNotes,
        source: release.source,
        approvedAt: "2026-10-15T00:00:00.000Z",
      })),
    ),
  );
}

const storedApprovals = () =>
  JSON.parse(localStorage.getItem(PLUGIN_APPROVALS_STORAGE_KEY) ?? "[]") as {
    pluginId: string;
    version: string;
    digest: string;
  }[];

function renderAt(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/plugins" element={<AdminPluginsPage />} />
          <Route
            path="/app/plugins"
            element={<Navigate to="/admin/plugins" replace />}
          />
          <Route path="/app/plugins/:pluginId" element={<PluginRuntimePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const card = (name: string) => screen.findByRole("article", { name });

describe("Plugins", () => {
  setupMSW();

  beforeEach(() => {
    pluginHost.value = HOST;
    localStorage.removeItem(PLUGIN_APPROVALS_STORAGE_KEY);
    releases = [v1];
    server.use(
      http.get(`${HOST}/registry/plugins.json`, () => HttpResponse.json(registry)),
      http.get(`${HOST}/registry/releases.json`, () => HttpResponse.json(releases)),
    );
  });

  describe("AdminPluginsPage", () => {
    it("lists the plugins from the registry, disabled by default", async () => {
      renderAt("/admin/plugins");
      const grouping = await card("BQ Advanced Grouping");
      expect(grouping).toHaveTextContent("1.0.0");
      expect(grouping).toHaveTextContent("Data Grid");
      expect(grouping).toHaveTextContent("Disabled");
      expect(within(grouping).getByRole("button", { name: "Enable" })).toBeEnabled();
      expect(
        within(grouping).getByRole("button", { name: "Open Plugin" }),
      ).toBeDisabled();
      expect(await card("BQ Pivot")).toHaveTextContent("Inactive");
    });

    it("shows what each plugin asks for before it is enabled", async () => {
      renderAt("/admin/plugins");
      const grouping = await card("BQ Advanced Grouping");
      const asks = within(grouping).getByRole("list", {
        name: "BQ Advanced Grouping asks for",
      });
      expect(
        within(asks)
          .getAllByRole("listitem")
          .map((item) => item.textContent),
      ).toEqual(["Network access to https://api.example.com", "Downloading files"]);
      // BQ Pivot declares nothing, which is shown as such rather than as "nothing".
      expect(await card("BQ Pivot")).toHaveTextContent("Not declared by the plugin");
      expect(screen.queryByText(/\bsafe\b/i)).not.toBeInTheDocument();
    });

    it("no longer offers dashboard or data source configuration", async () => {
      renderAt("/admin/plugins");
      await card("BQ Advanced Grouping");
      expect(screen.queryByText(/add to dashboard/i)).not.toBeInTheDocument();
      expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
      expect(screen.queryByText("Data source")).not.toBeInTheDocument();
      expect(screen.queryByText("API URL")).not.toBeInTheDocument();
    });

    it("enables and disables a plugin globally", async () => {
      renderAt("/admin/plugins");
      const grouping = await card("BQ Advanced Grouping");

      await userEvent.click(within(grouping).getByRole("button", { name: "Enable" }));
      expect(
        await within(grouping).findByRole("button", { name: "Disable" }),
      ).toBeInTheDocument();
      expect(grouping).toHaveTextContent("Enabled");
      expect(
        within(grouping).getByRole("button", { name: "Open Plugin" }),
      ).toBeEnabled();
      // Enabling approves the newest released version, pinned to its digest.
      expect(storedApprovals()).toMatchObject([
        { pluginId: "bq-advanced-grouping", version: "1.0.0", digest: v1.digest },
      ]);

      await userEvent.click(within(grouping).getByRole("button", { name: "Disable" }));
      expect(
        await within(grouping).findByRole("button", { name: "Enable" }),
      ).toBeInTheDocument();
      expect(grouping).toHaveTextContent("Disabled");
      expect(storedApprovals()).toEqual([]);
    });

    it("doesn't let an inactive plugin be enabled or opened", async () => {
      renderAt("/admin/plugins");
      const pivot = await card("BQ Pivot");
      expect(within(pivot).getByRole("button", { name: "Enable" })).toBeDisabled();
      expect(within(pivot).getByRole("button", { name: "Open Plugin" })).toBeDisabled();
    });

    it("opens an enabled plugin at its resolved URL", async () => {
      setApproved([v1]);
      renderAt("/admin/plugins");
      const grouping = await card("BQ Advanced Grouping");
      await userEvent.click(
        within(grouping).getByRole("button", { name: "Open Plugin" }),
      );

      const frame = await screen.findByTitle("BQ Advanced Grouping");
      expect(frame.getAttribute("src")).toMatch(
        /^http:\/\/localhost:5173\/plugins\/advanced-grouping\/1\.0\.0\/\?theme=(light|dark)$/,
      );
      expect(frame.getAttribute("sandbox")).toContain("allow-scripts");
    });

    describe("releases", () => {
      it("keeps the approved version running and offers a newer one for review", async () => {
        setApproved([v1]);
        releases = [v1, v2];
        renderAt("/admin/plugins");
        const grouping = await card("BQ Advanced Grouping");
        expect(grouping).toHaveTextContent("Update available");
        expect(grouping).toHaveTextContent("1.0.0 (1.1.0 available)");
        expect(grouping).toHaveTextContent("Enabled");

        await userEvent.click(
          within(grouping).getByRole("button", { name: "Review update" }),
        );
        const review = within(grouping).getByRole("region", {
          name: "Review BQ Advanced Grouping 1.1.0",
        });
        expect(review).toHaveTextContent("Review 1.1.0 (running 1.0.0)");
        expect(
          within(within(review).getByRole("list", { name: "Request changes" }))
            .getAllByRole("listitem")
            .map((item) => item.textContent),
        ).toEqual(["+ Opening new windows"]);
        expect(
          within(within(review).getByRole("list", { name: "File changes" }))
            .getAllByRole("listitem")
            .map((item) => item.textContent),
        ).toEqual(["+ assets/popout.js (1.0 KB)", "~ assets/app.js (2.0 KB → 4.0 KB)"]);
        expect(review).toHaveTextContent("Adds pop-out charts.");
        expect(review).toHaveTextContent("a1b2c3d4e5f6");

        await userEvent.click(
          within(review).getByRole("button", { name: "Approve 1.1.0" }),
        );
        await waitFor(() => expect(grouping).not.toHaveTextContent("Update available"));
        expect(storedApprovals()).toMatchObject([
          { version: "1.1.0", digest: v2.digest },
        ]);
      });

      it("closes the review without approving on Not now", async () => {
        setApproved([v1]);
        releases = [v1, v2];
        renderAt("/admin/plugins");
        const grouping = await card("BQ Advanced Grouping");
        await userEvent.click(
          within(grouping).getByRole("button", { name: "Review update" }),
        );
        await userEvent.click(
          within(grouping).getByRole("button", { name: "Not now" }),
        );
        expect(within(grouping).queryByRole("region")).not.toBeInTheDocument();
        expect(storedApprovals()).toMatchObject([{ version: "1.0.0" }]);
      });

      it("blocks a version that changed on the host until it is reviewed", async () => {
        setApproved([v1]);
        releases = [
          {
            ...v1,
            digest: `sha256:${"f".repeat(64)}`,
            files: {
              ...v1.files,
              "assets/app.js": { sha256: fakeSha("tampered"), bytes: 2050 },
            },
          },
        ];
        renderAt("/admin/plugins");
        const grouping = await card("BQ Advanced Grouping");
        expect(grouping).toHaveTextContent("Blocked");
        expect(grouping).toHaveTextContent(
          "changed on the plugin host after it was approved",
        );
        expect(
          within(grouping).getByRole("button", { name: "Open Plugin" }),
        ).toBeDisabled();

        await userEvent.click(within(grouping).getByRole("button", { name: "Review" }));
        const review = within(grouping).getByRole("region");
        expect(review).toHaveTextContent("~ assets/app.js (2.0 KB → 2.0 KB)");
        await userEvent.click(
          within(review).getByRole("button", { name: "Approve 1.0.0" }),
        );
        await waitFor(() => expect(grouping).toHaveTextContent("Enabled"));
      });

      it("can't enable a plugin with no released version", async () => {
        releases = [];
        renderAt("/admin/plugins");
        const grouping = await card("BQ Advanced Grouping");
        expect(grouping).toHaveTextContent("Not released");
        expect(grouping).toHaveTextContent(
          "No released version on the plugin host yet.",
        );
        expect(within(grouping).getByRole("button", { name: "Enable" })).toBeDisabled();
      });
    });

    it("redirects the old /app/plugins URL to the Admin Portal", async () => {
      renderAt("/app/plugins");
      expect(await card("BQ Advanced Grouping")).toBeInTheDocument();
    });

    it("explains when no plugin host is configured", async () => {
      pluginHost.value = "";
      renderAt("/admin/plugins");
      expect(await screen.findByText("Plugins are not configured")).toBeInTheDocument();
    });

    it("shows registry errors and retries", async () => {
      let calls = 0;
      server.use(
        http.get(`${HOST}/registry/plugins.json`, () => {
          calls += 1;
          return calls === 1
            ? new HttpResponse(null, { status: 503 })
            : HttpResponse.json(registry);
        }),
      );
      renderAt("/admin/plugins");
      expect(
        await screen.findByText("The plugin registry returned 503."),
      ).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Retry" }));
      expect(await card("BQ Advanced Grouping")).toBeInTheDocument();
    });

    it("shows an empty state for an empty registry", async () => {
      server.use(
        http.get(`${HOST}/registry/plugins.json`, () => HttpResponse.json([])),
      );
      renderAt("/admin/plugins");
      expect(await screen.findByText("No plugins available")).toBeInTheDocument();
    });
  });

  describe("PluginRuntimePage", () => {
    it("loads an enabled plugin from the configured host", async () => {
      setApproved([v1]);
      pluginHost.value = "http://localhost:5174";
      server.use(
        http.get("http://localhost:5174/registry/plugins.json", () =>
          HttpResponse.json(registry),
        ),
        http.get("http://localhost:5174/registry/releases.json", () =>
          HttpResponse.json(releases),
        ),
      );
      renderAt("/app/plugins/bq-advanced-grouping");
      const frame = await screen.findByTitle("BQ Advanced Grouping");
      expect(frame.getAttribute("src")).toContain(
        "http://localhost:5174/plugins/advanced-grouping/1.0.0/",
      );
      expect(screen.queryByText(/add to dashboard/i)).not.toBeInTheDocument();
    });

    it("refuses a disabled plugin", async () => {
      renderAt("/app/plugins/bq-advanced-grouping");
      expect(
        await screen.findByText(/BQ Advanced Grouping is disabled/),
      ).toBeInTheDocument();
      expect(document.querySelector("iframe")).toBeNull();
    });

    it("refuses an unknown plugin", async () => {
      renderAt("/app/plugins/nope");
      expect(
        await screen.findByText('No plugin with id "nope" is registered.'),
      ).toBeInTheDocument();
      expect(document.querySelector("iframe")).toBeNull();
    });

    it("refuses an inactive plugin", async () => {
      renderAt("/app/plugins/bq-pivot");
      expect(
        await screen.findByText("BQ Pivot is inactive and can't be opened."),
      ).toBeInTheDocument();
    });
  });
  describe("useEnabledPluginWidgets", () => {
    /** Lists the widget library's plugin entries, as a dashboard's "Add widget" would. */
    function PluginWidgetLibrary() {
      const widgets = useEnabledPluginWidgets();
      return (
        <ul aria-label="Plugin widgets">
          {widgets.map((widget) => (
            <li key={widget.widgetId}>{widget.name}</li>
          ))}
        </ul>
      );
    }

    function renderAdminWithLibrary() {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      return render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <AdminPluginsPage />
            <PluginWidgetLibrary />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    }

    const library = () => screen.getByRole("list", { name: "Plugin widgets" });

    it("offers enabled, active plugins as iframe widgets for every dashboard", async () => {
      // bq-pivot is approved but inactive in the registry, so it stays out.
      setApproved([v1, makeRelease({ id: "bq-pivot" })]);
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const { result } = renderHook(() => useEnabledPluginWidgets(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      });

      // bq-pivot is inactive in the registry, so it is left out even though enabled.
      await waitFor(() =>
        expect(result.current).toEqual([
          {
            widgetId: "iframe-plugin-bq-advanced-grouping",
            name: "BQ Advanced Grouping",
            description:
              "Advanced grouping and aggregation capabilities for data grids.",
            type: "custom",
            category: "Plugins",
            subCategory: "Data Grid",
            gridData: { w: 40, h: 22, minW: 12, minH: 10 },
            storage: { html: `${HOST}/plugins/advanced-grouping` },
          },
        ]),
      );
    });

    it("adds a plugin to the library on Enable and removes it on Disable", async () => {
      renderAdminWithLibrary();
      const grouping = await card("BQ Advanced Grouping");
      expect(within(library()).queryByText("BQ Advanced Grouping")).toBeNull();

      // No dashboard is chosen: enabling is enough for every dashboard.
      await userEvent.click(within(grouping).getByRole("button", { name: "Enable" }));
      expect(
        await within(library()).findByText("BQ Advanced Grouping"),
      ).toBeInTheDocument();

      await userEvent.click(within(grouping).getByRole("button", { name: "Disable" }));
      await waitFor(() =>
        expect(within(library()).queryByText("BQ Advanced Grouping")).toBeNull(),
      );
    });
  });

  describe("usePluginFrameStatus", () => {
    const frameStatus = (url: string) => {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      return renderHook(() => usePluginFrameStatus(url), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      }).result;
    };
    const pluginUrl = `${HOST}/plugins/advanced-grouping?theme=dark&apiUrl=x`;

    it("leaves pages outside the plugin host alone", () => {
      expect(frameStatus("https://example.com/page").current).toEqual({
        state: "not-plugin",
      });
    });

    it("allows an enabled plugin page, including old widget URLs with settings", async () => {
      setApproved([v1]);
      const result = frameStatus(pluginUrl);
      await waitFor(() =>
        expect(result.current).toEqual({
          state: "available",
          src: `${HOST}/plugins/advanced-grouping/1.0.0/?theme=dark&apiUrl=x`,
        }),
      );
    });

    it("blocks a disabled plugin page", async () => {
      const result = frameStatus(pluginUrl);
      await waitFor(() =>
        expect(result.current).toMatchObject({
          state: "unavailable",
          message: expect.stringContaining("is disabled"),
        }),
      );
    });

    it("blocks a plugin page whose approved release changed on the host", async () => {
      setApproved([v1]);
      releases = [{ ...v1, digest: `sha256:${"f".repeat(64)}` }];
      const result = frameStatus(pluginUrl);
      await waitFor(() =>
        expect(result.current).toMatchObject({
          state: "unavailable",
          message: expect.stringContaining("changed on the plugin host"),
        }),
      );
    });

    it("blocks a page that is not a registered plugin", async () => {
      const result = frameStatus(`${HOST}/plugins/unknown`);
      await waitFor(() =>
        expect(result.current).toEqual({
          state: "unavailable",
          message: "This plugin is not registered.",
        }),
      );
    });
  });
});
