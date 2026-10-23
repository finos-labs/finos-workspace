import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Source, useBackendConnectorStore } from "~/lib/state/backendConnector";
import { forgetInvalidItems } from "~/utils/zodErrors";
import { installWidgetsSchemaFixture } from "../../../mocks/widgetsSchema";

installWidgetsSchemaFixture();

vi.mock("sonner", () => ({
  toast: {
    warning: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

const source: Source = {
  id: "source-1",
  uuid: "source-1",
  name: "Test Backend",
  url: "https://test-backend.com",
  endpointHeaders: [],
};

const widgets = {
  good: {
    name: "Good Widget",
    description: "Loads fine",
    endpoint: "/good",
    type: "html",
    params: [],
  },
  bad: { name: "", endpoint: "/bad", type: "html", params: [] },
};

const apps = [
  {
    name: "Good App",
    description: "Loads fine",
    tabs: { main: { id: "main", name: "Main", layout: [] } },
  },
  { name: "Broken App" },
];

function backendWithInvalidItems() {
  mockFetch.mockImplementation((url: URL | string) => {
    const href = url.toString();
    const body = href.endsWith("widgets.json")
      ? widgets
      : href.endsWith("apps.json")
        ? apps
        : [];
    return Promise.resolve({
      ok: true,
      url: href,
      json: () => Promise.resolve(body),
      headers: new Headers(),
    });
  });
}

describe("backends with invalid widgets or apps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    forgetInvalidItems(["source-1"]);
    localStorage.clear();
    useBackendConnectorStore.setState({
      apiSources: [],
      isLoadingBackends: false,
      widgetMetadata: [],
      storedFiles: [],
      queuedRefreshIds: [],
    });
  });

  it("loads the valid ones and warns about the rest when the backend connects", async () => {
    backendWithInvalidItems();

    await useBackendConnectorStore.getState().updateApiSources([source], true);

    const [loaded] = useBackendConnectorStore.getState().apiSources;
    expect(loaded.status).toBe("success");
    expect(Object.keys(loaded.widgets ?? {})).toEqual(["good"]);
    expect(loaded.templates?.map((t) => t.name)).toEqual(["Good App"]);

    const calls = (toast.warning as ReturnType<typeof vi.fn>).mock.calls;
    const call = calls.find(([title]) => title === "Invalid items in Test Backend");
    expect(call).toBeDefined();
    expect(call?.[1]).toMatchObject({
      id: "backend-invalid-items-source-1",
      description: "1 widget and 1 app could not be loaded.",
      action: { label: "Inspect" },
    });
  });

  it("warns on a plain load too, since the items would otherwise be silently missing", async () => {
    backendWithInvalidItems();

    await useBackendConnectorStore.getState().updateApiSources([source], false);

    const titles = (toast.warning as ReturnType<typeof vi.fn>).mock.calls.map(
      ([title]) => title,
    );
    expect(titles).toContain("Invalid items in Test Backend");
  });

  it("does not repeat itself when the same backend loads again with the same problem", async () => {
    backendWithInvalidItems();
    const warnings = () =>
      (toast.warning as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([title]) => title === "Invalid items in Test Backend",
      ).length;

    await useBackendConnectorStore.getState().updateApiSources([source], false);
    await useBackendConnectorStore.getState().updateApiSources([source], false);
    expect(warnings()).toBe(1);

    await useBackendConnectorStore.getState().updateApiSources([source], true);
    expect(warnings()).toBe(2);
  });

  it("announces again once the backend was fixed and breaks again", async () => {
    const warnings = () =>
      (toast.warning as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([title]) => title === "Invalid items in Test Backend",
      ).length;

    backendWithInvalidItems();
    await useBackendConnectorStore.getState().updateApiSources([source], false);
    expect(warnings()).toBe(1);

    mockFetch.mockReset();
    mockFetch.mockImplementation((url: URL | string) =>
      Promise.resolve({
        ok: true,
        url: url.toString(),
        json: () => Promise.resolve(url.toString().endsWith("widgets.json") ? {} : []),
        headers: new Headers(),
      }),
    );
    await useBackendConnectorStore.getState().updateApiSources([source], false);
    expect(warnings()).toBe(1);

    backendWithInvalidItems();
    await useBackendConnectorStore.getState().updateApiSources([source], false);
    expect(warnings()).toBe(2);
  });

  it("loads the valid ones and warns about the rest when the backend is refreshed", async () => {
    backendWithInvalidItems();

    const result = await useBackendConnectorStore.getState().updateApiSource(source);

    expect(result.errorMessage).toBeNull();
    expect(result.templateErrorMessage).toBeNull();
    expect(Object.keys(result.widgets)).toEqual(["good"]);
    expect(result.templates.map((t) => t.name)).toEqual(["Good App"]);
    expect(result.invalidItems?.map((item) => item.id)).toEqual(["bad", "Broken App"]);

    const stored = useBackendConnectorStore.getState().getApiSourceById("source-1");
    expect(stored?.status).toBe("success");
    expect(toast.warning).toHaveBeenCalledWith(
      "Invalid items in Test Backend",
      expect.objectContaining({
        action: expect.objectContaining({ label: "Inspect" }),
      }),
    );
  });

  it("leaves out an app whose plugin configuration its plugin's settings refuse", async () => {
    const chart = {
      name: "Chart",
      description: "A chart",
      endpoint: "/chart",
      type: "test_chart",
    };
    const appWith = (name: string, state: object) => ({
      name,
      tabs: {
        main: {
          id: "main",
          name: "Main",
          layout: [{ i: "chart", x: 0, y: 0, w: 20, h: 10, state }],
        },
      },
    });
    const body = {
      "widgets.json": { chart, note: widgets.good },
      "apps.json": [
        appWith("Warm", {
          storage: { plugin: { config: { palette: "warm", points: 50 } } },
        }),
        appWith("Neon", {
          storage: { plugin: { config: { palette: "neon", glow: true } } },
        }),
      ],
    };
    mockFetch.mockImplementation((url: URL | string) => {
      const href = url.toString();
      const file = Object.keys(body).find((name) => href.endsWith(name));
      return Promise.resolve({
        ok: true,
        url: href,
        json: () => Promise.resolve(file ? body[file as keyof typeof body] : []),
        headers: new Headers(),
      });
    });

    const result = await useBackendConnectorStore.getState().updateApiSource(source);

    expect(result.templates.map((t) => t.name)).toEqual(["Warm"]);
    const [neon] = result.invalidItems ?? [];
    expect(neon).toMatchObject({ file: "apps.json", id: "Neon" });
    expect(neon.errors).toContain(
      "[tabs/main/layout/0/state/storage/plugin/config]: unknown key `glow`",
    );
    expect(neon.errors).toContain(
      "[tabs/main/layout/0/state/storage/plugin/config/palette]: must be one of `warm`, `cool`",
    );
  });

  describe("MCP links (WIDGETS-JSON 5.3)", () => {
    const linked = (server: string, args?: Record<string, string>) => ({
      name: "Report",
      description: "A report",
      endpoint: "/report",
      type: "markdown",
      params: [{ paramName: "team", type: "text" }],
      mcp_tool: {
        mcp_server: server,
        tool_id: "get_report",
        ...(args ? { args } : {}),
      },
    });
    const app = (name: string, servers: { name: string; url: string }[]) => ({
      name,
      tabs: { main: { id: "main", name: "Main", layout: [] } },
      mcpServers: servers,
    });
    const serve = (files: Record<string, unknown>) =>
      mockFetch.mockImplementation((url: URL | string) => {
        const href = url.toString();
        const file = Object.keys(files).find((name) => href.endsWith(name));
        return Promise.resolve(
          file
            ? {
                ok: true,
                url: href,
                json: () => Promise.resolve(files[file]),
                headers: new Headers(),
              }
            : {
                ok: false,
                status: 404,
                url: href,
                json: () => Promise.resolve({}),
                headers: new Headers(),
              },
        );
      });

    it("keeps a widget whose link names a server its backend declares", async () => {
      serve({
        "widgets.json": { report: linked("Team data", { team_id: "$team" }) },
        "apps.json": [
          app("Teams", [{ name: "Team data", url: "https://mcp.example/a" }]),
        ],
      });
      const result = await useBackendConnectorStore.getState().updateApiSource(source);
      expect(Object.keys(result.widgets)).toEqual(["report"]);
    });

    it("leaves out a widget whose link names no declared server", async () => {
      serve({
        "widgets.json": { report: linked("Elsewhere"), note: widgets.good },
        "apps.json": [
          app("Teams", [{ name: "Team data", url: "https://mcp.example/a" }]),
        ],
      });
      const result = await useBackendConnectorStore.getState().updateApiSource(source);
      expect(Object.keys(result.widgets)).toEqual(["note"]);
      expect(result.invalidItems?.[0].errors).toContain(
        "[mcp_tool/mcp_server]: `Elsewhere` is not an MCP server this backend's apps.json declares",
      );
    });

    it("leaves it out when the backend has no apps.json, which declares no server", async () => {
      serve({ "widgets.json": { report: linked("Team data"), note: widgets.good } });
      const result = await useBackendConnectorStore.getState().updateApiSource(source);
      expect(Object.keys(result.widgets)).toEqual(["note"]);
    });

    it("does not check links while apps.json has an invalid app", async () => {
      serve({
        "widgets.json": { report: linked("Team data"), note: widgets.good },
        "apps.json": [
          app("Teams", [{ name: "Team data", url: "https://mcp.example/a" }]),
          app("Other", [{ name: "Team data", url: "https://mcp.example/b" }]),
        ],
      });
      const result = await useBackendConnectorStore.getState().updateApiSource(source);
      expect(Object.keys(result.widgets).sort()).toEqual(["note", "report"]);
      expect(result.templates.map((t) => t.name)).toEqual(["Teams"]);
      expect(result.invalidItems?.map((item) => item.id)).toEqual(["Other"]);
      expect(result.invalidItems?.[0].errors).toContain(
        "[mcpServers/0/name]: `Team data` already names another MCP server of this backend (https://mcp.example/a)",
      );
    });

    it("refuses a mapping that names no param of the widget", async () => {
      serve({
        "widgets.json": { report: linked("Team data", { team_id: "$squad" }) },
        "apps.json": [
          app("Teams", [{ name: "Team data", url: "https://mcp.example/a" }]),
        ],
      });
      const result = await useBackendConnectorStore.getState().updateApiSource(source);
      expect(result.widgets).toEqual({});
      expect(result.invalidItems?.[0].errors).toContain(
        "[mcp_tool/args/team_id]: `$squad` names no param of this widget",
      );
    });
  });

  it("is an error, not a warning, when the backend has nothing usable", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      url: "https://test-backend.com/widgets.json",
      json: () => Promise.resolve([{ name: "not a map of widgets" }]),
      headers: new Headers(),
    });

    await useBackendConnectorStore.getState().updateApiSources([source], true);

    const [loaded] = useBackendConnectorStore.getState().apiSources;
    expect(loaded.status).toBe("error");
    const titles = (toast.warning as ReturnType<typeof vi.fn>).mock.calls.map(
      ([title]) => title,
    );
    expect(titles).not.toContain("Invalid items in Test Backend");
  });
});
