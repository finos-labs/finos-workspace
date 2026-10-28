import Fuse from "fuse.js";
import { useCallback, useEffect, useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { type InnerTab, type Item, useShallowAppStore } from "~/lib/state/app";
import {
  type CopilotWidget,
  type Mention,
  useShallowCopilotStore,
} from "~/lib/state/copilot";
import { useShallowCopilotDataStore } from "~/lib/state/copilotData";
import { useShallowMentionsStore } from "~/lib/state/mentions";
import { createCopilotWidget } from "./useGetCopilotWidgets";

const GROUP_ORDER = ["tab", "dashboard", "all"];

const trigger = "@";

function getDashboardOptions(dashboardWidgets: CopilotWidget[]) {
  return dashboardWidgets
    .map((w) => ({
      id: `widget_id=${w.widget_id}&uuid=${w.uuid}`,
      group: "dashboard",
      trigger: trigger,
      name: w.name.replace(/ /g, "\u00A0").replace(/-/g, "\u2011"),
      description: w.description,
      content: w,
    }))
    .sort((a, b) => a.name.localeCompare(b.name)) as Mention[];
}

function getAllOptions(allWidgets: CopilotWidget[]) {
  return allWidgets
    .map((w) => ({
      id: w.widget_id,
      group: "all",
      trigger: trigger,
      name: w.name.replace(/ /g, "\u00A0").replace(/-/g, "\u2011"),
      description: w.description,
      content: w,
    }))
    .sort((a, b) => a.name.localeCompare(b.name)) as Mention[];
}

function getCurrentDashboardTabOptions(currentDashboard: Item | null) {
  const tabOptions: Mention[] = [];

  if (!currentDashboard?.data) return tabOptions;

  const allDashboardWidgets = currentDashboard.data.widgets || [];

  const navigationBarWidget = allDashboardWidgets.find(
    (w) => w.widgetId === "navigation_bar",
  );

  const tabStorage: InnerTab[] = navigationBarWidget?.storage?.tabs || [];
  const gridLayoutTabs = currentDashboard.data.gridLayout
    ? Object.keys(currentDashboard.data.gridLayout)
    : [];

  const allTabIds = new Set<string>();

  for (const tabId of gridLayoutTabs) if (tabId) allTabIds.add(tabId);
  for (const tab of tabStorage) if (tab.id) allTabIds.add(tab.id);
  for (const widget of allDashboardWidgets) {
    if (widget.innerTab && widget.widgetId !== "navigation_bar")
      allTabIds.add(widget.innerTab);
  }

  if (allTabIds.size <= 1) return tabOptions;

  for (const innerTabId of allTabIds) {
    const tabDashboardWidgets = allDashboardWidgets.filter(
      (w) =>
        w.innerTab === innerTabId &&
        !w?.disableRetrievalForCopilot &&
        w.widgetId !== "navigation_bar",
    );

    const tabWidgets = tabDashboardWidgets
      .map((widget) =>
        createCopilotWidget(widget.id, widget, {
          category: widget.category,
          subCategory: widget.subCategory,
          source: widget.source,
          connectionType: widget.connectionType,
        }),
      )
      .filter(Boolean) as CopilotWidget[];

    const widgetCount = tabWidgets.length;

    if (widgetCount === 0) continue;

    const tabInfo = tabStorage.find((tab) => tab.id === innerTabId);
    const tabDisplayName = tabInfo?.name || innerTabId;

    const widgetIds = tabDashboardWidgets.map((w) => w.id);

    tabOptions.push({
      id: `tab_id=${currentDashboard.index}&inner_tab=${innerTabId}`,
      group: "tab",
      trigger: trigger,
      name: tabDisplayName.replace(/ /g, "\u00A0").replace(/-/g, "\u2011"),
      description: `(${widgetCount} widget${widgetCount !== 1 ? "s" : ""})`,
      content: {
        origin: currentDashboard.index,
        widget_id: `tab_${currentDashboard.index}_${innerTabId}`,
        uuid: `tab_${currentDashboard.index}_${innerTabId}`,
        name: tabDisplayName,
        description: `(${widgetCount} widget${widgetCount !== 1 ? "s" : ""})`,
        params: [],
        metadata: {
          tabId: currentDashboard.index,
          innerTabId: innerTabId,
          widgetIds: widgetIds,
          widgetCount: widgetCount,
          tabWidgets: tabWidgets,
        },
      } as CopilotWidget,
    });
  }

  return tabOptions.sort((a, b) => a.name.localeCompare(b.name));
}

function getOptionsMap(
  allWidgets: CopilotWidget[],
  dashboardWidgets: CopilotWidget[],
  currentDashboard: Item | null,
  hasWidgetDashboardSelect = false,
  hasWidgetDashboardSearch = false,
) {
  const dashboardOptions = hasWidgetDashboardSelect
    ? getDashboardOptions(dashboardWidgets)
    : [];
  const allOptions = hasWidgetDashboardSearch ? getAllOptions(allWidgets) : [];
  const tabOptions = hasWidgetDashboardSelect
    ? getCurrentDashboardTabOptions(currentDashboard)
    : [];
  const map = new Map<string, Mention>();

  if (!(hasWidgetDashboardSelect || hasWidgetDashboardSearch)) return map;

  for (const option of tabOptions.concat(dashboardOptions, allOptions))
    map.set(option.id, option);

  return map;
}

export function useMentions() {
  const { getMention, getOptionsArray, optionsMap } = useShallowMentionsStore(
    (state) => ({
      getMention: state.getMention,
      getOptionsArray: state.getOptionsArray,
      optionsMap: state.optionsMap,
    }),
  );

  const getTabById = useShallowAppStore((state) => state.getTabById);

  const processMentions = useCallback(
    (prompt: string): { result: string; mentions: Mention[] } => {
      let result = prompt || "";
      const mentions: Mention[] = [];

      try {
        const mentionPattern = new RegExp(`\\${trigger}\\[(.*?)\\]`, "g");
        result = result.replace(mentionPattern, (fullMatch, mentionContent: string) => {
          const mentionObject = mentionContent
            .split(",")
            .reduce<Record<string, string>>((acc, pair) => {
              const [key, value] = pair.split(":").map((item) => item.trim());
              if (key && value) acc[key] = value;
              return acc;
            }, {});

          const mention = getMention(mentionObject.id);
          if (mention) {
            mentions.push(mention);
            return `${trigger}${mention.name}`;
          }

          const tabIdRegex = /^tab_id=(?<tabId>[^&]+)&inner_tab=(?<innerTabId>[^&]+)$/;

          if (!tabIdRegex.test(mentionObject.id)) return fullMatch;

          const match = mentionObject.id.match(tabIdRegex);
          const { tabId = "", innerTabId } = match?.groups || {};

          const tabOptions = getCurrentDashboardTabOptions(getTabById(tabId) ?? null);
          const tabMention = tabOptions.find(
            (option) => option.content?.metadata?.innerTabId === innerTabId,
          );
          if (tabMention) {
            mentions.push(tabMention);
            return `${trigger}${tabMention.name}`;
          }

          return fullMatch;
        });
      } catch (error) {
        console.error("Error parsing mentions", error);
      }
      return { result, mentions };
    },
    [getMention, optionsMap],
  );

  const restoreMentions = useCallback((prompt: string, mentions: Mention[]): string => {
    let reversedPrompt = prompt;
    const sortedMentions = [...mentions].sort((a, b) => b.name.length - a.name.length);

    sortedMentions.forEach((mention) => {
      const displayMention = `${mention.trigger}${mention.name}`.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&",
      );
      const regex = new RegExp(displayMention, "g");
      reversedPrompt = reversedPrompt.replace(
        regex,
        `${mention.trigger}[id:${mention.id}]`,
      );
    });
    return reversedPrompt;
  }, []);

  const removeMentionFromText = useCallback(
    (currentText: string, widgetUuid: string): string => {
      if (!currentText) return currentText;

      const { mentions } = processMentions(currentText);

      const mentionToRemove = mentions.find(
        (mention) => mention.content?.uuid === widgetUuid,
      );

      if (mentionToRemove) {
        const rawText = restoreMentions(currentText, mentions);
        const mentionPattern = `@\\[id:${mentionToRemove.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]`;
        const updatedRawText = rawText
          .replace(new RegExp(mentionPattern, "g"), "")
          .trim();

        return `${updatedRawText.trim()}  `;
      }

      return currentText;
    },
    [processMentions, restoreMentions],
  );

  const search = useCallback(
    (query: string, threshold = 0) => {
      const optionsArray = getOptionsArray();
      if (query === trigger) return optionsArray;
      const sequence = query.substring(trigger.length);
      if (sequence === " ") return [];
      const fuse = new Fuse(optionsArray, {
        keys: ["name"],
        threshold: threshold,
      });
      const widgetIdGroupMap = new Map<string, string>();
      const result = (
        fuse
          .search(sequence)
          .map((result) => {
            if (sequence.length > result.item.name.length) return null;
            return result.item;
          })
          .filter(Boolean) as Mention[]
      )
        .sort((a, b) => {
          const indexA = GROUP_ORDER.indexOf(a.group);
          const indexB = GROUP_ORDER.indexOf(b.group);
          return indexA - indexB;
        })
        .filter((item) => {
          const widgetIdMatch = item.id.match(/widget_id=([^&]+)/);
          const widgetId = widgetIdMatch?.[1] ?? item.id;
          const group = widgetIdGroupMap.get(widgetId);
          if (group && group !== item.group) return false;
          widgetIdGroupMap.set(widgetId, item.group);
          return true;
        }) as Mention[];
      return result;
    },
    [getOptionsArray],
  );

  return useMemo(
    () => ({
      trigger,
      search,
      processMentions,
      restoreMentions,
      removeMentionFromText,
    }),
    [processMentions, restoreMentions, removeMentionFromText, search],
  );
}

