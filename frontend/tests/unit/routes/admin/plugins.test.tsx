// Tests the Admin Portal Plugins page and the plugin runtime page against a mocked
// plugin host and the Workspace API's plugin routes (MSW): the super administrator's catalog (install, uninstall, review),
// an entity administrator's installed plugins (enable/disable for the organization),
// previewing, the old /app/plugins redirect, empty/error states, unknown, inactive,
// not installed or disabled plugins, and enabled plugins appearing in (and leaving)
// the widget library the organization's dashboards use.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, Navigate, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useIsEntityAdmin } from "~/hooks/useEntityAdmin";
import {
  useEnabledPluginWidgets,
  usePluginFrameStatus,
} from "~/hooks/usePluginManager";
import type { PluginRelease } from "~/lib/plugins";
import { useAuthStore } from "~/lib/state/auth";
import AdminPluginsPage from "~/routes/admin/plugins";
import PluginRuntimePage from "~/routes/pluginRuntime";
import { HttpResponse, http, server, setupMSW } from "../../../mocks/msw-utils";
import { fakeSha, makeRelease } from "../../lib/plugins/releaseFixtures";

const HOST = "http://localhost:5173";
// The Workspace API in tests (VITE_BACKEND_URL)
const API = "https://backend.test";
const ENTITY = "Acme";

vi.mock("~/hooks/useEntityAdmin", () => ({ useIsEntityAdmin: vi.fn() }));

/** Signs in as a super administrator (the superuser check passes) or not. */
function signInAs(role: "super-admin" | "entity-admin") {
  vi.mocked(useIsEntityAdmin).mockReturnValue({
    isEntityAdmin: role === "super-admin",
    isLoading: false,
  });
}
const pluginHost = vi.hoisted(() => ({ value: "http://localhost:5173" }));

// The real API client, so the plugin routes go through MSW like a browser's requests
vi.unmock("~/api/api");

