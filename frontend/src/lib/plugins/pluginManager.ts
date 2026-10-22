/**
 * Plugin Manager: the one place that knows how to load the registry and the release
 * index, approve a plugin version (globally) or disable the plugin, work out each
 * plugin's release state (up to date, update available, changed on the host...), check
 * whether it can be opened, and build the runtime URL of its approved version
 * (plugin host + registry route + version + theme). UI code goes through it.
 */
import type { PluginApproval, PluginApprovalService } from "./approvals";
import type { EntitlementService } from "./entitlements";
import { parsePluginHost, REGISTRY_PATH } from "./pluginHost";
import { fetchRegistry, type ParsedRegistry, type PluginMetadata } from "./registry";
import {
  compareVersions,
  fetchReleases,
  latestRelease,
  type PluginRelease,
  RELEASES_PATH,
} from "./releases";

export type PluginAvailability =
  | { ok: true; url: string; version: string }
  | {
      ok: false;
      reason: "unknown" | "inactive" | "disabled" | "missing" | "changed" | "no-access";
      message: string;
    };

/**
 * Where a plugin stands against the releases on the host. "changed" and "missing" block
 * the plugin: its approved version no longer exists as approved.
 */
export type PluginReleaseState =
  | { kind: "no-release" }
  | { kind: "not-approved"; latest: PluginRelease }
  | { kind: "approved"; approval: PluginApproval; current: PluginRelease }
  | {
      kind: "update-available";
      approval: PluginApproval;
      current: PluginRelease;
      latest: PluginRelease;
    }
  /** The approved version's files or requests differ from what was approved. */
  | { kind: "changed"; approval: PluginApproval; current: PluginRelease }
  /** The approved version is gone from the host; `latest` is what could replace it. */
  | { kind: "missing"; approval: PluginApproval; latest?: PluginRelease };

export interface ResolveOptions {
  /** Passed to the plugin as ?theme= so it matches the Workspace theme. */
  theme?: "light" | "dark";
  /** Released version to load, at <route>/<version>/. Without it, the unversioned route. */
  version?: string;
}

export interface PluginManager {
  /** The validated plugin host, or why it can't be used. */
  readonly host: ReturnType<typeof parsePluginHost>;
  getPlugins(): Promise<PluginMetadata[]>;
  /** Registry problems from the last load (entries that were skipped). */
  getRegistryErrors(): Promise<string[]>;
  getPlugin(id: string): Promise<PluginMetadata | undefined>;
  /** The registered plugin whose page `url` is (any version), e.g. for an iframe widget. */
  findPluginForUrl(url: string): Promise<PluginMetadata | undefined>;
  /** Every release on the plugin host. */
  getReleases(): Promise<PluginRelease[]>;
  getApprovals(): Promise<PluginApproval[]>;
  /** Ids of the plugins an administrator has approved (enabled) for everyone. */
  getEnabledPluginIds(): Promise<string[]>;
  getReleaseState(id: string): Promise<PluginReleaseState>;
  /**
   * Approves `version` of a plugin for all users and dashboards, pinned to the digest the
   * host reports for it now. Replaces the plugin's earlier approval.
   */
  approveRelease(id: string, version: string): Promise<void>;
  /** Disables a plugin for all users and dashboards. */
  disablePlugin(id: string): Promise<void>;
  resolvePluginUrl(plugin: PluginMetadata, options?: ResolveOptions): string;
  /** Checks registry status, approval, release integrity and entitlement, then returns the URL. */
  checkAvailability(
    id: string,
    options?: Omit<ResolveOptions, "version">,
  ): Promise<PluginAvailability>;
  openPlugin(id: string): void;
  /** Drops the cached registry so the next call fetches it again. */
  refresh(): void;
}

export interface PluginManagerOptions {
  pluginHostUrl: string | undefined;
  entitlements: EntitlementService;
  approvals: PluginApprovalService;
  /** Opens the plugin inside Workspace (e.g. a router navigate). */
  open: (pluginId: string) => void;
  fetchFn?: typeof fetch;
}

export class PluginHostNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginHostNotConfiguredError";
  }
}

/** A plugin's release state, from its approval (if any) and its releases on the host. */
export function resolveReleaseState(
  approval: PluginApproval | undefined,
  releases: readonly PluginRelease[],
): PluginReleaseState {
  const latest = latestRelease(releases);
  if (!approval)
    return latest ? { kind: "not-approved", latest } : { kind: "no-release" };

  const current = releases.find((release) => release.version === approval.version);
  if (!current) return { kind: "missing", approval, latest };
  if (current.digest !== approval.digest) return { kind: "changed", approval, current };
  if (latest && compareVersions(latest.version, current.version) > 0) {
    return { kind: "update-available", approval, current, latest };
  }
  return { kind: "approved", approval, current };
}

