import cloneDeep from "lodash/cloneDeep";
import isEqual from "lodash.isequal";
import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";
import type {
  GridData,
  GridLayout,
  GroupTypeT,
  NewWidget,
  ParamDef,
  ParamDefT,
  StoredParamValue,
  Ticker,
  WidgetT as Widget,
  WidgetJsonT,
  WidgetT,
} from "~/components/types";
import { convertToReadableLabel } from "~/lib/utils/format";
import { formatZodIssues } from "~/lib/utils/validateBackend";
import { isTruthy } from "~/lib/utils/values";
import { formatZodErrorMessage } from "~/utils/zodErrors";
import type { AppState, Group, InnerTab, Item, Items } from "../state/app";
import {
  type ConnectionType,
  getSourceCredentials,
  useBackendConnectorStore,
} from "../state/backendConnector";
import { useCopilotDataStore } from "../state/copilotData";
import { DEFAULT_TICKERS } from "../types";
import {
  ExternalWidgetSchema,
  InternalWidgetSchema,
  isWellFormedVizType,
} from "../types/app";
import {
  ensureArray,
  extractUUIDFromURL,
  generateGroupingColor,
  generateRandomName,
} from "./utils";
import { getJsonWidget, getSupportedAssetClasses } from "./widget";
import {
  createParamDefs,
  createWidgetEndpoint,
  createWidgetInitParams,
} from "./widgetParams";
import {
  type BuiltRequest,
  buildOptionsRequest,
  requestInit,
  requestKey,
} from "./widgetRequest";

export function checkIfWidgetsHaveMainTickerAndAreTheSame(widgets: Widget[]) {
  let mainTicker: Ticker | undefined;
  let someHaveMainTicker = false;
  let allTheSame = true;
  for (const widget of widgets) {
    if (widget.data?.mainTicker) {
      someHaveMainTicker = true;
      if (mainTicker) {
        if (
          widget.data.mainTicker.id !== mainTicker.id ||
          widget.data.mainTicker.type !== mainTicker.type
        ) {
          allTheSame = false;
        }
      } else {
        mainTicker = widget.data.mainTicker;
      }
    }
  }
  return {
    someHaveMainTicker,
    allTheSame,
    mainTicker,
  };
}

export function createTab(addTab: AppState["addTab"]) {
  const id = uuidv4();
  addTab({
    index: id,
    data: {
      name: generateRandomName(),
      type: "custom",
    },
  });
  setTimeout(() => {
    document.getElementById(`tab-${id}`)?.click();
  }, 100);
}

export function createRootFolder(): Item {
  return {
    index: uuidv4(),
    name: "root",
    isFolder: true,
    isRoot: true,
    children: [],
    data: { name: "root", widgets: [], groups: [] },
  };
}

const emptyDash = {
  i: "empty-dashboard-cta",
  x: 0,
  y: 2,
  w: 40,
  h: 20,
  isResizable: false,
  isDraggable: false,
};

export function removeDuplicateNavBarWidgets(item: Item) {
  if (!(item?.data?.widgets || item?.isFolder)) return item;

  const navBarWidgets = item.data.widgets.filter(
    (widget) => widget.widgetId === "navigation_bar",
  );

  if (navBarWidgets.length === 0) return item;

  const gridLayout = item.data.gridLayout || {};
  const [firstWidgetId, ...restIds] = navBarWidgets.map((widget) => widget.id);

  item.data.widgets = item.data.widgets.filter(
    (widget) => !restIds.includes(widget.id),
  );

  const wGridData = Object.values(gridLayout)
    .flat()
    .find((l) => l.i === firstWidgetId);

  const tabs = (navBarWidgets?.[0]?.storage?.tabs as InnerTab[]) || [];
  for (const tab of tabs) {
    if (!gridLayout[tab.id]) gridLayout[tab.id] = [];
  }

  const navBarInnerTab = navBarWidgets[0].innerTab;
  if (navBarInnerTab === undefined || !gridLayout[navBarInnerTab]) {
    navBarWidgets[0].innerTab = tabs?.[0]?.id || "";
  }

  item.data.gridLayout = Object.fromEntries(
    Object.entries(gridLayout).map(([key, value]) => {
      const gridData = value?.find((item) => item.i === firstWidgetId);
      if (!gridData && wGridData) value.unshift({ ...wGridData, static: true });
      if (gridData) gridData.static = true;

      value.sort((a, b) => {
        if (a.i === firstWidgetId) return -1;
        if (b.i === firstWidgetId) return 1;
        return 0;
      });

      const newValue = value.filter(
        (item) =>
          !(item.i !== undefined && restIds.includes(item.i)) &&
          item.i !== "empty-dashboard-cta",
      );
      if (newValue.length === 1) newValue.push(emptyDash);

      return [key, newValue];
    }),
  );

  return item;
}

function getConnectionType(
  widgetId: string | undefined,
  sourceName?: string,
): ConnectionType {
  const prefix = widgetId?.split("-")[0];
  if (prefix === "database" || prefix === "file") {
    return prefix;
  }

  if (sourceName) {
    return "advanced-backend";
  }

  return "single";
}

export function recursiveCleanKeys<T>(data: T): T {
  if (Array.isArray(data) || !(typeof data === "object" && isTruthy(data))) return data;

  const record = data as Record<string, unknown>;
  for (const key in record) {
    let cleanedKey = key;
    if (key.includes("_undefined")) {
      cleanedKey = key.replace(/_undefined/g, "");
      record[cleanedKey] = record[key];
      delete record[key];
    }
    record[cleanedKey] = recursiveCleanKeys(record[cleanedKey]);
  }
  return data;
}

