import cloneDeep from "lodash/cloneDeep";
import isEqual from "lodash.isequal";
import { useEffect, useMemo } from "react";
import { subscribeWithSelector } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";
import { shallow } from "zustand/shallow";
import { createWithEqualityFn } from "zustand/traditional";
import { getCleanedCategory } from "~/components/DataConnectors/common/helpers";
import useSharedResources from "~/components/LayoutAuth/Search/hooks/useSharedResources";
import type { WidgetJsonT, WidgetT } from "~/components/types";
import type { WidgetId } from "~/components/Widgets";
import { getFileWidgetType } from "~/lib/constants";
import type { Selector } from "~/lib/state/app";
import {
  type Source,
  type StoredFile,
  useShallowBackendConnectorStore,
  type WidgetMetadataItem,
} from "~/lib/state/backendConnector";
import { isExcludedWidgetId } from "~/lib/state/featureFlags";
import { type UserGeneratedApp, useShallowUserAppsStore } from "~/lib/state/userApps";
import {
  WIDGETS_WITHOUT_DISABLED as API_WIDGETS,
  convertAdvancedBackend,
  getJsonWidget,
} from "~/lib/utils";

export function useGetAppWidgets() {
  const { storedFiles, apiSources, widgetMetadata } = useShallowBackendConnectorStore(
    (s) => ({
      storedFiles: s.storedFiles,
      apiSources: s.apiSources,
      widgetMetadata: s.widgetMetadata,
    }),
  );

  const setBackendNameToWidgetMap = useShallowAppWidgetsStore((s) => s.setAppWidgets);

  const customBackendWidgets = useMemo(
    () => apiSourcesToWidgets(apiSources),
    [apiSources],
  );

  const sharedUserApps = useShallowUserAppsStore((s) => s.getAllSharedUserApps());

  const sharedUserAppWidgets = useMemo(
    () => userAppsToWidgets(sharedUserApps),
    [sharedUserApps],
  );

  const builtInJsonWidgets = useMemo(
    () => jsonWidgetsToWidgets(API_WIDGETS),
    [API_WIDGETS],
  ); // the built-in widgets from widgets.json: iframe, navigation_bar

  const hubWidgets = useMemo(() => storedFilesToWidgets(storedFiles), [storedFiles]); // images, pdfs, etc

  const workspaceWidgets = useMemo(
    () => widgetMetadataToWidgets(widgetMetadata),
    [widgetMetadata],
  ); // includes copilot artifacts

  const sharedWidgets = useSharedResources();

  const backendNameToWidgetMap = useMemo(() => {
    const map = new Map<BackendName, Map<string, WidgetT>>();

    function addWidgets(backendName: BackendName, widgets: WidgetT[]) {
      const widgetMap = widgets.reduce((acc, widget) => {
        if (!widget.widgetId) return acc;
        acc.set(widget.widgetId, widget);
        return acc;
      }, new Map<string, WidgetT>());
      map.set(backendName, widgetMap);
    }

    function addWidget(backendName: BackendName, widgetId: string, widget: WidgetT) {
      const widgetMap = map.get(backendName) ?? new Map<string, WidgetT>();
      widgetMap.set(widgetId, widget);
      map.set(backendName, widgetMap);
    }

    addWidgets("the backend", hubWidgets);
    addWidgets("Workspace", [...builtInJsonWidgets, ...workspaceWidgets]);

    // Handle custom backends dynamically
    for (const widget of customBackendWidgets) {
      const backendName = widget.sourceName;
      if (!(backendName && widget.widgetId)) continue;

      addWidget(backendName, widget.widgetId, widget);
    }

    for (const widget of sharedWidgets) {
      const isFileWidget = widget.connectionType === "file";
      const backendName = isFileWidget ? "the backend" : widget.sourceName;
      if (!(backendName && widget.widgetId)) continue;

      addWidget(backendName, widget.widgetId, widget as WidgetT);
    }

    for (const widget of sharedUserAppWidgets) {
      if (!widget.widgetId) continue;
      // Skip if widgetId conflicts with built-in JSON widget
      if (!widget.external && getJsonWidget(widget.widgetId)) continue;
      const connectionMap: Partial<Record<string, string>> = {
        file: "the backend",
        widgetMetadata: "Workspace",
      };

      const backendName =
        connectionMap[widget.type] ||
        (widget.connectionType ? connectionMap[widget.connectionType] : undefined) ||
        widget.sourceName;
      if (!backendName) continue;

      if (map.get(backendName)?.has(widget.widgetId)) {
        if (import.meta.env.DEV)
          console.warn(
            `Widget ID conflict for "${widget.widgetId}" in backend "${backendName}".
            Skipping this widget to avoid overwriting.`,
          );
        continue;
      }
      addWidget(backendName, widget.widgetId, widget);
    }

    return map;
  }, [
    builtInJsonWidgets,
    hubWidgets,
    workspaceWidgets,
    customBackendWidgets,
    sharedUserAppWidgets,
    sharedWidgets,
  ]);

  useEffect(() => {
    setBackendNameToWidgetMap(backendNameToWidgetMap);
  }, [backendNameToWidgetMap]);
}

