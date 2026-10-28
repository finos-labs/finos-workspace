import cloneDeep from "lodash/cloneDeep";
import debounce from "lodash/debounce";
import isEqual from "lodash.isequal";
import type { Layout } from "react-grid-layout";
import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";
import { subscribeWithSelector } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";
import { shallow } from "zustand/shallow";
import { createWithEqualityFn } from "zustand/traditional";
import { postDashboards } from "~/api/dashboard.api";
import type {
  GridDataT as GridData,
  GridLayoutT as GridLayout,
  GroupT as Group,
  GroupTypeT,
  NewWidget,
  ParamDef,
  WidgetT as Widget,
  WidgetJsonT,
} from "~/components/types";
import type { DashSync } from "~/types/auth.type";
import {
  addDuplicateWidgetToItem,
  addToWidgetParamGroups,
  createRootFolder,
  deleteItemFn,
  diffItemsWithRemote,
  duplicateTabItem,
  getInnerTabsGridLayout,
  getStoredFileUUIDs,
  getValidItems,
  getWidgetData,
  getWidgetGroupValue,
  removeDuplicateNavBarWidgets,
  unlinkItemFn,
  updateDependentEndpointParamGroups,
  updateWidgetGridLayout,
  updateWidgetGroupValue,
  updateWidgetInItem,
} from "../utils/app";
import { NotificationId, showNotificationWithRememberMe } from "../utils/toast";
import {
  dispatchSaveState,
  dispatchUpdateWidget,
  extractUUIDFromURL,
  scoreArrays,
  triggerCustomEvent,
} from "../utils/utils";
import { createParamDefs } from "../utils/widgetParams";
import { useAuthStore } from "./auth";
import { useCopilotDataStore } from "./copilotData";
import { useSharedAppStore } from "./sharedApp";
import { useSidebarStore } from "./sidebar";

export type Selector<S, T> = (state: S) => T;

export type KeySelector<S, K extends keyof S> = K extends keyof S ? K : never;

export type Items = {
  [key: string]: Item;
};

export type MoveToTabs = Omit<Item, "children" | "data"> & {
  data: Omit<TabData, "widgets">;
  children?: MoveToTabs[];
};

export type Item = {
  index: string;
  name?: "root" | string;
  children: string[];
  isFolder?: boolean;
  isShared?: boolean;
  isRoot?: boolean;
  isEntityShared?: boolean;
  parentId?: string;
  data: TabData;
  created_date?: string;
  updated_date?: string;
  created_by?: string;
};

export type TabData = {
  name: string;
  type?: "custom" | "template";
  templateId?: "custom" | `custom-${string}`;
  gridLayout?: GridLayout;
  widgets: Widget[];
  locked?: boolean;
  lastUpdated?: number;
  numberOfChanges?: number;
  groups: Group[];
  currentTab?: string;
  storedFileUUIDs?: string[];
};

export type SideBarItem = Omit<Item, "data"> & {
  data: Pick<TabData, "templateId" | "name" | "type"> & { hasChanges?: boolean };
};

export type SideBarItems = {
  [key: string]: SideBarItem;
};

type ItemT = Omit<Item, "data" | "children"> & {
  children?: string[];
  data: Pick<TabData, "name"> &
    Partial<Omit<TabData, "name" | "widgets">> & {
      widgets?: (Widget | WidgetJsonT)[];
    };
};

type WidgetTypes = NewWidget | WidgetJsonT;

export type InnerTab = { id: string; name: string; newId?: string };
export type InnerTabsT = { [tabId: string]: InnerTab };
export type TabParamT = { total: number; options: (string | number | boolean)[] };
export type TabParams = { [key: string]: TabParamT };
export type TabEndpointParams = { [key: string]: number };

export type AppState = {
  unSavedChanges: boolean;
  checkForChanges: () => boolean | undefined;
  getWidgetsFromGroup: (groupId: string, tabId?: string) => Widget[];
  getRootTabs: () => Item[];
  getMoveToTabs: (currentTab: string) => MoveToTabs[];
  isDashboardShared: (id: string) => boolean;
  setDashboardShared: (id: string, shared: boolean) => void;
  getLatestDashboard: () => string | undefined;
  setTabLocked: (tabId: string, locked: boolean) => void;
  moveTabToFolder: (folderId: string, tabId: string, newName: string) => void;
  getAllTabs: () => Item[];
  getAllFoldersFlat: () => SideBarItem[];
  getAllTabActiveGroups: (tabId: string) => Group[];
  updateItemName: (id: string, newName: string) => void;
  deleteFolder: (id: string) => void;
  deleteGroup: (tabId: string, groupId: string) => void;
  updateGroup: (
    tabId: string,
    groupId: string,
    group: Group,
    updateDependentGroups?: boolean,
  ) => void;
  setWidgetGroupId: (
    tabId: string,
    widgetId: string,
    group: Group,
    remove?: boolean,
  ) => void;
  getWidgetGroups: (tabId: string, widgetId: string | undefined) => Group[];
  addGroup: (tabId: string, group: Group) => void;
  duplicateWidgetById: (tabId: string, widgetId: string) => void;
  duplicateWidget: (tabId: string, widget: Widget) => void;
  duplicateTab: (id: string) => string | undefined;
  currentTabParams: TabParams;
  currentEndpointParams: TabEndpointParams;
  updateTabParams: (tabId: string) => void;
  items: Items | null;
  hasItems: boolean;
  rootItem: SideBarItem | null;
  sideBarItems: SideBarItems;
  itemsStoredInCloud: Items | null;
  getSideBarItem: (id: string) => SideBarItem | undefined;
  updateItemsStoredInCloud: (items: Items) => void;
  updateItems: (items: SideBarItems) => void;
  deletedItems: string[];
  getLastInnerTab: (tabId: string) => string | undefined;
  addTab: (tab: ItemT, ignoreGridDataComputations?: boolean) => void;
  getTabById: (id: string) => Item | undefined;
  getTabWidgetById: (tabId: string, widgetId: string) => Widget | undefined;
  removeTab: (id: string, navigate?: (id: string) => void) => void;
  updateTabData: (
    id: string,
    data: Partial<
      Omit<TabData, "widgets" | "groups" | "gridLayout" | "storedFileUUIDs">
    >,
  ) => void;
  updateInnerTabs: (tabId: string, innerTabs: InnerTabsT) => void;
  addWidget: (tabId: string, widget: WidgetTypes) => Promise<string | undefined>;
  addWidgets: (tabId: string, widget: WidgetTypes[]) => Promise<string | undefined>;
  addWidgetsToTabs: (
    tabIds: string[],
    widget: WidgetTypes | WidgetTypes[],
  ) => Promise<void>;
  getWidgetById: (widgetId: string) => Widget | undefined;
  getWidgetsByAttribute: <T extends keyof Widget>(
    attribute: T,
    value: Widget[T],
  ) => { [tabId: string]: Widget[] };
  getWidgetsByAttributes: (attributes: Partial<Widget>) => {
    [tabId: string]: Widget[];
  };
  removeWidget: (tabId: string, widgetId: string) => void;
  updateWidget: (tabId: string, widget: Widget) => void;
  updateTabWidgetsLayout: (
    tabId: string,
    widgetsLayout: Layout[],
    currentTab?: string,
  ) => void;
  moveFolderToFolder: (folderId: string, newFolderId: string, newName: string) => void;
  getFolderById: (id: string) => Item | undefined;
  createFolder: (folder: Item, parentFolderId?: string) => void;
  createTabInsideFolder: (folderId: string, tab: Item) => void;
  updateRemoteItems: (remoteData: DashSync<"owned">) => void;
  updateOnlyItems: (items: Items) => void;
  saveDashboards: (props?: { logout?: boolean; withNotification?: boolean }) => void;
  debounceSaveDashboards: () => Promise<void> | undefined;
  getWidgetGridData: (tabId: string, widgetId: string) => GridData | undefined;
  minimizeWidget: (
    tabId: string,
    widgetId: string,
    isMinimized: boolean,
    originalH?: number,
  ) => void;
};