export function getValidItems(items: Items) {
  const rootFolder =
    Object.values(items || {})?.find((item) => item?.isRoot) || createRootFolder();

  const newItems = { [rootFolder?.index]: rootFolder };

  function checkChildren(parent: Item, children: string[]) {
    for (const child of children) {
      if (items[child]?.data?.name && items[child]?.parentId !== parent.index) {
        items[child].parentId = parent.index;
      }

      if (items[child]?.data?.name && typeof items[child]?.data?.name !== "string") {
        items[child].data.name = generateRandomName();
      }

      if (items[child]?.isFolder && items[child]?.children?.length > 0) {
        checkChildren(items[child], items[child].children);
      }

      const childWidgets = items[child]?.data?.widgets || [];
      const hasWidgets = childWidgets?.length > 0;

      if (hasWidgets) {
        items[child].data.widgets = items[child].data.widgets.map((widget) => {
          const params = createParamDefs(getJsonWidget(widget) ?? {});
          if (
            !Array.isArray(widget?.params) ||
            (!widget?.external && params?.length > 0)
          ) {
            widget.params = params;
          }

          widget.storage = recursiveCleanKeys(widget.storage);

          if (widget?.external && !widget?.connectionType) {
            const connectionType = getConnectionType(
              widget.widgetId,
              widget.sourceName,
            );

            return { ...widget, connectionType };
          }

          if (widget?.external && widget?.sourceName && !widget?.sourceId) {
            const sources = useBackendConnectorStore.getState().apiSources;
            const sourceId = sources.find(
              (source) =>
                source.name === widget.sourceName &&
                widget?.endpoint?.url?.includes(source.url),
            )?.id;

            if (sourceId) return { ...widget, sourceId: sourceId };
          }
          return widget;
        });

        if (
          !items[child]?.data?.gridLayout ||
          Array.isArray(items[child]?.data?.gridLayout)
        ) {
          const gridLayout = items[child]?.data?.widgets?.reduce<GridLayout>(
            (acc, widget) => {
              if (!widget?.gridData) return acc;
              const key = widget.innerTab || "";

              if (!acc[key]) {
                acc[key] = [];
              }

              acc[key].push(widget.gridData);

              return acc;
            },
            {},
          );

          items[child].data.gridLayout = gridLayout;
        }

        items[child].data.storedFileUUIDs = getStoredFileUUIDs(childWidgets);

        removeDuplicateNavBarWidgets(items[child]);
      }

      if (items[child]?.data?.name && !items[child]?.isFolder) {
        items[child].data.gridLayout = items[child]?.data?.gridLayout || {};
      }

      const tabWidgetIds = childWidgets?.map((widget) => widget.id) || [];

      if (tabWidgetIds.length > 0) {
        items[child].data.gridLayout = Object.fromEntries(
          Object.entries(items[child]?.data?.gridLayout || {}).map(([key, value]) => [
            key,
            value?.filter((item) => item.i && tabWidgetIds.includes(item.i)) || [],
          ]),
        );
      }

      newItems[child] = items[child];
    }
  }

  checkChildren(rootFolder, rootFolder?.children || []);

  return newItems;
}

export function deleteItem(itemId: string, items: Items): string[] {
  const itemToDelete = items[itemId];

  if (itemToDelete?.data?.widgets?.length) {
    const uuids = itemToDelete?.data?.widgets?.map((widget) => widget.id);
    useCopilotDataStore.getState()?.removeTabWidgetsData(uuids);
  }

  if (itemToDelete) {
    if (itemToDelete.isFolder) {
      const children = itemToDelete.children;
      const childrenToDelete = children.flatMap((childId) =>
        deleteItem(childId, items),
      );
      return [itemId, ...childrenToDelete];
    }

    return [itemId];
  }

  return [];
}

export function deleteItemFn(items: Items, id: string) {
  const deletedItems = deleteItem(id, items);

  const newItems = Object.fromEntries(
    Object.entries(cloneDeep({ ...items }))
      .filter(([itemId]) => !deletedItems.includes(itemId))
      .map(([itemId, item]) => {
        if (item.isFolder) {
          item.children = item.children.filter(
            (childId) => !deletedItems.includes(childId),
          );
        }
        return [itemId, item];
      }),
  );

  return { newItems, deletedItems };
}

export function unlinkItemFn(items: Items, id: string) {
  return Object.fromEntries(
    Object.entries(cloneDeep({ ...items })).map(([itemId, item]) => {
      if (item.isFolder) {
        item.children = item.children.filter((childId) => childId !== id);
      }
      return [itemId, item];
    }),
  );
}

export function addDuplicateWidgetToItem(item: Item, widget: Widget) {
  const id = uuidv4();
  const gridData =
    widget.gridData ||
    Object.values(item.data?.gridLayout || {})
      ?.flat()
      ?.find((w) => w.i === widget.id);

  const newWidget = {
    ...(cloneDeep(widget) as Widget),
    id,
    innerTab: widget.innerTab || "",
    groupId: "",
  };

  const gridLayout = updateWidgetGridLayout({
    widget: { ...newWidget, gridData: { ...(gridData || {}), i: id } },
    gridLayout: { ...(item.data?.gridLayout || {}) },
    currentTab: item.data?.currentTab || "",
  });

  const newTab = {
    ...item,
    data: {
      ...item.data,
      numberOfChanges: item.data.numberOfChanges ? item.data.numberOfChanges + 1 : 1,
      lastUpdated: Date.now(),
      widgets: [...item.data.widgets, newWidget],
      gridLayout,
    },
  };

  return removeDuplicateNavBarWidgets(newTab);
}

