import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { apiClient } from "~/api/api";
import { getApiSources } from "~/api/auth.api";
import { saveDashboards, saveDashboardsOnExit } from "~/api/dashboard.api";
import { usePluginRegistrySync } from "~/hooks/usePlugins";
import { useCreateRef } from "~/hooks/useRefHooks";
import { useShallowAccessStore } from "~/lib/state/access";
import { useAppStore, useShallowAppStore } from "~/lib/state/app";
import { useAuthStore, useShallowAuthStore } from "~/lib/state/auth";
import {
  useBackendConnectorStore,
  useShallowBackendConnectorStore,
} from "~/lib/state/backendConnector";
import { useShallowCopilotStore } from "~/lib/state/copilot";
import { useCopilotAccessStore } from "~/lib/state/copilotAccess";
import { useCopilotDataStore } from "~/lib/state/copilotData";
import { useShallowEntityThemeStore } from "~/lib/state/entityTheme";
import { useShallowMcpToolsStore } from "~/lib/state/mcpTools";
import { useSharedAppStore } from "~/lib/state/sharedApp";
import { useShallowSkillsLibraryStore } from "~/lib/state/skillsLibrary";
import { useShallowThemeStore } from "~/lib/state/theme";
import { useShallowUserAppsStore } from "~/lib/state/userApps";
import { dispatchSaveState } from "~/lib/utils";
import type { DashSyncT } from "~/types/auth.type";
import { useGetAppWidgets } from "../AI/hooks/useGetAppWidgets";

export default function useSyncItems() {
  const { pathname } = useLocation();
  useGetAppWidgets();
  usePluginRegistrySync();

  const user = useShallowAuthStore((state) => state.user);
  const updateThemeSettings = useShallowEntityThemeStore(
    (state) => state.updateThemeSettings,
  );
  const updateUserApps = useShallowUserAppsStore((state) => state.updateUserApps);

  const updateRemoteItems = useShallowAppStore((state) => state.updateRemoteItems);
  const updateChats = useShallowCopilotStore((state) => state.updateChats);
  const { updateApiSources, updateBackendConnector } = useShallowBackendConnectorStore(
    (state) => ({
      updateApiSources: state.updateApiSources,
      updateBackendConnector: state.updateBackendConnector,
    }),
  );
  const updateOnlySharedItems = useSharedAppStore(
    (state) => state.updateOnlySharedItems,
  );
  const setAccessAndUsage = useShallowAccessStore((state) => state.setAccessAndUsage);
  const updateThemeState = useShallowThemeStore((state) => state.updateThemeState);
  const updateMCPServers = useShallowMcpToolsStore((state) => state.updateServers);
  const updateUserSkills = useShallowSkillsLibraryStore((state) => state.updateSkills);

  const items = useShallowAppStore((state) => state.items);
  const itemsRef = useCreateRef(items);

  const { refetch: refetchApiSources } = useQuery({
    queryKey: ["apiSources"],
    queryFn: async () => getApiSources().then(updateApiSources),
    enabled: false,
    staleTime: Number.POSITIVE_INFINITY,
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });

  const { mutateAsync: getDashboards } = useMutation<DashSyncT>({
    mutationFn: async () => {
      const { data } = await apiClient
        .get("/app/dash/validate-and-sync")
        .catch((error) => {
          if (error?.response?.status === 401) {
            useAuthStore.getState().logout();
          }
          throw error;
        });
      return data;
    },

    onSuccess: (dashboardsData) => {
      queueMicrotask(async () => {
        const data = dashboardsData;
        if (data.access) {
          setAccessAndUsage(data.access, data.usage ?? null);
        }

        updateChats(data.copilot_chats, { questionsHistory: data.questions_history });
        updateRemoteItems(data.owned);
        updateOnlySharedItems({
          shared: data.shared ?? {},
          entityShared: data.entity_shared ?? {},
        });

        if (data.entity_theme_settings) updateThemeSettings(data.entity_theme_settings);

        updateThemeState(data.display_settings || {});
        updateBackendConnector({
          storedFiles: data.file_widgets || [],
          widgetMetadata: data.widget_metadata || [],
        });
        updateMCPServers(data.mcp_servers ?? []);
        useCopilotAccessStore.getState().setAccess(data.copilot_access);
        updateUserApps(data.user_apps || {}, true);
        updateUserSkills(data.user_skills || []);
        refetchApiSources();
      });
    },

    onError: (error) => {
      console.error("Failed to refetch dashboards:", error);
      useBackendConnectorStore.setState({ isLoadingBackends: false });
    },
  });

  useEffect(() => {
    if (user && !itemsRef?.current) {
      getDashboards();
    }
  }, [user, items, itemsRef]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") saveDashboardsOnExit();
    };
    window.addEventListener("pagehide", saveDashboardsOnExit);
    document.addEventListener("visibilitychange", onVisibility);
    const unsubscribeItems = useAppStore.subscribe(
      (state) => state.items,
      () => useAppStore.getState().debounceSaveDashboards(),
    );

    const debouncedSaveInt = setInterval(() => saveDashboards(), 1000 * 60 * 1);
    const clearInt = setInterval(() => dispatchSaveState(), 1000 * 30);

    return () => {
      window.removeEventListener("pagehide", saveDashboardsOnExit);
      document.removeEventListener("visibilitychange", onVisibility);
      unsubscribeItems();
      clearInterval(debouncedSaveInt);
      clearInterval(clearInt);
      dispatchSaveState();

      useCopilotDataStore.getState().clearState();

      saveDashboards();

      if (user && !itemsRef?.current) {
        getDashboards();
      }
    };
  }, [pathname, itemsRef]);
}
