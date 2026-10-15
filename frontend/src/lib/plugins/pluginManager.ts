/**
 * Plugin Manager: the one place that knows how to load the registry, look up a plugin,
 * enable or disable it (globally), check whether it can be opened, and build its
 * runtime URL (plugin host + registry route + theme). UI code goes through it.
 */
import type { PluginEnablementService } from "./enablement";
import type { EntitlementService } from "./entitlements";
import { parsePluginHost, REGISTRY_PATH } from "./pluginHost";
import { fetchRegistry, type ParsedRegistry, type PluginMetadata } from "./registry";

export type PluginAvailability =
  | { ok: true; url: string }
  | {
      ok: false;
      reason: "unknown" | "inactive" | "disabled" | "no-access";
      message: string;
    };

export interface ResolveOptions {
  /** Passed to the plugin as ?theme= so it matches the Workspace theme. */
  theme?: "light" | "dark";
}

export interface PluginManager {
  /** The validated plugin host, or why it can't be used. */
  readonly host: ReturnType<typeof parsePluginHost>;
  getPlugins(): Promise<PluginMetadata[]>;
  /** Registry problems from the last load (entries that were skipped). */
  getRegistryErrors(): Promise<string[]>;
  getPlugin(id: string): Promise<PluginMetadata | undefined>;
  /** The registered plugin whose page `url` is, e.g. for a dashboard iframe widget. */
  findPluginForUrl(url: string): Promise<PluginMetadata | undefined>;
  /** Ids of the plugins an administrator has enabled for everyone. */
  getEnabledPluginIds(): Promise<string[]>;
  isPluginEnabled(id: string): Promise<boolean>;
  /** Enables a plugin for all users and dashboards. Only active registry plugins can be enabled. */
  enablePlugin(id: string): Promise<void>;
  /** Disables a plugin for all users and dashboards. */
  disablePlugin(id: string): Promise<void>;
  resolvePluginUrl(plugin: PluginMetadata, options?: ResolveOptions): string;
  /** Checks registry status, enablement and entitlement, then returns the runtime URL. */
  checkAvailability(id: string, options?: ResolveOptions): Promise<PluginAvailability>;
  openPlugin(id: string): void;
  /** Drops the cached registry so the next call fetches it again. */
  refresh(): void;
}

export interface PluginManagerOptions {
  pluginHostUrl: string | undefined;
  entitlements: EntitlementService;
  enablement: PluginEnablementService;
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

export function createPluginManager(options: PluginManagerOptions): PluginManager {
  const host = parsePluginHost(options.pluginHostUrl);
  let registry: Promise<ParsedRegistry> | null = null;

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

  const resolvePluginUrl = (
    plugin: PluginMetadata,
    resolveOptions: ResolveOptions = {},
  ) => {
    if (host.ok === false) throw new PluginHostNotConfiguredError(host.message);
    const url = new URL(`${host.baseUrl}${plugin.route}`);
    // Routes are validated by the registry schema; this guards the invariant anyway.
    if (url.origin !== host.origin) {
      throw new Error(`Plugin "${plugin.id}" resolves outside the plugin host.`);
    }
    if (resolveOptions.theme) url.searchParams.set("theme", resolveOptions.theme);
    return url.toString();
  };

  const getPlugin = async (id: string) =>
    (await loadRegistry()).plugins.find((plugin) => plugin.id === id);

  const isPluginEnabled = async (id: string) =>
    (await options.enablement.getEnabledPluginIds()).includes(id);

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
      const path = target.pathname.replace(/\/+$/, "");
      return (await loadRegistry()).plugins.find(
        (plugin) =>
          path ===
          `${new URL(host.baseUrl).pathname.replace(/\/+$/, "")}${plugin.route}`,
      );
    },
    getEnabledPluginIds: () => options.enablement.getEnabledPluginIds(),
    isPluginEnabled,
    async enablePlugin(id) {
      const plugin = await getPlugin(id);
      if (!plugin) throw new Error(`No plugin with id "${id}" is registered.`);
      if (plugin.status !== "active") {
        throw new Error(`${plugin.name} is ${plugin.status} and can't be enabled.`);
      }
      await options.enablement.setPluginEnabled(id, true);
    },
    // A plugin that left the registry can still be disabled, so no lookup here.
    disablePlugin: (id) => options.enablement.setPluginEnabled(id, false),
    resolvePluginUrl,
    async checkAvailability(id, resolveOptions) {
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
      if (!(await isPluginEnabled(plugin.id))) {
        return {
          ok: false,
          reason: "disabled",
          message: `${plugin.name} is disabled. An administrator can enable it in Admin Portal → Plugins.`,
        };
      }
      if (!(await options.entitlements.hasAccess(plugin.id))) {
        return {
          ok: false,
          reason: "no-access",
          message: `You don't have access to ${plugin.name}.`,
        };
      }
      return { ok: true, url: resolvePluginUrl(plugin, resolveOptions) };
    },
    openPlugin: (id) => options.open(id),
    refresh: () => {
      registry = null;
    },
  };
}