export function duplicateTabItem(item: Item, rootId?: string, rename = true): Item {
  const { isShared, ...tabToDuplicate } = cloneDeep({ ...item });

  const groupIdMap = new Map<string, string>();
  const paramGroupIdMap = new Map<string, string>();

  const gridLayout = { ...(tabToDuplicate.data.gridLayout || {}) } as GridLayout;
  const cleanName = tabToDuplicate.data.name.replace(/ \(copy\)$/g, "");

  const duplicatedTab = {
    ...tabToDuplicate,
    index: uuidv4(),
    parentId: rootId,
    data: {
      ...tabToDuplicate.data,
      name: rename ? `${cleanName} (copy)` : tabToDuplicate.data.name,
      numberOfChanges: 0,
      lastUpdated: Date.now(),
      widgets: tabToDuplicate.data.widgets.map((w) => {
        let gridDataIndex = gridLayout?.[w.innerTab || ""]?.findIndex(
          (gridW) => gridW.i === w.id,
        );

        if (gridDataIndex === -1 || gridDataIndex === undefined) {
          gridDataIndex = gridLayout?.overview?.findIndex((gridW) => gridW.i === w.id);
          w.innerTab = "overview";
        }

        const newId = uuidv4();

        if (
          w.innerTab !== undefined &&
          gridDataIndex !== undefined &&
          gridLayout[w.innerTab]?.[gridDataIndex]
        ) {
          gridLayout[w.innerTab][gridDataIndex].i = newId;
        }

        if (w.widgetId === "navigation_bar") {
          for (const tabId in gridLayout) {
            gridLayout[tabId] = gridLayout[tabId].map((grid) => {
              if (grid.i === w.id) grid.i = newId;
              return grid;
            });
          }
        }

        const paramGroupIds = Object.values(w.paramGroups || {}).filter(Boolean);

        if (paramGroupIds.length > 0) {
          const paramGroups = tabToDuplicate.data.groups.filter(
            (g): g is GroupTypeT<"param" | "endpointParam"> =>
              paramGroupIds.includes(g.id) &&
              ["param", "endpointParam"].includes(g.type),
          );

          for (const g of paramGroups) {
            const pGroupId = paramGroupIdMap.get(g.id) ?? uuidv4();

            if (!paramGroupIdMap.has(g.id)) {
              paramGroupIdMap.set(g.id, pGroupId);
            }

            w.paramGroups = addToWidgetParamGroups(w?.paramGroups, {
              ...g,
              id: pGroupId,
            });
          }
        }

        if (!w.groupId) return { ...w, id: newId };

        if (groupIdMap.has(w.groupId)) {
          return {
            ...w,
            id: newId,
            groupId: groupIdMap.get(w.groupId),
          };
        }

        const newGroupId = uuidv4();
        groupIdMap.set(w.groupId, newGroupId);

        return {
          ...w,
          id: newId,
          groupId: newGroupId,
        };
      }),
      groups: tabToDuplicate.data.groups.map((g) => {
        const pGroupId = paramGroupIdMap.get(g.id);
        if (["param", "endpointParam"].includes(g.type) && pGroupId) {
          return {
            ...g,
            id: pGroupId,
            color: generateGroupingColor(),
          };
        }

        const newGroupId = groupIdMap.get(g.id);
        return newGroupId
          ? {
              ...g,
              id: newGroupId,
              color: generateGroupingColor(),
            }
          : g;
      }),
    },
  };

  duplicatedTab.data.gridLayout = gridLayout;

  return duplicatedTab;
}

export function needsGroupValueUpdate(widget: Widget, group: Group) {
  if (group?.id === undefined) return false;

  if (group?.type === "endpointParam") {
    const paramDef = getEndpointParamDef(getEndpointParams(widget), group?.groupById);
    const paramName = paramDef?.paramName;
    const current =
      paramName === undefined ? undefined : widget?.storage?.params?.[paramName];
    return current !== group.value;
  }

  if (group?.type === "ticker" && group?.value?.symbol) {
    const supportedTypes = getSupportedAssetClasses(widget.widgetId);
    const category = group?.value?.category ?? widget?.data?.mainTicker?.category;
    const isOptions = supportedTypes.includes("options") && group?.value?.has_options;

    const validTicker =
      [category, "all"].some((type) => supportedTypes.includes(type)) ||
      widget?.external;

    return validTicker || isOptions;
  }

  if (group?.type === "param" && group?.groupById) {
    return widget?.storage?.params?.[group.groupById] !== group.value;
  }

  return false;
}

export function needsGroupValuesUpdate(widget: Widget, groups: Group[]) {
  return groups.some((group) => needsGroupValueUpdate(widget, group));
}

export function updateWidgetGroupValues(widget: Widget, groups: Group[]): Widget {
  return (groups || []).reduce(
    (w, group) => {
      if (group?.id === undefined) return w;

      if (group?.type === "endpointParam") {
        const params = getEndpointParams(w);
        const paramName = getEndpointParamName(params, group?.groupById);
        if (!paramName) return w;

        w.storage = {
          ...(w.storage ?? {}),
          params: {
            ...(w.storage?.params ?? {}),
            [paramName]: group.value,
          },
        };
        return w;
      }

      if (group?.type === "ticker" && group?.value?.symbol) {
        w.data = { ...w.data, mainTicker: group.value };

        const tickerParam = getTickerParamName(w);

        w.storage = {
          ...(w.storage ?? {}),
          params: {
            ...(w.storage?.params ?? {}),
            ...(tickerParam ? { [tickerParam]: group.value.symbol } : {}),
          },
        };

        return w;
      }

      if (isValidParamOption(w, group)) {
        w.storage = {
          ...w.storage,
          params: {
            ...w.storage?.params,
            [group.groupById]: group.value,
          },
        };

        return w;
      }

      return w;
    },
    { ...widget },
  );
}

export function addToWidgetParamGroups(
  wParamGroups: Widget["paramGroups"],
  group: GroupTypeT<"param" | "endpointParam">,
): NonNullable<Widget["paramGroups"]> {
  if (group?.id === undefined) return wParamGroups ?? {};

  const paramGroups = {
    ...(wParamGroups ?? {}),
    [group.groupById]: group.id,
  };
  return paramGroups;
}

export function updateWidgetGroupValue(widget: Widget, group: Group | null) {
  return updateWidgetGroupValues(widget, group ? [group] : []);
}

