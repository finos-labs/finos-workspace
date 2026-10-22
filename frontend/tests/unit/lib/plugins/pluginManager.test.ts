// Tests the Plugin Manager: registry loading and caching, URL building (with a release
// version), approving a released version (pinned to its digest) and disabling, the
// release states (update available, changed on the host, missing), availability for
// unknown/inactive/disabled/blocked/no-access plugins, and host validation.
import { describe, expect, it, vi } from "vitest";
import {
  allowAllEntitlements,
  createLocalPluginApprovals,
  createPluginManager,
  type EntitlementService,
  PLUGIN_APPROVALS_STORAGE_KEY,
  PluginHostNotConfiguredError,
  type PluginRelease,
  parsePluginHost,
} from "~/lib/plugins";
import { makeRelease, memoryStorage } from "./releaseFixtures";

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

async function setup(
  options: {
    host?: string;
    entitlements?: EntitlementService;
    registry?: unknown;
    releases?: PluginRelease[];
    /** Versions approved before the test. Default: the active plugin at 1.0.0. */
    approved?: { pluginId: string; version: string }[];
  } = {},
) {
  const { map, storage } = memoryStorage();
  const approvals = createLocalPluginApprovals(() => storage);
  const state = { releases: options.releases ?? [makeRelease()] };
  const fetchFn = vi.fn(async (input: RequestInfo | URL) =>
    String(input).endsWith("/registry/releases.json")
      ? Response.json(state.releases)
      : Response.json(options.registry ?? [active, inactive]),
  );
  const open = vi.fn();
  const manager = createPluginManager({
    pluginHostUrl: options.host ?? "http://localhost:5173",
    entitlements: options.entitlements ?? allowAllEntitlements,
    approvals,
    open,
    fetchFn: fetchFn as unknown as typeof fetch,
  });
  for (const { pluginId, version } of options.approved ?? [
    { pluginId: active.id, version: "1.0.0" },
  ]) {
    await manager.approveRelease(pluginId, version);
  }
  const registryCalls = () =>
    fetchFn.mock.calls.filter(([url]) => String(url).endsWith("/plugins.json")).length;
  return { manager, fetchFn, registryCalls, open, map, state };
}

