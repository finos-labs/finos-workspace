import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Source, useBackendConnectorStore } from "~/lib/state/backendConnector";
import { forgetInvalidItems } from "~/utils/zodErrors";

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
  // A widget needs a name and a description
  bad: { name: "", endpoint: "/bad", type: "html", params: [] },
};

const apps = [
  {
    name: "Good App",
    description: "Loads fine",
    tabs: { main: { id: "main", name: "Main", layout: [] } },
  },
  // An app needs its tabs
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

    // The user asked for a refresh: say it again
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
