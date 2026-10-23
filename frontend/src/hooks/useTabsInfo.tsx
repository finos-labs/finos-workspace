import { useMemo } from "react";
import type { Item } from "~/lib/state/app";
import type { TabInfo } from "~/lib/utils";

export interface TabsInfoResult {
  hasMultipleTabs: boolean;
  tabsInfo: TabInfo[];
}

export function extractTabsFromItem(item: Item | null | undefined): TabInfo[] {
  const gridLayout = item?.data?.gridLayout || {};
  const validTabIds = Object.keys(gridLayout).filter(
    (k) => k && gridLayout[k]?.length > 0,
  );

  if (validTabIds.length === 0) {
    return [];
  }

  const navBarWidget = item?.data?.widgets?.find(
    (w) => w.widgetId === "navigation_bar",
  );
  const storedTabs = navBarWidget?.storage?.tabs as TabInfo[] | undefined;

  const tabsInfo: TabInfo[] = validTabIds.map((tabId) => {
    const storedTab = storedTabs?.find((t) => t.id === tabId);
    return { id: tabId, name: storedTab?.name || tabId };
  });

  if (storedTabs) {
    tabsInfo.sort((a, b) => {
      const aIndex = storedTabs.findIndex((t) => t.id === a.id);
      const bIndex = storedTabs.findIndex((t) => t.id === b.id);
      return aIndex - bIndex;
    });
  }

  return tabsInfo;
}

export function useTabsInfo(dashboard: Item | null | undefined): TabsInfoResult {
  return useMemo(() => {
    const tabsInfo = extractTabsFromItem(dashboard);

    return {
      hasMultipleTabs: tabsInfo.length > 1,
      tabsInfo,
    };
  }, [dashboard?.data?.gridLayout, dashboard?.data?.widgets]);
}
