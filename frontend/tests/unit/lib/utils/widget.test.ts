import { describe, expect, it, vi } from "vitest";
import type { WidgetT } from "~/components/types";
import type { Widget } from "~/lib/state/app";

const mockWidgets = vi.hoisted(() => ({
  test_widget: {
    widgetId: "test_widget",
    name: "Test Widget",
    type: "html",
    description: "A test widget",
    category: "Test",
    subCategory: "Unit",
    source: ["test_source"],
    supportedAssetClasses: ["equity", "etf"],
    params: [
      { paramName: "symbol", type: "ticker", value: "AAPL" },
      { paramName: "period", type: "text", value: "annual" },
    ],
  },
  another_widget: {
    widgetId: "another_widget",
    name: "Another Widget",
    type: "markdown",
    source: "single_source",
    supportedAssetClasses: ["crypto"],
  },
  navigation_bar: {
    widgetId: "navigation_bar",
    name: "Navigation Bar",
    type: "custom",
  },
}));

vi.mock("~/lib/widgets.json", () => ({
  default: mockWidgets,
}));

vi.mock("~/lib/state/featureFlags", () => ({
  useFeatureFlagsStore: {
    getState: () => ({
      featureFlags: {
        tier: "full",
        data_bundle_info: {
          providers: ["test_source", "single_source"],
        },
      },
    }),
  },
  isExcludedWidgetId: () => false,
}));

vi.mock("~/hooks/useAllTemplates", () => ({
  useAllTemplates: () => [],
}));

import {
  extractColumns,
  getCleanWidgetId,
  getJsonWidget,
  getSupportedAssetClasses,
  getUUIDFromWidgetId,
  getWidgetInfo,
  getWidgetSourceInfo,
  getWidgetsWithSupportedAssetClass,
  METADATA_WIDGETS,
  processWidgetId,
  WIDGETS_CONNECTION_TYPES,
} from "~/lib/utils/widget";
import { malformed, partial } from "../../mocks";

