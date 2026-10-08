import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getDependentEndpointParamValues,
  getUngroupedDependentEndpointParams,
} from "~/lib/utils/app";

const FEEDS: Record<string, { label: string; value: string; selected?: boolean }[]> = {
  wire: [
    { label: "General News", value: "wire_general" },
    { label: "Markets", value: "wire_markets" },
  ],
  bbc: [{ label: "Top stories", value: "bbc_top" }],
  axios: [{ label: "Latest", value: "axios_latest", selected: true }],
};

const rssWidget = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "rss",
    widgetId: "news_rss",
    endpoint: { url: "http://backend.test/api/v1/news/rss" },
    storage: { params: {} },
    params: [
      {
        paramName: "outlet",
        type: "endpoint",
        groupById: "outlet-options",
        optionsEndpoint: "http://backend.test/api/v1/news/rss_providers",
      },
      {
        paramName: "source",
        type: "endpoint",
        groupById: "source-options",
        optionsEndpoint: "http://backend.test/api/v1/news/rss_feeds",
        optionsParams: { outlet: "$outlet" },
      },
    ],
    ...overrides,
  }) as never;

describe("dependent endpoint params of a widget that is not in a group", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const outlet = new URL(url).searchParams.get("outlet") ?? "";
        return { ok: true, json: async () => FEEDS[outlet] ?? [] };
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("finds the params whose options depend on the changed one", () => {
    const widget = rssWidget();

    expect(
      getUngroupedDependentEndpointParams(widget, "outlet").map((p) => p.paramName),
    ).toEqual(["source"]);
    expect(getUngroupedDependentEndpointParams(widget, "source")).toEqual([]);
  });

  it("leaves the params that are in a group to their group", () => {
    const widget = rssWidget({ paramGroups: { "source-options": "group-1" } });

    expect(getUngroupedDependentEndpointParams(widget, "outlet")).toEqual([]);
  });

  it("clears a value that the new provider does not offer", async () => {
    const updates = await getDependentEndpointParamValues(rssWidget(), "outlet", {
      outlet: "bbc",
      source: "wire_general",
    });

    expect(updates).toEqual({ source: "" });
  });

  it("takes the feed the backend marks as selected", async () => {
    const updates = await getDependentEndpointParamValues(rssWidget(), "outlet", {
      outlet: "axios",
      source: "wire_general",
    });

    expect(updates).toEqual({ source: "axios_latest" });
  });

  it("asks for the feeds of the new provider", async () => {
    await getDependentEndpointParamValues(rssWidget(), "outlet", {
      outlet: "bbc",
      source: "wire_general",
    });

    expect(fetch).toHaveBeenCalledWith(
      "http://backend.test/api/v1/news/rss_feeds?outlet=bbc",
      { headers: {} },
    );
  });

  it("keeps a value that the new provider offers", async () => {
    const updates = await getDependentEndpointParamValues(rssWidget(), "outlet", {
      outlet: "wire",
      source: "wire_markets",
    });

    expect(updates).toEqual({});
  });

  it("changes nothing when there was no value and none is marked", async () => {
    const updates = await getDependentEndpointParamValues(rssWidget(), "outlet", {
      outlet: "bbc",
    });

    expect(updates).toEqual({});
  });

  it("follows a chain of dependent params", async () => {
    const widget = rssWidget({
      params: [
        ...(rssWidget() as { params: unknown[] }).params,
        {
          paramName: "article",
          type: "endpoint",
          groupById: "article-options",
          optionsEndpoint: "http://backend.test/api/v1/news/articles",
          optionsParams: { source: "$source" },
        },
      ],
    });

    const updates = await getDependentEndpointParamValues(widget, "outlet", {
      outlet: "bbc",
      source: "wire_general",
      article: "old-article",
    });

    // The cleared feed offers no article, so the article is cleared as well
    expect(updates).toEqual({ source: "", article: "" });
  });
});