const itemsOf = (state: AppState): Items => state.items ?? {};

function getLatestDashboardId(currentItems: Items | null) {
  const items = Object.values(currentItems || {});
  if (items.length === 0) return;

  const dashboards = items.filter((item) => !item.isFolder && item?.data?.widgets);
  const sortedDashboards = dashboards.sort((a, b) => {
    if (a.data?.lastUpdated && b.data?.lastUpdated) {
      return b.data.lastUpdated - a.data.lastUpdated;
    }
    return 0;
  });
  return sortedDashboards?.[0]?.index;
}

function getSideBarItems(items: Items): SideBarItems {
  return Object.entries(items).reduce<SideBarItems>((acc, [key, item]) => {
    const { data, ...rest } = item;
    const lastUpdated = data?.lastUpdated || 0;
    acc[key] = {
      ...rest,
      ...(item.updated_date && lastUpdated > Date.parse(item.updated_date)
        ? { updated_date: new Date(lastUpdated).toISOString() }
        : {}),
      data: {
        name: item.data?.name,
        type: item.data?.type,
        templateId: item.data?.templateId,
        hasChanges: (item.data?.numberOfChanges ?? 0) > 0,
      },
    };
    return acc;
  }, {});
}

function getRootItem(sideBarItems: SideBarItems, state?: AppState): SideBarItem | null {
  const rootIndex = state?.rootItem?.index;
  const rootItem = rootIndex === undefined ? undefined : sideBarItems[rootIndex];
  if (!rootItem) return Object.values(sideBarItems || {}).find((i) => i.isRoot) ?? null;
  return rootItem;
}

function updateSideBarItems(newItems: Items, state?: AppState) {
  const sideBarItems = getSideBarItems(newItems);
  const rootItem = getRootItem(sideBarItems, state);
  const hasItems =
    rootItem?.index !== undefined &&
    (sideBarItems[rootItem.index]?.children?.length ?? 0) > 0;

  return { sideBarItems, rootItem, hasItems };
}

