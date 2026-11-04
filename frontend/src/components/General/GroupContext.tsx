import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import { forwardRef, type ReactNode, useCallback, useEffect, useMemo } from "react";
import { useLocation, useParams } from "react-router-dom";
import { type ExternalToast, toast } from "sonner";
import { useStateReducer } from "~/hooks/useStateReducer";
import { useAppStore, useShallowAppStore } from "~/lib/state/app";
import {
  type Source,
  useShallowBackendConnectorStore,
} from "~/lib/state/backendConnector";
import { useShallowSharedAppStore } from "~/lib/state/sharedApp";
import { useShallowThemeStore } from "~/lib/state/theme";
import {
  dispatchRefreshQuery,
  dispatchSaveState,
  getJsonWidget,
  isTabPath,
} from "~/lib/utils";
import { formatZodErrorMessage } from "~/utils/zodErrors";
import {
  getSourceWidgetsToAdd,
  updateWidgetEndpoints,
} from "../DataConnectors/common/helpers";
import useFetchSharedResources from "../LayoutAuth/Search/hooks/useFetchSharedResources";
import type { WidgetT } from "../types";

export default function GroupContext(props: { children: ReactNode }) {
  const { children } = props;
  const { pathname } = useLocation();

  const isTab = useMemo(() => isTabPath(pathname), [isTabPath(pathname)]);

  const childrenMemo = useMemo(() => children, [children]);
  const contextMenuContentMemo = useMemo(() => <GroupDropdownContent />, []);

  const groupContextMemo = useMemo(
    () => (
      <ContextMenuPrimitive.Root modal={false}>
        <ContextMenuPrimitive.Trigger asChild={true}>
          {childrenMemo}
        </ContextMenuPrimitive.Trigger>
        <ContextMenuPrimitive.Portal>
          {contextMenuContentMemo}
        </ContextMenuPrimitive.Portal>
      </ContextMenuPrimitive.Root>
    ),
    [childrenMemo, contextMenuContentMemo],
  );

  if (!isTab) return childrenMemo;

  return groupContextMemo;
}

function getBackendSourceWidgets(widgets: WidgetT[]) {
  return widgets
    .filter((widget) => widget.connectionType === "advanced-backend")
    .reduce(
      (acc, widget) => {
        if (!widget.sourceId) return acc;

        if (widget.isSharedWidget) {
          acc.sharedSourceIds.add(widget.sourceId);
          return acc;
        }

        acc.sourceIds.add(widget.sourceId);

        return acc;
      },
      { sharedSourceIds: new Set<string>(), sourceIds: new Set<string>() },
    );
}

