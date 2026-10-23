/**
 * React hooks for plugins. `usePluginManager` builds a Plugin Manager from the runtime
 * config (plugin host URL), the signed-in user's entity and the router; `usePlugins`
 * loads the registry through react-query; `usePluginApprovals` reads each plugin's
 * installed (approved) version, release state and whether it is enabled for the
 * entity, and installs, uninstalls, enables or disables plugins;
 * `useEnabledPluginWidgets` lists the plugins enabled for the entity as widgets its
 * dashboards can add; and `usePluginFrameStatus` tells an iframe widget whether its
 * plugin may be shown, and at which approved version.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { WidgetJsonT } from "~/components/types";
import {
  allowAllEntitlements,
  createLocalEntityPlugins,
  createPluginManager,
  isPluginHostUrl,
  localPluginApprovals,
  type OpenOptions,
  type PluginManager,
  type PluginRelease,
  resolveReleaseState,
} from "~/lib/plugins";
import { getConfig } from "~/lib/runtimeConfig";
import { useAuthStore } from "~/lib/state/auth";

const runtimePath = (pluginId: string, options?: OpenOptions) =>
  `/app/plugins/${encodeURIComponent(pluginId)}${options?.preview ? "?preview=1" : ""}`;

/** Query keys that depend on approvals or enablements; refreshed after any change. */
const APPROVALS_KEY = ["plugin-approvals"];
const ENTITY_PLUGINS_KEY = ["plugin-entity-enablements"];
const APPROVAL_DEPENDENT_KEYS = [
  APPROVALS_KEY,
  ENTITY_PLUGINS_KEY,
  ["plugin-releases"],
  ["plugin-runtime"],
  ["plugin-frame"],
];

/** The signed-in user's entity, which plugin enablements belong to. */
const currentEntity = () => useAuthStore.getState().user?.entity_name;
const localEntityPlugins = createLocalEntityPlugins(currentEntity);

function createWorkspacePluginManager(
  open: (pluginId: string, options?: OpenOptions) => void,
) {
  return createPluginManager({
    pluginHostUrl: getConfig().urls.pluginHost,
    entitlements: allowAllEntitlements,
    approvals: localPluginApprovals,
    entityPlugins: localEntityPlugins,
    open,
  });
}

/** The signed-in user's entity, for query keys. */
export const useCurrentEntity = () =>
  useAuthStore((state) => state.user?.entity_name ?? null);

/** Plugin Manager wired to Workspace config and routing. */
export function usePluginManager() {
  const navigate = useNavigate();
  return useMemo(
    () =>
      createWorkspacePluginManager((pluginId, options) =>
        navigate(runtimePath(pluginId, options)),
      ),
    [navigate],
  );
}

/** Plugin Manager for code outside the router (dashboards, widget lists, tests). */
function useRouterFreePluginManager() {
  return useMemo(
    () =>
      createWorkspacePluginManager((pluginId, options) =>
        window.location.assign(runtimePath(pluginId, options)),
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

/** Keyed by entity, so switching accounts never shows another entity's choices. */
function entityPluginsQueryOptions(manager: PluginManager, entity: string | null) {
  return {
    queryKey: [...ENTITY_PLUGINS_KEY, entity],
    queryFn: () => manager.getEntityEnabledPluginIds(),
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
 * Each plugin's installation and release state (approved version, update available,
 * changed on the host...) and whether it is enabled for the signed-in user's entity,
 * with the actions that change them. Installations are global; enablements belong to
 * the entity.
 */
export function usePluginApprovals(manager: PluginManager) {
  const queryClient = useQueryClient();
  const entity = useCurrentEntity();
  const approvals = useQuery(approvalsQueryOptions(manager));
  const releases = useQuery(releasesQueryOptions(manager));
  const enabled = useQuery(entityPluginsQueryOptions(manager, entity));

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
  const uninstall = useMutation({
    mutationFn: ({ pluginId }: { pluginId: string }) =>
      manager.uninstallPlugin(pluginId),
    onSettled: invalidate,
  });
  const enable = useMutation({
    mutationFn: ({ pluginId }: { pluginId: string }) =>
      manager.enableForEntity(pluginId),
    onSettled: invalidate,
  });
  const disable = useMutation({
    mutationFn: ({ pluginId }: { pluginId: string }) =>
      manager.disableForEntity(pluginId),
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

  const isInstalled = useCallback(
    (pluginId: string) =>
      approvals.data?.some((approval) => approval.pluginId === pluginId) ?? false,
    [approvals.data],
  );
  const isEnabledForEntity = useCallback(
    (pluginId: string) => enabled.data?.includes(pluginId) ?? false,
    [enabled.data],
  );

  const pending = [approve, uninstall, enable, disable].find(
    (mutation) => mutation.isPending,
  );

  return {
    stateFor,
    isInstalled,
    isEnabledForEntity,
    isLoading: approvals.isLoading || releases.isLoading || enabled.isLoading,
    error: approvals.error ?? releases.error ?? enabled.error,
    /** Installs a version, or approves an update to an installed plugin. */
    approveRelease: approve.mutateAsync,
    uninstallPlugin: uninstall.mutateAsync,
    enableForEntity: enable.mutateAsync,
    disableForEntity: disable.mutateAsync,
    /** The plugin whose installation or enablement is being changed, if any. */
    pendingPluginId: pending?.variables?.pluginId,
  };
}

/** Default size of a plugin widget on a dashboard. */
const PLUGIN_WIDGET_GRID = { w: 40, h: 22, minW: 12, minH: 10 };

/**
 * The installed plugins enabled for the signed-in user's entity, as widgets for the
 * dashboard widget library. Enabling a plugin makes it addable on every dashboard of the
 * entity; disabling or uninstalling it drops it from the library (and
 * usePluginFrameStatus hides copies already on dashboards). Each is a regular iframe
 * widget whose `iframe-` widgetId maps to the Iframe component.
 */
export function useEnabledPluginWidgets(): WidgetJsonT[] {
  const manager = useRouterFreePluginManager();
  const entity = useCurrentEntity();
  const { data: registry } = useQuery(registryQueryOptions(manager));
  const { data: approvals } = useQuery(approvalsQueryOptions(manager));
  const { data: enabled } = useQuery(entityPluginsQueryOptions(manager, entity));

  return useMemo(() => {
    if (!registry || !approvals || !enabled) return [];
    const installedIds = approvals.map((approval) => approval.pluginId);
    return registry.plugins
      .filter(
        (plugin) =>
          plugin.status === "active" &&
          installedIds.includes(plugin.id) &&
          enabled.includes(plugin.id),
      )
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
  }, [registry, approvals, enabled, manager]);
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
 * plugin is registered, active, installed and enabled for the user's entity, and only
 * at its approved version whose release still matches what was approved; so disabling
 * or uninstalling a plugin removes it from dashboards, and a changed release is
 * blocked. Usable outside the router.
 */
export function usePluginFrameStatus(url: string): PluginFrameStatus {
  const manager = useRouterFreePluginManager();
  const entity = useCurrentEntity();
  const isPlugin = isPluginHostUrl(url, getConfig().urls.pluginHost);

  const { data, error, isLoading } = useQuery({
    queryKey: [
      "plugin-frame",
      manager.host.ok ? manager.host.baseUrl : null,
      entity,
      url,
    ],
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
