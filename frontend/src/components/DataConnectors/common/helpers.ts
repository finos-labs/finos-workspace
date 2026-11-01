import cloneDeep from "lodash/cloneDeep";
import isEqual from "lodash.isequal";
import { v4 as uuidv4 } from "uuid";
import type { ParamDef, WidgetT } from "~/components/types";
import { useAppStore, type Widget } from "~/lib/state/app";
import type { Source } from "~/lib/state/backendConnector";
import { useCopilotStore } from "~/lib/state/copilot";
import { isBuiltInVizType, isWellFormedVizType } from "~/lib/types/app";
import {
  createParamDefs,
  createURLString,
  createWidgetEndpoint,
  createWidgetInitParams,
  dispatchSaveState,
  dispatchUpdateWidget,
  generateRandomName,
} from "~/lib/utils";
import { streamEndpointOf } from "~/lib/utils/widgetParams";
import type { WidgetsType } from "~/utils/zodForms";

export function listToSortedSet(list: string[]): string[] {
  return [...new Set(list)].sort();
}

export function addNewDataConnector(
  setPendingNavigation: (value: string | null) => void,
  widgetToAdd: Partial<Omit<Widget, "endpoint" | "endpointHeaders">>,
) {
  const id = uuidv4();
  useAppStore.getState().addTab({
    index: id,
    data: {
      name: generateRandomName(),
      type: "custom",
      groups: [],
      widgets: [
        {
          ...widgetToAdd,
          id: uuidv4(),
          innerTab: "",
          external: true,
        } as Widget,
      ],
    },
  });
  setPendingNavigation(`/app/${id}`);
}

export function addMultipleNewDataConnector(
  setPendingNavigation: (value: string | null) => void,
  widgetsToAdd: Partial<Omit<Widget, "endpoint">>[],
) {
  const id = uuidv4();
  useAppStore.getState().addTab({
    index: id,
    data: {
      name: generateRandomName(),
      type: "custom",
      groups: [],
      widgets: widgetsToAdd.map(
        (widget) =>
          ({
            ...widget,
            id: uuidv4(),
            innerTab: "",
            external: true,
            name: Array.isArray(widget.name) ? widget.name.join(" ") : widget.name,
          }) as Widget,
      ),
    },
  });
  setPendingNavigation(`/app/${id}`);
}

export function createSourceWidget(
  widget: WidgetsType[string],
  source: Source,
  withAccess = true,
): WidgetT {
  const params = createParamDefs(widget, source.url);
  const groupById = params?.find((p) => p?.type === "endpoint")?.groupById;

  const endpoint =
    typeof widget.endpoint === "string"
      ? {
          url: createURLString(widget.endpoint, source.url),
          method: widget.method ?? "GET",
        }
      : widget.endpoint;

  const streamEndpoint = streamEndpointOf(widget.data, source.url);
  const newWidget = {
    ...widget,
    groupById,
    id: uuidv4(),
    type: widget.type,
    endpoint,
    ...(streamEndpoint ? { data: { ...widget.data, streamEndpoint } } : {}),
    params,
    external: true,
    sourceId: source.id,
    sourceName: source.name,
    connectionType: "advanced-backend",
  } as WidgetT;

  if (source.isSharedSource) {
    newWidget.isSharedWidget = true;
    newWidget.sourceName = `shared-${source.name}`;
    if (!withAccess) {
      newWidget.endpoint = { url: "", method: "GET" };
      newWidget.disabled = true;
    }
  }

  return newWidget;
}

export function getSourceWidgetsToAdd(widgets: WidgetsType, source: Source): WidgetT[] {
  return Object.keys(widgets).map((widgetId) => {
    const widget = cloneDeep({ ...widgets[widgetId], widgetId });
    return createSourceWidget(widget, source);
  });
}

export const CATEGORY_OPTIONS = [
  "Economy",
  "Crypto",
  "Stocks",
  "Fixed Income",
  "Equity",
  "Currency",
  "ETF",
  "Index",
  "Derivatives",
  "Others",
] as const;

export function getCleanedCategory(category: string | null | undefined) {
  const cleanedCategory = CATEGORY_OPTIONS.find(
    (c) => c.toLowerCase() === category?.toLowerCase()?.trim(),
  );
  return cleanedCategory || category || "My Data";
}

const reduceParams = (acc: string[], p: ParamDef) => {
  const show = p.hidden === undefined ? p.show !== false : !p.hidden;
  return show ? acc.concat(p.paramName) : acc;
};

export const getParamsOrder = (
  origParams: ParamDef[] | undefined,
  params: ParamDef[] | undefined,
) => {
  const origParamOrder = (origParams || []).reduce(reduceParams, []);
  const paramOrder = (params || []).reduce(reduceParams, []);

  return isEqual(paramOrder, origParamOrder) ? undefined : origParamOrder;
};

export function updateParamOrder(paramOrder: string[] | undefined, params: ParamDef[]) {
  if (!paramOrder) return params;
  return params
    .map((p) => {
      const show = paramOrder?.includes(p.paramName);
      const hidden = !show;
      return { ...p, show, hidden };
    })
    .sort((a, b) => {
      const indexA = paramOrder?.indexOf(a.paramName);
      const indexB = paramOrder?.indexOf(b.paramName);
      if (indexA === -1 && indexB === -1) return 0;
      if (indexA === -1) return 1;
      if (indexB === -1) return -1;
      return indexA - indexB;
    });
}

