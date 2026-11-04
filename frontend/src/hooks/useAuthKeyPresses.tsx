import { useCallback, useEffect } from "react";
import { useDebouncedCallback } from "use-debounce";
import { saveDashboards } from "~/api/dashboard.api";
import { isCopilotAvailable } from "~/components/AI/hooks/useCopilotAvailable";
import { useDataConnectorContext } from "~/components/DataConnectors/Providers/DataConnectorContext";
import { usePanelsState } from "~/components/LayoutAuth/AppLayout/hooks/usePanelsState";
import { useShallowAppStore } from "~/lib/state/app";
import { useCopilotStore } from "~/lib/state/copilot";
import { useShallowThemeStore } from "~/lib/state/theme";
import { dispatchSaveState } from "~/lib/utils";
import { createTab } from "~/lib/utils/app";

const useAuthKeyPresses = () => {
  const { setOpen } = useDataConnectorContext();
  const themeStore = useShallowThemeStore((state) => ({
    toggleGroupingVisibility: state.toggleGroupingVisibility,
    toggleTheme: state.toggleTheme,
    togglePresenterMode: state.togglePresenterMode,
    toggleShortcutSidebar: state.toggleShortcutSidebar,
    toggleSearch: state.toggleSearch,
    setInitialSelectedSearchTab: state.setInitialSelectedSearchTab,
    setCreateFolderPopup: state.setCreateFolderPopup,
    debouncedUpdateSettings: state.debouncedUpdateSettings,
  }));

  const rightPanelCollapsed = usePanelsState("collapsedRight");

  const addTab = useShallowAppStore((state) => state.addTab);

  const debouncedSave = useDebouncedCallback(saveDashboards, 200, {
    leading: true,
    maxWait: 200,
  });

  const handleKeypress = useCallback(
    async (e: KeyboardEvent) => {
      if (
        e.shiftKey &&
        (e.key === "ArrowRight" ||
          e.key === "ArrowLeft" ||
          e.key === "ArrowUp" ||
          e.key === "ArrowDown")
      ) {
      }
      if (e.keyCode === 27) {
      }

      if ((e.ctrlKey || e.metaKey) && e.keyCode === 71) {
        e.preventDefault();
        themeStore.toggleGroupingVisibility();
      }

      if ((e.ctrlKey || e.metaKey) && e.keyCode === 75) {
        e.preventDefault();
        themeStore.setInitialSelectedSearchTab("widgets");

        themeStore.toggleSearch();
      }

      if ((e.ctrlKey || e.metaKey) && e.keyCode === 76) {
        e.preventDefault();
        if (isCopilotAvailable()) {
          const {
            isFullscreen,
            lastPanelState,
            toggleFullscreen,
            setLastPanelState,
            setIsIntentionallyCollapsed,
          } = useCopilotStore.getState();
          if (isFullscreen) {
            setIsIntentionallyCollapsed(false);
            toggleFullscreen();
            setTimeout(() => {
              if (document.getElementById("expand-copilot-btn")) {
                document.getElementById("expand-copilot-btn")?.click();
              }
            }, 50);
          } else if (rightPanelCollapsed) {
            if (lastPanelState === "fullscreen") {
              toggleFullscreen();
            } else {
              document.getElementById("toggle-copilot-btn")?.click();
            }
            setTimeout(() => {
              document.getElementById("copilot-input")?.focus();
            }, 200);
          } else {
            setLastPanelState("open");
            document.getElementById("toggle-copilot-btn")?.click();
          }
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.keyCode === 85) {
        e.preventDefault();
        if (isCopilotAvailable()) {
          const { isFullscreen, toggleFullscreen, setIsIntentionallyCollapsed } =
            useCopilotStore.getState();

          if (rightPanelCollapsed) {
            setIsIntentionallyCollapsed(false);
            toggleFullscreen();
          } else if (isFullscreen) {
            toggleFullscreen();
            setIsIntentionallyCollapsed(true);
          } else {
            toggleFullscreen();
          }
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.keyCode === 66) {
        e.preventDefault();
        document.getElementById("toggle-left-sidebar-btn")?.click();
      }

      if ((e.ctrlKey || e.metaKey) && e.keyCode === 77) {
        e.preventDefault();
        themeStore.toggleTheme();
        themeStore.debouncedUpdateSettings();
      }

      if ((e.ctrlKey || e.metaKey) && e.keyCode === 70 && e.shiftKey) {
        e.preventDefault();
        themeStore.togglePresenterMode();
      }

      if ((e.ctrlKey || e.metaKey) && e.keyCode === 72) {
        e.preventDefault();
        themeStore.toggleShortcutSidebar();
      }

      if ((e.ctrlKey || e.metaKey) && e.keyCode === 67 && e.shiftKey) {
        e.preventDefault();
        setOpen(true);
      }

      if ((e.ctrlKey || e.metaKey) && e.keyCode === 84 && e.altKey) {
        e.preventDefault();
        createTab(addTab);
      }

      if ((e.ctrlKey || e.metaKey) && e.keyCode === 70 && e.altKey) {
        e.preventDefault();
        themeStore.setCreateFolderPopup(true);
      }

      if ((e.ctrlKey || e.metaKey) && e.keyCode === 83 && e.shiftKey) {
        e.preventDefault();
        dispatchSaveState().then(() => debouncedSave({ withNotification: true }));
      }
    },
    [themeStore, debouncedSave, rightPanelCollapsed],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    document.addEventListener("keydown", handleKeypress, { signal: ctrl.signal });
    return () => ctrl.abort();
  }, [handleKeypress]);
};

export default useAuthKeyPresses;