export function useInitMentions() {
  const { id: currentDashboardId } = useParams();
  const [searchParams] = useSearchParams();

  const { getTabById, lastInnerTab } = useShallowAppStore((state) => ({
    getTabById: state.getTabById,
    lastInnerTab: currentDashboardId
      ? state.getLastInnerTab(currentDashboardId)
      : undefined,
  }));

  const currentInnerTab = useMemo(
    () => searchParams.get("tab") || lastInnerTab || "",
    [lastInnerTab, searchParams.get("tab")],
  );

  const state = useShallowCopilotDataStore((s) => {
    const { allDashboardWidgets, allWidgets } = s.getCopilotWidgets();
    return { allDashboardWidgets, allWidgets };
  });

  const { widgetDashboardSelectFF, widgetDashboardSearchFF } = useShallowCopilotStore(
    (state) => ({
      widgetDashboardSelectFF:
        state.selectedCopilot?.features?.["widget-dashboard-select"] === true,
      widgetDashboardSearchFF:
        state.selectedCopilot?.features?.["widget-dashboard-search"] === true,
    }),
  );

  const setOptionsMap = useShallowMentionsStore((state) => state.setOptionsMap);

  useEffect(() => {
    const currentDashboard = currentDashboardId
      ? (getTabById(currentDashboardId) ?? null)
      : null;

    setOptionsMap(
      getOptionsMap(
        state.allWidgets,
        state.allDashboardWidgets,
        currentDashboard,
        widgetDashboardSelectFF,
        widgetDashboardSearchFF,
      ),
    );
  }, [
    state,
    currentDashboardId,
    widgetDashboardSearchFF,
    widgetDashboardSelectFF,
    currentInnerTab,
  ]);
}
