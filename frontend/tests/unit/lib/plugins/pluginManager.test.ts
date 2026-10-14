// Tests the Plugin Manager: registry loading and caching, URL building with theme and
// settings, unknown/inactive/no-access plugins, and plugin host validation.
import { describe, expect, it, vi } from "vitest";
import {
  allowAllEntitlements,
  createPluginManager,
  type EntitlementService,
  PluginHostNotConfiguredError,
  parsePluginHost,
} from "~/lib/plugins";

const active = {
  id: "bq-advanced-grouping",
  name: "BQ Advanced Grouping",
  description: "Grouping",
  version: "1.0.0",
  category: "Data Grid",
  route: "/plugins/advanced-grouping",
  status: "active" as const,
};
const inactive = {
  ...active,
  id: "bq-pivot",
  name: "BQ Pivot",
  route: "/plugins/pivot",
  status: "inactive" as const,
};

function setup(
  options: {
    host?: string;
    entitlements?: EntitlementService;
    registry?: unknown;
  } = {},
) {
  const fetchFn = vi.fn(async () =>
    Response.json(options.registry ?? [active, inactive]),
  );
  const open = vi.fn();
  const manager = createPluginManager({
    pluginHostUrl: options.host ?? "http://localhost:5173",
    entitlements: options.entitlements ?? allowAllEntitlements,
    open,
    fetchFn: fetchFn as unknown as typeof fetch,
  });
  return { manager, fetchFn, open };
}

describe("createPluginManager", () => {
  it("loads plugins from <host>/registry/plugins.json and caches them", async () => {
    const { manager, fetchFn } = setup();
    expect((await manager.getPlugins()).map((p) => p.id)).toEqual([
      "bq-advanced-grouping",
      "bq-pivot",
    ]);
    await manager.getPlugin("bq-pivot");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith(
      "http://localhost:5173/registry/plugins.json",
      expect.anything(),
    );
  });

  it("resolves the runtime URL as plugin host + registry route", () => {
    const { manager } = setup({ host: "https://plugins.brightquery.com/" });
    expect(manager.resolvePluginUrl(active)).toBe(
      "https://plugins.brightquery.com/plugins/advanced-grouping",
    );
    expect(manager.resolvePluginUrl(active, { theme: "dark" })).toBe(
      "https://plugins.brightquery.com/plugins/advanced-grouping?theme=dark",
    );
  });

  it("passes declared settings as query parameters and drops the rest", () => {
    const { manager } = setup();
    const withSettings = {
      ...active,
      settings: [
        {
          key: "dataSource",
          label: "Data source",
          type: "select" as const,
          options: [{ value: "api", label: "API" }],
        },
        { key: "apiUrl", label: "API URL", type: "url" as const },
      ],
    };
    const url = new URL(
      manager.resolvePluginUrl(withSettings, {
        theme: "dark",
        settings: {
          dataSource: "api",
          apiUrl: " https://api.example.com/companies?x=1 ",
          enableExport: "true", // not declared
        },
      }),
    );
    expect(url.origin + url.pathname).toBe(
      "http://localhost:5173/plugins/advanced-grouping",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      theme: "dark",
      dataSource: "api",
      apiUrl: "https://api.example.com/companies?x=1",
    });
  });

  it("leaves out empty setting values", () => {
    const { manager } = setup();
    const withSettings = {
      ...active,
      settings: [{ key: "apiUrl", label: "API URL", type: "url" as const }],
    };
    expect(manager.resolvePluginUrl(withSettings, { settings: { apiUrl: "  " } })).toBe(
      "http://localhost:5173/plugins/advanced-grouping",
    );
  });

  it("keeps a base path on the host", () => {
    const { manager } = setup({ host: "https://cdn.example.com/bq" });
    expect(manager.resolvePluginUrl(active)).toBe(
      "https://cdn.example.com/bq/plugins/advanced-grouping",
    );
  });

  it("returns an available plugin's URL", async () => {
    const { manager } = setup();
    expect(await manager.checkAvailability("bq-advanced-grouping")).toEqual({
      ok: true,
      url: "http://localhost:5173/plugins/advanced-grouping",
    });
  });

  it("handles an unknown plugin", async () => {
    const { manager } = setup();
    expect(await manager.getPlugin("nope")).toBeUndefined();
    expect(await manager.checkAvailability("nope")).toMatchObject({
      ok: false,
      reason: "unknown",
    });
  });

  it("refuses an inactive plugin", async () => {
    const { manager } = setup();
    expect(await manager.checkAvailability("bq-pivot")).toMatchObject({
      ok: false,
      reason: "inactive",
    });
  });

  it("checks entitlements", async () => {
    const hasAccess = vi.fn(async (id: string) => id !== "bq-advanced-grouping");
    const { manager } = setup({ entitlements: { hasAccess } });
    expect(await manager.checkAvailability("bq-advanced-grouping")).toMatchObject({
      ok: false,
      reason: "no-access",
    });
    expect(hasAccess).toHaveBeenCalledWith("bq-advanced-grouping");
  });

  it("opens plugins through the injected opener", () => {
    const { manager, open } = setup();
    manager.openPlugin("bq-advanced-grouping");
    expect(open).toHaveBeenCalledWith("bq-advanced-grouping");
  });

  it("retries the registry after a failure", async () => {
    const { manager, fetchFn } = setup();
    fetchFn.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(manager.getPlugins()).rejects.toMatchObject({ kind: "network" });
    expect(await manager.getPlugins()).toHaveLength(2);
  });

  it("fails clearly when no host is configured", async () => {
    const { manager, fetchFn } = setup({ host: "" });
    await expect(manager.getPlugins()).rejects.toBeInstanceOf(
      PluginHostNotConfiguredError,
    );
    expect(() => manager.resolvePluginUrl(active)).toThrow(
      PluginHostNotConfiguredError,
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("parsePluginHost", () => {
  it.each([
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://plugins.brightquery.com",
  ])("accepts %s", (value) => {
    expect(parsePluginHost(value).ok).toBe(true);
  });

  it.each([
    ["", "missing"],
    ["not a url", "invalid"],
    ["http://plugins.brightquery.com", "invalid"], // plain http outside localhost
    ["ftp://plugins.brightquery.com", "invalid"],
    ["https://user:pass@plugins.brightquery.com", "invalid"],
    ["https://plugins.brightquery.com?x=1", "invalid"],
  ])("rejects %j", (value, reason) => {
    expect(parsePluginHost(value)).toMatchObject({ ok: false, reason });
  });
});