export function getGroupLabel(group: Group) {
  if (group?.type === "ticker") return group?.value?.symbol;
  return group?.value;
}

export function getGroupInfo(group: Group | null, paramDef?: ParamDef) {
  const output = { valueLabel: "", paramLabel: paramDef?.label || paramDef?.paramName };
  if (!group) return output;

  const rawValue = group.type === "ticker" ? group.value?.symbol : group.value;
  if (!rawValue) return { ...output, valueLabel: "" };

  output.valueLabel = ensureArray(rawValue)
    .map((v) => {
      const option = paramDef?.options?.find(
        (item) => String(item.value) === String(v),
      );
      return option?.label ?? String(v);
    })
    .join(", ");

  return output;
}

export function endpointOptionsRequest(
  widget: Widget,
  param: ParamDefT<"endpoint">,
  currentParams: Record<string, unknown>,
): BuiltRequest | null {
  return buildOptionsRequest(
    param,
    { params: widget.params ?? [], values: currentParams },
    getSourceCredentials(widget.sourceId, param.optionsEndpoint),
  );
}

export function getEndpointParams(widget: Partial<Widget>): ParamDefT<"endpoint">[] {
  const params = createParamDefs({ params: widget?.params ?? [] });
  return params.filter(
    (param): param is ParamDefT<"endpoint"> => param?.type === "endpoint",
  );
}

export function getEndpointParamDef(params: ParamDef[], paramId: string | undefined) {
  return params?.find(
    (param): param is ParamDefT<"endpoint"> =>
      param.type === "endpoint" &&
      (param.groupById === paramId || param.paramName === paramId),
  );
}

export function getEndpointParamName(params: ParamDef[], paramId: string | undefined) {
  const param = params?.find(
    (param) =>
      param.type === "endpoint" &&
      (param.groupById === paramId || param.paramName === paramId),
  );
  return param?.paramName;
}

export function getGroupKindLabel(group: Group): string {
  if (group.type === "ticker" && group.value?.category === "country") return "country";
  return "paramName" in group && typeof group.paramName === "string"
    ? group.paramName
    : group.type;
}

export function getWidgetGroupValue(
  widget: Widget,
  group: GroupTypeT<"ticker">,
): Ticker | null | undefined;
export function getWidgetGroupValue(
  widget: Widget,
  group: GroupTypeT<"param" | "endpointParam">,
): StoredParamValue | undefined;
export function getWidgetGroupValue(
  widget: Widget,
  group: Group | undefined,
): Ticker | StoredParamValue | undefined;
export function getWidgetGroupValue(widget: Widget, group: Group | undefined) {
  if (group?.id === undefined) return null;

  if (group?.type === "endpointParam") {
    const params = getEndpointParams(widget);
    const paramName = getEndpointParamName(params, group?.groupById);
    return paramName === undefined ? undefined : widget?.storage?.params?.[paramName];
  }

  if (group?.type === "ticker") {
    return widget?.data?.mainTicker;
  }

  if (group?.type === "param" && group?.groupById) {
    return widget?.storage?.params?.[group.groupById];
  }

  return null;
}

type EndpointParamGroup = GroupTypeT<"endpointParam">;

type EndpointParamDependency = {
  widget: Widget;
  sourceParam: ParamDefT<"endpoint">;
  dependentParam: ParamDefT<"endpoint">;
  dependentGroupId: string;
};

type EndpointParamOptionsRequestCache = Map<string, Promise<unknown[]>>;

const _getEndpointParamOptionValue = (option: unknown): string | undefined => {
  if (typeof option === "string") return option;
  if (!option || typeof option !== "object") return undefined;

  const value = (option as { value?: unknown }).value;
  if (value === undefined || value === null) return undefined;
  return value.toString();
};

const _getEndpointParamOptionValues = (options: unknown[]): Set<string> => {
  return new Set(
    options
      .map(_getEndpointParamOptionValue)
      .filter((value): value is string => !!value),
  );
};

const _getSelectedEndpointParamOptionValues = (options: unknown[]): string[] => {
  return options
    .filter(
      (option) =>
        !!option &&
        typeof option === "object" &&
        (option as { selected?: unknown }).selected === true,
    )
    .map(_getEndpointParamOptionValue)
    .filter((value): value is string => !!value);
};

const _getEndpointGroupValues = (value: StoredParamValue | undefined): string[] => {
  if (Array.isArray(value)) {
    return value
      .filter(
        (item): item is string | number | boolean =>
          item !== undefined && item !== null && item !== "",
      )
      .map((item) => item.toString());
  }
  if (value === undefined || value === null || value === "") return [];
  return [value.toString()];
};

const _endpointParamDependsOn = (param: ParamDefT<"endpoint">, paramName: string) => {
  return Object.values(param.optionsParams ?? {}).some(
    (value) => value === `$${paramName}`,
  );
};

function _getWidgetParamsWithGroupMap(widget: Widget, groupsMap: Map<string, Group>) {
  const endpointParams = getEndpointParams(widget);
  const currentParams = { ...(widget.storage?.params ?? {}) };

  for (const [groupById, groupId] of Object.entries(widget.paramGroups ?? {})) {
    const group = groupsMap.get(groupId);
    if (!group) continue;

    if (group.type === "endpointParam") {
      const paramName = getEndpointParamName(endpointParams, groupById);
      if (paramName) currentParams[paramName] = group.value;
      continue;
    }

    if (group.type === "param") {
      currentParams[group.groupById] = group.value;
    }
  }

  return currentParams;
}

async function _fetchEndpointParamOptions(
  widget: Widget,
  param: ParamDefT<"endpoint">,
  currentParams: Record<string, unknown>,
  requestCache?: EndpointParamOptionsRequestCache,
) {
  const built = endpointOptionsRequest(widget, param, currentParams);
  if (!built?.ok) return [];

  const cacheKey = JSON.stringify(requestKey(built));
  const cachedRequest = requestCache?.get(cacheKey);
  if (cachedRequest) return cachedRequest;

  const request = (async () => {
    const response = await fetch(built.request.url, requestInit(built.request));
    if (!response.ok) return [];

    const data = await response.json();
    return Array.isArray(data) ? data : [];
  })().catch((error) => {
    requestCache?.delete(cacheKey);
    throw error;
  });

  requestCache?.set(cacheKey, request);
  return request;
}

