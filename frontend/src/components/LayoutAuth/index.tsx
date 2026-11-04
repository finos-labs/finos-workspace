import { type UseQueryOptions, useQueries } from "@tanstack/react-query";
import {
  memo,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import {
  Outlet,
  UNSAFE_useScrollRestoration,
  useLocation,
  useParams,
} from "react-router-dom";
import useAuthKeyPresses from "~/hooks/useAuthKeyPresses";
import { usePrivateRoute } from "~/hooks/usePrivateRoute";
import { MobileProvider, useMobile } from "~/lib/providers/MobileProvider";
import { useShallowAppStore } from "~/lib/state/app";
import { useShallowAuthStore } from "~/lib/state/auth";
import { useShallowBackendConnectorStore } from "~/lib/state/backendConnector";
import { useShallowCopilotStore } from "~/lib/state/copilot";
import { useShallowThemeStore } from "~/lib/state/theme";
import { isTabPath } from "~/lib/utils/utils";
import { FileProvider } from "../DataConnectors/FileProvider";
import { DataConnectorProvider } from "../DataConnectors/Providers/DataConnectorProvider";
import { ResizablePanelGroup } from "../ui/Resizable";
import { MobileCenterPanel } from "./AppLayout/CenterPanel";
import { CombinedCenterRightPanel } from "./AppLayout/CombinedCenterRightPanel";
import { LeftSidePanel, MobileLeftSidePanel } from "./AppLayout/LeftSidePanel";
import { MobileRightSidePanel } from "./AppLayout/RightSidePanel";
import BottomTabBar from "./Mobile/BottomTabBar";
import NoItems from "./NoItems";
import OuterComponents from "./OuterComponents";
import useSyncChats from "./useSyncChats";
import useSyncItems from "./useSyncItems";

function App({ children }: { children?: ReactNode }) {
  return useMemo(
    () => (
      <DataConnectorProvider>
        <MobileProvider>
          <FileProvider>
            <LayoutAuth>{children}</LayoutAuth>
          </FileProvider>
        </MobileProvider>
      </DataConnectorProvider>
    ),
    [children],
  );
}

function useQueuedRefresh() {
  const { id: activeDashboardId } = useParams();
  const { queuedRefreshIds, refreshApiSourceById } = useShallowBackendConnectorStore(
    (state) => ({
      queuedRefreshIds: state.queuedRefreshIds,
      refreshApiSourceById: state.refreshApiSourceById,
    }),
  );

  useQueries({
    queries: (queuedRefreshIds ?? []).map(
      (sourceId) =>
        ({
          queryKey: ["refreshBackend", sourceId],
          queryFn: async () => refreshApiSourceById(sourceId, activeDashboardId),
          staleTime: 1000 * 20,
          gcTime: 1000 * 60,
          enabled: !!sourceId,
        }) as UseQueryOptions<{ success: boolean }>,
    ),
  });
}

function useLayoutHooks() {
  usePrivateRoute(false);
  useAuthKeyPresses();
  UNSAFE_useScrollRestoration();
  useSyncChats();
}

function useLastVisitedPage() {
  const location = useLocation();
  const previousPathRef = useRef<string>("");
  const updateLastVisitedPage = useShallowAuthStore(
    (state) => state.updateLastVisitedPage,
  );
  const updateSettings = useShallowThemeStore((s) => s.debouncedUpdateSettings);
  const hasItems = useShallowAppStore((state) => state.hasItems || !!state.rootItem);
  const { isFullscreen, setIsIntentionallyCollapsed, toggleFullscreen } =
    useShallowCopilotStore((state) => ({
      isFullscreen: state.isFullscreen,
      setIsIntentionallyCollapsed: state.setIsIntentionallyCollapsed,
      toggleFullscreen: state.toggleFullscreen,
    }));

  useEffect(() => {
    if (!hasItems) return;
    const pathname = location.pathname;

    updateLastVisitedPage(pathname);
    updateSettings();

    const currentIsDashboardPage = isTabPath(pathname);
    const previousWasDashboardPage = isTabPath(previousPathRef.current);

    if (
      isFullscreen &&
      previousPathRef.current &&
      previousPathRef.current !== pathname
    ) {
      const shouldClose = !currentIsDashboardPage;

      if (shouldClose) {
        setIsIntentionallyCollapsed(true);
        toggleFullscreen();
      }
    }

    previousPathRef.current = pathname;
  }, [location.pathname, previousPathRef]);

  useLayoutEffect(() => {
    const workarea = document.getElementById("workarea");
    workarea?.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [location.pathname]);
}

function useLoad() {
  useLastVisitedPage();
  useLayoutHooks();
  useSyncItems();
  useQueuedRefresh();
}

type LayoutProps = {
  children?: ReactNode;
};

const LayoutMobile = (props: LayoutProps) => {
  const { children } = props;

  return (
    <div className="flex flex-col bg-surface-page h-dvh" id="app-layout">
      <div className="relative flex-1 overflow-y-auto pb-14">
        <OuterComponents />
        <MobileLeftSidePanel />
        <MobileCenterPanel>{children}</MobileCenterPanel>
        <MobileRightSidePanel />
      </div>
      <BottomTabBar />
    </div>
  );
};

const LayoutDesktop = memo((props: LayoutProps) => {
  const { children } = props;
  const combinedPanelMemo = useMemo(
    () => (
      <CombinedCenterRightPanel key="combined-center-right-panel">
        {children}
      </CombinedCenterRightPanel>
    ),
    [children],
  );

  return useMemo(
    () => (
      <div className="flex bg-surface-page" id="app-layout" key="app-layout">
        <OuterComponents key="outer-components" />
        <ResizablePanelGroup
          key="resizable-panel-group"
          direction="horizontal"
          id="group"
          autoSaveId="persistence-1"
        >
          <LeftSidePanel key="left-panel" />
          {combinedPanelMemo}
        </ResizablePanelGroup>
      </div>
    ),
    [combinedPanelMemo],
  );
});

const LayoutAuthRoot = (props: { children?: ReactNode }) => {
  const { children } = props;
  const isMobile = useMobile((state) => state.isMobile);
  const childrenMemo = useMemo(() => children || <Outlet />, [children]);

  useLoad();

  const hasItems = useShallowAppStore((state) => state.hasItems || !!state.rootItem);
  return useMemo(() => {
    if (!hasItems) return <NoItems />;
    if (isMobile)
      return <LayoutMobile key="layout-mobile">{childrenMemo}</LayoutMobile>;
    return <LayoutDesktop key="layout-desktop">{childrenMemo}</LayoutDesktop>;
  }, [childrenMemo, hasItems, isMobile]);
};

const LayoutAuth = memo(LayoutAuthRoot);

export default memo(App);
