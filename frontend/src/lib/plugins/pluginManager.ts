/**
 * Plugin Manager: the one place that knows how to load the registry, look up a plugin,
 * check its status and entitlement, and build its runtime URL
 * (plugin host + registry route + theme and settings). UI code goes through it.
 */
import type { EntitlementService } from "./entitlements";
import { parsePluginHost, REGISTRY_PATH } from "./pluginHost";
import {
  fetchRegistry,
  type ParsedRegistry,
  type PluginMetadata,
  type PluginSettingValues,
} from "./registry";

export type PluginAvailability =
  | { ok: true; url: string }
  | { ok: false; reason: "unknown" | "inactive" | "no-access"; message: string };

export interface ResolveOptions {
  /** Passed to the plugin as ?theme= so it matches the Workspace theme. */
  theme?: "light" | "dark";
  /**
   * Values for the plugin's declared settings, passed as query parameters. Keys the
   * registry does not declare and empty values are dropped; the plugin validates the rest.
   */
  settings?: PluginSettingValues;
}

export interface PluginManager {
  /** The validated plugin host, or why it can't be used. */
  readonly host: ReturnType<typeof parsePluginHost>;
  getPlugins(): Promise<PluginMetadata[]>;
  /** Registry problems from the last load (entries that were skipped). */
  getRegistryErrors(): Promise<string[]>;
  getPlugin(id: string): Promise<PluginMetadata | undefined>;
  resolvePluginUrl(plugin: PluginMetadata, options?: ResolveOptions): string;
  /** Checks status and entitlement, then returns the runtime URL. */
  checkAvailability(id: string, options?: ResolveOptions): Promise<PluginAvailability>;
  openPlugin(id: string): void;
  /** Drops the cached registry so the next call fetches it again. */
  refresh(): void;
}

export interface PluginManagerOptions {
  pluginHostUrl: string | undefined;
  entitlements: EntitlementService;
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
    for (const setting of plugin.settings ?? []) {
      const value = resolveOptions.settings?.[setting.key]?.trim();
      if (value) url.searchParams.set(setting.key, value);
    }
    return url.toString();
  };

  const getPlugin = async (id: string) =>
    (await loadRegistry()).plugins.find((plugin) => plugin.id === id);

  return {
    host,
    getPlugins: async () => (await loadRegistry()).plugins,
    getRegistryErrors: async () => (await loadRegistry()).errors,
    getPlugin,
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