function _buildEndpointParamDependencyMap(
  widgets: Widget[],
  groupMap: Map<string, Group>,
) {
  const dependencyMap = new Map<string, EndpointParamDependency[]>();
  const seenDependentGroupIdsBySource = new Map<string, Set<string>>();

  for (const widget of widgets) {
    const endpointParams = getEndpointParams(widget);

    for (const sourceParam of endpointParams) {
      const sourceGroupById = sourceParam.groupById;
      if (!sourceGroupById) continue;

      const sourceGroupId = widget.paramGroups?.[sourceGroupById];
      if (!sourceGroupId) continue;

      const sourceGroup = groupMap.get(sourceGroupId);
      if (sourceGroup?.type !== "endpointParam") continue;

      for (const dependentParam of endpointParams) {
        const dependentGroupById = dependentParam.groupById;
        if (!dependentGroupById || dependentGroupById === sourceGroupById) continue;
        if (!_endpointParamDependsOn(dependentParam, sourceParam.paramName)) continue;

        const dependentGroupId = widget.paramGroups?.[dependentGroupById];
        if (!dependentGroupId) continue;

        const seenDependentGroupIds =
          seenDependentGroupIdsBySource.get(sourceGroupId) ?? new Set<string>();
        if (seenDependentGroupIds.has(dependentGroupId)) continue;
        seenDependentGroupIds.add(dependentGroupId);
        seenDependentGroupIdsBySource.set(sourceGroupId, seenDependentGroupIds);

        const dependencies = dependencyMap.get(sourceGroupId) ?? [];
        dependencies.push({
          widget,
          sourceParam,
          dependentParam,
          dependentGroupId,
        });
        dependencyMap.set(sourceGroupId, dependencies);
      }
    }
  }

  return dependencyMap;
}

export async function updateDependentEndpointParamGroups(
  tab: Item,
  sourceGroup: Group,
  updateGroup: AppState["updateGroup"],
) {
  if (sourceGroup?.type !== "endpointParam") return;
  if (!tab?.data) return;

  const tabId = tab.index;
  const groups = tab.data.groups ?? [];
  const groupMap = new Map(groups.map((group) => [group.id, group]));
  groupMap.set(sourceGroup.id, sourceGroup);

  const dependencyMap = _buildEndpointParamDependencyMap(
    tab.data.widgets ?? [],
    groupMap,
  );
  const requestCache: EndpointParamOptionsRequestCache = new Map();
  const processedSourceGroupIds = new Set<string>();

  const updateEndpointGroup = (group: EndpointParamGroup) => {
    groupMap.set(group.id, group);
    const index = groups.findIndex((item) => item.id === group.id);
    if (index !== -1) groups[index] = group;
    updateGroup(tabId, group.id, group, false);
  };

  const updateDependentsForGroup = async (currentSourceGroup: EndpointParamGroup) => {
    if (processedSourceGroupIds.has(currentSourceGroup.id)) return;
    processedSourceGroupIds.add(currentSourceGroup.id);

    for (const dependency of dependencyMap.get(currentSourceGroup.id) ?? []) {
      try {
        const currentParams = _getWidgetParamsWithGroupMap(dependency.widget, groupMap);
        currentParams[dependency.sourceParam.paramName] = currentSourceGroup.value;
        const options = await _fetchEndpointParamOptions(
          dependency.widget,
          dependency.dependentParam,
          {
            ...currentParams,
            [dependency.dependentParam.paramName]: "",
          },
          requestCache,
        );

        const dependentGroup = groupMap.get(dependency.dependentGroupId);
        if (dependentGroup?.type !== "endpointParam") continue;

        const groupValues = _getEndpointGroupValues(dependentGroup.value);
        const optionValues = _getEndpointParamOptionValues(options);
        const hasValidValue = groupValues.some((value) => optionValues.has(value));
        if (hasValidValue) continue;

        const selectedValues = _getSelectedEndpointParamOptionValues(options);
        if (groupValues.length === 0 && selectedValues.length === 0) {
          await updateDependentsForGroup(dependentGroup);
          continue;
        }

        const nextValue: EndpointParamGroup["value"] = dependency.dependentParam
          .multiSelect
          ? selectedValues
          : (selectedValues[0] ?? "");
        const updatedGroup: EndpointParamGroup = {
          ...dependentGroup,
          value: nextValue,
        };
        updateEndpointGroup(updatedGroup);
        await updateDependentsForGroup(updatedGroup);
      } catch (error) {
        console.error("Failed to cascade endpoint parameter group", error);
      }
    }
  };

  await updateDependentsForGroup(sourceGroup);
}

export function getUngroupedDependentEndpointParams(
  widget: Partial<Widget>,
  paramName: string,
) {
  return getEndpointParams(widget).filter(
    (param) =>
      _endpointParamDependsOn(param, paramName) &&
      (param.groupById === undefined || !widget.paramGroups?.[param.groupById]),
  );
}

export function endpointParamDependsOnAnotherParam(param: ParamDefT<"endpoint">) {
  return Object.values(param.optionsParams ?? {}).some(
    (value) => typeof value === "string" && value.startsWith("$"),
  );
}

export function getOfferedEndpointParamValue(
  param: ParamDefT<"endpoint">,
  options: unknown[],
  current: StoredParamValue | undefined,
): string | string[] | undefined {
  const values = _getEndpointGroupValues(current);
  if (values.length === 0) return undefined;

  const offered = _getEndpointParamOptionValues(options);
  if (values.some((value) => offered.has(value))) return undefined;

  const selected = _getSelectedEndpointParamOptionValues(options);
  return param.multiSelect ? selected : (selected[0] ?? "");
}

