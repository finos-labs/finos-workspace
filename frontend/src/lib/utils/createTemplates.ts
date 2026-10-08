import type { NavigateFunction } from "react-router-dom";
import { getExternalCopilotHolders } from "~/api/auth.api";
import {
  createSourceWidget,
  updateParamOrder,
} from "~/components/DataConnectors/common/helpers";
import type { GroupTypeT, WidgetJsonT, WidgetT } from "~/components/types";
import { someTruthy } from "~/lib/utils/values";
import type { AppState, GridLayout, Items, Ticker, Widget } from "../state/app";
import type { BackendTemplate, Source } from "../state/backendConnector";
import { useCopilotStore } from "../state/copilot";
import { useThemeStore } from "../state/theme";
import type { TabLayout } from "../templates";
import { backendTemplateSchema } from "../types/app";
import {
  addToWidgetParamGroups,
  getGridData,
  getTickerParamName,
  recursiveCleanKeys,
} from "./app";
import { COLORS, slugify, uuidv4 } from "./utils";
import { getJsonWidget } from "./widget";
import { currentDateModifier } from "./widgetParams";

function getTickerSymbolsFromParams(
  params: Record<string, unknown>,
  paramName: string,
) {
  const value = params[paramName];
  if (typeof value === "string") {
    return value
      .split(",")
      .map((symbol) => symbol.trim())
      .filter(Boolean);
  }
  if (value && typeof value === "object" && "symbol" in value) {
    const symbol = String((value as { symbol?: unknown }).symbol || "").trim();
    return symbol ? [symbol] : [];
  }
  return [];
}

function tickerFromSymbol(symbol: string): Ticker {
  const normalizedSymbol = symbol.toUpperCase();
  return {
    id: normalizedSymbol,
    symbol: normalizedSymbol,
    name: normalizedSymbol,
    category: "equity",
    type: "stock",
  };
}

/**
 * Checks if there are any existing dashboards for a given app that haven't been modified by the user.
 * If such a dashboard exists, it returns the corresponding tab information and navigation path.
 * If all existing dashboards have been modified, it generates a new unique tab name for the app.
 *
 * @param templateId - The unique identifier for the app template.
 * @param appName - The name of the app to be used in the tab name.
 * @param items - The current list of dashboard items to check against.
 *
 * @returns An object containing either the index and navigation path for an untouched dashboard,
 * or a new tab name for a modified app.
 */
export function getUntouchedAppTabInfo(
  templateId: BackendTemplate["id"],
  appName: string,
  items: Items | null,
  allowUntouchedReuse = true,
) {
  const cleanAppName = appName.replace(/\s*\(\d+\)$/, "");
  const appDashboards = Object.values(items || {}).filter((item) => {
    if (item?.isFolder || !item?.index || !item?.data) return false;
    const data = item.data;
    return data.templateId === templateId && data.name.startsWith(cleanAppName);
  });

  const untouchedDashboard = appDashboards.find(
    (item) => item.data.numberOfChanges === 0,
  );
  if (allowUntouchedReuse && untouchedDashboard?.index) {
    const { index, data } = untouchedDashboard;
    const navigateTo = `/app/${index}${data?.currentTab ? `?tab=${data.currentTab}` : ""}`;
    return { index, navigateTo };
  }
  const maxCount = appDashboards.reduce(
    (max, item) => {
      const name = item.data?.name || "";
      const numberMatch = name.match(/\((\d+)\)$/);
      const number = numberMatch ? Number.parseInt(numberMatch[1], 10) : 0;
      return Math.max(max, number);
    },
    appDashboards.length > 0 ? 1 : 0,
  );

  const tabName = cleanAppName + (maxCount > 0 ? ` (${maxCount + 1})` : "");
  return { tabName };
}