const GroupDropdownContent = forwardRef<HTMLDivElement>((_props, _ref) => {
  const { id: activeDashboardId = "" } = useParams();
  const isSharedDashboard = useShallowSharedAppStore(
    (s) => s.getDashboardById(activeDashboardId) !== undefined,
  );
  const { toggleSearch, setInitialSelectedSearchTab } = useShallowThemeStore(
    (state) => ({
      toggleSearch: state.toggleSearch,
      setInitialSelectedSearchTab: state.setInitialSelectedSearchTab,
    }),
  );

  const backendConnector = useShallowBackendConnectorStore((state) => ({
    getApiSourceById: state.getApiSourceById,
    updateApiSource: state.updateApiSource,
  }));

  const sharedResources = useFetchSharedResources();
  const [state, dispatch] = useStateReducer({
    success: false,
    backendSources: [] as Source[],
    sharedBackendSources: [] as Partial<Omit<Source, "templates">>[],
  });

  useEffect(() => {
    const unsub = useAppStore.subscribe(
      (s) =>
        getBackendSourceWidgets(s.getTabById(activeDashboardId)?.data?.widgets ?? []),
      (current) => {
        if (!current) return dispatch({ backendSources: [], sharedBackendSources: [] });

        const { sourceIds, sharedSourceIds } = current;

        const backendSources = Array.from(sourceIds)
          .map((sourceId) => backendConnector.getApiSourceById(sourceId))
          .filter((source): source is Source => Boolean(source));

        const sharedBackendSources = Array.from(sharedSourceIds)
          .map((sourceId) => sharedResources?.backends.find((s) => s.id === sourceId))
          .filter((source): source is NonNullable<typeof source> => Boolean(source))
          ?.map((source) => {
            const transformedBackend = {
              ...source,
              widgets: Object.fromEntries(
                Object.entries(source.widgets ?? {}).map(([id, widget]) => [
                  id,
                  {
                    ...widget,
                    sub_category: widget.subCategory || widget.category || "",
                    widgetType: widget.type || "default",
                  },
                ]),
              ),
            } as Partial<Omit<Source, "templates" | "widgets">>;
            return transformedBackend;
          });

        dispatch({ backendSources, sharedBackendSources });
      },
      { fireImmediately: true },
    );

    return () => unsub();
  }, [activeDashboardId, backendConnector.getApiSourceById, sharedResources]);

  const { addWidgets, hasNavigationBar, updateTabParams, hasRefreshableWidgets } =
    useShallowAppStore((state) => {
      const widgets = state.getTabById(activeDashboardId)?.data?.widgets ?? [];
      const hasNavigationBar =
        widgets?.find((w) => w.widgetId === "navigation_bar") !== undefined;
      const hasRefreshableWidgets =
        widgets?.find((w) => w.widgetId !== "navigation_bar") !== undefined;

      return {
        addWidgets: state.addWidgets,
        updateTabParams: state.updateTabParams,
        hasNavigationBar,
        hasRefreshableWidgets,
      };
    });

  useEffect(() => {
    if (state.success) {
      updateTabParams(activeDashboardId);
      dispatch({ success: false });
    }
  }, [state.success]);

  const handleRefreshBackends = useCallback(async () => {
    await dispatchSaveState();
    let success = false;
    for await (const source of state.backendSources) {
      const currentWidgets = Object.keys(source?.widgets ?? {});
      const { widgets, errorMessage } = await backendConnector.updateApiSource(source);

      if (errorMessage) {
        toast.error(`Error: ${source.name}`, {
          id: `backend-error-${source.id}`,
          description: formatZodErrorMessage(errorMessage),
        });
        continue;
      }

      updateWidgetEndpoints({ ...source, widgets }, activeDashboardId);

      const newWidgets = Object.fromEntries(
        Object.entries(widgets).filter(
          ([widgetId]) => !currentWidgets.includes(widgetId),
        ),
      );

      const widgetsToAdd = getSourceWidgetsToAdd(newWidgets, source);

      const toastOptions = {
        className: "_toast-success",
        duration: 8000,
      } as ExternalToast;

      if (widgetsToAdd.length !== 0 && source?.widgets) {
        toastOptions.description =
          "New widgets detected. Do you want to add them to current dashboard?";
        toastOptions.action = {
          label: "Add Widgets",
          onClick: async () => {
            await addWidgets(activeDashboardId, widgetsToAdd);

            dispatchSaveState();
          },
        };
      }

      toast.success(`Backend updated: ${source.name}`, toastOptions);
      success = true;
    }

    dispatch({ success });
  }, [state.backendSources, activeDashboardId, backendConnector.updateApiSource]);

  const handleAddNavigationBar = useCallback(async () => {
    await dispatchSaveState();
    const navigationBar = getJsonWidget("navigation_bar");
    if (navigationBar) await addWidgets(activeDashboardId, [navigationBar]);
    dispatchSaveState();
  }, [activeDashboardId, addWidgets]);

  const handleOpenWidgetsSearch = useCallback(() => {
    toggleSearch();
    setInitialSelectedSearchTab("widgets");
  }, [toggleSearch, setInitialSelectedSearchTab]);

  return (
    <ContextMenuPrimitive.Content
      style={{
        boxShadow: "0px 4px 8px 0px rgba(0, 0, 0, 0.25)",
      }}
      className="ws-dropdown-container z-9999"
    >
      <ContextMenuPrimitive.Item
        className="truncate flex gap-1 items-center cursor-pointer
            whitespace-nowrap rounded-[2px] p-1 transition-colors
            hover:bg-light-50 dark:hover:bg-dark-600 data-[disabled]:hover:bg-transparent! data-[disabled]:dark:hover:bg-transparent! data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed"
        onSelect={handleOpenWidgetsSearch}
        disabled={isSharedDashboard}
      >
        Add widgets
      </ContextMenuPrimitive.Item>
      <ContextMenuPrimitive.Item
        className="truncate flex gap-1 items-center cursor-pointer
              whitespace-nowrap rounded-[2px] p-1 transition-colors
              hover:bg-light-50 dark:hover:bg-dark-600 data-[disabled]:hover:bg-transparent! data-[disabled]:dark:hover:bg-transparent! data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed"
        onSelect={handleAddNavigationBar}
        disabled={isSharedDashboard || hasNavigationBar}
      >
        Add navigation bar
      </ContextMenuPrimitive.Item>
      <ContextMenuPrimitive.Separator className="my-1 h-px w-full bg-light-200 dark:bg-dark-500" />
      <ContextMenuPrimitive.Item
        className="truncate flex gap-1 items-center cursor-pointer
        whitespace-nowrap rounded-[2px] p-1 transition-colors
        hover:bg-light-50 dark:hover:bg-dark-600 data-[disabled]:hover:bg-transparent! data-[disabled]:dark:hover:bg-transparent! data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed"
        onSelect={() => {
          dispatchRefreshQuery();
        }}
        disabled={!hasRefreshableWidgets}
      >
        Refresh data
      </ContextMenuPrimitive.Item>
      <ContextMenuPrimitive.Item
        className="truncate flex gap-1 items-center cursor-pointer
        whitespace-nowrap rounded-[2px] p-1 transition-colors hover:bg-light-50 dark:hover:bg-dark-600 data-[disabled]:hover:bg-transparent! data-[disabled]:dark:hover:bg-transparent! data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed"
        onSelect={handleRefreshBackends}
        disabled={state.backendSources?.length === 0}
      >
        Refresh backend
      </ContextMenuPrimitive.Item>
    </ContextMenuPrimitive.Content>
  );
});
