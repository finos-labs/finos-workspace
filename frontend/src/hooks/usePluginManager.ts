/**
 * React hooks for plugins. `usePluginManager` builds a Plugin Manager from the runtime
 * config (plugin host URL) and the router; `usePlugins` loads the registry through
 * react-query; `usePluginEnablement` reads and toggles the global enabled state;
 * `useEnabledPluginWidgets` lists the enabled plugins as widgets every dashboard can
 * add; and `usePluginFrameStatus` tells an iframe widget whether its plugin may be shown.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { WidgetJsonT } from "~/components/types";
import {
  allowAllEntitlements,
  createPluginManager,
  isPluginHostUrl,
  localPluginEnablement,
  type PluginManager,
} from "~/lib/plugins";
import { getConfig } from "~/lib/runtimeConfig";

const runtimePath = (pluginId: string) =>
  `/app/plugins/${encodeURIComponent(pluginId)}`;

/** Query keys that depend on whether plugins are enabled; refreshed after a toggle. */
const ENABLEMENT_KEY = ["plugin-enablement"];
const ENABLEMENT_DEPENDENT_KEYS = [
  ENABLEMENT_KEY,
  ["plugin-runtime"],
  ["plugin-frame"],
];

function createWorkspacePluginManager(open: (pluginId: string) => void) {
  return createPluginManager({
    pluginHostUrl: getConfig().urls.pluginHost,
    entitlements: allowAllEntitlements,
    enablement: localPluginEnablement,
    open,
  });
}

/** Plugin Manager wired to Workspace config and routing. */
export function usePluginManager() {
  const navigate = useNavigate();
  return useMemo(
    () => createWorkspacePluginManager((pluginId) => navigate(runtimePath(pluginId))),
    [navigate],
  );
}

/** Plugin Manager for code outside the router (dashboards, widget lists, tests). */
function useRouterFreePluginManager() {
  return useMemo(
    () =>
      createWorkspacePluginManager((pluginId) =>
        window.location.assign(runtimePath(pluginId)),
      ),
    [],
  );
}

/** One registry query per plugin host, shared by every hook that reads the registry. */
function registryQueryOptions(manager: PluginManager) {
  const hostKey = manager.host.ok ? manager.host.baseUrl : null;
  return {
    queryKey: ["plugin-registry", hostKey],
    queryFn: async () => ({
      plugins: await manager.getPlugins(),
      errors: await manager.getRegistryErrors(),
    }),
    enabled: hostKey !== null,
    staleTime: 1000 * 60,
    retry: false,
    refetchOnWindowFocus: false,
  };
}

function enablementQueryOptions(manager: PluginManager) {
  return {
    queryKey: ENABLEMENT_KEY,
    queryFn: () => manager.getEnabledPluginIds(),
    retry: false,
  };
}

/** Registry plugins for the configured host, cached by react-query. */
export function usePlugins() {
  const manager = usePluginManager();
  const query = useQuery(registryQueryOptions(manager));
  return { manager, ...query };
}

/** The global enabled state of every plugin, and a way to change it. */
export function usePluginEnablement(manager: PluginManager) {
  const queryClient = useQueryClient();

  const query = useQuery(enablementQueryOptions(manager));

  const mutation = useMutation({
    mutationFn: ({ pluginId, enabled }: { pluginId: string; enabled: boolean }) =>
      enabled ? manager.enablePlugin(pluginId) : manager.disablePlugin(pluginId),
    onSettled: () =>
      Promise.all(
        ENABLEMENT_DEPENDENT_KEYS.map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      ),
  });

  const enabledIds = useMemo(() => new Set(query.data ?? []), [query.data]);

  return {
    enabledIds,
    isLoading: query.isLoading,
    error: query.error,
    setPluginEnabled: mutation.mutateAsync,
    /** The plugin whose state is being changed, if any. */
    pendingPluginId: mutation.isPending ? mutation.variables?.pluginId : undefined,
  };
}

/** Default size of a plugin widget on a dashboard. */
const PLUGIN_WIDGET_GRID = { w: 40, h: 22, minW: 12, minH: 10 };

/**
 * The enabled plugins as widgets for the dashboard widget library. Enabling a plugin
 * makes it addable on every dashboard; disabling it drops it from the library (and
 * usePluginFrameStatus hides copies already on dashboards). Each is a regular iframe
 * widget whose `iframe-` widgetId maps to the Iframe component.
 */
export function useEnabledPluginWidgets(): WidgetJsonT[] {
  const manager = useRouterFreePluginManager();
  const { data: registry } = useQuery(registryQueryOptions(manager));
  const { data: enabledIds } = useQuery(enablementQueryOptions(manager));

  return useMemo(() => {
    if (!registry || !enabledIds) return [];
    return registry.plugins
      .filter((plugin) => plugin.status === "active" && enabledIds.includes(plugin.id))
      .map(
        (plugin): WidgetJsonT => ({
          widgetId: `iframe-plugin-${plugin.id}`,
          name: plugin.name,
          description: plugin.description,
          type: "custom",
          category: "Plugins",
          subCategory: plugin.category,
          gridData: PLUGIN_WIDGET_GRID,
          // The Iframe widget adds ?theme= itself.
          storage: { html: manager.resolvePluginUrl(plugin) },
        }),
      );
  }, [registry, enabledIds, manager]);
}

export type PluginFrameStatus =
  | { state: "not-plugin" }
  | { state: "checking" }
  | { state: "available" }
  | { state: "unavailable"; message: string };

/**
 * Whether an iframe widget pointing at `url` may show it. URLs outside the plugin
 * host are not plugins and are left alone. A plugin page is shown only while its
 * plugin is registered, active and enabled, so disabling a plugin removes it from
 * every dashboard. Usable outside the router (dashboards, tests).
 */
export function usePluginFrameStatus(url: string): PluginFrameStatus {
  const manager = useRouterFreePluginManager();
  const isPlugin = isPluginHostUrl(url, getConfig().urls.pluginHost);

  const { data, error, isLoading } = useQuery({
    queryKey: ["plugin-frame", manager.host.ok ? manager.host.baseUrl : null, url],
    queryFn: async () => {
      const plugin = await manager.findPluginForUrl(url);
      if (!plugin) {
        return { ok: false as const, message: "This plugin is not registered." };
      }
      return manager.checkAvailability(plugin.id);
    },
    enabled: isPlugin,
    retry: false,
  });

  if (!isPlugin) return { state: "not-plugin" };
  if (isLoading) return { state: "checking" };
  if (error) return { state: "unavailable", message: error.message };
  if (data && !data.ok) return { state: "unavailable", message: data.message };
  return { state: "available" };
}
