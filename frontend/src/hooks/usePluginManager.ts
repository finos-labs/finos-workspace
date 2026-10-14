/**
 * React hooks for plugins. `usePluginManager` builds a Plugin Manager from the runtime
 * config (plugin host URL) and the router; `usePlugins` loads the registry through
 * react-query for components.
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { allowAllEntitlements, createPluginManager } from "~/lib/plugins";
import { getConfig } from "~/lib/runtimeConfig";

/** Plugin Manager wired to Workspace config and routing. */
export function usePluginManager() {
  const navigate = useNavigate();
  return useMemo(
    () =>
      createPluginManager({
        pluginHostUrl: getConfig().urls.pluginHost,
        entitlements: allowAllEntitlements,
        open: (pluginId) => navigate(`/app/plugins/${encodeURIComponent(pluginId)}`),
      }),
    [navigate],
  );
}

/** Registry plugins for the configured host, cached by react-query. */
export function usePlugins() {
  const manager = usePluginManager();
  const hostKey = manager.host.ok ? manager.host.baseUrl : null;

  const query = useQuery({
    queryKey: ["plugin-registry", hostKey],
    queryFn: async () => ({
      plugins: await manager.getPlugins(),
      errors: await manager.getRegistryErrors(),
    }),
    enabled: hostKey !== null,
    staleTime: 1000 * 60,
    retry: false,
    refetchOnWindowFocus: false,
  });

  return { manager, ...query };
}
