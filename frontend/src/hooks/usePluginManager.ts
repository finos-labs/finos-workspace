/**
 * React hooks for plugins. `usePluginManager` builds a Plugin Manager from the runtime
 * config (plugin host URL) and the router; `usePlugins` loads the registry through
 * react-query; `usePluginApprovals` reads each plugin's approved version and release
 * state and approves or disables plugins; `useEnabledPluginWidgets` lists the enabled
 * plugins as widgets every dashboard can add; and `usePluginFrameStatus` tells an iframe
 * widget whether its plugin may be shown, and at which approved version.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { WidgetJsonT } from "~/components/types";
import {
  allowAllEntitlements,
  createPluginManager,
  isPluginHostUrl,
  localPluginApprovals,
  type PluginManager,
  type PluginRelease,
  resolveReleaseState,
} from "~/lib/plugins";
import { getConfig } from "~/lib/runtimeConfig";

const runtimePath = (pluginId: string) =>
  `/app/plugins/${encodeURIComponent(pluginId)}`;

/** Query keys that depend on approvals; refreshed after an approve or disable. */
const APPROVALS_KEY = ["plugin-approvals"];
const APPROVAL_DEPENDENT_KEYS = [
  APPROVALS_KEY,
  ["plugin-releases"],
  ["plugin-runtime"],
  ["plugin-frame"],
];

function createWorkspacePluginManager(open: (pluginId: string) => void) {
  return createPluginManager({
    pluginHostUrl: getConfig().urls.pluginHost,
    entitlements: allowAllEntitlements,
    approvals: localPluginApprovals,
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

function approvalsQueryOptions(manager: PluginManager) {
  return {
    queryKey: APPROVALS_KEY,
    queryFn: () => manager.getApprovals(),
    retry: false,
  };
}

function releasesQueryOptions(manager: PluginManager) {
  const hostKey = manager.host.ok ? manager.host.baseUrl : null;
  return {
    queryKey: ["plugin-releases", hostKey],
    queryFn: () => manager.getReleases(),
    enabled: hostKey !== null,
    retry: false,
  };
}

/** Registry plugins for the configured host, cached by react-query. */
export function usePlugins() {
  const manager = usePluginManager();
  const query = useQuery(registryQueryOptions(manager));
  return { manager, ...query };
}

/**
 * Each plugin's approval and release state (approved version, update available, changed
 * on the host...), and the actions that change it. Approvals are global.
 */
export function usePluginApprovals(manager: PluginManager) {
  const queryClient = useQueryClient();
  const approvals = useQuery(approvalsQueryOptions(manager));
  const releases = useQuery(releasesQueryOptions(manager));

  const invalidate = () =>
    Promise.all(
      APPROVAL_DEPENDENT_KEYS.map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ),
    );

  const approve = useMutation({
    mutationFn: ({ pluginId, version }: { pluginId: string; version: string }) =>
      manager.approveRelease(pluginId, version),
    onSettled: invalidate,
  });
  const disable = useMutation({
    mutationFn: ({ pluginId }: { pluginId: string }) => manager.disablePlugin(pluginId),
    onSettled: invalidate,
  });

  const releasesById = useMemo(() => {
    const map = new Map<string, PluginRelease[]>();
    for (const release of releases.data ?? []) {
      map.set(release.id, [...(map.get(release.id) ?? []), release]);
    }
    return map;
  }, [releases.data]);

  const stateFor = useCallback(
    (pluginId: string) =>
      resolveReleaseState(
        approvals.data?.find((approval) => approval.pluginId === pluginId),
        releasesById.get(pluginId) ?? [],
      ),
    [approvals.data, releasesById],
  );

  return {
    stateFor,
    isLoading: approvals.isLoading || releases.isLoading,
    error: approvals.error ?? releases.error,
    approveRelease: approve.mutateAsync,
    disablePlugin: disable.mutateAsync,
    /** The plugin whose approval is being changed, if any. */
    pendingPluginId: approve.isPending
      ? approve.variables?.pluginId
      : disable.isPending
        ? disable.variables?.pluginId
        : undefined,
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
  const { data: approvals } = useQuery(approvalsQueryOptions(manager));

  return useMemo(() => {
    if (!registry || !approvals) return [];
    const enabledIds = approvals.map((approval) => approval.pluginId);
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
          // The plugin's identity, not a version: the frame loads whichever version is
          // approved when it renders (usePluginFrameStatus). The widget adds ?theme=.
          storage: { html: manager.resolvePluginUrl(plugin) },
        }),
      );
  }, [registry, approvals, manager]);
}

export type PluginFrameStatus =
  | { state: "not-plugin" }
  | { state: "checking" }
  /** `src`: the approved version's URL, with the widget URL's query parameters. */
  | { state: "available"; src: string }
  | { state: "unavailable"; message: string };

/**
 * Whether an iframe widget pointing at `url` may show it. URLs outside the plugin
 * host are not plugins and are left alone. A plugin page is shown only while its
 * plugin is registered, active and approved, and only at its approved version whose
 * release still matches what was approved; so disabling a plugin removes it from every
 * dashboard, and a changed release is blocked. Usable outside the router.
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
  if (!data) return { state: "checking" };
  if (!data.ok) return { state: "unavailable", message: data.message };
  return { state: "available", src: withQueryOf(data.url, url) };
}

/** `target` with the query parameters of `source` added (e.g. the widget's theme). */
function withQueryOf(target: string, source: string) {
  try {
    const result = new URL(target);
    for (const [key, value] of new URL(source).searchParams) {
      result.searchParams.set(key, value);
    }
    return result.toString();
  } catch {
    return target;
  }
}