export async function getDependentEndpointParamValues(
  widget: Widget,
  changedParamName: string,
  params: Record<string, StoredParamValue>,
): Promise<Record<string, StoredParamValue>> {
  const updates: Record<string, StoredParamValue> = {};
  const requestCache: EndpointParamOptionsRequestCache = new Map();
  const visited = new Set<string>();

  const visit = async (
    paramName: string,
    current: Record<string, StoredParamValue>,
  ) => {
    if (visited.has(paramName)) return;
    visited.add(paramName);

    for (const dependent of getUngroupedDependentEndpointParams(widget, paramName)) {
      const options = await _fetchEndpointParamOptions(
        widget,
        dependent,
        { ...current, [dependent.paramName]: "" },
        requestCache,
      );

      const values = _getEndpointGroupValues(current[dependent.paramName]);
      if (values.some((value) => _getEndpointParamOptionValues(options).has(value))) {
        continue;
      }

      const selected = _getSelectedEndpointParamOptionValues(options);
      if (values.length === 0 && selected.length === 0) continue;

      const next = dependent.multiSelect ? selected : (selected[0] ?? "");
      updates[dependent.paramName] = next;
      await visit(dependent.paramName, { ...current, [dependent.paramName]: next });
    }
  };

  await visit(changedParamName, params);
  return updates;
}

export function isValidParamOption(
  widget: Widget,
  group: Group,
): group is GroupTypeT<"param"> {
  if (group?.type === "param" && group?.groupById) {
    const groupValue = group?.value?.toString();
    const paramName = group.groupById;
    const options = createParamDefs({ params: widget?.params ?? [] }).find(
      (param) => param.paramName === paramName,
    )?.options;

    return (
      options?.length === 0 ||
      !!options?.find((option) => groupValue?.includes(option.value?.toString()))
    );
  }

  return false;
}

export function getTickerParamName(widget: Partial<Widget | WidgetJsonT>) {
  const isEconomyGroup = widget?.data?.mainTicker?.category === "country";
  const param = widget?.params?.find((param) => param?.type === "ticker");
  return param?.paramName || (isEconomyGroup ? "country" : null);
}

export function getEndpointParamGroupByIds(widget: Partial<Widget>) {
  return getEndpointParams(widget as Widget)?.reduce<Record<string, string>>(
    (acc, p) => {
      if (p.groupById !== undefined) acc[p.groupById] = p?.paramName;
      return acc;
    },
    {},
  );
}

export function updateWidgetInItem(item: Item, widget: Widget) {
  const newItem = { ...item };

  if (!newItem.isFolder && newItem.data) {
    let hasChanges = false;
    newItem.data.widgets = newItem.data.widgets.map((w) => {
      if (w.id !== widget.id) return w;

      hasChanges = !w.isNew && !isEqual(w, widget);
      const { isNew, ...updatedWidget } = { ...w, ...widget };
      return updatedWidget;
    });

    if (hasChanges) {
      const numberOfChanges = newItem?.data?.numberOfChanges ?? 0;
      newItem.data.numberOfChanges = numberOfChanges + 1;
      newItem.data.lastUpdated = Date.now();
      newItem.updated_date = new Date().toISOString();
    }
  }
  return newItem;
}

export function getGridData(
  lastWidgetGridData?: Partial<GridData>,
  widgetGridData: Partial<GridData> = {
    w: 20,
    h: 10,
  },
  options: { tabCols?: number; keepXY?: boolean } = {},
) {
  const { tabCols = 40, keepXY = false } = options;
  const isMinimized = widgetGridData?.h === 1;

  const gridData: GridData = {
    ...widgetGridData,
    w: widgetGridData.w,
    h: widgetGridData.h,
    x: 0,
    y: 0,
    minH: 4,
    minW: 8,
  };

  if (keepXY) {
    gridData.x = widgetGridData.x || 0;
    gridData.y = widgetGridData.y || 0;
  }

  if (widgetGridData.minW) {
    gridData.minW = widgetGridData.minW;
  }

  if (widgetGridData.minH) {
    gridData.minH = Math.min(
      widgetGridData.minH,
      widgetGridData.maxH || Number.POSITIVE_INFINITY,
    );
  }

  if (widgetGridData.maxW) {
    gridData.maxW = Math.max(widgetGridData.maxW, widgetGridData.minW || 0);
  }

  if (widgetGridData.maxH) {
    gridData.maxH = Math.max(widgetGridData.maxH, widgetGridData.minH || 0);
  }

  gridData.w = Math.max(gridData.minW ?? 0, gridData.w ?? 0);
  gridData.h = isMinimized ? gridData.h : Math.max(gridData.minH ?? 0, gridData.h ?? 0);

  if (lastWidgetGridData) {
    const {
      w: lastWidgetCols = 0,
      h: lastWidgetRows = 0,
      x: lastWidgetX = 0,
      y: lastWidgetY,
    } = lastWidgetGridData;

    const ensuredValidY =
      lastWidgetY !== undefined && Number.isFinite(lastWidgetY) ? lastWidgetY : 0;

    if (lastWidgetX + lastWidgetCols + (widgetGridData.w ?? 0) <= tabCols) {
      gridData.x = lastWidgetX + lastWidgetCols;
      gridData.y = ensuredValidY;
    } else {
      gridData.x = 0;
      gridData.y = ensuredValidY + lastWidgetRows;
    }
  }

  return gridData;
}

export function getInnerTabsGridLayout(gridLayout: GridLayout | undefined) {
  return Object.fromEntries(
    Object.entries(gridLayout ?? {}).filter(([key, value]) =>
      [key !== "", value?.length > 0].every(Boolean),
    ),
  );
}

