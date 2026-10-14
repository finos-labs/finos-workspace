import { beforeEach, describe, expect, it } from "vitest";
import {
  getPluginVizTypes,
  pluginWidgetId,
  resolvePluginWidget,
  resolveVizHandler,
  standalonePluginWidgets,
  usePluginRegistryStore,
} from "~/plugins/registry";
import { PluginListingSchema } from "~/plugins/types";

const listing = PluginListingSchema.parse({
  enabled: true,
  etag: "1",
  plugins: [
    {
      id: "chart-kit",
      version: "1.0.0",
      name: "Chart kit",
      digest: `sha256-${"A".repeat(43)}`,
      entry: { module: "entry.js", styles: [] },
      files: { "entry.js": { size: 10, sha256: "a".repeat(64) } },
      csp: {},
      widgets: [
        {
          id: "chart",
          name: "Chart",
          handles: [{ type: "chart" }],
          permissions: ["core:data:read"],
        },
        { id: "clock", name: "Clock", standalone: true, permissions: [] },
      ],
    },
  ],
  vizHandlers: { chart: { plugin: "chart-kit", widget: "chart" } },
});

describe("the plugin registry", () => {
  beforeEach(() => usePluginRegistryStore.getState().clear());

  it("resolves what the listing names, and nothing before it loads", () => {
    expect(resolveVizHandler("chart")).toBeNull();
    usePluginRegistryStore.getState().setListing(listing);
    expect(resolveVizHandler("chart")?.widget.id).toBe("chart");
    expect(resolveVizHandler("table")).toBeNull();
    expect(resolvePluginWidget({ id: "chart-kit", widget: "clock" })?.widget.id).toBe(
      "clock",
    );
    expect(resolvePluginWidget({ id: "other", widget: "clock" })).toBeNull();
    expect([...getPluginVizTypes()]).toEqual(["chart"]);
  });

  it("drops what a new listing no longer has", () => {
    usePluginRegistryStore.getState().setListing(listing);
    usePluginRegistryStore
      .getState()
      .setListing({ ...listing, etag: "2", plugins: [], vizHandlers: {} });
    expect(resolveVizHandler("chart")).toBeNull();
    expect(getPluginVizTypes().size).toBe(0);
  });

  it("names standalone widgets by plugin and widget", () => {
    expect(pluginWidgetId("chart-kit", "clock")).toBe("plugin:chart-kit:clock");
  });

  it("lists the standalone widgets for Add widget, with their plugin as source", () => {
    expect(standalonePluginWidgets(listing.plugins)).toEqual([
      {
        id: "plugin:chart-kit:clock",
        widgetId: "plugin:chart-kit:clock",
        type: "custom",
        name: "Clock",
        description: "",
        category: "Chart kit",
        subCategory: undefined,
        sourceName: "Chart kit",
        connectionType: "plugin",
        plugin: { id: "chart-kit", widget: "clock" },
        params: [],
        gridData: { w: 20, h: 12 },
      },
    ]);
  });

  it("refuses a listing with a malformed digest or permission", () => {
    const bad = structuredClone(listing) as unknown as {
      plugins: { digest: string; widgets: { permissions: string[] }[] }[];
    };
    bad.plugins[0].digest = "md5-x";
    expect(PluginListingSchema.safeParse(bad).success).toBe(false);
    const worse = structuredClone(listing) as unknown as typeof bad;
    worse.plugins[0].widgets[0].permissions = ["core:everything"];
    expect(PluginListingSchema.safeParse(worse).success).toBe(false);
  });
});
