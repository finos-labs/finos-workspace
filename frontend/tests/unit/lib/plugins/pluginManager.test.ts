// Tests the Plugin Manager: registry loading and caching, URL building, global
// enable/disable, unknown/inactive/disabled/no-access plugins, and host validation.
import { describe, expect, it, vi } from "vitest";
import {
  allowAllEntitlements,
  createLocalPluginEnablement,
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
    /** Plugins enabled before the test. Default: the active plugin. */
    enabledIds?: string[];
  } = {},
) {
  const storage = new Map<string, string>();
  const enablement = createLocalPluginEnablement(
    () =>
      ({
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      }) as unknown as Storage,
  );
  for (const id of options.enabledIds ?? [active.id]) {
    void enablement.setPluginEnabled(id, true);
  }
  const fetchFn = vi.fn(async () =>
    Response.json(options.registry ?? [active, inactive]),
  );
  const open = vi.fn();
  const manager = createPluginManager({
    pluginHostUrl: options.host ?? "http://localhost:5173",
    entitlements: options.entitlements ?? allowAllEntitlements,
    enablement,
    open,
    fetchFn: fetchFn as unknown as typeof fetch,
  });
  return { manager, fetchFn, open, storage };
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

  it("refuses a disabled plugin", async () => {
    const { manager } = setup({ enabledIds: [] });
    expect(await manager.checkAvailability("bq-advanced-grouping")).toMatchObject({
      ok: false,
      reason: "disabled",
    });
  });

  it("enables and disables a plugin globally", async () => {
    const { manager } = setup({ enabledIds: [] });
    expect(await manager.isPluginEnabled("bq-advanced-grouping")).toBe(false);

    await manager.enablePlugin("bq-advanced-grouping");
    expect(await manager.isPluginEnabled("bq-advanced-grouping")).toBe(true);
    expect(await manager.getEnabledPluginIds()).toEqual(["bq-advanced-grouping"]);
    expect(await manager.checkAvailability("bq-advanced-grouping")).toMatchObject({
      ok: true,
    });

    await manager.disablePlugin("bq-advanced-grouping");
    expect(await manager.isPluginEnabled("bq-advanced-grouping")).toBe(false);
    expect(await manager.getEnabledPluginIds()).toEqual([]);
  });

  it("only enables registered, active plugins", async () => {
    const { manager } = setup({ enabledIds: [] });
    await expect(manager.enablePlugin("nope")).rejects.toThrow("No plugin");
    await expect(manager.enablePlugin("bq-pivot")).rejects.toThrow("inactive");
    expect(await manager.getEnabledPluginIds()).toEqual([]);
  });

  it("treats unreadable stored state as nothing enabled", async () => {
    const { manager, storage } = setup({ enabledIds: [] });
    storage.set("bq-plugins:enabled", "{not json");
    expect(await manager.getEnabledPluginIds()).toEqual([]);
    storage.set("bq-plugins:enabled", JSON.stringify({ old: "dashboard state" }));
    expect(await manager.getEnabledPluginIds()).toEqual([]);
  });

  it("finds the plugin for a widget URL on the plugin host", async () => {
    const { manager } = setup();
    expect(
      await manager.findPluginForUrl(
        "http://localhost:5173/plugins/advanced-grouping?theme=dark&apiUrl=x",
      ),
    ).toMatchObject({ id: "bq-advanced-grouping" });
    expect(
      await manager.findPluginForUrl("http://localhost:5173/plugins/unknown"),
    ).toBeUndefined();
    expect(
      await manager.findPluginForUrl("https://other.example/plugins/advanced-grouping"),
    ).toBeUndefined();
    expect(await manager.findPluginForUrl("not a url")).toBeUndefined();
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