export function resolveInnerTabParams(props: {
  gridLayout: GridLayout | undefined;
  currentTab: string;
  lastInnerTab: string | undefined;
  searchParams: URLSearchParams;
}) {
  const { gridLayout, currentTab, lastInnerTab, searchParams } = props;

  const filtered = getInnerTabsGridLayout(gridLayout);
  const innerTabs = Object.keys(filtered);
  const nextParams = new URLSearchParams(searchParams);

  if (gridLayout && !(currentTab in gridLayout)) nextParams.delete("tab");

  if (innerTabs.length !== 0) {
    const preferred =
      lastInnerTab && filtered[lastInnerTab] ? lastInnerTab : innerTabs[0];
    nextParams.set("tab", preferred);
  }

  return nextParams.toString() === searchParams.toString() ? null : nextParams;
}

export function getStoredFileUUIDs(widgets: Widget[]) {
  const storedFileUUIDs = new Set<string>();

  for (const widget of widgets) {
    if (widget?.connectionType === "file") {
      const fileUUID = extractUUIDFromURL(widget?.endpoint?.url);
      if (fileUUID) storedFileUUIDs.add(fileUUID);
    }
  }

  return Array.from(storedFileUUIDs);
}

export type UpdateWidgetGridLayoutParams = {
  widget: WidgetT | WidgetJsonT;
  gridLayout: GridLayout;
  lastWidgetGridData?: Partial<GridData>;
  currentTab?: string;
  removeWidget?: boolean;
  ignoreLastWidgetGridData?: boolean;
  tabCols?: number;
  tabWidgets?: (WidgetT | WidgetJsonT)[];
};

export function updateWidgetGridLayout(params: UpdateWidgetGridLayoutParams) {
  const {
    widget,
    gridLayout,
    lastWidgetGridData = null,
    currentTab = "overview",
    removeWidget = false,
    ignoreLastWidgetGridData = false,
    tabCols = 40,
    tabWidgets = [],
  } = params;

  const isNavigationBar = widget?.widgetId === "navigation_bar";
  const tabWidgetIds = tabWidgets.map((widget) => widget.id);

  if (removeWidget) {
    const widgetIds = tabWidgetIds.filter((id) => id !== widget.id);
    return Object.fromEntries(
      Object.entries(gridLayout)
        .map(([key, value]) => [
          key,
          value.filter((item) => widgetIds.includes(item.i)),
        ])
        .filter(([_key, value]) => value.length > 0),
    );
  }

  const layoutKey = widget.innerTab || currentTab || "";
  const currentTabLayout = (gridLayout[layoutKey] || []).filter(
    (item) => item.i !== "empty-dashboard-cta",
  );

  const lastWidget =
    currentTabLayout?.reduce<GridData>(
      (prev, current) => {
        if (prev.i === "empty-dashboard-cta") return current;
        if (current.i === "empty-dashboard-cta") return prev;
        const [prevX, prevY] = [prev.x ?? 0, prev.y ?? 0];
        const [currentX, currentY] = [current.x ?? 0, current.y ?? 0];
        return prevY > currentY
          ? prev
          : prevY === currentY
            ? prevX > currentX
              ? prev
              : current
            : current;
      },
      { x: 0, y: 0, w: 0, h: 0 },
    ) || null;

  const widgetGridData = { y: 0, x: 0, w: 40, h: 10, ...(widget?.gridData ?? {}) };

  const gridData = getGridData(lastWidgetGridData || lastWidget, widgetGridData, {
    tabCols,
  });

  const finalGridData = ignoreLastWidgetGridData ? widgetGridData : gridData;
  finalGridData.i = widget.id;
  if (isNavigationBar && !ignoreLastWidgetGridData) finalGridData.y = 0;

  for (const key in gridLayout) {
    for (const w of gridLayout[key]) {
      if (w.i === widget.id && layoutKey !== key) {
        gridLayout[key] = gridLayout[key].filter((item) => item.i !== widget.id);
        gridLayout[layoutKey] = [...(gridLayout[layoutKey] || []), finalGridData];

        return gridLayout;
      }
    }
  }

  gridLayout[layoutKey] = Array.from(new Set([...currentTabLayout, finalGridData]));

  return gridLayout;
}

type MainTickerByCategoryParams = {
  widget?: (NewWidget | WidgetJsonT) & { dependsOn?: string[] };
  defaultTicker?: Ticker;
  defaultCategory?: Ticker["category"];
};

export function MainTickerByCategory(props: MainTickerByCategoryParams): Ticker {
  const { widget, defaultTicker = DEFAULT_TICKERS.AAPL, defaultCategory } = props;
  const mainTicker = widget?.data?.mainTicker || defaultTicker;

  const widgetTypes = getSupportedAssetClasses(widget?.widgetId);
  const hasOptions = widgetTypes.includes("options") && mainTicker?.has_options;

  const supportedTypes = widgetTypes?.length
    ? widgetTypes
    : [
        widget?.defaultAssetClass,
        widget?.category?.toLowerCase(),
        defaultCategory,
        defaultTicker?.category,
      ];

  const tickerCategories: Record<string, Ticker> = {
    etf: DEFAULT_TICKERS.SPY,
    equity: DEFAULT_TICKERS.AAPL,
    stock: DEFAULT_TICKERS.AAPL,
    [defaultTicker?.category]: defaultTicker,
    all: mainTicker,
    [mainTicker?.category]: mainTicker,
  };

  if (hasOptions) {
    return widget?.data?.mainTicker || defaultTicker;
  }

  const categoryTicker = (category: string | undefined) =>
    category === undefined ? undefined : tickerCategories[category];

  return (
    supportedTypes
      .map(
        (assetClass) =>
          categoryTicker(widget?.defaultAssetClass) ||
          categoryTicker(assetClass) ||
          categoryTicker(defaultCategory),
      )
      .find((ticker) => ticker) || tickerCategories.all
  );
}

