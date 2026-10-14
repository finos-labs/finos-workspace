import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { apiClient } from "~/api/api";
import { getApiSources } from "~/api/auth.api";
import { saveDashboards, saveDashboardsOnExit } from "~/api/dashboard.api";
import { usePluginRegistrySync } from "~/hooks/usePlugins";
import { useCreateRef } from "~/hooks/useRefHooks";
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
import { useShallowFeatureFlagsStore } from "~/lib/state/featureFlags";
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
  useGetAppWidgets(); // Initialize the app widgets store
  usePluginRegistrySync(); // The widget plugins this user may use

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
  const setFeatureFlagsAndUsage = useShallowFeatureFlagsStore(
    (state) => state.setFeatureFlagsAndUsage,
  );
  const updateThemeState = useShallowThemeStore((state) => state.updateThemeState);
  const updateMCPServers = useShallowMcpToolsStore((state) => state.updateServers);
  const updateUserSkills = useShallowSkillsLibraryStore((state) => state.updateSkills);

  const items = useShallowAppStore((state) => state.items);
  const itemsRef = useCreateRef(items);

  const { refetch: refetchApiSources } = useQuery({
    queryKey: ["apiSources"],
    queryFn: async () => getApiSources().then(updateApiSources),
    enabled: false, // Only fetch when needed
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
            // If the user is unauthorized, log them out
            useAuthStore.getState().logout();
          }
          throw error;
        });
      return data;
    },

    onSuccess: (dashboardsData) => {
      queueMicrotask(async () => {
        const data = dashboardsData;
        if (data.feature_entitlements) {
          setFeatureFlagsAndUsage(data.feature_entitlements, data.usage ?? null);
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
        if (pathname === "/app") return;

        refetchApiSources();
      });
    },

    onError: (error) => {
      console.error("Failed to refetch dashboards:", error);
      useBackendConnectorStore.setState({ isLoadingBackends: false });
    },
  });

  useEffect(() => {
    // Check if the user is logged in and items are null
    if (user && !itemsRef?.current) {
      getDashboards();
    }
  }, [user, items, itemsRef]);

  useEffect(() => {
    // Saved as the page is hidden or goes away, with a request that outlives it: one made in
    // beforeunload is cancelled in WebKit, and a change of the last minute was lost
    const onVisibility = () => {
      if (document.visibilityState === "hidden") saveDashboardsOnExit();
    };
    window.addEventListener("pagehide", saveDashboardsOnExit);
    document.addEventListener("visibilitychange", onVisibility);
    // And two seconds after any change, so little waits for the page to go away
    const unsubscribeItems = useAppStore.subscribe(
      (state) => state.items,
      () => useAppStore.getState().debounceSaveDashboards(),
    );

    const debouncedSaveInt = setInterval(() => saveDashboards(), 1000 * 60 * 1); // Save every minute
    const clearInt = setInterval(() => dispatchSaveState(), 1000 * 30); // Save every 30 seconds

    return () => {
      window.removeEventListener("pagehide", saveDashboardsOnExit);
      document.removeEventListener("visibilitychange", onVisibility);
      unsubscribeItems();
      // Cleanup function: cancel the debounced call and immediately save changes
      clearInterval(debouncedSaveInt);
      clearInterval(clearInt);
      dispatchSaveState(); // Ensure all local widget changes are pushed to the store

      // Clear the selected widgets
      useCopilotDataStore.getState().clearState();

      saveDashboards(); // Save immediately when the component unmounts or before re-running the effect

      // Makes sure the user is logged in and items aren't null before refetching
      if (user && !itemsRef?.current) {
        getDashboards();
      }
    };
  }, [pathname, itemsRef]);
}
