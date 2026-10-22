// Tests registry parsing and fetching: valid, empty, malformed and duplicate entries,
// settings validation, and network/HTTP/JSON errors.
import { describe, expect, it, vi } from "vitest";
import { fetchRegistry, PluginRegistryError, parseRegistry } from "~/lib/plugins";

const plugin = {
  id: "bq-advanced-grouping",
  name: "BQ Advanced Grouping",
  description: "Advanced grouping and aggregation capabilities for data grids.",
  version: "1.0.0",
  category: "Data Grid",
  route: "/plugins/advanced-grouping",
  status: "active",
};

describe("parseRegistry", () => {
  it("returns valid plugins", () => {
    expect(parseRegistry([plugin])).toEqual({ plugins: [plugin], errors: [] });
  });

  it("handles an empty registry", () => {
    expect(parseRegistry([])).toEqual({ plugins: [], errors: [] });
  });

  it("rejects a document that is not an array", () => {
    expect(() => parseRegistry({ plugins: [plugin] })).toThrow(PluginRegistryError);
  });

  it("skips invalid entries but keeps the valid ones", () => {
    const { plugins, errors } = parseRegistry([
      plugin,
      { ...plugin, id: "x", route: "https://evil.example.com/plugins/x" },
      { ...plugin, id: "y", route: "/plugins/y", status: "beta" },
      "not an object",
    ]);
    expect(plugins).toEqual([plugin]);
    expect(errors).toHaveLength(3);
  });

  it("skips duplicate ids and routes", () => {
    const { plugins, errors } = parseRegistry([
      plugin,
      { ...plugin, route: "/plugins/other" },
    ]);
    expect(plugins).toHaveLength(1);
    expect(errors[0]).toContain("duplicate");
  });

  it("drops unknown keys, so registry metadata can't smuggle in extra fields", () => {
    const { plugins } = parseRegistry([{ ...plugin, script: "alert(1)" }]);
    expect(plugins[0]).not.toHaveProperty("script");
  });

  describe("requests", () => {
    it("keeps what a plugin asks for and fills in what it leaves out", () => {
      const { plugins, errors } = parseRegistry([
        {
          ...plugin,
          requests: { network: ["https://api.example.com"], downloads: true },
        },
      ]);
      expect(errors).toEqual([]);
      expect(plugins[0].requests).toEqual({
        network: ["https://api.example.com"],
        storage: false,
        downloads: true,
        popups: false,
      });
    });

    it("leaves requests undefined when the plugin does not declare them", () => {
      expect(parseRegistry([plugin]).plugins[0].requests).toBeUndefined();
    });

    it("accepts http only on this machine", () => {
      const { plugins } = parseRegistry([
        { ...plugin, requests: { network: ["http://localhost:8080"] } },
      ]);
      expect(plugins[0].requests?.network).toEqual(["http://localhost:8080"]);
    });

    it.each([
      ["a full URL instead of an origin", { network: ["https://api.example.com/v1"] }],
      ["a trailing slash", { network: ["https://api.example.com/"] }],
      ["http on another machine", { network: ["http://api.example.com"] }],
      ["another scheme", { network: ["ftp://files.example.com"] }],
      ["not a URL", { network: ["api.example.com"] }],
      ["duplicate origins", { network: ["https://a.example", "https://a.example"] }],
      ["a non-boolean flag", { storage: "yes" }],
    ])("skips an entry with %s", (_, requests) => {
      const { plugins, errors } = parseRegistry([{ ...plugin, requests }]);
      expect(plugins).toEqual([]);
      expect(errors).toHaveLength(1);
    });
  });

  describe("settings", () => {
    const dataSource = {
      key: "dataSource",
      label: "Data source",
      type: "select",
      description: "Where this widget loads company data from.",
      options: [
        { value: "mock", label: "Sample data" },
        { value: "api", label: "API" },
      ],
    };
    const apiUrl = { key: "apiUrl", label: "API URL", type: "url" };

    it("keeps declared settings", () => {
      const entry = { ...plugin, settings: [dataSource, apiUrl] };
      expect(parseRegistry([entry])).toEqual({ plugins: [entry], errors: [] });
    });

    it.each([
      ["a key that is not camelCase", [{ ...apiUrl, key: "api-url" }]],
      ["the reserved key theme", [{ ...apiUrl, key: "theme" }]],
      ["an unknown type", [{ ...apiUrl, type: "script" }]],
      ["a select without options", [{ ...dataSource, options: undefined }]],
      ["options on a non-select", [{ ...apiUrl, options: dataSource.options }]],
      [
        "duplicate option values",
        [{ ...dataSource, options: [...dataSource.options, dataSource.options[0]] }],
      ],
      ["duplicate keys", [apiUrl, apiUrl]],
      [
        "more than 20 settings",
        Array.from({ length: 21 }, (_, i) => ({ ...apiUrl, key: `key${i}` })),
      ],
    ])("skips an entry with %s", (_, settings) => {
      const { plugins, errors } = parseRegistry([{ ...plugin, settings }]);
      expect(plugins).toEqual([]);
      expect(errors).toHaveLength(1);
    });
  });
});

describe("fetchRegistry", () => {
  const url = "http://localhost:5173/registry/plugins.json";

  it("fetches without credentials and parses the document", async () => {
    const fetchFn = vi.fn().mockResolvedValue(Response.json([plugin]));
    const result = await fetchRegistry(url, { fetchFn });
    expect(result.plugins).toEqual([plugin]);
    expect(fetchFn).toHaveBeenCalledWith(
      url,
      expect.objectContaining({ credentials: "omit" }),
    );
  });

  it.each([
    ["network", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["http", () => Promise.resolve(new Response("nope", { status: 500 }))],
    ["format", () => Promise.resolve(new Response("<html>", { status: 200 }))],
  ] as const)("reports %s failures", async (kind, respond) => {
    const fetchFn = vi.fn(respond) as unknown as typeof fetch;
    await expect(fetchRegistry(url, { fetchFn })).rejects.toMatchObject({ kind });
  });
});
