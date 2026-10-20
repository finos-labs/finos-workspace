import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WidgetJsonT, WidgetT } from "~/components/types";
import {
  getSourceCredentials,
  type Source,
  useBackendConnectorStore,
} from "~/lib/state/backendConnector";
import { getEndpointParamRequestArgs, getWidgetData } from "~/lib/utils/app";
import {
  splitEndpointHeaders,
  withoutEndpointCredentials,
} from "~/lib/utils/endpointCredentials";
import { partial } from "../../mocks";

vi.mock("sonner", () => ({
  toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

const ROWS: Source["endpointHeaders"] = [
  { key: "Authorization", value: "Bearer data-backend-secret", location: "headers" },
  { key: "apikey", value: "query-secret", location: "query" },
  { key: "X-Plain", value: "plain" },
];

describe("splitEndpointHeaders", () => {
  it("splits a source's credentials into request headers and URL query", () => {
    expect(splitEndpointHeaders(ROWS)).toEqual({
      headers: { Authorization: "Bearer data-backend-secret", "X-Plain": "plain" },
      query: { apikey: "query-secret" },
    });
    expect(splitEndpointHeaders(null)).toEqual({ headers: {}, query: {} });
  });
});

describe("withoutEndpointCredentials", () => {
  it("keeps a widget's URL and method only", () => {
    const widget = partial<WidgetT>({
      id: "w",
      endpoint: {
        url: "https://api.example.com/data",
        method: "GET",
        headers: { Authorization: "Bearer data-backend-secret" },
        query: { apikey: "query-secret" },
      } as WidgetT["endpoint"],
    });

    expect(withoutEndpointCredentials(widget).endpoint).toEqual({
      url: "https://api.example.com/data",
      method: "GET",
    });
  });
});

describe("credentials of a data backend", () => {
  beforeEach(() => {
    useBackendConnectorStore.setState({
      apiSources: [
        partial<Source>({
          id: "src-1",
          name: "Data API",
          url: "https://api.example.com",
          endpointHeaders: ROWS,
        }),
      ],
    });
  });

  it("are looked up in memory by the widget's source id", () => {
    const url = "https://api.example.com/prices";
    expect(getSourceCredentials("src-1", url).headers.Authorization).toBe(
      "Bearer data-backend-secret",
    );
    expect(getSourceCredentials("src-1", "/prices").headers.Authorization).toBe(
      "Bearer data-backend-secret",
    );
    expect(getSourceCredentials("unknown", url)).toEqual({ headers: {}, query: {} });
    expect(getSourceCredentials(undefined, url)).toEqual({ headers: {}, query: {} });
  });

  it("go only to the backend's own origin, whatever a widget pairs with its source id", () => {
    const none = { headers: {}, query: {} };
    // A widget shared back with the victim's source id and a URL of the sharer's
    expect(getSourceCredentials("src-1", "https://attacker.example/collect")).toEqual(
      none,
    );
    // Same host, another port or scheme, and a lookalike host are other origins
    expect(getSourceCredentials("src-1", "https://api.example.com:8443/x")).toEqual(
      none,
    );
    expect(getSourceCredentials("src-1", "http://api.example.com/x")).toEqual(none);
    expect(
      getSourceCredentials("src-1", "https://api.example.com.evil.test/x"),
    ).toEqual(none);
    expect(getSourceCredentials("src-1", "//attacker.example/x")).toEqual(none);
    expect(getSourceCredentials("src-1", undefined)).toEqual(none);
  });

  it("go with an endpoint parameter's options request: headers, and query rows in its URL", () => {
    type Args = Parameters<typeof getEndpointParamRequestArgs>;
    const { url, reqInit } = getEndpointParamRequestArgs(
      partial<Args[0]>({ sourceId: "src-1" }),
      partial<Args[1]>({
        optionsEndpoint: "https://api.example.com/options",
        optionsParams: { region: "eu" },
      }),
      {},
    );

    const { searchParams } = new URL(url);
    expect(searchParams.get("apikey")).toBe("query-secret");
    expect(searchParams.get("region")).toBe("eu");
    expect(reqInit.headers).toMatchObject({
      Authorization: "Bearer data-backend-secret",
    });
  });

  it("never land in the widget a dashboard saves", () => {
    const widget = getWidgetData({
      widget: partial<WidgetJsonT>({
        widgetId: "prices",
        name: "Prices",
        external: true,
        connectionType: "advanced-backend",
        sourceId: "src-1",
        sourceName: "Data API",
        endpoint: "https://api.example.com/prices",
        endpointHeaders: ROWS ?? [],
        params: [],
      }),
    });

    expect(widget.endpoint).toEqual({
      url: "https://api.example.com/prices",
      method: "GET",
    });
    expect(widget.sourceId).toBe("src-1");
    expect(JSON.stringify(widget)).not.toContain("secret");
  });
});
