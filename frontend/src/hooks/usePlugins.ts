import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { getAvailablePlugins, getWidgetsSchema } from "~/api/plugins.api";
import { useShallowAuthStore } from "~/lib/state/auth";
import { useBackendConnectorStore } from "~/lib/state/backendConnector";
import {
  failWidgetsSchema,
  setDefaultPluginVizTypes,
  setDefaultWidgetsSchema,
} from "~/lib/utils/validateBackend";
import { usePluginRegistryStore } from "~/plugins/registry";

export const pluginKeys = {
  available: (token?: string) => ["widget-plugins", "available", token] as const,
  widgetsSchema: (token?: string) =>
    ["widget-plugins", "widgets-schema", token] as const,
  platform: ["widget-plugins", "platform"] as const,
  detail: (pluginId: string) => ["widget-plugins", "detail", pluginId] as const,
  entity: ["widget-plugins", "entity"] as const,
  events: (pluginId: string, scope: string) =>
    ["widget-plugins", "events", pluginId, scope] as const,
  reports: (pluginId: string, scope: string) =>
    ["widget-plugins", "reports", pluginId, scope] as const,
  role: (roleUuid: string) => ["widget-plugins", "role", roleUuid] as const,
};

const REFRESH = {
  staleTime: 30_000,
  refetchInterval: 60_000,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: true,
} as const;

/**
 * Keeps the plugin registry and the widgets.json schema current: fetched on sign-in, on
 * window focus and every 60 seconds while the page is visible (docs/widget-plugins/
 * DESIGN.md 5, WIDGETS-JSON.md 3.6). A plugin that leaves the listing stops rendering;
 * its widgets stay in their dashboards. When the schema changes (a plugin enabled,
 * revoked or updated for the entity), the connected backends are validated again.
 */
export function usePluginRegistrySync() {
  const token = useShallowAuthStore((state) => state.user?.token);
  const setListing = usePluginRegistryStore((state) => state.setListing);

  const { data } = useQuery({
    queryKey: pluginKeys.available(token),
    queryFn: getAvailablePlugins,
    enabled: !!token,
    retry: 1,
    ...REFRESH,
  });
  const { data: schema, error: schemaError } = useQuery({
    queryKey: pluginKeys.widgetsSchema(token),
    queryFn: getWidgetsSchema,
    enabled: !!token,
    retry: 2,
    ...REFRESH,
  });

  useEffect(() => {
    if (!data) return;
    setListing(data);
    setDefaultPluginVizTypes(Object.keys(data.vizHandlers));
  }, [data, setListing]);

  const schemaId = useRef<string | null>(null);
  useEffect(() => {
    if (!schema) return;
    const previous = schemaId.current;
    schemaId.current = schema.$id;
    setDefaultWidgetsSchema(schema);
    if (previous && previous !== schema.$id) {
      const store = useBackendConnectorStore.getState();
      if (store.apiSources.length) store.updateApiSources(store.apiSources);
    }
  }, [schema]);

  useEffect(() => {
    if (schemaError && !schema)
      failWidgetsSchema(
        schemaError instanceof Error ? schemaError : new Error(String(schemaError)),
      );
  }, [schemaError, schema]);

  useEffect(() => {
    if (token) return;
    usePluginRegistryStore.getState().clear();
    setDefaultPluginVizTypes([]);
    setDefaultWidgetsSchema(undefined);
    schemaId.current = null;
  }, [token]);
}
