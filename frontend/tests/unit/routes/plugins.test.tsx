// Tests the Plugins page and the plugin runtime page against a mocked plugin host
// (MSW): listing, opening, empty/error states, and unknown or inactive plugins.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PluginRuntimePage from "~/routes/pluginRuntime";
import PluginsPage from "~/routes/plugins";
import { HttpResponse, http, server, setupMSW } from "../../mocks/msw-utils";

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

function renderAt(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/app/plugins" element={<PluginsPage />} />
          <Route path="/app/plugins/:pluginId" element={<PluginRuntimePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Plugins", () => {
  setupMSW();

  beforeEach(() => {
    pluginHost.value = HOST;
    server.use(
      http.get(`${HOST}/registry/plugins.json`, () => HttpResponse.json(registry)),
    );
  });

  describe("PluginsPage", () => {
    it("lists the plugins from the registry", async () => {
      renderAt("/app/plugins");
      const card = await screen.findByRole("article", { name: "BQ Advanced Grouping" });
      expect(card).toHaveTextContent("1.0.0");
      expect(card).toHaveTextContent("Data Grid");
      expect(screen.getByRole("article", { name: "BQ Pivot" })).toHaveTextContent(
        "Inactive",
      );
    });

    it("disables actions for inactive plugins", async () => {
      renderAt("/app/plugins");
      const pivot = await screen.findByRole("article", { name: "BQ Pivot" });
      for (const button of pivot.querySelectorAll("button"))
        expect(button).toBeDisabled();
    });

    it("opens the selected plugin inside Workspace at its resolved URL", async () => {
      renderAt("/app/plugins");
      await screen.findByRole("article", { name: "BQ Advanced Grouping" });
      await userEvent.click(screen.getAllByRole("button", { name: "Open Plugin" })[0]);

      const frame = await screen.findByTitle("BQ Advanced Grouping");
      expect(frame.getAttribute("src")).toMatch(
        /^http:\/\/localhost:5173\/plugins\/advanced-grouping\?theme=(light|dark)$/,
      );
      expect(frame.getAttribute("sandbox")).toContain("allow-scripts");
    });

    it("explains when no plugin host is configured", async () => {
      pluginHost.value = "";
      renderAt("/app/plugins");
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
      renderAt("/app/plugins");
      expect(
        await screen.findByText("The plugin registry returned 503."),
      ).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Retry" }));
      expect(
        await screen.findByRole("article", { name: "BQ Advanced Grouping" }),
      ).toBeInTheDocument();
    });

    it("shows an empty state for an empty registry", async () => {
      server.use(
        http.get(`${HOST}/registry/plugins.json`, () => HttpResponse.json([])),
      );
      renderAt("/app/plugins");
      expect(await screen.findByText("No plugins available")).toBeInTheDocument();
    });
  });

  describe("PluginRuntimePage", () => {
    it("loads the plugin runtime from the configured host", async () => {
      pluginHost.value = "http://localhost:5174";
      server.use(
        http.get("http://localhost:5174/registry/plugins.json", () =>
          HttpResponse.json(registry),
        ),
      );
      renderAt("/app/plugins/bq-advanced-grouping");
      const frame = await screen.findByTitle("BQ Advanced Grouping");
      expect(frame.getAttribute("src")).toContain(
        "http://localhost:5174/plugins/advanced-grouping",
      );
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
});
