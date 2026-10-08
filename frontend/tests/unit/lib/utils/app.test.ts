import { describe, expect, it, vi } from "vitest";
import type { GridDataT as GridData, GridLayout, WidgetT } from "~/components/types";
import {
  checkIfWidgetsHaveMainTickerAndAreTheSame,
  createRootFolder,
  createTab,
  recursiveCleanKeys,
  updateWidgetGridLayout,
} from "~/lib/utils/app";
import { partial } from "../../mocks";

describe("app utils", () => {
  describe("checkIfWidgetsHaveMainTickerAndAreTheSame", () => {
    it("returns correct flags for widgets with same ticker", () => {
      const widgets = partial<WidgetT[]>([
        { data: { mainTicker: { id: "AAPL", type: "stock" } } },
        { data: { mainTicker: { id: "AAPL", type: "stock" } } },
      ]);
      const result = checkIfWidgetsHaveMainTickerAndAreTheSame(widgets);
      expect(result.someHaveMainTicker).toBe(true);
      expect(result.allTheSame).toBe(true);
      expect(result.mainTicker?.id).toBe("AAPL");
    });

    it("returns allTheSame false for different tickers", () => {
      const widgets = partial<WidgetT[]>([
        { data: { mainTicker: { id: "AAPL", type: "stock" } } },
        { data: { mainTicker: { id: "MSFT", type: "stock" } } },
      ]);
      const result = checkIfWidgetsHaveMainTickerAndAreTheSame(widgets);
      expect(result.someHaveMainTicker).toBe(true);
      expect(result.allTheSame).toBe(false);
    });
  });

  describe("createTab", () => {
    it("calls addTab with new uuid and random name", () => {
      const addTab = vi.fn();
      createTab(addTab);
      expect(addTab).toHaveBeenCalledWith(
        expect.objectContaining({
          index: expect.any(String),
          data: expect.objectContaining({
            name: expect.any(String),
            type: "custom",
          }),
        }),
      );
    });
  });

  describe("createRootFolder", () => {
    it("creates a root folder structure", () => {
      const folder = createRootFolder();
      expect(folder.isRoot).toBe(true);
      expect(folder.name).toBe("root");
      expect(folder.isFolder).toBe(true);
    });
  });

  describe("recursiveCleanKeys", () => {
    it("removes _undefined from keys", () => {
      const data = {
        foo_undefined: "bar",
        nested: {
          baz_undefined: "qux",
        },
      };
      expect(recursiveCleanKeys(data)).toEqual({ foo: "bar", nested: { baz: "qux" } });
    });
  });

  describe("updateWidgetGridLayout", () => {
    it("removes the empty-dashboard-cta placeholder when a widget is added to the tab", () => {
      const gridLayout = partial<GridLayout>({
        charts: [
          { i: "nav-bar", x: 0, y: 0, w: 40, h: 2, static: true },
          {
            i: "empty-dashboard-cta",
            x: 0,
            y: 2,
            w: 40,
            h: 20,
            isResizable: false,
            isDraggable: false,
          },
        ],
      });

      const result = updateWidgetGridLayout({
        widget: partial({ id: "chart-1", innerTab: "charts" }),
        gridLayout,
        currentTab: "charts",
      });

      const chartsLayout = result.charts;
      expect(chartsLayout.some((l: GridData) => l.i === "empty-dashboard-cta")).toBe(
        false,
      );
      expect(chartsLayout.some((l: GridData) => l.i === "chart-1")).toBe(true);
    });
  });
});