export async function createCustomTemplateTab({
  addTab,
  navigate,
  items,
  template,
  source,
  currentDashboard = "",
  resolveWidgetSource,
  resolveWidget,
  dashboardBehavior = "auto",
}: {
  addTab: AppState["addTab"];
  navigate?: NavigateFunction;
  items: Items | null;
  template: BackendTemplate;
  source: Source;
  currentDashboard?: string;
  dashboardBehavior?: "auto" | "current" | "new";
  /**
   * Resolve the backend Source for a single widget id. When provided, each widget is
   * resolved against its own Source (multi-origin apps); when omitted, the single
   * `source` is used for every widget (the apps-gallery path).
   */
  resolveWidgetSource?: (widgetId: string) => Source | undefined;
  resolveWidget?: (widgetId: string) => Widget | WidgetJsonT | WidgetT | undefined;
}): Promise<string | undefined> {
  const sourceId = source.id ?? source.uuid;
  const templateId = `custom-${sourceId}-${slugify(template.name)}` as const;
  const { index, tabName, navigateTo } = getUntouchedAppTabInfo(
    templateId,
    template.name,
    items,
    dashboardBehavior === "auto",
  );

  if (navigateTo) {
    if (navigate) navigate(navigateTo);
    return index;
  }

  const currentDashboardItem = items?.[currentDashboard];
  const hasZeroWidgets = currentDashboardItem?.data?.widgets?.length === 0;

  const shouldUseCurrentDashboard =
    !!currentDashboard &&
    dashboardBehavior !== "new" &&
    (dashboardBehavior === "current" || hasZeroWidgets);
  const id = shouldUseCurrentDashboard ? currentDashboard : uuidv4();
  const gridLayout = {} as GridLayout;
  const templateWidgets: (Widget | WidgetJsonT)[] = [];
  const unresolvedWidgetIds = new Set<string>();

  template = backendTemplateSchema.parse(template) as unknown as BackendTemplate;

  const temporaryGroups =
    template.groups?.map((group, index) => {
      const groupId = uuidv4();
      const color = COLORS[index % COLORS.length];

      if (
        typeof group.defaultValue === "string" &&
        group.defaultValue.startsWith("$currentDate")
      ) {
        group.defaultValue = currentDateModifier(group.defaultValue);
      }

      return {
        id: groupId,
        color,
        name: group.name,
        type: group.type ?? "endpointParam",
        groupById: group.paramName,
        // adding temporarily so i can match the widgets to the groups,
        // we remove this later before creating the dashboard
        widgetIds: group.widgetIds,
        value: group.defaultValue,
      } as GroupTypeT<"endpointParam" | "param" | "ticker"> & { widgetIds: string[] };
    }) || [];

  let hasNavigationBar = false;
  for (const tabId in template.tabs) {
    if (template.tabs.hasOwnProperty(tabId)) {
      const tab = template.tabs[tabId];
      gridLayout[tab.id] = [];

      for await (const layout of tab.layout) {
        const { i: widgetId, state, groups, ...restGridData } = layout;
        const widgetSource = resolveWidgetSource
          ? resolveWidgetSource(widgetId)
          : source;
        const sourceWidget = widgetSource?.widgets?.[widgetId];

        if (widgetId === "navigation_bar") {
          hasNavigationBar = true;
          continue;
        }

        const appWidget =
          resolveWidget?.(widgetId) ??
          (sourceWidget && widgetSource
            ? createSourceWidget({ ...sourceWidget, widgetId }, widgetSource)
            : getJsonWidget(widgetId));

        if (!appWidget) {
          if (resolveWidgetSource || resolveWidget) unresolvedWidgetIds.add(widgetId);
          continue;
        }

        const { gridData, ...widget } = appWidget as Widget;

        const isMinimized = restGridData.minimized === true || restGridData.h === 1;
        const originalH = isMinimized ? restGridData.h : gridData?.h || restGridData.h;

        const endpointParams = (widget?.params ?? []).reduce<Record<string, string>>(
          (acc, p) => {
            if (p.type === "endpoint" && p.groupById) acc[p.paramName] = p.groupById;
            return acc;
          },
          {},
        );

        const widgetUniqueId = uuidv4();

        const finalGridData = getGridData(
          undefined,
          { ...(gridData || {}), ...restGridData, i: widgetUniqueId },
          { keepXY: true },
        );
        if (isMinimized) {
          finalGridData.originalMinH = finalGridData.minH;
          finalGridData.minH = 1.4;
          finalGridData.h = 1.4;
        }
        gridLayout[tab.id].push(finalGridData);

        const tempGroups = temporaryGroups.filter((g) => groups?.includes(g.name));

        for await (const group of tempGroups) {
          if (
            group?.type === "endpointParam" &&
            !group?.groupById &&
            widget.groupById
          ) {
            group.groupById = widget.groupById;
          }

          if (group?.type === "endpointParam" && endpointParams?.[group?.groupById]) {
            group.groupById = endpointParams?.[group?.groupById];
          }

          if (group?.type === "param" || group?.type === "endpointParam") {
            widget.paramGroups = addToWidgetParamGroups(widget?.paramGroups, group);
          }

          if (group?.type === "ticker") {
            if (!group?.value?.symbol) {
              group.value = tickerFromSymbol(group?.value as unknown as string);
            }

            widget.data = {
              ...(widget.data ?? {}),
              mainTicker: group.value,
            };
            widget.groupId = group.id;
          }
        }

        widget.params = updateParamOrder(state?.paramOrder, widget.params ?? []);

        const { params = {}, storage } = recursiveCleanKeys(state ?? {}) as NonNullable<
          TabLayout["state"]
        >;
        if (someTruthy(...Object.values(state ?? {}))) {
          widget.storage = {
            ...(widget.storage ?? {}),
            ...(storage ?? {}),
            params,
          };
        }

        const tickerParamName = getTickerParamName(widget as Widget);
        const tickerSymbols = tickerParamName
          ? getTickerSymbolsFromParams(params, tickerParamName)
          : [];
        const tickerSymbol = tickerSymbols[0];
        if (tickerParamName && tickerSymbol) {
          const mainTicker = tickerFromSymbol(tickerSymbol);
          widget.data = {
            ...(widget.data ?? {}),
            mainTicker,
          };
          widget.storage = {
            ...(widget.storage ?? {}),
            params: {
              ...(widget.storage?.params ?? {}),
              ...params,
              [tickerParamName]:
                typeof params[tickerParamName] === "string"
                  ? tickerSymbols.join(",")
                  : mainTicker.symbol,
            },
          };
        }

        // Create widget instance
        templateWidgets.push({
          ...widget,
          id: widgetUniqueId,
          innerTab: tab.id,
          isMinimized,
          originalH,
        });
      }
    }
  }

  if (unresolvedWidgetIds.size > 0) {
    throw new Error(
      `Unable to create app because these widgets are unavailable: ${[
        ...unresolvedWidgetIds,
      ].join(", ")}`,
    );
  }

  if (Object.keys(gridLayout).length > 1 || hasNavigationBar) {
    const widget = getJsonWidget("navigation_bar");
    const tabStorage = Object.values(template.tabs).map((tab) => ({
      id: tab.id,
      name: tab.name,
    }));
    const widgetUniqueId = uuidv4();
    const navigationWidget = {
      ...widget,
      id: widgetUniqueId,
      storage: { tabs: tabStorage },
      innerTab: Object.keys(gridLayout)[0],
    } as Widget;

    templateWidgets.push(navigationWidget);
  }

  // we need to remove widgetIds from groups
  const newGroups = temporaryGroups.map((group) => {
    const { widgetIds, ...restGroup } = group;
    return restGroup;
  });

  if (template.selected_agent) {
    const availableCopilots = await getExternalCopilotHolders();
    const copilot = availableCopilots
      .flatMap((copilot) => copilot.copilots || [])
      .find((c) => [c.id, c.name].some((name) => name === template.selected_agent));

    if (copilot) {
      useCopilotStore.getState().setSelectedCopilot(copilot);
      document.getElementById("expand-copilot-btn")?.click();
      document.getElementById("expand-copilot-mobile-btn")?.click();
    }

    if ((template.prompts?.length ?? 0) > 0) {
      setTimeout(() => {
        useThemeStore.getState().setPromptsSuggestionsMenuOpen(true);
      }, 400);
    }
  }

  addTab(
    {
      index: id,
      data: {
        name: tabName ?? template.name,
        templateId,
        type: "template",
        widgets: templateWidgets,
        gridLayout,
        groups: newGroups,
      },
    },
    true,
  );

  if (navigate) navigate(`/app/${id}`);
  return id;
}

export async function openListedApp({
  source,
  items,
  addTab,
  navigate,
  currentDashboard,
}: {
  source: Source | null | undefined;
  items: Items | null;
  addTab: AppState["addTab"];
  navigate?: NavigateFunction;
  currentDashboard?: string;
}) {
  if (!source) return false;
  const template = source.templates?.[0];
  if (!template) return false;

  return await createCustomTemplateTab({
    addTab,
    navigate,
    items,
    template,
    source,
    currentDashboard,
  });
}

export function extractCustomTemplateInfo(templateId = "") {
  const groups = templateId.match(
    /custom-(?<sourceId>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(?<templateName>.+)/,
  )?.groups as { sourceId: string; templateName: string };

  return groups ?? { sourceId: null, templateName: null };
}
