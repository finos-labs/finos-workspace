import { describe, expect, it, vi } from "vitest";
import type { ParamDef, WidgetT } from "~/components/types";
import type { Group, Item, Items } from "~/lib/state/app";
import {
  deleteItem,
  deleteItemFn,
  duplicateTabItem,
  getEndpointParamDef,
  getEndpointParamName,
  getGridData,
  getGroupLabel,
  getInnerTabsGridLayout,
  getStoredFileUUIDs,
  getTickerParamName,
  getWidgetGroupValue,
  needsGroupValuesUpdate,
  needsGroupValueUpdate,
  unlinkItemFn,
  updateWidgetGroupValues,
  updateWidgetInItem,
} from "~/lib/utils/app";
import {
  makeParamGroup,
  makeTabData,
  makeTicker,
  makeTickerGroup,
  makeWidget,
} from "../../factories";
import { malformed, partial } from "../../mocks";

// Mock external dependencies

vi.mock("~/lib/state/copilotData", () => ({
  useCopilotDataStore: {
    getState: () => ({
      removeTabWidgetsData: vi.fn(),
    }),
  },
}));

vi.mock("uuid", () => ({
  v4: () => "test-uuid-1234",
}));

describe("lib/utils/app - Additional Tests", () => {
  describe("deleteItem", () => {
    it("returns empty array for non-existent item", () => {
      const items: Items = {};
      expect(deleteItem("non-existent", items)).toEqual([]);
    });

    it("returns the item id for a non-folder item", () => {
      const items: Items = {
        "item-1": {
          index: "item-1",
          name: "Tab 1",
          isFolder: false,
          children: [],
          data: makeTabData({ name: "Tab 1", widgets: [] }),
        },
      };
      expect(deleteItem("item-1", items)).toEqual(["item-1"]);
    });

    it("returns all child ids for a folder", () => {
      const items: Items = {
        "folder-1": {
          index: "folder-1",
          name: "Folder",
          isFolder: true,
          children: ["item-1", "item-2"],
          data: makeTabData({ name: "Folder" }),
        },
        "item-1": {
          index: "item-1",
          name: "Item 1",
          isFolder: false,
          children: [],
          data: makeTabData({ name: "Item 1", widgets: [] }),
        },
        "item-2": {
          index: "item-2",
          name: "Item 2",
          isFolder: false,
          children: [],
          data: makeTabData({ name: "Item 2", widgets: [] }),
        },
      };
      const result = deleteItem("folder-1", items);
      expect(result).toContain("folder-1");
      expect(result).toContain("item-1");
      expect(result).toContain("item-2");
    });
  });

  describe("deleteItemFn", () => {
    it("removes item and updates children references", () => {
      const items: Items = {
        root: {
          index: "root",
          name: "Root",
          isFolder: true,
          isRoot: true,
          children: ["item-1", "item-2"],
          data: makeTabData({ name: "Root" }),
        },
        "item-1": {
          index: "item-1",
          name: "Item 1",
          isFolder: false,
          children: [],
          data: makeTabData({ name: "Item 1", widgets: [] }),
        },
        "item-2": {
          index: "item-2",
          name: "Item 2",
          isFolder: false,
          children: [],
          data: makeTabData({ name: "Item 2", widgets: [] }),
        },
      };

      const result = deleteItemFn(items, "item-1");

      expect(result.deletedItems).toContain("item-1");
      expect(result.newItems["item-1"]).toBeUndefined();
      expect(result.newItems.root.children).not.toContain("item-1");
      expect(result.newItems.root.children).toContain("item-2");
    });
  });

  describe("unlinkItemFn", () => {
    it("removes item from parent children array", () => {
      const items: Items = {
        root: {
          index: "root",
          name: "Root",
          isFolder: true,
          isRoot: true,
          children: ["item-1", "item-2"],
          data: makeTabData({ name: "Root" }),
        },
        "item-1": {
          index: "item-1",
          name: "Item 1",
          isFolder: false,
          children: [],
          data: makeTabData({ name: "Item 1", widgets: [] }),
        },
        "item-2": {
          index: "item-2",
          name: "Item 2",
          isFolder: false,
          children: [],
          data: makeTabData({ name: "Item 2", widgets: [] }),
        },
      };

      const result = unlinkItemFn(items, "item-1");

      expect(result.root.children).not.toContain("item-1");
      expect(result.root.children).toContain("item-2");
    });
  });

  describe("getGroupLabel", () => {
    it("returns symbol for ticker group", () => {
      const group = makeTickerGroup({
        id: "g1",
        value: makeTicker({ name: "Apple" }),
      });
      expect(getGroupLabel(group)).toBe("AAPL");
    });

    it("returns value for non-ticker group", () => {
      const group = makeParamGroup({ id: "g1", groupById: "period", value: "annual" });
      expect(getGroupLabel(group)).toBe("annual");
    });
  });

  describe("getEndpointParamDef", () => {
    const params = partial<ParamDef[]>([
      { paramName: "date", type: "date" },
      { paramName: "ticker", type: "ticker" },
      { paramName: "endpoint1", type: "endpoint", groupById: "ep1" },
    ]);

    it("finds endpoint param by groupById", () => {
      const result = getEndpointParamDef(params, "ep1");
      expect(result?.paramName).toBe("endpoint1");
    });

    it("finds endpoint param by paramName for older saved groups", () => {
      const result = getEndpointParamDef(params, "endpoint1");
      expect(result?.groupById).toBe("ep1");
    });

    it("returns undefined for non-existent param", () => {
      const result = getEndpointParamDef(params, "nonexistent");
      expect(result).toBeUndefined();
    });
  });

  describe("getEndpointParamName", () => {
    const params = partial<ParamDef[]>([
      { paramName: "date", type: "date" },
      { paramName: "endpoint1", type: "endpoint", groupById: "ep1" },
    ]);

    it("returns param name for matching groupById", () => {
      expect(getEndpointParamName(params, "ep1")).toBe("endpoint1");
    });

    it("returns param name for matching paramName", () => {
      expect(getEndpointParamName(params, "endpoint1")).toBe("endpoint1");
    });

    it("returns undefined for non-matching groupById", () => {
      expect(getEndpointParamName(params, "ep2")).toBeUndefined();
    });
  });

  describe("getWidgetGroupValue", () => {
    it("returns null for undefined group id", () => {
      const widget = {} as WidgetT;
      const group = {} as Group;
      expect(getWidgetGroupValue(widget, group)).toBeNull();
    });

    it("returns mainTicker for ticker group", () => {
      const widget = makeWidget({ data: { mainTicker: makeTicker() } });
      const group = makeTickerGroup({ id: "g1", value: makeTicker() });
      expect(getWidgetGroupValue(widget, group)).toEqual(makeTicker());
    });

    it("returns param value for param group", () => {
      const widget = partial<WidgetT>({
        storage: { params: { period: "annual" } },
      });
      const group = makeParamGroup({ id: "g1", groupById: "period", value: "annual" });
      expect(getWidgetGroupValue(widget, group)).toBe("annual");
    });
  });

  describe("getTickerParamName", () => {
    it("returns paramName from ticker param", () => {
      const widget = partial<WidgetT>({
        params: [{ type: "ticker", paramName: "symbol" }],
        data: { mainTicker: { category: "equity" } },
      });
      expect(getTickerParamName(widget)).toBe("symbol");
    });

    it("returns 'country' for economy group without ticker param", () => {
      const widget = partial<WidgetT>({
        params: [],
        data: { mainTicker: { category: "country" } },
      });
      expect(getTickerParamName(widget)).toBe("country");
    });

    it("returns null when no ticker param and not economy group", () => {
      const widget = partial<WidgetT>({
        params: [],
        data: { mainTicker: { category: "equity" } },
      });
      expect(getTickerParamName(widget)).toBeNull();
    });
  });

  describe("updateWidgetInItem", () => {
    it("updates widget in item data", () => {
      const item: Item = {
        index: "item-1",
        name: "Tab",
        isFolder: false,
        children: [],
        data: makeTabData({
          name: "Tab",
          widgets: [
            partial<WidgetT>({ id: "w1", widgetId: "equity_profile" }),
            partial<WidgetT>({ id: "w2", widgetId: "company_news" }),
          ],
        }),
      };
      const updatedWidget = partial<WidgetT>({
        id: "w1",
        widgetId: "equity_profile",
        name: "Updated",
      });

      const result = updateWidgetInItem(item, updatedWidget);

      expect(result.data?.widgets?.[0].name).toBe("Updated");
      expect(result.data?.numberOfChanges).toBe(1);
    });

    it("does not count the first startup sync update for a template widget", () => {
      const item: Item = {
        index: "item-1",
        name: "Tab",
        isFolder: false,
        children: [],
        data: makeTabData({
          name: "Tab",
          numberOfChanges: 0,
          widgets: [
            partial<WidgetT>({ id: "w1", widgetId: "equity_profile", isNew: true }),
          ],
        }),
      };

      const result = updateWidgetInItem(
        item,
        partial<WidgetT>({
          id: "w1",
          widgetId: "equity_profile",
          name: "Startup update",
        }),
      );

      expect(result.data?.widgets?.[0].name).toBe("Startup update");
      expect(result.data?.numberOfChanges).toBe(0);
    });

    it("counts later widget updates after the startup sync update was consumed", () => {
      const item: Item = {
        index: "item-1",
        name: "Tab",
        isFolder: false,
        children: [],
        data: makeTabData({
          name: "Tab",
          numberOfChanges: 0,
          widgets: [partial<WidgetT>({ id: "w1", widgetId: "equity_profile" })],
        }),
      };

      const result = updateWidgetInItem(
        item,
        partial<WidgetT>({ id: "w1", widgetId: "equity_profile", name: "User update" }),
      );

      expect(result.data?.numberOfChanges).toBe(1);
    });

    it("does not modify folder items", () => {
      const item: Item = {
        index: "folder-1",
        name: "Folder",
        isFolder: true,
        children: ["child-1"],
        data: makeTabData({ name: "Folder" }),
      };
      const widget = partial<WidgetT>({ id: "w1" });

      const result = updateWidgetInItem(item, widget);

      expect(result).toEqual(item);
    });
  });

  describe("getGridData", () => {
    it("returns default grid data when no last widget", () => {
      const result = getGridData(undefined, { w: 20, h: 10 });

      expect(result.w).toBe(20);
      expect(result.h).toBe(10);
      expect(result.x).toBeDefined();
      expect(result.y).toBeDefined();
    });

    it("positions new widget based on last widget", () => {
      const lastWidget = { x: 0, y: 0, w: 20, h: 10 };
      const result = getGridData(lastWidget, { w: 20, h: 10 });

      expect(result.x).toBe(20); // Next to last widget
    });

    it("wraps to next row when exceeding tabCols", () => {
      const lastWidget = { x: 20, y: 0, w: 20, h: 10 };
      const result = getGridData(lastWidget, { w: 20, h: 10 }, { tabCols: 40 });

      expect(result.x).toBe(0);
      expect(result.y).toBe(10); // Next row
    });
  });

  describe("getInnerTabsGridLayout", () => {
    it("filters out empty key entries", () => {
      const gridLayout = {
        "": [{ i: "w1" }],
        tab2: [{ i: "w2" }],
      };

      const result = getInnerTabsGridLayout(gridLayout);

      expect(result[""]).toBeUndefined();
      expect(result.tab2).toBeDefined();
    });

    it("filters out entries with empty value arrays", () => {
      const gridLayout = {
        tab1: [],
        tab2: [{ i: "w2" }],
      };

      const result = getInnerTabsGridLayout(gridLayout);

      expect(result.tab1).toBeUndefined();
      expect(result.tab2).toBeDefined();
    });
  });

  describe("getStoredFileUUIDs", () => {
    it("extracts UUIDs from file widgets with endpoint url", () => {
      const widgets = [
        partial<WidgetT>({
          widgetId: "file-widget",
          connectionType: "file",
          endpoint: {
            url: "https://example.com/files/c0ebd61e-39fa-4382-b82f-4374ea96a30f.pdf",
          },
        }),
        partial<WidgetT>({ widgetId: "equity_profile", connectionType: "single" }),
      ];

      const result = getStoredFileUUIDs(widgets);

      expect(result).toContain("c0ebd61e-39fa-4382-b82f-4374ea96a30f");
    });

    it("returns empty array when no file widgets", () => {
      const widgets = [
        partial<WidgetT>({ widgetId: "equity_profile", connectionType: "single" }),
      ];

      const result = getStoredFileUUIDs(widgets);

      expect(result).toHaveLength(0);
    });
  });

  describe("needsGroupValueUpdate", () => {
    it("returns true when widget param differs from group value", () => {
      const widget = partial<WidgetT>({
        groupId: "g1",
        storage: { params: { period: "quarterly" } },
      });
      const group = makeParamGroup({ id: "g1", groupById: "period", value: "annual" });

      expect(needsGroupValueUpdate(widget, group)).toBe(true);
    });

    it("returns false when values match", () => {
      const widget = partial<WidgetT>({
        groupId: "g1",
        storage: { params: { period: "annual" } },
      });
      const group = makeParamGroup({ id: "g1", groupById: "period", value: "annual" });

      expect(needsGroupValueUpdate(widget, group)).toBe(false);
    });
  });

  describe("updateWidgetGroupValues", () => {
    it("updates param group values when widget params are row-grouped", () => {
      // Widgets saved before their params were flat group them in rows
      const widget = malformed<WidgetT>({
        widgetId: "muni_stats_filters",
        storage: { params: { use_categories: "" } },
        params: [
          [
            {
              paramName: "use_categories",
              type: "text",
              groupById: "use_categories",
              options: [
                { label: "All", value: "" },
                {
                  label: "Correctional Facilities",
                  value: "correctional_facilities",
                },
              ],
            },
          ],
        ],
      });
      const group = {
        id: "use-categories-group",
        type: "param",
        groupById: "use_categories",
        value: "correctional_facilities",
      } as Group;

      expect(needsGroupValueUpdate(widget, group)).toBe(true);

      const updatedWidget = updateWidgetGroupValues(widget, [group]);

      expect(updatedWidget.storage?.params?.use_categories).toBe(
        "correctional_facilities",
      );
    });
  });

  describe("needsGroupValuesUpdate", () => {
    it("returns true if any group needs update", () => {
      const widget = partial<WidgetT>({
        groupId: "g1",
        storage: { params: { period: "quarterly" } },
      });
      const groups = [
        makeParamGroup({ id: "g1", groupById: "period", value: "annual" }),
      ];

      expect(needsGroupValuesUpdate(widget, groups)).toBe(true);
    });
  });

  describe("duplicateTabItem", () => {
    it("duplicates a tab with widgets and grid layout", () => {
      const item: Item = {
        index: "tab-1",
        name: "Tab 1",
        isFolder: false,
        children: [],
        data: {
          name: "My Tab",
          widgets: [
            partial<WidgetT>({
              id: "w1",
              widgetId: "equity_profile",
              innerTab: "overview",
            }),
          ],
          gridLayout: {
            overview: [{ i: "w1", x: 0, y: 0, w: 20, h: 10 }],
          },
          groups: [],
        },
      };

      const result = duplicateTabItem(item, "root-id");

      expect(result.index).toBe("test-uuid-1234");
      expect(result.parentId).toBe("root-id");
      expect(result.data?.name).toBe("My Tab (copy)");
      expect(result.data?.widgets).toHaveLength(1);
      expect(result.data?.widgets?.[0].id).toBe("test-uuid-1234");
    });

    it("handles widgets with missing innerTab in gridLayout gracefully", () => {
      const item: Item = {
        index: "tab-1",
        name: "Tab 1",
        isFolder: false,
        children: [],
        data: {
          name: "My Tab",
          widgets: [
            partial<WidgetT>({
              id: "w1",
              widgetId: "equity_profile",
              innerTab: "nonexistent-tab",
            }),
          ],
          gridLayout: {
            overview: [], // Widget not in overview either
          },
          groups: [],
        },
      };

      // Should not throw "Cannot read properties of undefined"
      expect(() => duplicateTabItem(item, "root-id")).not.toThrow();
    });

    it("handles widgets when gridLayout inner tab array is undefined", () => {
      const item: Item = {
        index: "tab-1",
        name: "Tab 1",
        isFolder: false,
        children: [],
        data: {
          name: "My Tab",
          widgets: [
            partial<WidgetT>({
              id: "w1",
              widgetId: "equity_profile",
              innerTab: "tab-that-doesnt-exist",
            }),
          ],
          gridLayout: {}, // No tabs at all
          groups: [],
        },
      };

      // Should not throw "Cannot read properties of undefined"
      expect(() => duplicateTabItem(item, "root-id")).not.toThrow();
    });

    it("removes isShared flag from duplicated tab", () => {
      const item: Item = {
        index: "tab-1",
        name: "Tab 1",
        isFolder: false,
        isShared: true,
        children: [],
        data: {
          name: "Shared Tab",
          widgets: [],
          gridLayout: {},
          groups: [],
        },
      };

      const result = duplicateTabItem(item, "root-id");

      expect(result.isShared).toBeUndefined();
    });
  });
});