export function updateWidgetParamOrder(
  params: ParamDef[],
  origParams: ParamDef[] | undefined,
) {
  const paramOrder = getParamsOrder(origParams, params);
  if (!paramOrder) return params;

  return updateParamOrder(paramOrder, params);
}

export function updateWidgetEndpoints(
  source: Partial<Source & { prevName?: string }>,
  activeDashboardId?: string,
  saveState = true,
) {
  const { items, getWidgetsByAttributes, updateWidget } = useAppStore.getState();
  const currentTab = activeDashboardId
    ? items?.[activeDashboardId]?.data?.currentTab
    : undefined;
  const isSharedSource = source?.isSharedSource;
  const sourceName = source.prevName ?? source.name;

  const selectedWidgets = getWidgetsByAttributes({
    sourceId: source.id,
    sourceName,
    ...(isSharedSource && { isSharedWidget: true }),
  });

  if (source.prevName && source.name && source.prevName !== source.name) {
    const updateCitationsOrigin = useCopilotStore.getState().updateCitationsOrigin;
    updateCitationsOrigin(source.prevName, source.name);
  }

  const onUpdatedWidget = (
    dashId: string,
    widget: WidgetT,
    innerTab: string | undefined,
  ) => {
    if (activeDashboardId === dashId && innerTab === currentTab) {
      return dispatchUpdateWidget(widget.id, widget);
    }

    updateWidget(dashId, widget);
  };

  for (const [dashId, widgets] of Object.entries(selectedWidgets)) {
    for (const w of widgets) {
      const widgetId = (w.widgetId ?? "").replace(`${sourceName}-`, "");
      const widgetJson = source.widgets?.[widgetId];
      if (!widgetJson) {
        const { url, method } = createWidgetEndpoint(w.endpoint);
        const updatedWidget = {
          ...w,
          sourceName: source.name,
          endpoint: { url, method },
        };
        onUpdatedWidget(dashId, updatedWidget, w.innerTab);

        continue;
      }

      const params = updateWidgetParamOrder(
        createParamDefs(widgetJson, source.url),
        w?.params,
      );
      const groupById = params?.find((p) => p?.type === "endpoint")?.groupById;

      const { url, method } = createWidgetEndpoint({
        url: createURLString(widgetJson.endpoint, source.url),
        method: widgetJson.method ?? "GET",
      });

      const subCategory = widgetJson.subCategory;
      const dataKey = widgetJson.data?.dataKey ?? w.data?.dataKey;
      const type = isWellFormedVizType(widgetJson.type) ? widgetJson.type : w.type;
      const typeConfig =
        type && !isBuiltInVizType(type)
          ? { [type]: (widgetJson.data as Record<string, unknown> | undefined)?.[type] }
          : {};

      const updatedWidget = {
        ...w,
        name: widgetJson.name ?? w.name,
        description: widgetJson.description ?? "",
        groupById,
        type,
        sourceName: source.name,
        category: widgetJson.category ?? "",
        subCategory,
        params,
        runButton: widgetJson.runButton,
        data: {
          ...(w.data ?? {}),
          dataKey,
          rawDataKey: widgetJson.data?.rawDataKey,
          rawType: widgetJson.data?.rawType,
          streamEndpoint: streamEndpointOf(widgetJson.data, source.url),
          ...typeConfig,
        },
        endpoint: { url, method },
        staleTime: widgetJson.staleTime ?? w.staleTime,
        refetchInterval: widgetJson.refetchInterval ?? w.refetchInterval,
        dataUpdateDisplay: widgetJson.dataUpdateDisplay ?? w.dataUpdateDisplay,
        refreshQuery: Date.now(),
        showTitle: widgetJson.showTitle !== false,
        exportable: widgetJson.exportable !== false,
        disableRetrievalForCopilot: widgetJson.disableRetrievalForCopilot,
      } as WidgetT;

      if (updatedWidget.raw !== widgetJson.raw) {
        updatedWidget.raw = widgetJson.raw;
      }

      if (isSharedSource) updatedWidget.isSharedWidget = true;

      const initialParams = createWidgetInitParams(updatedWidget);
      updatedWidget.storage = { ...updatedWidget.storage, params: initialParams };

      onUpdatedWidget(dashId, updatedWidget, w.innerTab);
    }
  }

  if (activeDashboardId && saveState) dispatchSaveState();
}

export function deleteSourceWidgets(source: Source) {
  const { getWidgetsByAttributes, updateWidget } = useAppStore.getState();

  if (!source) return;

  const selectedWidgets = getWidgetsByAttributes({
    sourceId: source.id,
    sourceName: source.name,
    ...(source.isSharedSource && { isSharedWidget: true }),
  });

  for (const [dashId, widgets] of Object.entries(selectedWidgets)) {
    for (const widget of widgets) {
      updateWidget(dashId, {
        ...widget,
        endpoint: { url: "", method: "GET" },
      });
    }
  }
}
