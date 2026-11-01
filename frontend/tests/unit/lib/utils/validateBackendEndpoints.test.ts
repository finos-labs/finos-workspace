import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Source } from "~/lib/state/backendConnector";
import { validateBackend, validateBackendEndpoints } from "~/lib/utils/validateBackend";
import type { WidgetsType } from "~/utils/zodForms";
import { throughSourceProxy } from "../../../mocks/sourceProxy";
import { installWidgetsSchemaFixture } from "../../../mocks/widgetsSchema";

const mockFetch = vi.fn();
global.fetch = throughSourceProxy(mockFetch);
installWidgetsSchemaFixture();

const backendUrl = new URL("https://backend.test");

const widget = {
  name: "Stock Price",
  description: "Get current stock price",
  type: "html",
  params: [],
};

const widgets = {
  own: { ...widget, endpoint: "/stock/price" },
  elsewhere: { ...widget, endpoint: "https://elsewhere.test/stock/price" },
} as unknown as WidgetsType;

const sentTo = () =>
  Object.fromEntries(
    mockFetch.mock.calls.map(([url, init]) => {
      const { origin, pathname, searchParams } = new URL(String(url));
      return [
        `${origin}${pathname}`,
        {
          method: init?.method ?? "GET",
          credentials: init?.credentials,
          proxy: init?.proxy,
          headers: init?.headers,
          query: searchParams,
        },
      ];
    }),
  );

const answer = async (url: string | URL, init?: RequestInit) => {
  if (init?.method === "OPTIONS")
    return { status: String(url).includes("__workspace_route_probe_") ? 404 : 204 };
  return {
    ok: true,
    url: String(url),
    headers: new Headers(),
    json: () =>
      Promise.resolve(String(url).includes("widgets.json") ? { own: widgets.own } : []),
  };
};

describe("validateBackendEndpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockImplementation(answer);
  });

  it("asks the backend's own routes with a plain OPTIONS, without its credentials", async () => {
    const report = await validateBackendEndpoints(widgets, backendUrl);

    const own = sentTo()["https://backend.test/stock/price"];
    expect(own.method).toBe("OPTIONS");
    expect(own.credentials).toBe("omit");
    expect(own.headers).toBeUndefined();
    expect([...own.query.keys()]).toEqual([]);
    expect(sentTo()["https://elsewhere.test/stock/price"]).toBeUndefined();
    expect(report.failed).toEqual([]);
    expect(report.unchecked).toEqual([
      "Widget: elsewhere - `https://elsewhere.test/stock/price`: not on the backend's origin",
    ]);
  });
});

describe("validateBackend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockImplementation(answer);
  });

  it("reads every file through the API with the source's id, never with its credentials", async () => {
    const source = {
      id: "src-1",
      name: "Backend",
      url: backendUrl.href,
      endpointHeaders: [
        { key: "X-API-KEY", value: "", location: "headers" },
        { key: "token", value: "", location: "query" },
      ],
    } as Source;

    await validateBackend(source, {
      validateAllWidgets: true,
      apps: true,
      agents: true,
    });

    const sent = sentTo();
    for (const path of ["widgets.json", "apps.json", "agents.json"]) {
      const call = sent[`https://backend.test/${path}`];
      expect(call?.proxy).toEqual({ route: "saved", sourceId: "src-1" });
      expect(call?.headers).toEqual({});
      expect(call?.query.has("token")).toBe(false);
    }
    const route = sent["https://backend.test/stock/price"];
    expect(route?.method).toBe("OPTIONS");
    expect(route?.headers).toBeUndefined();
    expect(route?.query.has("token")).toBe(false);
  });
});