export const useAppStore = createWithEqualityFn<AppState>()(
  subscribeWithSelector((set, get: () => AppState) => ({
    sideBarItems: {},
    rootItem: null,
    hasItems: false,
    unSavedChanges: false,
    checkForChanges: () => {
      dispatchSaveState();
      const { items, itemsStoredInCloud } = get();
      if (!(items && itemsStoredInCloud)) return;

      const diff = diffItemsWithRemote(items, itemsStoredInCloud);
      set({ unSavedChanges: Object.keys(diff).length > 0 });
      return Object.keys(diff).length > 0;
    },
    saveDashboards: async (props) => {
      const { logout = false, withNotification = false } = props ?? {};
      const { items, itemsStoredInCloud } = get();
      if (!(items && itemsStoredInCloud)) return;

      try {
        const diff = diffItemsWithRemote(items, itemsStoredInCloud);
        if (Object.keys(diff).length > 0) {
          if (import.meta.env.DEV) console.log(items, itemsStoredInCloud, diff);
          await postDashboards(diff).then((_res) => {
            get().updateItemsStoredInCloud(items);
          });
          if (withNotification) toast.success("Dashboards saved");

          if (logout) useAuthStore.getState().logout();
          return;
        }
      } catch (_e) {
        if (logout) useAuthStore.getState().logout();
      }

      if (import.meta.env.DEV)
        console.log("No dashboard changes found", logout ? " - Logging out" : "");
      if (withNotification) toast.success("Dashboards saved");

      if (logout) useAuthStore.getState().logout();
    },
    debounceSaveDashboards: debounce(async () => {
      dispatchSaveState();
      get().saveDashboards();
    }, 2000),
    isDashboardShared: (id: string) => {
      const { items } = get();
      const item = items?.[id];
      if (!item) {
        const sharedItems = useSharedAppStore?.getState().sharedItems;
        const sharedItem = sharedItems?.[id];
        return sharedItem?.isShared ?? false;
      }
      return item?.isShared ?? false;
    },
    setDashboardShared: (id: string, shared: boolean) => {
      const { items } = get();
      const item = items?.[id];
      if (!item) return;

      set((state: AppState) => {
        const newItems = {
          ...state.items,
          [id]: {
            ...itemsOf(state)[id],
            isShared: shared,
          },
        };

        return {
          items: newItems,
          ...updateSideBarItems(newItems, state),
        };
      });
    },
    getWidgetsFromGroup: (groupId: string, tabId?: string) => {
      const dashboards = get().items ?? {};
      let widgetsList: Widget[] = tabId ? dashboards[tabId]?.data?.widgets || [] : [];

      if (!tabId) {
        widgetsList = Object.values(dashboards).flatMap(
          (item) => item?.data?.widgets || [],
        );
      }

      return widgetsList.filter((w) =>
        Object.values(w.paramGroups || {}).includes(groupId),
      );
    },
    getRootTabs: () => {
      const items = get().items;
      if (!items) return [];

      const root = Object.values(items).find((item) => item.isRoot);
      const rootChildren = root?.children || [];
      const allTabs: Item[] = [];
      const getAllChildrenTabs = (children: string[]) => {
        for (const childId of children) {
          const child = items[childId];

          if (!child) continue;

          if (child.isFolder) {
            getAllChildrenTabs(child.children);
          } else {
            allTabs.push(child);
          }
        }
      };
      getAllChildrenTabs(rootChildren);
      return allTabs;
    },
    getMoveToTabs: (currentTab: string) => {
      const { items } = get();
      if (!items) return [];
      const root = Object.values(items).find((item) => item.isRoot);
      const rootChildren = root?.children || [];

      const recursiveGetMoveToTabs = (children: string[]): MoveToTabs[] => {
        const tabs: MoveToTabs[] = [];
        for (const childId of children) {
          const child = items[childId];
          if (!child) continue;

          const {
            data: { widgets: _widgets, ...data },
            ...rest
          } = child;
          if (child.isFolder && child.children.length > 0) {
            const children = recursiveGetMoveToTabs(child.children);
            tabs.push({ ...rest, data, children });
            continue;
          }

          if (child.index !== currentTab) {
            tabs.push({ ...rest, data, children: [] });
          }
        }
        return tabs;
      };

      const moveToTabs = recursiveGetMoveToTabs(rootChildren);

      moveToTabs.sort((a, b) => (a.isFolder ? -1 : 1) - (b.isFolder ? -1 : 1));

      const gridLayout = getInnerTabsGridLayout(items[currentTab]?.data?.gridLayout);

      const currentItem = items[currentTab];
      if (currentItem && Object.keys(gridLayout).length > 1) {
        const {
          data: { widgets: _widgets, ...data },
          ...rest
        } = currentItem;
        moveToTabs.unshift({ ...rest, data, children: [] });
      }

      return moveToTabs;
    },
    updateOnlyItems: (items: Items) => {
      if (!items) return;

      set((state: AppState) => ({
        items: cloneDeep(items),
        ...updateSideBarItems(items, state),
      }));
    },
    updateRemoteItems: (remoteData) => {
      set((_state: AppState) => {
        if (!remoteData || Object.keys(remoteData).length === 0) {
          const root = createRootFolder();
          const items: Items = { [root.index]: root };
          const sideBarItems = getSideBarItems(items);
          return {
            items,
            itemsStoredInCloud: cloneDeep(items),
            rootItem: sideBarItems[root.index],
            hasItems: false,
          };
        }

        const filteredRemoteItems = {} as Items;

        for (const key in remoteData) {
          const { content, is_shared, created_date, updated_date, created_by } =
            remoteData[key];
          if (content && Object.keys(content).length > 0) {
            filteredRemoteItems[key] = content;
            filteredRemoteItems[key].isShared = is_shared;
            filteredRemoteItems[key].created_date = created_date as unknown as string;
            filteredRemoteItems[key].updated_date = updated_date as unknown as string;
            filteredRemoteItems[key].created_by = created_by;
          }
        }

        if (import.meta.env.DEV) {
          console.log("remoteData", remoteData);
          console.log("filteredRemoteItems", filteredRemoteItems);
        }

        for (const key in filteredRemoteItems) {
          const item = filteredRemoteItems[key];
          if (item?.isFolder && (item?.children?.length ?? 0) > 0) {
            filteredRemoteItems[key].children = item.children.filter(
              (child: string) => {
                const childItem = filteredRemoteItems[child];
                return childItem?.data?.name;
              },
            );
          }
        }

        const validItems = getValidItems(filteredRemoteItems);
        if (import.meta.env.DEV) console.log("validItems", validItems);

        const clonedItems = cloneDeep(validItems);
        return {
          items: clonedItems,
          itemsStoredInCloud: cloneDeep(validItems),
          ...updateSideBarItems(clonedItems),
        };
      });
    },
    getLatestDashboard: () => getLatestDashboardId(get().items),
    createTabInsideFolder: (folderId: string, tab: Item) => {
      const { items, addTab } = get();
      if (!items?.[folderId]) return;

      addTab({
        ...tab,
        isFolder: false,
        parentId: folderId,
        data: {
          ...tab.data,
          numberOfChanges: 0,
          lastUpdated: Date.now(),
          widgets: [],
        },
      });
    },
    currentTabParams: {},
    currentEndpointParams: {},
    updateTabParams: (tabId: string) => {
      const { items } = get();
      const sharedItems = useSharedAppStore?.getState().sharedItems;
      const tab = items?.[tabId] || sharedItems?.[tabId];
      if (!tab) return;

      const { tabParamOptions, endpointParams } = (tab?.data?.widgets || []).reduce(
        (acc, w) => {
          const params = createParamDefs({ params: w.params || [] });
          for (const param of params) {
            if (param.type === "endpoint") {
              const groupById = param.groupById;
              if (groupById === undefined) continue;
              if (!acc.endpointParams[groupById]) acc.endpointParams[groupById] = 0;
              acc.endpointParams[groupById] += 1;
              continue;
            }
            const paramName = param.paramName;

            if (!acc.tabParamOptions[paramName]) acc.tabParamOptions[paramName] = [];
            acc.tabParamOptions[paramName].push(param?.options || []);
          }

          return acc;
        },
        { tabParamOptions: {}, endpointParams: {} } as {
          tabParamOptions: { [key: string]: NonNullable<ParamDef["options"]>[] };
          endpointParams: { [key: string]: number };
        },
      );

      const uniqueParams: TabParams = {};
      const uniqueEndpointParams: TabEndpointParams = endpointParams;

      for (const paramName in tabParamOptions) {
        const paramOptions = tabParamOptions[paramName];

        if (paramOptions.every((options) => options.length === 0)) {
          uniqueParams[paramName] = {
            total: paramOptions.length,
            options: [],
          };
          continue;
        }

        paramOptions.sort((a, b) => b.length - a.length);

        for (const options of paramOptions) {
          const values = options?.map((o) => o.value) || [];

          if (!uniqueParams[paramName]) {
            uniqueParams[paramName] = { total: 1, options: values };
            continue;
          }

          const result = scoreArrays(uniqueParams[paramName].options, values);

          if (result?.score > 0.5) {
            uniqueParams[paramName].total += 1;
            uniqueParams[paramName].options = result?.matches;
          }
        }
      }

      set({
        currentTabParams: uniqueParams,
        currentEndpointParams: uniqueEndpointParams,
      });
    },
    items: null,
    itemsStoredInCloud: null,
    updateItemsStoredInCloud: (items: Items) => {
      set((_state: AppState) => ({
        itemsStoredInCloud: cloneDeep(items),
      }));
    },
    deletedItems: [],
    setTabLocked: (tabId: string, locked: boolean) => {
      set((state: AppState) => ({
        items: {
          ...state.items,
          [tabId]: {
            ...itemsOf(state)[tabId],
            data: {
              ...itemsOf(state)[tabId].data,
              locked,
            },
          },
        },
      }));
    },
    getWidgetById(widgetId: string) {
      const { items } = get();
      for (const key in items) {
        if (Object.prototype.hasOwnProperty.call(items, key)) {
          const item = items[key];
          if (item?.data?.widgets) {
            const widget = item?.data?.widgets?.find((w) => w.id === widgetId);
            if (widget) {
              return widget;
            }
          }
        }
      }
      return undefined;
    },
    getWidgetsByAttribute: <T extends keyof Widget>(attribute: T, value: Widget[T]) => {
      const { items } = get();
      if (!items) return {};

      const widgets: { [tabId: string]: Widget[] } = {};
      for (const key in items) {
        if (Object.prototype.hasOwnProperty.call(items, key)) {
          const item = items[key];
          if ((item?.data?.widgets?.length ?? 0) > 0) {
            const selections = item?.data?.widgets?.filter(
              (w) => w[attribute] === value,
            );
            widgets[item.index] = selections || [];
          }
        }
      }
      return cloneDeep({ ...widgets });
    },
    getWidgetsByAttributes: (attributes) => {
      const { items } = get();
      if (!items) return {};

      const widgets: { [tabId: string]: Widget[] } = {};
      for (const key in items) {
        if (Object.prototype.hasOwnProperty.call(items, key)) {
          const item = items[key];
          if ((item?.data?.widgets?.length ?? 0) > 0) {
            const selections = item?.data?.widgets?.filter((w) =>
              Object.entries(attributes).every(
                ([key, value]) => w[key as keyof Widget] === value,
              ),
            );
            if (selections && selections.length > 0) widgets[item.index] = selections;
          }
        }
      }
      return cloneDeep({ ...widgets });
    },
    getSideBarItem: (id: string) => {
      const { sideBarItems } = get();
      return sideBarItems?.[id];
    },
    updateItems: (sideBarItems: SideBarItems) => {
      const { items } = get();
      if (!items) return;

      const itemsToUpdate = Object.entries(sideBarItems).reduce<Items>(
        (acc, [key, item]) => {
          const currentItem = items[key];
          if (!currentItem) return acc;

          acc[key] = {
            ...currentItem,
            parentId: item.parentId,
            children: item.children,
          };
          return acc;
        },
        {},
      );

      set((state: AppState) => ({
        rootItem: getRootItem(sideBarItems, state),
        items: itemsToUpdate,
        sideBarItems,
      }));
    },
    getAllFoldersFlat: () => {
      const { rootItem, sideBarItems } = get();
      if (!(rootItem && sideBarItems)) return [];

      return rootItem.children.reduce((acc: SideBarItem[], childId: string) => {
        const child = sideBarItems[childId];
        if (!child) return acc;

        if (child.isFolder) {
          acc.push(child);
          if (child.children?.length > 0) {
            const subFolders = child.children
              .map((c) => sideBarItems[c])
              .filter((c) => c?.isFolder);
            acc.push(...subFolders);
          }
        }
        return acc;
      }, []);
    },
    createFolder: (folder: Item, parentFolderId?: string) => {
      const { items } = get();
      if (!items) return;

      const rootFolder = Object.values(items).find((item) => item.isRoot);

      const parentFolder =
        (parentFolderId === undefined ? undefined : items[parentFolderId]) ||
        rootFolder;

      if (!(parentFolder?.isRoot || parentFolder?.isFolder)) return;

      const parentId = parentFolder.index;

      set((state: AppState) => {
        const newItems = {
          ...state.items,
          [parentId]: {
            ...itemsOf(state)[parentId],
            children: [...itemsOf(state)[parentId].children, folder.index],
          },
          [folder.index]: {
            index: folder.index,
            parentId: parentId,
            isFolder: true,
            children: [],
            data: {
              name: folder.data.name,
              widgets: [],
              groups: [],
            },
          },
        };

        return {
          items: newItems,
          ...updateSideBarItems(newItems, state),
        };
      });

      triggerCustomEvent("scrollToTabItem", { tabId: folder.index });
      get().debounceSaveDashboards();
    },
    deleteFolder: (id: string) => {
      const { items } = get();
      if (!items?.[id]) return;

      const { newItems, deletedItems } = deleteItemFn(items, id);

      set((state: AppState) => ({
        items: newItems,
        deletedItems: [...state.deletedItems, ...deletedItems],
        ...updateSideBarItems(newItems, state),
      }));
      get().debounceSaveDashboards();
    },
    moveFolderToFolder: (folderId: string, newFolderId: string, newName: string) => {
      const { items } = get();
      if (!items?.[folderId]) return;

      const rootFolder = Object.values(items).find((item) => item.isRoot);
      const rootId = rootFolder?.index;

      const newItems = unlinkItemFn(items, folderId);
      const folderToMove = newItems[folderId];
      let newFolder: Item | undefined = newItems[newFolderId];

      if (newFolderId === "root") {
        newFolder = rootFolder;
        newFolderId = rootFolder?.index ?? newFolderId;
      }

      if (!newFolder) {
        const newId = uuidv4();
        newItems[newId] = {
          index: newId,
          isFolder: true,
          children: [folderId],
          parentId: rootId,
          data: {
            name: newName,
            widgets: [],
            groups: [],
          },
        };

        if (!rootFolder) return;

        newItems[rootFolder.index].children = [
          ...newItems[rootFolder.index].children,
          newId,
        ];
        newItems[folderId] = {
          ...folderToMove,
          parentId: newId,
        };

        return set((state: AppState) => ({
          items: newItems,
          ...updateSideBarItems(newItems, state),
        }));
      }

      newItems[folderId] = {
        ...folderToMove,
        parentId: newFolderId,
      };

      newItems[newFolderId] = {
        ...newFolder,
        children: [...newFolder.children, folderId],
      };

      set((state: AppState) => ({
        items: newItems,
        ...updateSideBarItems(newItems, state),
      }));

      triggerCustomEvent("scrollToTabItem", { tabId: folderId });
      get().debounceSaveDashboards();
    },
    moveTabToFolder: (folderId: string, tabId: string, newName: string) => {
      const { items } = get();
      if (!items?.[tabId]) return;

      const newItems = unlinkItemFn(items, tabId);
      let folder: Item | null | undefined = folderId ? newItems[folderId] : null;
      const rootFolder = Object.values(items).find((item) => item.isRoot);
      const rootId = rootFolder?.index;

      if (folderId === "root") {
        folder = rootFolder;
        folderId = folder?.index ?? folderId;
      }

      if (!folder) {
        const newId = uuidv4();
        newItems[newId] = {
          index: newId,
          isFolder: true,
          children: [tabId],
          parentId: rootId,
          data: {
            name: newName,
            widgets: [],
            groups: [],
          },
        };

        if (!rootFolder) return;
        newItems[rootFolder.index].children = [
          ...newItems[rootFolder.index].children,
          newId,
        ];
        newItems[tabId].parentId = newId;

        return set((state: AppState) => ({
          items: newItems,
          ...updateSideBarItems(newItems, state),
        }));
      }

      newItems[tabId].parentId = folderId;
      newItems[folderId].children = [...folder.children, tabId];

      set((state: AppState) => ({
        items: newItems,
        ...updateSideBarItems(newItems, state),
      }));

      triggerCustomEvent("scrollToTabItem", { tabId: tabId });
      get().debounceSaveDashboards();
    },
    duplicateWidgetById: (tabId: string, widgetId: string) => {
      const { items } = get();
      const tab = items?.[tabId];
      if (!tab) return;
      const widget = tab.data.widgets.find((w) => w.id === widgetId);

      if (!widget) return;

      set((state: AppState) => {
        const newTab = addDuplicateWidgetToItem(tab, widget);

        const newItems = {
          ...state.items,
          [tabId]: newTab,
        };

        return {
          items: newItems,
          ...updateSideBarItems(newItems, state),
        };
      });

      get().debounceSaveDashboards();
    },
    duplicateWidget: (tabId: string, widget: Widget) => {
      const { items } = get();
      const tab = items?.[tabId];
      if (!tab) return;

      if (!widget) return;

      set((state: AppState) => {
        const newTab = addDuplicateWidgetToItem(tab, widget);

        const newItems = {
          ...state.items,
          [tabId]: newTab,
        };

        return {
          items: newItems,
          ...updateSideBarItems(newItems, state),
        };
      });

      get().debounceSaveDashboards();
    },
    getAllTabs: () => {
      const { items } = get();
      return Object.values(items ?? {}).filter((i) => !i.isFolder && i.data);
    },
    getAllTabActiveGroups: (tabId: string) => {
      const { items } = get();
      const tab = items?.[tabId];
      if (!tab?.data) return [];

      const activeGroups = tab.data.widgets.flatMap((w) =>
        Object.values(w.paramGroups || {}).filter(Boolean),
      );

      const uniqueGroups = Array.from(new Set(activeGroups));

      return tab.data?.groups?.filter((g) => uniqueGroups.includes(g.id)) || [];
    },
    deleteGroup: (tabId: string, groupId: string) => {
      const { items } = get();
      const tab = items?.[tabId];
      if (!tab?.data) return;

      set((state: AppState) => {
        tab.data.groups = tab.data.groups.filter((g) => g.id !== groupId);

        tab.data.widgets = tab.data.widgets.map((w) => {
          w.paramGroups = Object.entries(w.paramGroups || {}).reduce(
            (acc, [key, value]) => {
              if (value !== groupId) {
                acc[key] = value;
              }
              return acc;
            },
            {} as Record<string, string>,
          );
          return w;
        });

        return {
          items: {
            ...state.items,
            [tabId]: tab,
          },
        };
      });
    },
    updateItemName: (id: string, newName: string) => {
      set((state: AppState) => {
        const newItems = {
          ...state.items,
          [id]: {
            ...itemsOf(state)[id],
            data: {
              ...itemsOf(state)[id].data,
              numberOfChanges: itemsOf(state)[id].data.numberOfChanges ?? 0 + 1,
              lastUpdated: Date.now(),
              name: newName,
            },
          },
        };

        return {
          items: newItems,
          sideBarItems: getSideBarItems(newItems),
        };
      });
    },
    updateGroup: (
      tabId: string,
      groupId: string,
      group: Group,
      updateDependentGroups = true,
    ) => {
      const { items } = get();
      const { getDashboardById, updateSharedDashboard } = useSharedAppStore.getState();
      const sharedTab = getDashboardById(tabId);
      const tab = items?.[tabId] || sharedTab;
      if (!tab?.data) return;

      const newTab = {
        ...tab,
        data: {
          ...tab.data,
          groups: tab.data.groups.map((g) => (g.id === groupId ? group : g)),
        },
      };

      if (sharedTab) {
        updateSharedDashboard(tabId, newTab);
      } else {
        set((state: AppState) => ({
          items: {
            ...state.items,
            [tabId]: newTab,
          },
        }));
      }

      if (updateDependentGroups && group.type === "endpointParam") {
        void updateDependentEndpointParamGroups(newTab, group, get().updateGroup);
      }
    },
    setWidgetGroupId: (
      tabId: string,
      widgetId: string,
      group: Group,
      remove?: boolean,
    ) => {
      const { items } = get();
      const tab = items?.[tabId];
      if (!tab?.data) return;

      set((state: AppState) => {
        tab.data.widgets = tab.data.widgets.map((w) => {
          if (w.id !== widgetId) return w;

          if (remove) {
            w.paramGroups = Object.entries(w.paramGroups || {}).reduce(
              (acc, [key, value]) => {
                if (value !== group.id) {
                  acc[key] = value;
                }
                return acc;
              },
              {} as Record<string, string>,
            );
          } else {
            w.paramGroups = addToWidgetParamGroups(w?.paramGroups, group);
          }

          return updateWidgetGroupValue(w, group);
        });

        return {
          items: {
            ...state.items,
            [tabId]: tab,
          },
        };
      });
    },
    getWidgetGroups: (tabId: string, widgetId: string | undefined) => {
      if (!widgetId) return [];
      const { items } = get();
      const { getDashboardById, getWidgetGroups } = useSharedAppStore.getState();
      if (getDashboardById(tabId)) return getWidgetGroups(tabId, widgetId);

      const tab = items?.[tabId];
      if (!tab?.data) return [];

      const widget = tab.data.widgets.find((w) => w.id === widgetId);
      if (!widget) return [];

      return tab.data.groups.filter((g) =>
        Object.values(widget.paramGroups || {}).includes(g.id),
      );
    },
    addGroup: (tabId: string, group: Group) => {
      const { items } = get();
      const tab = items?.[tabId];
      if (!tab) return;

      const newTab = {
        ...tab,
        data: {
          ...tab.data,
          groups: [
            ...(tab.data.groups || []),
            {
              ...group,
              id: group.id ? group.id : uuidv4(),
            },
          ],
        },
      };

      set((state: AppState) => ({
        items: {
          ...state.items,
          [tabId]: newTab,
        },
      }));
    },
    getTabById: (id: string) => {
      const { items } = get();
      if (!items?.[id]) return;
      return items[id];
    },
    getTabWidgetById: (tabId: string, widgetId: string) => {
      const { items } = get();
      const tab = items?.[tabId];
      if (!Array.isArray(tab?.data?.widgets)) return;
      return tab.data.widgets.find((w) => w.id === widgetId);
    },
    getFolderById: (id: string) => {
      const { items } = get();
      if (!items?.[id]?.isFolder) return;
      return items[id];
    },
    duplicateTab: (id: string) => {
      const { items } = get();
      if (!items?.[id]) return;

      const rootFolder = Object.values(items).find((item) => item.isRoot);

      if (!rootFolder) return;

      const rootId = rootFolder.index;
      const duplicatedTab = duplicateTabItem(items[id], rootId);

      const newItems = {
        ...items,
        [rootId]: {
          ...items[rootId],
          children: [...items[rootId].children, duplicatedTab.index],
        },
        [duplicatedTab.index]: duplicatedTab,
      };

      set((state: AppState) => ({
        items: newItems,
        ...updateSideBarItems(newItems, state),
      }));

      triggerCustomEvent("scrollToTabItem", { tabId: duplicatedTab.index });
      get().debounceSaveDashboards();

      return duplicatedTab.index;
    },
    addTab: (tab, ignoreLastWidgetGridData = false) => {
      const { items } = get();
      if (!items) return;

      const rootFolder = Object.values(items).find((item) => item.isRoot);

      if (!rootFolder) return;

      const rootId = rootFolder.index;

      const gridLayout = { ...(tab?.data?.gridLayout || {}) } as GridLayout;
      const widgets = [] as Widget[];
      const groups = tab?.data?.groups || [];

      const widgetsInGrid = Object.entries(gridLayout).reduce(
        (acc, [key, grid]) => {
          for (const g of grid) {
            if (g.i !== undefined) acc[g.i] = { ...g, innerTab: key };
          }
          return acc;
        },
        {} as { [key: string]: GridData & { innerTab: string } },
      );

      for (const w of tab?.data?.widgets || []) {
        const paramGroups = groups.filter(
          (g): g is GroupTypeT<"param" | "endpointParam"> =>
            Object.values(w?.paramGroups || {}).includes(g.id),
        );
        const newWidget = getWidgetData({ widget: w });

        for (const g of paramGroups) {
          if (["param", "endpointParam"].includes(g.type)) {
            newWidget.paramGroups = addToWidgetParamGroups(newWidget?.paramGroups, g);
          }
          Object.assign(newWidget, updateWidgetGroupValue(newWidget, g));
        }

        const id = w.id ? w.id : uuidv4();
        newWidget.id = id;
        const gridData = widgetsInGrid?.[id];

        newWidget.innerTab = gridData?.innerTab ?? w.innerTab ?? "";
        newWidget.isNew = true;
        w.innerTab = newWidget.innerTab;
        widgets.push(newWidget);

        if (!gridData)
          updateWidgetGridLayout({
            widget: { ...w, id } as Widget,
            gridLayout,
            ignoreLastWidgetGridData,
          });
      }

      const parentId = tab?.parentId || rootId;

      const newTab = removeDuplicateNavBarWidgets({
        ...tab,
        index: tab.index || uuidv4(),
        isFolder: false,
        created_date: new Date().toISOString(),
        parentId,
        children: tab.children ?? [],
        data: {
          ...tab.data,
          currentTab: tab.data?.currentTab ?? Object.keys(gridLayout)?.[0] ?? "",
          numberOfChanges: 0,
          lastUpdated: Date.now(),
          groups: tab.data.groups ?? [],
          widgets: widgets,
          storedFileUUIDs: getStoredFileUUIDs(widgets),
          gridLayout,
        },
      });

      set((state: AppState) => {
        const newItems = { ...state.items };

        if (newItems[newTab.index]) {
          newItems[newTab.index] = cloneDeep({ ...newTab });
        } else {
          newItems[parentId] = {
            ...newItems[parentId],
            children: [...newItems[parentId].children, newTab.index],
          };
          newItems[newTab.index] = cloneDeep({ ...newTab });
        }

        return {
          items: newItems as Items,
          ...updateSideBarItems(newItems, state),
        };
      });

      triggerCustomEvent("scrollToTabItem", { tabId: newTab.index });
      get().debounceSaveDashboards();
    },
    removeTab: (id: string, navigate?: (path: string) => void) => {
      const { items, getLastInnerTab } = get();
      const tab = items?.[id];
      if (!tab) return;

      const { newItems, deletedItems } = deleteItemFn({ ...items }, id);
      const latestDashboardId = getLatestDashboardId(newItems);
      const activeItem = useSidebarStore.getState()?.activeItem;

      queueMicrotask(() => {
        if (activeItem !== id) return;
        if (!latestDashboardId) return navigate?.("/app");

        const innerTab = getLastInnerTab(latestDashboardId);
        triggerCustomEvent("scrollToTabItem", { tabId: latestDashboardId });
        queueMicrotask(() =>
          navigate?.(`/app/${latestDashboardId}${innerTab && `?tab=${innerTab}`}`),
        );
      });

      set((state: AppState) => {
        return {
          items: newItems,
          deletedItems: [...state.deletedItems, ...deletedItems],
          ...updateSideBarItems(newItems, state),
        };
      });
    },
    updateTabData: (tabId: string, data = {}) => {
      const { items } = get();
      const tabData = items?.[tabId]?.data;
      if (!tabData) return;

      set((state: AppState) => {
        const newItems = { ...state.items };
        Object.assign(newItems[tabId].data, data);
        return { items: newItems };
      });
    },
    updateInnerTabs: (tabId: string, innerTabs: InnerTabsT) => {
      const { items } = get();
      const tab = items?.[tabId];
      if (!tab) return;

      const newGridLayout = {} as GridLayout;
      const currentTab = tab.data.currentTab;
      const newCurrentTab =
        (currentTab === undefined ? undefined : innerTabs?.[currentTab]?.newId) ||
        Object.keys(innerTabs || {})?.[0] ||
        "";

      const tabGridLayout = tab.data.gridLayout ?? {};
      for (const key in tabGridLayout) {
        const value = innerTabs?.[key];

        if (value?.newId) {
          newGridLayout[value.newId] = tabGridLayout[key];
        } else if (value?.id) {
          newGridLayout[key] = tabGridLayout[key];
        }
      }

      const newTabs = Object.values(innerTabs).map((t) => ({
        id: t.newId || t.id,
        name: t.name,
      }));

      const hasTabs = newTabs.length > 0;

      const newWidgets = tab.data.widgets
        .filter(
          (w) =>
            (w.innerTab !== undefined && innerTabs?.[w.innerTab]) ||
            (w.widgetId === "navigation_bar" && hasTabs),
        )
        .map((w) => {
          if (w.widgetId === "navigation_bar") {
            return {
              ...w,
              storage: {
                ...w.storage,
                tabs: newTabs,
              },
            };
          }
          const renamedTab =
            w.innerTab === undefined ? undefined : innerTabs[w.innerTab]?.newId;
          if (renamedTab) w.innerTab = renamedTab;
          return w;
        });

      if (hasTabs && newTabs.every((t) => !newGridLayout[t.id])) {
        const navBarWidget = newWidgets.find((w) => w.widgetId === "navigation_bar");
        const wGridData = Object.values(tab.data?.gridLayout || {})
          .flat()
          .find((l) => l.i === navBarWidget?.id);
        if (wGridData) {
          const firstTabId = newTabs[0].id;
          newGridLayout[firstTabId] = [wGridData];
        }
      }

      const gridLayout = updateWidgetGridLayout({
        widget: { id: "" } as Widget,
        gridLayout: newGridLayout,
        tabWidgets: newWidgets,
        removeWidget: true,
      });

      for (const tab of newTabs) {
        if (!gridLayout[tab.id]) gridLayout[tab.id] = [];
      }

      const sortedGridLayout = newTabs.reduce((acc, t) => {
        const key = t.id;
        if (gridLayout[key] === undefined) return acc;

        acc[key] = gridLayout[key];
        return acc;
      }, {} as GridLayout);

      const newTab = {
        ...tab,
        data: {
          ...tab.data,
          widgets: newWidgets,
          gridLayout: sortedGridLayout,
          currentTab: newCurrentTab,
        },
      } as Item;

      set((state: AppState) => {
        return {
          items: {
            ...state.items,
            [tabId]: removeDuplicateNavBarWidgets(newTab),
          },
        };
      });
    },
    getLastInnerTab: (tabId: string) => {
      const { items } = get();
      const sharedItems = useSharedAppStore.getState().sharedItems;
      const tab = sharedItems?.[tabId] || items?.[tabId];

      return tab?.data?.currentTab;
    },
    addWidget: async (tabId, widget) => get().addWidgets(tabId, [widget]),
    addWidgets: async (tabId, widgets) => {
      const { items } = get();
      const tab = items?.[tabId];
      if (!tab) {
        toast.error("No permission", {
          description: "You are not allowed to add widgets to this dashboard",
        });
        return;
      }
      const widgetsToAdd = widgets;
      let currentTab = tab.data.currentTab ?? "";
      const storedFileUUIDs = new Set<string>(tab.data?.storedFileUUIDs || []);

      const newWidgets: Widget[] = [];
      let gridLayout: GridLayout = { ...(tab.data.gridLayout || {}) };
      for (const initialWidget of widgetsToAdd) {
        initialWidget.innerTab = initialWidget?.innerTab || currentTab;
        const tabWidgets = [...tab.data.widgets, ...newWidgets];

        const finalWidget = getWidgetData({ widget: initialWidget });

        const id = initialWidget.id ? initialWidget.id : uuidv4();
        const newWidget = {
          ...cloneDeep({ ...finalWidget }),
          innerTab: finalWidget?.innerTab ?? currentTab,
          id,
        };

        if (newWidget.widgetId === "iframe") {
          showNotificationWithRememberMe({
            id: NotificationId.WebsiteNotEmbeddable,
            message: "Iframe may not be embeddable",
            description: `Some pages may not allow iframe embedding.
              If the iframe is not loading, please try a different URL.`,
            toastType: "info",
          });
        }

        const hasNavigationBar = tabWidgets.some(
          (widget) => widget.widgetId === "navigation_bar",
        );

        if (!hasNavigationBar && newWidget.widgetId === "navigation_bar") {
          currentTab = newWidget.innerTab;
          for (const w of tab.data.widgets || []) w.innerTab = newWidget.innerTab;
          for (const w of newWidgets) w.innerTab = newWidget.innerTab;

          gridLayout = {
            [newWidget.innerTab]: Object.keys(gridLayout).flatMap((key) =>
              Object.values(gridLayout[key]),
            ),
          };
        }

        if (newWidget.widgetId !== "navigation_bar") {
          currentTab = newWidget?.innerTab || tab.data.currentTab || "";
        }

        gridLayout = updateWidgetGridLayout({
          widget: { ...initialWidget, id } as Widget,
          gridLayout: gridLayout,
          currentTab: currentTab,
          tabWidgets,
        });

        if (newWidget?.connectionType === "file") {
          const fileUUID = extractUUIDFromURL(newWidget?.endpoint?.url);
          if (fileUUID) storedFileUUIDs.add(fileUUID);
        }

        const paramGroupIds = Object.values(newWidget?.paramGroups || {});
        const paramGroups = tab?.data?.groups.filter(
          (g): g is GroupTypeT<"param" | "endpointParam"> =>
            paramGroupIds.includes(g.id),
        );

        for (const g of paramGroups) {
          if (["param", "endpointParam"].includes(g.type)) {
            newWidget.paramGroups = addToWidgetParamGroups(newWidget?.paramGroups, g);
          }
          Object.assign(newWidget, updateWidgetGroupValue(newWidget, g));
        }

        newWidget.isNew = true;

        const isStaticArtifact =
          newWidget.widgetId?.startsWith("html") ||
          newWidget.widgetId?.startsWith("file") ||
          newWidget.connectionType === "file";
        if (isStaticArtifact && !newWidget.storage?.createdAt) {
          newWidget.storage = {
            ...(newWidget.storage || {}),
            createdAt: new Date().toISOString(),
          };
        }

        newWidgets.push(newWidget);
      }

      const tabWidgets = tab?.data?.widgets || [];

      const numberOfChanges = tab?.data?.numberOfChanges ?? 0;
      const newTab = {
        ...tab,
        updated_date: new Date().toISOString(),
        data: {
          ...tab.data,
          numberOfChanges: numberOfChanges + 1,
          lastUpdated: Date.now(),
          widgets: [...tabWidgets, ...newWidgets],
          gridLayout,
          currentTab,
          storedFileUUIDs: Array.from(storedFileUUIDs),
        },
      } as Item;

      set((state: AppState) => {
        const newItems = {
          ...state.items,
          [tabId]: removeDuplicateNavBarWidgets(newTab),
        };
        return {
          items: newItems,
          ...updateSideBarItems(newItems, state),
        };
      });

      get().debounceSaveDashboards();

      return newWidgets[newWidgets.length - 1]?.id;
    },
    addWidgetsToTabs: async (tabIds, widget) => {
      widget = Array.isArray(widget) ? widget : [widget];

      await Promise.all(
        tabIds.map(async (tabId) => await get().addWidgets(tabId, widget)),
      );
    },
    removeWidget: (tabId: string, widgetId: string) => {
      const { items } = get();
      const tab = items?.[tabId];
      if (!tab) return;

      let gridLayout = { ...(tab.data.gridLayout ?? {}) };

      set((state: AppState) => {
        let widgets = tab.data.widgets;
        let currentTab = tab.data.currentTab;

        const widgetToRemove = widgets.find((w) => w.id === widgetId);
        if (!widgetToRemove) return {};

        const paramGroups = Object.values(widgetToRemove?.paramGroups || {});

        const widgetsInGroup = widgets.filter((w) => {
          const wParamGroups = Object.values(w?.paramGroups || {});

          return w.id !== widgetId && paramGroups.some((p) => wParamGroups.includes(p));
        });

        if (widgetsInGroup.length === 0) {
          tab.data.groups = tab.data.groups.filter(
            (g) => !paramGroups.some((p) => p === g.id),
          );
        }

        if (widgetToRemove?.widgetId === "navigation_bar") {
          gridLayout = { overview: gridLayout[currentTab ?? ""] ?? [] };
          const filteredWidgets = [];

          for (const w of tab.data.widgets) {
            if (w.innerTab !== currentTab || w.id === widgetId) continue;
            filteredWidgets.push({ ...w, innerTab: "overview" });
          }

          widgets = filteredWidgets;
          currentTab = "overview";
        } else {
          widgets = widgets.filter((w) => w.id !== widgetId);
        }

        gridLayout = updateWidgetGridLayout({
          widget: widgetToRemove,
          gridLayout,
          removeWidget: true,
          tabWidgets: widgets,
        });

        const numberOfChanges = tab?.data?.numberOfChanges ?? 0;
        const newTab = {
          ...tab,
          updated_date: new Date().toISOString(),
          data: {
            ...tab.data,
            numberOfChanges: numberOfChanges + 1,
            lastUpdated: Date.now(),
            widgets: widgets,
            currentTab,
            gridLayout,
            storedFileUUIDs: getStoredFileUUIDs(widgets),
          },
        };

        useCopilotDataStore.getState()?.removeWidgetData(widgetId);

        return {
          items: {
            ...state.items,
            [tabId]: removeDuplicateNavBarWidgets(newTab),
          },
        };
      });

      get().debounceSaveDashboards();
    },
    updateWidget: (tabId: string, widget: Widget) => {
      const { items } = get();
      const { getDashboardById, updateSharedDashboard } = useSharedAppStore.getState();
      const sharedTab = getDashboardById(tabId);
      const tab = items?.[tabId] || sharedTab;
      if (!tab) return;

      const currentGroups = Object.values(widget.paramGroups || {});

      for (const group of (tab.data.groups || []) as Group[]) {
        if (!currentGroups.includes(group?.id)) continue;
        const value = getWidgetGroupValue(widget, group) ?? null;

        if (value !== group.value) {
          group.value = value;
        }
      }

      const newTab = updateWidgetInItem(tab, widget);
      if (sharedTab) return updateSharedDashboard(tabId, newTab);

      set((state: AppState) => {
        const newItems = { ...state.items, [tabId]: newTab };
        return {
          items: newItems,
          ...updateSideBarItems(newItems, state),
        };
      });
    },
    updateTabWidgetsLayout: (
      tabId: string,
      widgetsLayout: GridData[],
      currentTab = "",
    ) => {
      const { items } = get();
      const tab = items?.[tabId];
      if (!tab) return;

      const gridLayout = { ...(tab.data.gridLayout ?? {}) };

      for (const layout of widgetsLayout) {
        const currLayout = gridLayout?.[currentTab]?.find((l) => l.i === layout.i);
        if (currLayout?.originalMinH) layout.originalMinH = currLayout.originalMinH;
        if (currLayout?.mobileH && !layout.mobileH) layout.mobileH = currLayout.mobileH;
        if (layout.mobileH) {
          for (const key of ["w", "h", "x", "y"] as const) {
            layout[key] = currLayout?.[key] || layout[key];
          }
        }
      }

      gridLayout[currentTab] = widgetsLayout;

      set((state: AppState) => {
        const newItems = { ...state.items };
        const numberOfChanges = (tab.data?.numberOfChanges ?? 0) + 1;
        const lastUpdated = Date.now();
        Object.assign(newItems[tabId].data, {
          currentTab,
          gridLayout,
          numberOfChanges,
          lastUpdated,
        });
        return { items: newItems, ...updateSideBarItems(newItems, state) };
      });
    },
    getWidgetGridData: (tabId: string, widgetId: string) => {
      const { items } = get();
      const tab = items?.[tabId];
      if (!tab) return;

      const { gridLayout = {}, currentTab = "" } = tab.data;

      const gridData = gridLayout[currentTab]?.find((grid) => grid.i === widgetId);
      if (gridData) return gridData;

      return Object.keys(gridLayout).reduce<GridData | undefined>(
        (acc, key) => acc ?? gridLayout[key].find((grid) => grid.i === widgetId),
        undefined,
      );
    },
    minimizeWidget: (
      tabId: string,
      widgetId: string,
      isMinimized: boolean,
      originalH,
    ) => {
      const { items } = get();
      const tab = items?.[tabId];
      if (!tab?.data?.gridLayout) return;

      const currentTab = tab.data.currentTab || "";

      let widgetFound = false;
      const updatedGridLayout = { ...tab.data.gridLayout };

      const currentGridLayout = updatedGridLayout[currentTab];
      if (currentGridLayout) {
        const widgetIndex = currentGridLayout.findIndex((item) => item.i === widgetId);

        if (widgetIndex !== -1) {
          widgetFound = true;
          updatedGridLayout[currentTab] = currentGridLayout.map((item, index) => {
            if (index === widgetIndex) {
              const updatedWidget = { ...item };
              let updatedH = originalH;
              if (isMinimized) {
                updatedH = updatedWidget.h;

                updatedWidget.h = 1.4;
                updatedWidget.originalMinH = updatedWidget.minH;
                updatedWidget.minH = 1.4;
              } else if (updatedH !== undefined) {
                updatedWidget.h = updatedH;
                updatedWidget.minH = updatedWidget.originalMinH || 4;
              } else {
                updatedWidget.h = 12;
                updatedWidget.minH = updatedWidget.originalMinH || updatedWidget.minH;
              }

              dispatchUpdateWidget(widgetId, (w) => ({
                ...w,
                originalH: updatedH,
                isMinimized,
              }));

              return updatedWidget;
            }
            return item;
          });
        }
      }

      if (!widgetFound) return;

      set((state: AppState) => ({
        items: {
          ...state.items,
          [tabId]: {
            ...tab,
            data: {
              ...tab.data,
              gridLayout: updatedGridLayout,
              lastUpdated: Date.now(),
              numberOfChanges: (tab.data.numberOfChanges || 0) + 1,
            },
          },
        },
      }));
    },
  })),
  shallow,
);

export function useShallowAppStore<T>(selector: Selector<AppState, T>): T {
  return useAppStore(useShallow(selector), (prev, next) => isEqual(prev, next));
}

export type { GridData, GridLayout, Group, Widget };