const VERSION_SEGMENT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function createPluginManager(options: PluginManagerOptions): PluginManager {
  const host = parsePluginHost(options.pluginHostUrl);
  let registry: Promise<ParsedRegistry> | null = null;

  const requireHost = () => {
    if (host.ok === false) throw new PluginHostNotConfiguredError(host.message);
    return host;
  };

  const loadRegistry = () => {
    if (host.ok === false)
      return Promise.reject(new PluginHostNotConfiguredError(host.message));
    registry ??= fetchRegistry(`${host.baseUrl}${REGISTRY_PATH}`, {
      fetchFn: options.fetchFn,
    }).catch((error: unknown) => {
      registry = null; // let the next call retry
      throw error;
    });
    return registry;
  };

  // Not cached: integrity checks must see the host as it is now (react-query paces calls).
  const loadReleases = () => {
    if (host.ok === false)
      return Promise.reject(new PluginHostNotConfiguredError(host.message));
    return fetchReleases(`${host.baseUrl}${RELEASES_PATH}`, {
      fetchFn: options.fetchFn,
    });
  };

  const resolvePluginUrl = (
    plugin: PluginMetadata,
    resolveOptions: ResolveOptions = {},
  ) => {
    const { baseUrl, origin } = requireHost();
    const version = resolveOptions.version;
    if (version !== undefined && !VERSION_SEGMENT.test(version)) {
      throw new Error(`"${version}" is not a release version.`);
    }
    const url = new URL(`${baseUrl}${plugin.route}${version ? `/${version}/` : ""}`);
    // Routes are validated by the registry schema; this guards the invariant anyway.
    if (url.origin !== origin) {
      throw new Error(`Plugin "${plugin.id}" resolves outside the plugin host.`);
    }
    if (resolveOptions.theme) url.searchParams.set("theme", resolveOptions.theme);
    return url.toString();
  };

  const getPlugin = async (id: string) =>
    (await loadRegistry()).plugins.find((plugin) => plugin.id === id);

  const getReleaseState = async (id: string) => {
    const [approvals, all] = await Promise.all([
      options.approvals.getApprovals(),
      loadReleases(),
    ]);
    return resolveReleaseState(
      approvals.find((approval) => approval.pluginId === id),
      all.filter((release) => release.id === id),
    );
  };

  return {
    host,
    getPlugins: async () => (await loadRegistry()).plugins,
    getRegistryErrors: async () => (await loadRegistry()).errors,
    getPlugin,
    async findPluginForUrl(url) {
      if (host.ok === false) return undefined;
      let target: URL;
      try {
        target = new URL(url);
      } catch {
        return undefined;
      }
      if (target.origin !== host.origin) return undefined;
      const basePath = new URL(host.baseUrl).pathname.replace(/\/+$/, "");
      const segments = target.pathname.replace(/\/+$/, "").split("/");
      // "<route>" or "<route>/<version>"
      const path = VERSION_SEGMENT.test(segments.at(-1) ?? "")
        ? segments.slice(0, -1).join("/")
        : segments.join("/");
      return (await loadRegistry()).plugins.find(
        (plugin) => path === `${basePath}${plugin.route}`,
      );
    },
    getReleases: loadReleases,
    getApprovals: () => options.approvals.getApprovals(),
    getEnabledPluginIds: async () =>
      (await options.approvals.getApprovals()).map((approval) => approval.pluginId),
    getReleaseState,
    async approveRelease(id, version) {
      const plugin = await getPlugin(id);
      if (!plugin) throw new Error(`No plugin with id "${id}" is registered.`);
      if (plugin.status !== "active") {
        throw new Error(`${plugin.name} is ${plugin.status} and can't be enabled.`);
      }
      const release = (await loadReleases()).find(
        (item) => item.id === id && item.version === version,
      );
      if (!release) {
        throw new Error(
          `${plugin.name} ${version} is not released on the plugin host.`,
        );
      }
      await options.approvals.approve({
        pluginId: id,
        version: release.version,
        digest: release.digest,
        files: release.files,
        requests: release.requests,
        releaseNotes: release.releaseNotes,
        source: release.source,
        approvedAt: new Date().toISOString(),
      });
    },
    // A plugin that left the registry can still be disabled, so no lookup here.
    disablePlugin: (id) => options.approvals.revoke(id),
    resolvePluginUrl,
    async checkAvailability(id, resolveOptions = {}) {
      const plugin = await getPlugin(id);
      if (!plugin) {
        return {
          ok: false,
          reason: "unknown",
          message: `No plugin with id "${id}" is registered.`,
        };
      }
      if (plugin.status !== "active") {
        return {
          ok: false,
          reason: "inactive",
          message: `${plugin.name} is ${plugin.status} and can't be opened.`,
        };
      }
      const state = await getReleaseState(plugin.id);
      if (state.kind === "no-release" || state.kind === "not-approved") {
        return {
          ok: false,
          reason: "disabled",
          message: `${plugin.name} is disabled. An administrator can enable it in Admin Portal → Plugins.`,
        };
      }
      if (state.kind === "missing") {
        return {
          ok: false,
          reason: "missing",
          message: `The approved version of ${plugin.name} (${state.approval.version}) is no longer on the plugin host. An administrator must review it in Admin Portal → Plugins.`,
        };
      }
      if (state.kind === "changed") {
        return {
          ok: false,
          reason: "changed",
          message: `${plugin.name} ${state.approval.version} changed on the plugin host after it was approved, so it is blocked until an administrator reviews it.`,
        };
      }
      if (!(await options.entitlements.hasAccess(plugin.id))) {
        return {
          ok: false,
          reason: "no-access",
          message: `You don't have access to ${plugin.name}.`,
        };
      }
      // An update waiting for review does not interrupt anyone: the approved version runs.
      const version = state.approval.version;
      return {
        ok: true,
        version,
        url: resolvePluginUrl(plugin, { ...resolveOptions, version }),
      };
    },
    openPlugin: (id) => options.open(id),
    refresh: () => {
      registry = null;
    },
  };
}