describe("Widget Utility Functions", () => {
  describe("getJsonWidget", () => {
    it("should return widget data when passed a valid widget ID string", () => {
      const result = getJsonWidget(malformed("test_widget"));
      expect(result).not.toBeNull();
      expect(result?.widgetId).toBe("test_widget");
      expect(result?.name).toBe("Test Widget");
    });

    it("should return null for non-existent widget ID", () => {
      const result = getJsonWidget(malformed("non_existent_widget"));
      expect(result).toBeNull();
    });

    it("should return widget data when passed a widget object with widgetId", () => {
      const widgetObj = { widgetId: "test_widget" } as Partial<Widget>;
      const result = getJsonWidget(partial(widgetObj));
      expect(result).not.toBeNull();
      expect(result?.widgetId).toBe("test_widget");
    });

    it("should return the widget object itself if widgetId not found in WIDGETS", () => {
      const customWidget = {
        widgetId: "custom_external",
        name: "Custom External Widget",
        external: true,
      } as Partial<Widget>;
      const result = getJsonWidget(partial(customWidget));
      expect(result?.widgetId).toBe("custom_external");
      expect(result?.name).toBe("Custom External Widget");
    });

    it("should return a deep clone, not the original object", () => {
      const result1 = getJsonWidget(malformed("test_widget"));
      const result2 = getJsonWidget(malformed("test_widget"));
      expect(result1).not.toBe(result2);
      if (result1 && result2) {
        result1.name = "Modified";
        expect(result2.name).toBe("Test Widget");
      }
    });
  });

  describe("getSupportedAssetClasses", () => {
    it("should return supported asset classes for a valid widget", () => {
      const result = getSupportedAssetClasses("test_widget");
      expect(result).toEqual(["equity", "etf"]);
    });

    it("should return empty array for widget without supported asset classes", () => {
      const result = getSupportedAssetClasses(malformed("non_existent"));
      expect(result).toEqual([]);
    });

    it("should return a deep clone of the array", () => {
      const result1 = getSupportedAssetClasses("test_widget");
      const result2 = getSupportedAssetClasses("test_widget");
      expect(result1).not.toBe(result2);
      result1.push("new_class");
      expect(result2).not.toContain("new_class");
    });
  });

  describe("getWidgetsWithSupportedAssetClass", () => {
    it("should return widgets that support a given asset class", () => {
      const result = getWidgetsWithSupportedAssetClass("equity");
      expect(result.length).toBeGreaterThan(0);
      expect(result.some((w) => w.widgetId === "test_widget")).toBe(true);
    });

    it("should return only widget IDs when onlyIds is true", () => {
      const result = getWidgetsWithSupportedAssetClass("equity", true);
      expect(result).toContain("test_widget");
      expect(typeof result[0]).toBe("string");
    });

    it("should return empty array for unsupported asset class", () => {
      const result = getWidgetsWithSupportedAssetClass("forex");
      expect(result).toEqual([]);
    });
  });

  describe("getWidgetSourceInfo", () => {
    it("should return source info for a widget", () => {
      const widget = {
        widgetId: "test_widget",
        sourceName: "Test Source",
        source: ["provider1"],
      } as unknown as Widget;
      const result = getWidgetSourceInfo(widget);
      expect(result.sourceName).toBe("Test Source");
    });

    it("should handle array source names", () => {
      const widget = {
        widgetId: "test_widget",
        sourceName: ["Source 1", "Source 2"],
        source: ["provider1"],
      } as unknown as Widget;
      const result = getWidgetSourceInfo(widget);
      expect(result.sourceName).toBe("Source 1, Source 2");
    });

    it("should handle null widget", () => {
      const result = getWidgetSourceInfo(null);
      expect(result.source).toBe("");
      expect(result.sourceName).toBe("");
    });
  });

  describe("getWidgetInfo", () => {
    it("should extract widget info fields", () => {
      const widget = {
        type: "html",
        name: "Test Widget",
        description: "A test",
        category: "Category",
        subCategory: "SubCategory",
        source: ["source1"],
      } as Partial<WidgetT>;
      const result = getWidgetInfo(widget);
      expect(result).toEqual({
        type: "html",
        name: "Test Widget",
        description: "A test",
        category: "Category",
        subCategory: "SubCategory",
        source: ["source1"],
      });
    });

    it("should handle partial widget with missing fields", () => {
      const widget = { type: "markdown" } as Partial<WidgetT>;
      const result = getWidgetInfo(widget);
      expect(result.type).toBe("markdown");
      expect(result.name).toBeUndefined();
    });
  });

  describe("extractColumns", () => {
    it("should extract column names from array of objects", () => {
      const data = [
        { name: "John", age: 30, city: "NYC" },
        { name: "Jane", age: 25, city: "LA" },
      ];
      const result = extractColumns(data);
      expect(result).toEqual(["name", "age", "city"]);
    });

    it("should return null for empty array", () => {
      expect(extractColumns([])).toBeNull();
    });

    it("should return null for non-array data", () => {
      expect(extractColumns({ key: "value" })).toBeNull();
      expect(extractColumns("string")).toBeNull();
      expect(extractColumns(123)).toBeNull();
    });

    it("should return null for null/undefined", () => {
      expect(extractColumns(null)).toBeNull();
      expect(extractColumns(undefined)).toBeNull();
    });

    it("should return null for array of primitives", () => {
      expect(extractColumns([1, 2, 3])).toBeNull();
      expect(extractColumns(["a", "b", "c"])).toBeNull();
    });

    it("should return null for array of arrays", () => {
      expect(
        extractColumns([
          [1, 2],
          [3, 4],
        ]),
      ).toBeNull();
    });

    it("should return null for object with no keys", () => {
      expect(extractColumns([{}])).toBeNull();
    });

    it("should use first row to determine columns", () => {
      const data = [
        { a: 1, b: 2 },
        { a: 3, b: 4, c: 5 },
      ];
      const result = extractColumns(data);
      expect(result).toEqual(["a", "b"]);
    });
  });

  describe("getCleanWidgetId", () => {
    it("should clean file prefix", () => {
      expect(getCleanWidgetId("file-789")).toBe("file");
      expect(getCleanWidgetId("shared_file-abc")).toBe("file");
    });

    it("should clean iframe prefix", () => {
      expect(getCleanWidgetId("iframe-abc123")).toBe("iframe");
    });

    it("should not know a rich_note prefix any more", () => {
      expect(getCleanWidgetId("rich_note-note123")).toBe("rich_note-note123");
    });

    it("should clean html prefix", () => {
      expect(getCleanWidgetId("html-report123")).toBe("html");
    });

    it("should return original widgetId for advanced-backend connectionType", () => {
      expect(getCleanWidgetId("custom-widget-id", "advanced-backend")).toBe(
        "custom-widget-id",
      );
    });

    it("should return widgetId unchanged if no pattern matches", () => {
      expect(getCleanWidgetId("regular_widget")).toBe("regular_widget");
    });
  });

  describe("getUUIDFromWidgetId", () => {
    it("should extract UUID from iframe widget ID", () => {
      expect(getUUIDFromWidgetId("iframe-abc123")).toBe("abc123");
    });

    it("should extract UUID from file widget ID", () => {
      expect(getUUIDFromWidgetId("file-file123")).toBe("file123");
      expect(getUUIDFromWidgetId("shared_file-shared123")).toBe("shared123");
    });

    it("should extract UUID from html widget ID", () => {
      expect(getUUIDFromWidgetId("html-report123")).toBe("report123");
    });

    it("should return original ID if no prefix matches", () => {
      expect(getUUIDFromWidgetId("regular_widget")).toBe("regular_widget");
      expect(getUUIDFromWidgetId("custom-id")).toBe("custom-id");
    });
  });

  describe("processWidgetId", () => {
    it("should return both UUID and cleanWidgetId", () => {
      const result = processWidgetId("iframe-abc123");
      expect(result.uuid).toBe("abc123");
      expect(result.cleanWidgetId).toBe("iframe");
    });

    it("should process file widget ID", () => {
      const result = processWidgetId("file-file123");
      expect(result.uuid).toBe("file123");
      expect(result.cleanWidgetId).toBe("file");
    });

    it("should handle regular widget ID without prefix", () => {
      const result = processWidgetId("regular_widget");
      expect(result.uuid).toBe("regular_widget");
      expect(result.cleanWidgetId).toBe("regular_widget");
    });

    it("should respect connectionType for cleanWidgetId", () => {
      const result = processWidgetId("custom-widget", "advanced-backend");
      expect(result.uuid).toBe("custom-widget");
      expect(result.cleanWidgetId).toBe("custom-widget");
    });
  });

  describe("Constants", () => {
    describe("METADATA_WIDGETS", () => {
      it("should contain expected widget types", () => {
        expect(METADATA_WIDGETS).toContain("websites");
        expect(METADATA_WIDGETS).toContain("html");
        expect(METADATA_WIDGETS).not.toContain("notes");
      });

      it("should include legacy widget names", () => {
        expect(METADATA_WIDGETS).not.toContain("note");
        expect(METADATA_WIDGETS).toContain("website");
      });
    });

    describe("WIDGETS_CONNECTION_TYPES", () => {
      it("should contain all connection types", () => {
        expect(WIDGETS_CONNECTION_TYPES).toContain("individual");
        expect(WIDGETS_CONNECTION_TYPES).toContain("backend");
        expect(WIDGETS_CONNECTION_TYPES).toContain("file");
        expect(WIDGETS_CONNECTION_TYPES).toContain("widgetMetadata");
      });

      it("should have exactly 4 connection types", () => {
        expect(WIDGETS_CONNECTION_TYPES.length).toBe(4);
      });
    });
  });

  describe("Edge Cases", () => {
    describe("getJsonWidget edge cases", () => {
      it("should handle empty string widget ID", () => {
        const result = getJsonWidget(malformed(""));
        expect(result).toBeNull();
      });

      it("should handle widget object with undefined widgetId", () => {
        const result = getJsonWidget(partial({ widgetId: undefined }));
        expect(result).not.toBeNull();
      });
    });

    describe("extractColumns edge cases", () => {
      it("should handle object with Symbol keys", () => {
        const symbolKey = Symbol("test");
        const data = [{ [symbolKey]: "value", normalKey: "normal" }];
        const result = extractColumns(data);
        expect(result).toContain("normalKey");
      });

      it("should handle deeply nested objects as first element", () => {
        const data = [{ nested: { deep: { value: 1 } }, flat: "test" }];
        const result = extractColumns(data);
        expect(result).toEqual(["nested", "flat"]);
      });
    });

    describe("processWidgetId edge cases", () => {
      it("should handle hyphenated UUIDs", () => {
        const result = processWidgetId("iframe-550e8400-e29b-41d4-a716-446655440000");
        expect(result.uuid).toBe("550e8400-e29b-41d4-a716-446655440000");
        expect(result.cleanWidgetId).toBe("iframe");
      });
    });

    describe("getCleanWidgetId edge cases", () => {
      it("should handle widget ID that is exactly the prefix", () => {
        expect(getCleanWidgetId("file-")).toBe("file");
      });

      it("should handle widget ID with special characters after prefix", () => {
        expect(getCleanWidgetId("iframe-!@#$%")).toBe("iframe");
      });
    });
  });
});