vi.mock("~/lib/runtimeConfig", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/runtimeConfig")>();
  return {
    ...actual,
    getConfig: () => {
      const config = actual.getConfig();
      return {
        ...config,
        urls: {
          ...config.urls,
          backend: "https://backend.test",
          pluginHost: pluginHost.value,
        },
      };
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

/** What the mocked Workspace API (backend routers/plugins.py) keeps. */
interface StoredInstallation {
  pluginId: string;
  version: string;
  digest: string;
  files: PluginRelease["files"];
  requests: PluginRelease["requests"];
  releaseNotes: PluginRelease["releaseNotes"];
  source: PluginRelease["source"];
  approvedAt: string;
}
let installations: StoredInstallation[] = [];
/** Plugin ids each organization enabled. */
let enablements: Record<string, string[]> = {};

const installation = (release: PluginRelease): StoredInstallation => ({
  pluginId: release.id,
  version: release.version,
  digest: release.digest,
  files: release.files,
  requests: release.requests,
  releaseNotes: release.releaseNotes,
  source: release.source,
  approvedAt: "2026-10-15T00:00:00.000Z",
});

/** Installs each release, as a super administrator's Install would have. */
function setInstalled(approved: PluginRelease[]) {
  installations = approved.map(installation);
}

/** Sets the plugins an entity administrator enabled for their organization. */
function setEnabled(pluginIds: string[], entity = ENTITY) {
  enablements = { ...enablements, [entity]: pluginIds };
}

/** Installs each release and enables it for the signed-in user's organization. */
function setAvailable(releases: PluginRelease[]) {
  setInstalled(releases);
  setEnabled(releases.map((release) => release.id));
}

const storedEnablements = () => enablements;
const storedApprovals = () => installations;

const isInstalled = (pluginId: string) =>
  installations.some((item) => item.pluginId === pluginId);

/**
 * The plugin routes of the Workspace API, answering as the signed-in user of ENTITY:
 * uninstalling cascades to every organization, and only an installed plugin is enabled.
 */
const pluginApi = [
  http.get(`${API}/plugins/installations`, () => HttpResponse.json(installations)),
  http.put<{ pluginId: string }, Omit<StoredInstallation, "pluginId" | "approvedAt">>(
    `${API}/plugins/installations/:pluginId`,
    async ({ params, request }) => {
      const item = {
        ...(await request.json()),
        pluginId: params.pluginId,
        approvedAt: "2026-10-23T00:00:00.000Z",
      };
      installations = [
        ...installations.filter((other) => other.pluginId !== params.pluginId),
        item,
      ];
      return HttpResponse.json(item);
    },
  ),
  http.delete<{ pluginId: string }>(
    `${API}/plugins/installations/:pluginId`,
    ({ params }) => {
      installations = installations.filter((item) => item.pluginId !== params.pluginId);
      enablements = Object.fromEntries(
        Object.entries(enablements).map(([entity, ids]) => [
          entity,
          ids.filter((id) => id !== params.pluginId),
        ]),
      );
      return HttpResponse.json({ success: true });
    },
  ),
  http.get(`${API}/plugins/entity`, () =>
    HttpResponse.json({
      pluginIds: (enablements[ENTITY] ?? []).filter(isInstalled),
    }),
  ),
  http.put<{ pluginId: string }>(`${API}/plugins/entity/:pluginId`, ({ params }) => {
    if (!isInstalled(params.pluginId)) {
      return HttpResponse.json(
        { detail: "The plugin is not installed. A superuser must install it first." },
        { status: 404 },
      );
    }
    const ids = enablements[ENTITY] ?? [];
    if (!ids.includes(params.pluginId)) setEnabled([...ids, params.pluginId]);
    return HttpResponse.json({ success: true });
  }),
  http.delete<{ pluginId: string }>(`${API}/plugins/entity/:pluginId`, ({ params }) => {
    setEnabled((enablements[ENTITY] ?? []).filter((id) => id !== params.pluginId));
    return HttpResponse.json({ success: true });
  }),
];

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
const button = (within_: HTMLElement, name: string) =>
  within(within_).getByRole("button", { name });

describe("Plugins", () => {
  setupMSW();

  beforeEach(() => {
    pluginHost.value = HOST;
    installations = [];
    enablements = {};
    useAuthStore.setState({
      user: { uuid: "u-1", email: "admin@acme.test", entity_name: ENTITY, role: null },
    });
    signInAs("super-admin");
    releases = [v1];
    server.use(
      http.get(`${HOST}/registry/plugins.json`, () => HttpResponse.json(registry)),
      http.get(`${HOST}/registry/releases.json`, () => HttpResponse.json(releases)),
      ...pluginApi,
    );
  });

  describe("AdminPluginsPage", () => {
    describe("Catalog (super administrator)", () => {
      it("lists every registry plugin, not installed by default", async () => {
        renderAt("/admin/plugins");
        expect(screen.getByRole("tab", { name: "Catalog" })).toHaveAttribute(
          "aria-selected",
          "true",
        );
        const grouping = await card("BQ Advanced Grouping");
        expect(grouping).toHaveTextContent("1.0.0");
        expect(grouping).toHaveTextContent("Data Grid");
        expect(grouping).toHaveTextContent("Not installed");
        expect(button(grouping, "Install")).toBeEnabled();
        expect(button(grouping, "Preview")).toBeDisabled();
        expect(within(grouping).queryByRole("button", { name: "Enable" })).toBeNull();
        expect(await card("BQ Pivot")).toHaveTextContent("Inactive");
      });

      it("shows what each plugin asks for before it is installed", async () => {
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

      it("installs and uninstalls a plugin", async () => {
        renderAt("/admin/plugins");
        const grouping = await card("BQ Advanced Grouping");

        await userEvent.click(button(grouping, "Install"));
        expect(
          await within(grouping).findByRole("button", { name: "Uninstall" }),
        ).toBeInTheDocument();
        expect(grouping).toHaveTextContent("Installed");
        expect(button(grouping, "Preview")).toBeEnabled();
        // Installing approves the newest released version, pinned to its digest...
        expect(storedApprovals()).toMatchObject([
          { pluginId: "bq-advanced-grouping", version: "1.0.0", digest: v1.digest },
        ]);
        // ...but enables it for no organization yet.
        expect(storedEnablements()).toEqual({});

        await userEvent.click(button(grouping, "Uninstall"));
        expect(
          await within(grouping).findByRole("button", { name: "Install" }),
        ).toBeInTheDocument();
        expect(grouping).toHaveTextContent("Not installed");
        expect(storedApprovals()).toEqual([]);
      });

      it("uninstalling disables the plugin for every organization", async () => {
        setInstalled([v1]);
        enablements = { [ENTITY]: [v1.id], Globex: [v1.id] };
        renderAt("/admin/plugins");
        await userEvent.click(button(await card("BQ Advanced Grouping"), "Uninstall"));
        await waitFor(() =>
          expect(storedEnablements()).toEqual({ [ENTITY]: [], Globex: [] }),
        );
      });

      it("doesn't let an inactive plugin be installed or previewed", async () => {
        renderAt("/admin/plugins");
        const pivot = await card("BQ Pivot");
        expect(button(pivot, "Install")).toBeDisabled();
        expect(button(pivot, "Preview")).toBeDisabled();
      });

      it("previews an installed plugin before any organization enables it", async () => {
        setInstalled([v1]);
        renderAt("/admin/plugins");
        await userEvent.click(button(await card("BQ Advanced Grouping"), "Preview"));

        const frame = await screen.findByTitle("BQ Advanced Grouping");
        expect(frame.getAttribute("src")).toMatch(
          /^http:\/\/localhost:5173\/plugins\/advanced-grouping\/1\.0\.0\/\?theme=(light|dark)$/,
        );
        expect(frame.getAttribute("sandbox")).toContain("allow-scripts");
        expect(screen.getByText(/Preview/)).toBeInTheDocument();
      });

      describe("releases", () => {
        it("keeps the approved version running and offers a newer one for review", async () => {
          setInstalled([v1]);
          releases = [v1, v2];
          renderAt("/admin/plugins");
          const grouping = await card("BQ Advanced Grouping");
          expect(grouping).toHaveTextContent("Update available");
          expect(grouping).toHaveTextContent("1.0.0 (1.1.0 available)");
          expect(grouping).toHaveTextContent("Installed");

          await userEvent.click(button(grouping, "Review update"));
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
          ).toEqual([
            "+ assets/popout.js (1.0 KB)",
            "~ assets/app.js (2.0 KB → 4.0 KB)",
          ]);
          expect(review).toHaveTextContent("Adds pop-out charts.");
          expect(review).toHaveTextContent("a1b2c3d4e5f6");

          await userEvent.click(button(review, "Approve 1.1.0"));
          await waitFor(() =>
            expect(grouping).not.toHaveTextContent("Update available"),
          );
          expect(storedApprovals()).toMatchObject([
            { version: "1.1.0", digest: v2.digest },
          ]);
        });

        it("closes the review without approving on Not now", async () => {
          setInstalled([v1]);
          releases = [v1, v2];
          renderAt("/admin/plugins");
          const grouping = await card("BQ Advanced Grouping");
          await userEvent.click(button(grouping, "Review update"));
          await userEvent.click(button(grouping, "Not now"));
          expect(within(grouping).queryByRole("region")).not.toBeInTheDocument();
          expect(storedApprovals()).toMatchObject([{ version: "1.0.0" }]);
        });

        it("blocks a version that changed on the host until it is reviewed", async () => {
          setInstalled([v1]);
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
          expect(button(grouping, "Preview")).toBeDisabled();

          await userEvent.click(button(grouping, "Review"));
          const review = within(grouping).getByRole("region");
          expect(review).toHaveTextContent("~ assets/app.js (2.0 KB → 2.0 KB)");
          await userEvent.click(button(review, "Approve 1.0.0"));
          await waitFor(() => expect(grouping).toHaveTextContent("Installed"));
        });

        it("can't install a plugin with no released version", async () => {
          releases = [];
          renderAt("/admin/plugins");
          const grouping = await card("BQ Advanced Grouping");
          expect(grouping).toHaveTextContent("Not released");
          expect(grouping).toHaveTextContent(
            "No released version on the plugin host yet.",
          );
          expect(button(grouping, "Install")).toBeDisabled();
        });
      });
    });

    describe("Organization", () => {
      it("lists only installed plugins, disabled for the organization by default", async () => {
        setInstalled([v1]);
        signInAs("entity-admin");
        renderAt("/admin/plugins");
        const grouping = await card("BQ Advanced Grouping");
        expect(screen.queryByRole("article", { name: "BQ Pivot" })).toBeNull();
        expect(grouping).toHaveTextContent("Disabled");
        expect(button(grouping, "Enable")).toBeEnabled();
        // An installed plugin can be previewed before it is enabled.
        expect(button(grouping, "Preview")).toBeEnabled();
        expect(within(grouping).queryByRole("button", { name: "Install" })).toBeNull();
        expect(
          within(grouping).queryByRole("button", { name: "Uninstall" }),
        ).toBeNull();
      });

      it("shows no catalog to an entity administrator", async () => {
        signInAs("entity-admin");
        renderAt("/admin/plugins?tab=catalog");
        expect(await screen.findByText("No plugins installed")).toBeInTheDocument();
        expect(
          screen.getByText(
            "A super administrator must install plugins before you can enable them.",
          ),
        ).toBeInTheDocument();
        expect(screen.queryByRole("tab", { name: "Catalog" })).toBeNull();
      });

      it("enables and disables a plugin for the organization only", async () => {
        setInstalled([v1]);
        signInAs("entity-admin");
        renderAt("/admin/plugins");
        const grouping = await card("BQ Advanced Grouping");

        await userEvent.click(button(grouping, "Enable"));
        expect(
          await within(grouping).findByRole("button", { name: "Disable" }),
        ).toBeInTheDocument();
        expect(grouping).toHaveTextContent("Enabled");
        expect(storedEnablements()).toEqual({ [ENTITY]: ["bq-advanced-grouping"] });
        // The installation itself is untouched.
        expect(storedApprovals()).toMatchObject([{ version: "1.0.0" }]);

        await userEvent.click(button(grouping, "Disable"));
        expect(
          await within(grouping).findByRole("button", { name: "Enable" }),
        ).toBeInTheDocument();
        expect(storedEnablements()).toEqual({ [ENTITY]: [] });
        expect(storedApprovals()).toHaveLength(1);
      });

      it("shows a super administrator the organization tab next to the catalog", async () => {
        setAvailable([v1]);
        renderAt("/admin/plugins?tab=organization");
        const grouping = await card("BQ Advanced Grouping");
        expect(grouping).toHaveTextContent("Enabled");
        expect(button(grouping, "Disable")).toBeEnabled();
      });

      it("leaves update reviews to the super administrator", async () => {
        setAvailable([v1]);
        releases = [v1, v2];
        signInAs("entity-admin");
        renderAt("/admin/plugins");
        const grouping = await card("BQ Advanced Grouping");
        expect(grouping).not.toHaveTextContent("Update available");
        expect(within(grouping).queryByRole("button", { name: /Review/ })).toBeNull();
      });

      it("can't enable a blocked plugin", async () => {
        setInstalled([v1]);
        releases = [{ ...v1, digest: `sha256:${"f".repeat(64)}` }];
        signInAs("entity-admin");
        renderAt("/admin/plugins");
        const grouping = await card("BQ Advanced Grouping");
        expect(grouping).toHaveTextContent("Blocked");
        expect(grouping).toHaveTextContent("until a super administrator reviews it");
        expect(button(grouping, "Enable")).toBeDisabled();
        expect(button(grouping, "Preview")).toBeDisabled();
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
      setAvailable([v1]);
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

    it("refuses a plugin that is not installed, even as a preview", async () => {
      renderAt("/app/plugins/bq-advanced-grouping?preview=1");
      expect(
        await screen.findByText(/BQ Advanced Grouping is not installed/),
      ).toBeInTheDocument();
      expect(document.querySelector("iframe")).toBeNull();
    });

    it("refuses a plugin its organization has not enabled", async () => {
      setInstalled([v1]);
      renderAt("/app/plugins/bq-advanced-grouping");
      expect(
        await screen.findByText(
          /BQ Advanced Grouping is disabled for your organization/,
        ),
      ).toBeInTheDocument();
      expect(document.querySelector("iframe")).toBeNull();
    });

    it("refuses a plugin another organization enabled", async () => {
      setInstalled([v1]);
      setEnabled([v1.id], "Globex");
      renderAt("/app/plugins/bq-advanced-grouping");
      expect(
        await screen.findByText(/disabled for your organization/),
      ).toBeInTheDocument();
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
      // bq-pivot is enabled but inactive in the registry, so it stays out.
      setAvailable([v1, makeRelease({ id: "bq-pivot" })]);
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
      setInstalled([v1]);
      signInAs("entity-admin");
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
      setAvailable([v1]);
      const result = frameStatus(pluginUrl);
      await waitFor(() =>
        expect(result.current).toEqual({
          state: "available",
          src: `${HOST}/plugins/advanced-grouping/1.0.0/?theme=dark&apiUrl=x`,
        }),
      );
    });

    it("blocks a plugin page its organization has not enabled", async () => {
      setInstalled([v1]);
      const result = frameStatus(pluginUrl);
      await waitFor(() =>
        expect(result.current).toMatchObject({
          state: "unavailable",
          message: expect.stringContaining("is disabled for your organization"),
        }),
      );
    });

    it("blocks a plugin page whose approved release changed on the host", async () => {
      setAvailable([v1]);
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
