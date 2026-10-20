import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Source } from "~/lib/state/backendConnector";
import { validateBackend, validateBackendEndpoints } from "~/lib/utils/validateBackend";
import type { WidgetsType } from "~/utils/zodForms";

const mockFetch = vi.fn();
global.fetch = mockFetch;

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

/** Each request the backend got, by the origin and path it went to */
const sentTo = () =>
  Object.fromEntries(
    mockFetch.mock.calls.map(([url, init]) => {
      const { origin, pathname, searchParams } = new URL(String(url));
      return [`${origin}${pathname}`, { headers: init?.headers, query: searchParams }];
    }),
  );

describe("validateBackendEndpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
  });

  it("sends the backend's credentials to its own origin only", async () => {
    await validateBackendEndpoints(
      widgets,
      backendUrl,
      { "X-API-KEY": "backend-key" },
      { token: "backend-token" },
    );

    const sent = sentTo();
    const own = sent["https://backend.test/stock/price"];
    expect(own.headers).toEqual({ "X-API-KEY": "backend-key" });
    expect(own.query.get("token")).toBe("backend-token");
    const elsewhere = sent["https://elsewhere.test/stock/price"];
    expect(elsewhere.headers).toEqual({});
    expect(elsewhere.query.has("token")).toBe(false);
  });
});

describe("validateBackend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockImplementation(async (url: string | URL) => ({
      ok: true,
      url: String(url),
      headers: new Headers(),
      json: () =>
        Promise.resolve(
          String(url).includes("widgets.json") ? { own: widgets.own } : [],
        ),
    }));
  });

  it("sends the backend's query rows with every file it reads and every endpoint it checks", async () => {
    const source = {
      id: "src-1",
      name: "Backend",
      url: backendUrl.href,
      endpointHeaders: [
        { key: "X-API-KEY", value: "backend-key", location: "headers" },
        { key: "token", value: "backend-token", location: "query" },
      ],
    } as Source;

    await validateBackend(source, {
      validateAllWidgets: true,
      apps: true,
      agents: true,
    });

    const sent = sentTo();
    for (const path of ["widgets.json", "apps.json", "agents.json", "stock/price"]) {
      expect(sent[`https://backend.test/${path}`]?.query.get("token")).toBe(
        "backend-token",
      );
      expect(sent[`https://backend.test/${path}`]?.headers).toMatchObject({
        "X-API-KEY": "backend-key",
      });
    }
  });
});