describe("createPluginManager", () => {
  it("loads plugins from <host>/registry/plugins.json and caches them", async () => {
    const { manager, registryCalls } = await setup({ approved: [] });
    expect((await manager.getPlugins()).map((p) => p.id)).toEqual([
      "bq-advanced-grouping",
      "bq-pivot",
    ]);
    await manager.getPlugin("bq-pivot");
    expect(registryCalls()).toBe(1);
  });

  it("resolves the runtime URL as plugin host + route (+ version)", async () => {
    const { manager } = await setup({
      host: "https://plugins.brightquery.com/",
      approved: [],
    });
    expect(manager.resolvePluginUrl(active)).toBe(
      "https://plugins.brightquery.com/plugins/advanced-grouping",
    );
    expect(manager.resolvePluginUrl(active, { theme: "dark", version: "1.2.0" })).toBe(
      "https://plugins.brightquery.com/plugins/advanced-grouping/1.2.0/?theme=dark",
    );
    expect(() => manager.resolvePluginUrl(active, { version: "../x" })).toThrow();
  });

  it("keeps a base path on the host", async () => {
    const { manager } = await setup({
      host: "https://cdn.example.com/bq",
      approved: [],
    });
    expect(manager.resolvePluginUrl(active)).toBe(
      "https://cdn.example.com/bq/plugins/advanced-grouping",
    );
  });

  it("opens the approved version of an enabled plugin", async () => {
    const { manager } = await setup();
    expect(await manager.checkAvailability("bq-advanced-grouping")).toEqual({
      ok: true,
      version: "1.0.0",
      url: "http://localhost:5173/plugins/advanced-grouping/1.0.0/",
    });
  });

  it("handles an unknown plugin", async () => {
    const { manager } = await setup();
    expect(await manager.getPlugin("nope")).toBeUndefined();
    expect(await manager.checkAvailability("nope")).toMatchObject({
      ok: false,
      reason: "unknown",
    });
  });

  it("refuses an inactive plugin", async () => {
    const { manager } = await setup();
    expect(await manager.checkAvailability("bq-pivot")).toMatchObject({
      ok: false,
      reason: "inactive",
    });
  });

  it("refuses a plugin that is not approved", async () => {
    const { manager } = await setup({ approved: [] });
    expect(await manager.checkAvailability("bq-advanced-grouping")).toMatchObject({
      ok: false,
      reason: "disabled",
    });
    expect(await manager.getReleaseState("bq-advanced-grouping")).toMatchObject({
      kind: "not-approved",
      latest: { version: "1.0.0" },
    });
  });

  describe("approvals", () => {
    it("approves a released version pinned to its digest, globally", async () => {
      const release = makeRelease({ releaseNotes: "First." });
      const { manager, map } = await setup({ releases: [release], approved: [] });
      await manager.approveRelease("bq-advanced-grouping", "1.0.0");

      expect(await manager.getEnabledPluginIds()).toEqual(["bq-advanced-grouping"]);
      const [approval] = JSON.parse(map.get(PLUGIN_APPROVALS_STORAGE_KEY) ?? "[]");
      expect(approval).toMatchObject({
        pluginId: "bq-advanced-grouping",
        version: "1.0.0",
        digest: release.digest,
        files: release.files,
        releaseNotes: "First.",
      });
    });

    it("disables a plugin by removing its approval", async () => {
      const { manager } = await setup();
      await manager.disablePlugin("bq-advanced-grouping");
      expect(await manager.getEnabledPluginIds()).toEqual([]);
      expect(await manager.checkAvailability("bq-advanced-grouping")).toMatchObject({
        reason: "disabled",
      });
    });

    it("only approves registered, active plugins at a released version", async () => {
      const { manager } = await setup({ approved: [] });
      await expect(manager.approveRelease("nope", "1.0.0")).rejects.toThrow(
        "No plugin",
      );
      await expect(manager.approveRelease("bq-pivot", "1.0.0")).rejects.toThrow(
        "inactive",
      );
      await expect(
        manager.approveRelease("bq-advanced-grouping", "9.9.9"),
      ).rejects.toThrow("not released");
      expect(await manager.getEnabledPluginIds()).toEqual([]);
    });

    it("treats unreadable stored approvals as nothing approved", async () => {
      const { manager, map } = await setup({ approved: [] });
      map.set(PLUGIN_APPROVALS_STORAGE_KEY, "{not json");
      expect(await manager.getEnabledPluginIds()).toEqual([]);
      map.set(PLUGIN_APPROVALS_STORAGE_KEY, JSON.stringify([{ pluginId: "x" }]));
      expect(await manager.getEnabledPluginIds()).toEqual([]);
    });
  });

  describe("release states", () => {
    it("keeps running the approved version while a newer one waits for review", async () => {
      const { manager, state } = await setup();
      state.releases = [makeRelease(), makeRelease({ version: "1.1.0" })];

      expect(await manager.getReleaseState("bq-advanced-grouping")).toMatchObject({
        kind: "update-available",
        current: { version: "1.0.0" },
        latest: { version: "1.1.0" },
      });
      expect(await manager.checkAvailability("bq-advanced-grouping")).toMatchObject({
        ok: true,
        version: "1.0.0",
      });

      await manager.approveRelease("bq-advanced-grouping", "1.1.0");
      expect(await manager.checkAvailability("bq-advanced-grouping")).toMatchObject({
        ok: true,
        url: "http://localhost:5173/plugins/advanced-grouping/1.1.0/",
      });
    });

    it("blocks an approved version whose release changed on the host", async () => {
      const { manager, state } = await setup();
      state.releases = [makeRelease({ digest: `sha256:${"f".repeat(64)}` })];

      expect(await manager.getReleaseState("bq-advanced-grouping")).toMatchObject({
        kind: "changed",
      });
      expect(await manager.checkAvailability("bq-advanced-grouping")).toMatchObject({
        ok: false,
        reason: "changed",
      });
      // Re-approving accepts the release as it is now.
      await manager.approveRelease("bq-advanced-grouping", "1.0.0");
      expect(await manager.checkAvailability("bq-advanced-grouping")).toMatchObject({
        ok: true,
      });
    });

    it("blocks an approved version that is gone from the host", async () => {
      const { manager, state } = await setup();
      state.releases = [makeRelease({ version: "2.0.0" })];

      expect(await manager.getReleaseState("bq-advanced-grouping")).toMatchObject({
        kind: "missing",
        latest: { version: "2.0.0" },
      });
      expect(await manager.checkAvailability("bq-advanced-grouping")).toMatchObject({
        ok: false,
        reason: "missing",
      });
    });

    it("reports a plugin without releases", async () => {
      const { manager } = await setup({ releases: [], approved: [] });
      expect(await manager.getReleaseState("bq-advanced-grouping")).toEqual({
        kind: "no-release",
      });
    });

    it("treats a host without a release index as having no releases", async () => {
      const { manager, fetchFn } = await setup({ approved: [] });
      fetchFn.mockImplementation(async (input: RequestInfo | URL) =>
        String(input).endsWith("/registry/releases.json")
          ? new Response(null, { status: 404 })
          : Response.json([active, inactive]),
      );
      expect(await manager.getReleases()).toEqual([]);
    });
  });

  it("finds the plugin for a widget URL on the plugin host, with or without a version", async () => {
    const { manager } = await setup();
    for (const url of [
      "http://localhost:5173/plugins/advanced-grouping?theme=dark&apiUrl=x",
      "http://localhost:5173/plugins/advanced-grouping/1.0.0/",
    ]) {
      expect(await manager.findPluginForUrl(url)).toMatchObject({
        id: "bq-advanced-grouping",
      });
    }
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
    const { manager } = await setup({ entitlements: { hasAccess } });
    expect(await manager.checkAvailability("bq-advanced-grouping")).toMatchObject({
      ok: false,
      reason: "no-access",
    });
    expect(hasAccess).toHaveBeenCalledWith("bq-advanced-grouping");
  });

  it("opens plugins through the injected opener", async () => {
    const { manager, open } = await setup();
    manager.openPlugin("bq-advanced-grouping");
    expect(open).toHaveBeenCalledWith("bq-advanced-grouping");
  });

  it("retries the registry after a failure", async () => {
    const { manager, fetchFn } = await setup({ approved: [] });
    fetchFn.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(manager.getPlugins()).rejects.toMatchObject({ kind: "network" });
    expect(await manager.getPlugins()).toHaveLength(2);
  });

  it("fails clearly when no host is configured", async () => {
    const { manager, fetchFn } = await setup({ host: "", approved: [] });
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