export function getWidgetData(params: {
  widget: (NewWidget | WidgetJsonT) & { dependsOn?: string[] };
  defaultTicker?: Ticker;
}): Widget {
  const { widget, defaultTicker = DEFAULT_TICKERS.AAPL } = params;

  const mainTicker = MainTickerByCategory({ widget, defaultTicker });

  widget.params = createParamDefs(widget);
  widget.storage = widget.storage || {};
  widget.storage.params = widget?.storage?.params || {};

  const tickerParam = getTickerParamName(widget);

  if (widget?.params?.length > 0) {
    const initialParams = createWidgetInitParams(widget, mainTicker);

    widget.storage = { ...widget.storage, params: initialParams };
  }

  if (
    !widget.data?.mainTicker &&
    widget.dependsOn?.includes("mainTicker") &&
    tickerParam
  ) {
    widget.data = {
      ...widget.data,
      mainTicker,
    };
    widget.storage = {
      ...widget.storage,
      params: { ...widget.storage.params, [tickerParam]: mainTicker.symbol },
    };
  }

  if (widget.dataKey) {
    widget.data = {
      ...widget.data,
      dataKey: widget.dataKey,
    };
  }

  if (widget.widgetId === "navigation_bar") {
    const defaultTab = { id: "overview", name: "Overview" };
    const innerTab = widget.innerTab || "overview";
    widget.innerTab = innerTab;

    widget.storage = {
      ...widget.storage,
      tabs: widget.storage?.tabs || [
        innerTab === "overview"
          ? defaultTab
          : { id: innerTab, name: convertToReadableLabel(innerTab) },
      ],
    };
  }

  if (
    widget.dependsOn?.includes("mainTicker") &&
    tickerParam &&
    !widget?.storage?.params?.[tickerParam]
  ) {
    widget.data = { ...widget.data, mainTicker };
    widget.storage = {
      ...widget.storage,
      params: { ...widget.storage?.params, [tickerParam]: mainTicker.symbol },
    };
  }

  if (widget?.data?.mainTicker === null) {
    widget.data.mainTicker = undefined;
  }

  const finalWidgetData: Partial<Widget> = {
    id: widget.id || uuidv4(),
    groupId: widget.groupId ?? "",
    widgetId: widget.widgetId,
    name: widget.name ?? "",
    external: widget.external,
    innerTab: widget.innerTab ?? "",
    storage: widget.storage,
    params: widget.params,
    description: widget.description ?? "",
    data: widget.data,
    staleTime: widget.staleTime,
    refetchInterval: widget.refetchInterval,
    dataUpdateDisplay: widget.dataUpdateDisplay,
    runButton: widget?.runButton === true,
    showTitle: widget?.showTitle !== false,
    exportable: widget?.exportable !== false,
    disableRetrievalForCopilot: widget?.disableRetrievalForCopilot,
    ...(widget.plugin ? { plugin: widget.plugin } : {}),
  };

  if (isWellFormedVizType(widget.type)) {
    finalWidgetData.type = widget.type;
  }

  if (widget.external) {
    const optionalSourceKeys = [
      "source",
      "sourceId",
      "sourceName",
      "connectionType",
      "isSharedWidget",
      "category",
      "subCategory",
      "raw",
    ] as const;
    for (const key of optionalSourceKeys) {
      if (widget[key]) {
        Object.assign(finalWidgetData, { [key]: widget[key] });
      }
    }
    if (widget.endpoint) {
      const { url, method } = createWidgetEndpoint(widget.endpoint);
      finalWidgetData.endpoint = { url, method };
    }

    const uniqueParam = widget?.params?.find((param) => param.type === "ticker");

    if (uniqueParam?.type === "ticker") {
      if (finalWidgetData.storage?.params) {
        finalWidgetData.storage.params[uniqueParam.paramName] = mainTicker.symbol;
      }
      finalWidgetData.data = {
        ...finalWidgetData.data,
        mainTicker,
      };
    }

    if (
      widget.connectionType === "advanced-backend" &&
      widget.widgetId !== undefined &&
      getJsonWidget(widget.widgetId) !== null
    ) {
      finalWidgetData.widgetId = `${widget.sourceName}-${widget.widgetId}`;
    }

    if (import.meta.env.DEV) console.log(widget, finalWidgetData);
  }

  if (!widget.external) {
    const mainTickerFields: Record<string, unknown> | undefined =
      widget.data?.mainTicker;
    if (tickerParam && mainTickerFields?.[tickerParam]) {
      finalWidgetData.data = {
        ...finalWidgetData.data,
        mainTicker: widget.data?.mainTicker,
      };
    }
  }

  const result = finalWidgetData.external
    ? ExternalWidgetSchema.safeParse(finalWidgetData)
    : InternalWidgetSchema.safeParse(finalWidgetData);
  if (result.success) {
    if (import.meta.env.DEV) console.log("Widget is valid", result.data);
    const validatedWidget = result.data as WidgetT;
    if (widget?.isMinimized || widget?.originalH) {
      validatedWidget.isMinimized = widget.isMinimized;
      validatedWidget.originalH = widget.originalH;
    }
    return validatedWidget;
  }

  const errors = formatZodIssues(result.error?.issues, [], finalWidgetData);
  toast.error("Widget is invalid", {
    description: formatZodErrorMessage(errors.join("\n\n")),
  });
  throw new Error(result.error.message);
}

export const diffItemsWithRemote = (currentState: Items, remoteState: Items | null) => {
  if (!remoteState) return currentState;
  if (!currentState) throw new Error("Current state is empty");
  const diff: Record<string, Item | "DELETE"> = {};

  for (const [key, value] of Object.entries(currentState)) {
    if (!(remoteState[key] && isEqual(value, remoteState[key]))) {
      diff[key] = value;
    }
  }

  for (const key of Object.keys(remoteState)) {
    if (!currentState[key]) {
      diff[key] = "DELETE";
    }
  }

  return diff;
};
