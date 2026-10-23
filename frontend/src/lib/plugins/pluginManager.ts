/**
 * Plugin Manager: the one place that knows how to load the registry and the release
 * index, install a plugin version (a super administrator's approval, global) or
 * uninstall the plugin, enable or disable an installed plugin for the signed-in user's
 * entity (an entity administrator's choice), work out each plugin's release state (up
 * to date, update available, changed on the host...), check whether it can be opened,
 * and build the runtime URL of its approved version (plugin host + registry route +
 * version + theme). UI code goes through it.
 */
import type { PluginApproval, PluginApprovalService } from "./approvals";
import type { EntitlementService } from "./entitlements";
import type { EntityPluginService } from "./entityPlugins";
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
      reason:
        | "unknown"
        | "inactive"
        | "not-installed"
        | "disabled"
        | "missing"
        | "changed"
        | "no-access";
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

export interface AvailabilityOptions extends Omit<ResolveOptions, "version"> {
  /**
   * An administrator previewing an installed plugin: it need not be enabled for their
   * entity yet. Installation, release integrity and entitlement are still checked.
   */
  preview?: boolean;
}

export interface OpenOptions {
  preview?: boolean;
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
  /** Ids of the plugins a super administrator has installed (approved). */
  getInstalledPluginIds(): Promise<string[]>;
  /** Ids of the plugins enabled for the signed-in user's entity (installed or not). */
  getEntityEnabledPluginIds(): Promise<string[]>;
  getReleaseState(id: string): Promise<PluginReleaseState>;
  /**
   * Installs (approves) `version` of a plugin, pinned to the digest the host reports for
   * it now, so entity administrators can enable it. Replaces the plugin's earlier
   * approval; an update keeps the entities that enabled it.
   */
  approveRelease(id: string, version: string): Promise<void>;
  /** Uninstalls a plugin: it is removed from every entity, user and dashboard. */
  uninstallPlugin(id: string): Promise<void>;
  /** Enables an installed plugin for the signed-in user's entity. */
  enableForEntity(id: string): Promise<void>;
  /** Disables a plugin for the signed-in user's entity. */
  disableForEntity(id: string): Promise<void>;
  resolvePluginUrl(plugin: PluginMetadata, options?: ResolveOptions): string;
  /**
   * Checks registry status, installation, release integrity, the entity's enablement
   * and entitlement, then returns the URL.
   */
  checkAvailability(
    id: string,
    options?: AvailabilityOptions,
  ): Promise<PluginAvailability>;
  openPlugin(id: string, options?: OpenOptions): void;
  /** Drops the cached registry so the next call fetches it again. */
  refresh(): void;
}

export interface PluginManagerOptions {
  pluginHostUrl: string | undefined;
  entitlements: EntitlementService;
  approvals: PluginApprovalService;
  entityPlugins: EntityPluginService;
  /** Opens the plugin inside Workspace (e.g. a router navigate). */
  open: (pluginId: string, options?: OpenOptions) => void;
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
    getInstalledPluginIds: async () =>
      (await options.approvals.getApprovals()).map((approval) => approval.pluginId),
    getEntityEnabledPluginIds: () => options.entityPlugins.getEnabledPluginIds(),
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
    // A plugin that left the registry can still be uninstalled, so no lookup here.
    async uninstallPlugin(id) {
      await options.approvals.revoke(id);
      await options.entityPlugins.disableEverywhere(id);
    },
    async enableForEntity(id) {
      const installed = (await options.approvals.getApprovals()).some(
        (approval) => approval.pluginId === id,
      );
      if (!installed) {
        const name = (await getPlugin(id))?.name ?? id;
        throw new Error(
          `${name} is not installed. A super administrator must install it first.`,
        );
      }
      await options.entityPlugins.enable(id);
    },
    disableForEntity: (id) => options.entityPlugins.disable(id),
    resolvePluginUrl,
    async checkAvailability(id, { preview = false, ...resolveOptions } = {}) {
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
          reason: "not-installed",
          message: `${plugin.name} is not installed. A super administrator can install it in Admin Portal → Plugins.`,
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
      if (
        !preview &&
        !(await options.entityPlugins.getEnabledPluginIds()).includes(plugin.id)
      ) {
        return {
          ok: false,
          reason: "disabled",
          message: `${plugin.name} is disabled for your organization. An administrator can enable it in Admin Portal → Plugins.`,
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
    openPlugin: (id, openOptions) => options.open(id, openOptions),
    refresh: () => {
      registry = null;
    },
  };
}
