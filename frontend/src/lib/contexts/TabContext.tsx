import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Layout } from "react-grid-layout";
import { useShallowAppStore, type Widget } from "~/lib/state/app";
import { useShallowSharedAppStore } from "~/lib/state/sharedApp";

export type GridItem = Layout & { mobileH?: number };

export type TabProviderProps = {
  currentTab: string;
  tabId?: string;
  layouts: GridItem[];
  isShared?: boolean;
  setLayouts?: (layouts: GridItem[]) => void;
  children: ReactNode;
};

type TabContextType = Omit<TabProviderProps, "children"> & {
  getWidget: (widgetId: string) => Widget | undefined;
};

export const TabContext = createContext<TabContextType | null>(null);

export function useTabContext() {
  const context = useContext(TabContext);
  if (!context) {
    throw new Error("useTabContext must be used within a TabProvider");
  }
  return context;
}

export function TabProvider(props: TabProviderProps) {
  const { children, currentTab, tabId, layouts, isShared } = props;
  const [internalLayouts, setInternalLayouts] = useState(layouts);

  const getSharedWidgetById = useShallowSharedAppStore((state) => state.getWidgetById);
  const { getWidgetById, updateTabData } = useShallowAppStore((state) => ({
    getWidgetById: state.getWidgetById,
    updateTabData: state.updateTabData,
  }));

  const setLayoutsCb = useCallback(
    (layouts: Layout[]) => {
      if (props.setLayouts) {
        props.setLayouts(layouts);

        console.log("setLayoutsCb called");
      }
      setInternalLayouts(layouts);
    },
    [props.setLayouts],
  );

  const getWidget = useCallback(
    (widgetId: string) => {
      if (!isShared) {
        return getWidgetById(widgetId);
      }
      return getSharedWidgetById(widgetId);
    },
    [isShared, getWidgetById, getSharedWidgetById, tabId],
  );

  useEffect(() => {
    if (tabId) updateTabData(tabId, { lastUpdated: Date.now() });
  }, [tabId]);

  const propsMemo = useMemo(
    () => ({
      currentTab,
      tabId,
      layouts: internalLayouts,
      isShared,
      setLayouts: setLayoutsCb,
      getWidget,
    }),
    [currentTab, tabId, internalLayouts, isShared, setLayoutsCb, getWidget],
  );

  const childrenMemo = useMemo(() => children, [children]);

  return <TabContext.Provider value={propsMemo}>{childrenMemo}</TabContext.Provider>;
}