type BackendTypes = "the backend" | "Workspace" | "Shared App Widgets";

type BackendName<T extends BackendTypes = BackendTypes> = T | (string & {});

type GetWidgetsState = {
  lastUpdated: number;
  backendNameToWidgetMap: Map<BackendName, Map<string, WidgetT>>;
  getAllAppWidgets: () => WidgetT[];
  setAppWidgets: (
    backendNameToWidgetMap: Map<BackendName, Map<string, WidgetT>>,
  ) => void;
  getAppWidget: (widgetId: WidgetId, sourceName?: BackendName) => WidgetT | undefined;
};

export const useGetWidgetsStore = createWithEqualityFn<GetWidgetsState>()(
  subscribeWithSelector((set, get) => ({
    lastUpdated: Date.now(),
    backendNameToWidgetMap: new Map<BackendName, Map<string, WidgetT>>(),
    setAppWidgets: (backendNameToWidgetMap) =>
      set({ backendNameToWidgetMap, lastUpdated: Date.now() }),
    getAppWidget: (widgetId, sourceName) => {
      const map = get().backendNameToWidgetMap;
      if (sourceName)
        return map.get(sourceName)?.get(widgetId.replace(`${sourceName}-`, ""));

      // Search all sources for the widgetId
      for (const sourceMap of map.values()) {
        if (sourceMap.has(widgetId)) {
          return sourceMap.get(widgetId);
        }
      }

      return undefined;
    },
    getAllAppWidgets: () =>
      Array.from(get().backendNameToWidgetMap.values()).flatMap((widgetMap) =>
        Array.from(widgetMap.values()).filter((widget) => !widget.disabled),
      ),
  })),
  shallow,
);

export function useShallowAppWidgetsStore<T>(
  selector: Selector<GetWidgetsState, T>,
): T {
  return useGetWidgetsStore(useShallow(selector), (prev, next) => isEqual(prev, next));
}

function apiSourcesToWidgets(apiSources: Source[]): WidgetT[] {
  const customBackendWidgets = apiSources
    .filter((elem) => elem.id !== "root" && elem.widgets)
    .flatMap((source) => {
      return convertAdvancedBackend(source);
    });
  // TODO: This assertion can be inaccurate, needs fix
  return customBackendWidgets as WidgetT[];
}

function storedFilesToWidgets(storedFiles: StoredFile[]): WidgetT[] {
  const hubWidgets = storedFiles.map((widget) => {
    return {
      ...cloneDeep({ ...widget }),
      type: getFileWidgetType(widget.extension),
      external: true,
      category: widget?.category ?? "My Data",
      subCategory: widget?.subCategory ?? undefined,
      widgetType: "file",
      endpoint: {
        url: widget.url,
        method: "GET",
      },
      widgetId: `file-${widget.id}`,
      description: widget.description,
      connectionType: "file",
      gridData: { w: 20, h: widget.extension === "pdf" ? 20 : 10 },
      extension: widget.extension,
      data: { dataKey: widget?.dataKey },
    };
  });
  // TODO: This assertion can be inaccurate, needs fix
  return hubWidgets as WidgetT[];
}

function jsonWidgetsToWidgets(apiWidgets: WidgetJsonT[]): WidgetT[] {
  const jsonWidgets = apiWidgets
    .filter((widget) => {
      // Check if the widget is not in the except_widgets list
      return !isExcludedWidgetId(widget.widgetId);
    })
    .map((widget) => cloneDeep({ ...widget }));
  // TODO: This assertion can be inaccurate, needs fix
  return jsonWidgets as unknown as WidgetT[];
}

function userAppsToWidgets(userApps: UserGeneratedApp[]): WidgetT[] {
  return userApps.flatMap((app) =>
    app.widgets.map(
      (widget) =>
        ({
          ...cloneDeep({ ...widget }),
          id: undefined, // Clear id to avoid conflicts
          category: getCleanedCategory(widget?.category) || "User Apps",
          sourceName: widget.sourceName || "Shared App Widgets",
          storage: { ...(widget.storage ?? {}), userAppId: app.uuid },
        }) as unknown as WidgetT,
    ),
  );
}

function widgetMetadataToWidgets(widgetMetadata: WidgetMetadataItem[]): WidgetT[] {
  return widgetMetadata.map((widget) => {
    return {
      ...cloneDeep({ ...widget }),
      connectionType: "widgetMetadata",
      type: widget.widgetType,
      widgetId: `${widget.widgetType}-${widget.widgetId}`,
      category: getCleanedCategory(widget?.category),
      subCategory: widget?.subCategory,
      storage: { ...(widget.storage ?? {}) },
    } as WidgetT;
  });
}
