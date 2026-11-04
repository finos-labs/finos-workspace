import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParamDefT, WidgetJsonT, WidgetT } from "~/components/types";
import type { Widget } from "~/lib/state/app";
import { type Source, useBackendConnectorStore } from "~/lib/state/backendConnector";
import { endpointOptionsRequest, getWidgetData } from "~/lib/utils/app";
import { withoutEndpointCredentials } from "~/lib/utils/endpointCredentials";
import { partial } from "../../mocks";

vi.mock("sonner", () => ({
  toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

const TYPED: Source["endpointHeaders"] = [
  { key: "Authorization", value: "Bearer data-backend-secret", location: "headers" },
  { key: "apikey", value: "query-secret", location: "query" },
];

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
    useBackendConnectorStore.setState({ apiSources: [] });
  });

  it("never stay in the page after a source is added, only their names do", () => {
    useBackendConnectorStore.getState().addApiSource(
      partial<Source>({
        id: "src-1",
        name: "Data API",
        url: "https://api.example.com",
        endpointHeaders: TYPED,
      }),
    );

    const [source] = useBackendConnectorStore.getState().apiSources;
    expect(source.endpointHeaders).toEqual([
      { key: "Authorization", value: "", location: "headers" },
      { key: "apikey", value: "", location: "query" },
    ]);
    expect(source.hasApiKey).toBe(true);
    expect(
      JSON.stringify(useBackendConnectorStore.getState().apiSources),
    ).not.toContain("secret");
  });

  it("never stay in the page after a source list is loaded", () => {
    useBackendConnectorStore.setState({ apiSources: [] });
    useBackendConnectorStore
      .getState()
      .updateApiSources([
        partial<Source>({
          id: "src-1",
          name: "Data API",
          url: "https://api.example.com",
          endpointHeaders: TYPED,
        }),
      ])
      .catch(() => undefined);

    expect(
      JSON.stringify(useBackendConnectorStore.getState().apiSources),
    ).not.toContain("secret");
  });

  it("are not part of an endpoint parameter's options request, only the source id is", () => {
    const built = endpointOptionsRequest(
      partial<Widget>({ sourceId: "src-1", params: [] }),
      partial<ParamDefT<"endpoint">>({
        type: "endpoint",
        paramName: "region_options",
        optionsEndpoint: "https://api.example.com/options",
        optionsParams: { region: "eu" },
      }),
      {},
    );
    if (!built?.ok) throw new Error("The options request was not built");

    expect(built.request.sourceId).toBe("src-1");
    expect(built.request.url).toBe("https://api.example.com/options?region=eu");
    expect(built.request.paramHeaders).toEqual({});
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
        endpointHeaders: TYPED ?? [],
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
