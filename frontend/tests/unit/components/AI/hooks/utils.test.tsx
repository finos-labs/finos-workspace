import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParamDef, WidgetT } from "~/components/types";
import type { WidgetSignature } from "~/lib/state/copilot";
import type { DashboardWidgetData } from "~/lib/state/copilotData";

// Mock external dependencies
vi.mock("~/lib/utils/widgetParams", () => ({
  currentDateModifier: vi.fn((value) => value), // Default passthrough
}));

import {
  compareSignatures,
  createSignatureMap,
  detectQueryMismatch,
  normalizeCitations,
} from "~/components/AI/hooks/utils";
// Import after mocking
import { currentDateModifier } from "~/lib/utils/widgetParams";
import { malformed, partial } from "../../../mocks";

// Helper function to create test widgets with proper typing
const createTestWidget = (overrides: Partial<WidgetT> = {}): WidgetT => ({
  id: "test-widget",
  name: "Test Widget",
  type: "html",
  widgetId: "test_widget",
  params: [],
  ...overrides,
});

const mockCurrentDateModifier = vi.mocked(currentDateModifier);

describe("compareSignatures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when both signatures are undefined or null", () => {
    it("should return false when sig1 is undefined", () => {
      const sig2: WidgetSignature = {
        origin: "the backend",
        widgetId: "test-widget",
        args: { param1: "value1" },
      };

      expect(compareSignatures(undefined, sig2)).toBe(false);
    });

    it("should return false when sig2 is undefined", () => {
      const sig1: WidgetSignature = {
        origin: "the backend",
        widgetId: "test-widget",
        args: { param1: "value1" },
      };

      expect(compareSignatures(sig1, undefined)).toBe(false);
    });

    it("should return false when both signatures are undefined", () => {
      expect(compareSignatures(undefined, undefined)).toBe(false);
    });
  });

  describe("when comparing valid signatures", () => {
    it("should return true when all fields match exactly", () => {
      const sig1: WidgetSignature = {
        origin: "the backend",
        widgetId: "equity_price",
        args: { symbol: "AAPL", period: "1y" },
      };

      const sig2: WidgetSignature = {
        origin: "the backend",
        widgetId: "equity_price",
        args: { symbol: "AAPL", period: "1y" },
      };

      expect(compareSignatures(sig1, sig2)).toBe(true);
    });

    it("should return false when origin differs", () => {
      const sig1: WidgetSignature = {
        origin: "the backend",
        widgetId: "equity_price",
        args: { symbol: "AAPL" },
      };

      const sig2: WidgetSignature = {
        origin: "Workspace",
        widgetId: "equity_price",
        args: { symbol: "AAPL" },
      };

      expect(compareSignatures(sig1, sig2)).toBe(false);
    });

    it("should return false when widgetId differs", () => {
      const sig1: WidgetSignature = {
        origin: "the backend",
        widgetId: "equity_price",
        args: { symbol: "AAPL" },
      };

      const sig2: WidgetSignature = {
        origin: "the backend",
        widgetId: "equity_chart",
        args: { symbol: "AAPL" },
      };

      expect(compareSignatures(sig1, sig2)).toBe(false);
    });

    it("should match prefixed and canonical widgetId forms for external widgets", () => {
      const sig1: WidgetSignature = {
        origin: "DTCC",
        widgetId: "DTCC-fixed_income/treasury_volumes",
        args: { time_period: "1M" },
      };

      const sig2: WidgetSignature = {
        origin: "DTCC",
        widgetId: "fixed_income/treasury_volumes",
        args: { time_period: "1M" },
      };

      expect(compareSignatures(sig1, sig2)).toBe(true);
    });

    it("should return false when args differ", () => {
      const sig1: WidgetSignature = {
        origin: "the backend",
        widgetId: "equity_price",
        args: { symbol: "AAPL", period: "1y" },
      };

      const sig2: WidgetSignature = {
        origin: "the backend",
        widgetId: "equity_price",
        args: { symbol: "TSLA", period: "1y" },
      };

      expect(compareSignatures(sig1, sig2)).toBe(false);
    });

    it("should return false when args have different structure", () => {
      const sig1: WidgetSignature = {
        origin: "the backend",
        widgetId: "equity_price",
        args: { symbol: "AAPL" },
      };

      const sig2: WidgetSignature = {
        origin: "the backend",
        widgetId: "equity_price",
        args: { symbol: "AAPL", period: "1y" },
      };

      expect(compareSignatures(sig1, sig2)).toBe(false);
    });

    it("should handle complex nested args objects", () => {
      const complexArgs = {
        symbol: "AAPL",
        config: {
          chart: { type: "line", colors: ["red", "blue"] },
          data: { normalize: true, limit: 100 },
        },
        filters: ["price", "volume"],
      };

      const sig1: WidgetSignature = {
        origin: "the backend",
        widgetId: "complex_widget",
        args: complexArgs,
      };

      const sig2: WidgetSignature = {
        origin: "the backend",
        widgetId: "complex_widget",
        args: { ...complexArgs },
      };

      expect(compareSignatures(sig1, sig2)).toBe(true);
    });

    it("should detect differences in nested args objects", () => {
      const sig1: WidgetSignature = {
        origin: "the backend",
        widgetId: "complex_widget",
        args: {
          symbol: "AAPL",
          config: { chart: { type: "line" } },
        },
      };

      const sig2: WidgetSignature = {
        origin: "the backend",
        widgetId: "complex_widget",
        args: {
          symbol: "AAPL",
          config: { chart: { type: "bar" } },
        },
      };

      expect(compareSignatures(sig1, sig2)).toBe(false);
    });

    it("should handle empty args objects", () => {
      const sig1: WidgetSignature = {
        origin: "Workspace",
        widgetId: "simple_widget",
        args: {},
      };

      const sig2: WidgetSignature = {
        origin: "Workspace",
        widgetId: "simple_widget",
        args: {},
      };

      expect(compareSignatures(sig1, sig2)).toBe(true);
    });
  });

  describe("regression tests for critical fields", () => {
    it("should fail comparison if origin is missing from sig1", () => {
      const sig1 = {
        widgetId: "equity_price",
        args: { symbol: "AAPL" },
      } as unknown as WidgetSignature;

      const sig2: WidgetSignature = {
        origin: "the backend",
        widgetId: "equity_price",
        args: { symbol: "AAPL" },
      };

      expect(compareSignatures(sig1, sig2)).toBe(false);
    });

    it("should fail comparison if widgetId is missing from sig2", () => {
      const sig1: WidgetSignature = {
        origin: "the backend",
        widgetId: "equity_price",
        args: { symbol: "AAPL" },
      };

      const sig2 = {
        origin: "the backend",
        args: { symbol: "AAPL" },
      } as unknown as WidgetSignature;

      expect(compareSignatures(sig1, sig2)).toBe(false);
    });
  });

  describe("critical regression test for isEqual args comparison", () => {
    it("should return false when args comparison is disabled/commented out", () => {
      // This test ensures that if someone comments out the isEqual(sig1.args, sig2.args) line,
      // the test will fail, preventing the regression you experienced
      const sig1: WidgetSignature = {
        origin: "the backend",
        widgetId: "equity_price",
        args: { symbol: "AAPL", period: "1y" },
      };

      const sig2: WidgetSignature = {
        origin: "the backend",
        widgetId: "equity_price",
        args: { symbol: "TSLA", period: "6m" }, // Different args
      };

      // This MUST return false - if it returns true, the args comparison is broken
      expect(compareSignatures(sig1, sig2)).toBe(false);
    });

    it("should return true when all fields including args are identical", () => {
      const sig1: WidgetSignature = {
        origin: "the backend",
        widgetId: "equity_price",
        args: { symbol: "AAPL", period: "1y", limit: 100 },
      };

      const sig2: WidgetSignature = {
        origin: "the backend",
        widgetId: "equity_price",
        args: { symbol: "AAPL", period: "1y", limit: 100 },
      };

      // This MUST return true - if it returns false, the comparison logic is broken
      expect(compareSignatures(sig1, sig2)).toBe(true);
    });
  });
});

describe("createSignatureMap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCurrentDateModifier.mockImplementation((value) => value);
  });

  it("should create an empty map when no widgets provided", () => {
    const result = createSignatureMap([], {});
    expect(result).toEqual({});
  });

  it("should create signature map for widgets without parameters", () => {
    const widgets = [
      createTestWidget({
        id: "widget-1",
        widgetId: "iframe",
      }),
    ];

    const result = createSignatureMap(widgets, {});

    expect(result).toEqual({
      "widget-1": {
        origin: "Workspace",
        widgetId: "widget-1",
        args: {},
      },
    });
  });

  it("should process widget parameters correctly", () => {
    const widgets = [
      createTestWidget({
        id: "widget-1",
        widgetId: "equity_price",
        params: partial<ParamDef[]>([
          {
            paramName: "symbol",
            value: "AAPL",
            type: "text",
          },
          {
            paramName: "period",
            value: "1y",
            type: "text",
          },
        ]),
      }),
    ];

    const dashboardWidgetsData: Record<string, DashboardWidgetData> = {};

    const result = createSignatureMap(widgets, dashboardWidgetsData);

    expect(result).toEqual({
      "widget-1": {
        origin: "Workspace",
        widgetId: "widget-1",
        args: {
          symbol: "AAPL",
          period: "1y",
        },
      },
    });
  });

  it("should normalize prefixed external widgetId in signature map", () => {
    const widgets = [
      createTestWidget({
        id: "widget-1",
        widgetId: "DTCC-fixed_income/treasury_volumes",
        external: true,
        sourceName: "DTCC",
      }),
    ];

    const result = createSignatureMap(widgets, {});

    expect(result["widget-1"]).toEqual({
      origin: "DTCC",
      widgetId: "fixed_income/treasury_volumes",
      args: {},
    });
  });

  it("should use dashboard widget data params when available", () => {
    const widgets = [
      createTestWidget({
        id: "widget-1",
        widgetId: "equity_price",
        params: partial<ParamDef[]>([
          {
            paramName: "symbol",
            value: "AAPL",
            type: "text",
          },
        ]),
      }),
    ];

    const dashboardWidgetsData: Record<string, DashboardWidgetData> = {
      "widget-1": {
        description: "Test widget",
        data: {},
        metadata: {
          params: {
            symbol: "TSLA", // Override the widget's default value
          },
        },
      },
    };

    const result = createSignatureMap(widgets, dashboardWidgetsData);

    expect(result["widget-1"].args).toEqual({
      symbol: "TSLA", // Should use dashboard data value
    });
  });

  it("should handle date parameters with currentDateModifier", () => {
    const widgets = [
      createTestWidget({
        id: "widget-1",
        widgetId: "equity_price",
        params: partial<ParamDef[]>([
          {
            paramName: "start_date",
            value: "$currentDate-30d",
            type: "date",
          },
          {
            paramName: "symbol",
            value: "AAPL",
            type: "text",
          },
        ]),
      }),
    ];

    mockCurrentDateModifier.mockReturnValue("2024-01-01");

    const result = createSignatureMap(widgets, {});

    expect(mockCurrentDateModifier).toHaveBeenCalledWith("$currentDate-30d");
    expect(result["widget-1"].args).toEqual({
      start_date: "2024-01-01",
      symbol: "AAPL",
    });
  });

  it("should handle widgets with different origins correctly", () => {
    const widgets = [
      createTestWidget({
        id: "workspace-widget",
        name: "FINOS Workspace Widget",
        type: "iframe",
        widgetId: "iframe-123",
      }),
      createTestWidget({
        id: "backend-widget",
        name: "Backend Widget",
        widgetId: "my_backend-equity_price",
        external: true,
        sourceName: "my_backend",
      }),
    ];

    const result = createSignatureMap(widgets, {});

    expect(result).toEqual({
      "workspace-widget": {
        origin: "Workspace",
        widgetId: "workspace-widget", // Uses widget.id for FINOS Workspace widgets
        args: {},
      },
      "backend-widget": {
        origin: "my_backend",
        widgetId: "equity_price", // Uses the normalized widget.widgetId for backend widgets
        args: {},
      },
    });
  });

  it("should handle missing widget params gracefully", () => {
    const widgets = [
      createTestWidget({
        id: "widget-1",
        widgetId: "equity_price",
        params: malformed(undefined),
      }),
    ];

    const result = createSignatureMap(widgets, {});

    expect(result).toEqual({
      "widget-1": {
        origin: "Workspace",
        widgetId: "widget-1",
        args: {},
      },
    });
  });

  it("should handle missing dashboard widget data gracefully", () => {
    const widgets = [
      createTestWidget({
        id: "widget-1",
        widgetId: "equity_price",
        params: partial<ParamDef[]>([
          {
            paramName: "symbol",
            value: "AAPL",
            type: "text",
          },
        ]),
      }),
    ];

    // dashboardWidgetsData doesn't have this widget
    const dashboardWidgetsData: Record<string, DashboardWidgetData> = {};

    const result = createSignatureMap(widgets, dashboardWidgetsData);

    expect(result["widget-1"].args).toEqual({
      symbol: "AAPL", // Should fall back to widget's default value
    });
  });

  it("should handle Unknown widgetId when widgetId is missing", () => {
    const widgets = [
      createTestWidget({
        id: "widget-1",
        widgetId: malformed(undefined),
        external: true,
        sourceName: "my_backend",
      }),
    ];

    const result = createSignatureMap(widgets, {});

    expect(result["widget-1"].widgetId).toBe("Unknown");
  });

  describe("regression tests for critical signature building", () => {
    it("should ensure origin is always included in signature", () => {
      const widgets = [
        createTestWidget({
          id: "widget-1",
          widgetId: "test",
        }),
      ];

      const result = createSignatureMap(widgets, {});

      // Ensure origin is always present in the signature
      expect(result["widget-1"]).toHaveProperty("origin");
      expect(typeof result["widget-1"].origin).toBe("string");
      expect(result["widget-1"].origin.length).toBeGreaterThan(0);
    });

    it("should ensure widgetId logic follows origin-based rules", () => {
      const workspaceWidget = createTestWidget({
        id: "workspace-1",
        name: "FINOS Workspace Widget",
        type: "iframe",
        widgetId: "iframe-123",
      });

      const backendWidget = createTestWidget({
        id: "backend-1",
        name: "Backend Widget",
        widgetId: "equity_price",
        external: true,
        sourceName: "my_backend",
      });

      const result = createSignatureMap([workspaceWidget, backendWidget], {});

      // FINOS Workspace widgets should use widget.id as widgetId
      expect(result["workspace-1"].widgetId).toBe("workspace-1");

      // Non-workspace widgets should use widget.widgetId
      expect(result["backend-1"].widgetId).toBe("equity_price");
    });

    it("should ensure all parameters are processed and included in args", () => {
      const widgets = [
        createTestWidget({
          id: "widget-1",
          widgetId: "complex_widget",
          params: partial<ParamDef[]>([
            { paramName: "param1", value: "value1", type: "text" },
            { paramName: "param2", value: "value2", type: "text" },
            { paramName: "date_param", value: "$currentDate+0d", type: "date" },
          ]),
        }),
      ];

      mockCurrentDateModifier.mockReturnValue("2024-01-01");

      const result = createSignatureMap(widgets, {});

      // Ensure all parameters are present in args
      expect(Object.keys(result["widget-1"].args)).toHaveLength(3);
      expect(result["widget-1"].args).toEqual({
        param1: "value1",
        param2: "value2",
        date_param: "2024-01-01",
      });
    });

    it("should ensure date parameters are processed with currentDateModifier", () => {
      const widgets = [
        createTestWidget({
          id: "widget-1",
          widgetId: "test_widget",
          params: partial<ParamDef[]>([
            { paramName: "start_date", value: "$currentDate-1y", type: "date" },
            { paramName: "end_date", value: "$currentDate+0d", type: "date" },
            { paramName: "symbol", value: "AAPL", type: "text" },
          ]),
        }),
      ];

      mockCurrentDateModifier
        .mockReturnValueOnce("2023-01-01") // for start_date
        .mockReturnValueOnce("2024-01-01"); // for end_date

      const result = createSignatureMap(widgets, {});

      expect(mockCurrentDateModifier).toHaveBeenCalledWith("$currentDate-1y");
      expect(mockCurrentDateModifier).toHaveBeenCalledWith("$currentDate+0d");
      expect(mockCurrentDateModifier).toHaveBeenCalledTimes(2);

      expect(result["widget-1"].args).toEqual({
        start_date: "2023-01-01",
        end_date: "2024-01-01",
        symbol: "AAPL", // Non-date param should not be processed
      });
    });
  });
});

describe("detectQueryMismatch", () => {
  it("returns false when both queries are equal", () => {
    expect(detectQueryMismatch("SELECT 1", "SELECT 1")).toBe(false);
  });

  it("returns true when queries differ", () => {
    expect(detectQueryMismatch("SELECT 1", "SELECT 2")).toBe(true);
  });

  it("returns false when citation query is undefined", () => {
    expect(detectQueryMismatch(undefined, "SELECT 1")).toBe(false);
  });

  it("returns false when widget query is undefined", () => {
    expect(detectQueryMismatch("SELECT 1", undefined)).toBe(false);
  });

  it("returns false when both queries are undefined", () => {
    expect(detectQueryMismatch(undefined, undefined)).toBe(false);
  });

  it("returns false when citation query is empty string", () => {
    expect(detectQueryMismatch("", "SELECT 1")).toBe(false);
  });
});

describe("normalizeCitations", () => {
  const sourceInfo = { type: "widget", name: "Widget" };

  it("passes through citations that have an id and a signature", () => {
    const citations = [{ id: "cite-1", signature: "sig-1", source_info: sourceInfo }];

    expect(normalizeCitations(citations)).toEqual(citations);
  });

  it("gives a citation without an id one", () => {
    const [citation] = normalizeCitations([
      { signature: "sig-1", source_info: sourceInfo },
    ]);

    expect(citation.id).toBeTruthy();
    expect(citation.signature).toBe("sig-1");
  });

  it("gives a citation without a signature an empty one", () => {
    const [citation] = normalizeCitations([{ id: "cite-1", source_info: sourceInfo }]);

    expect(citation.id).toBe("cite-1");
    expect(citation.signature).toBe("");
  });

  it("keeps the details and artifacts of a citation it completes", () => {
    const [citation] = normalizeCitations([
      {
        id: "cite-1",
        source_info: sourceInfo,
        details: [{ extra: "data" }],
        artifacts: [{ uuid: "a1", type: "text", content: "text" }],
      },
    ]);

    expect(citation.details).toEqual([{ extra: "data" }]);
    expect(citation.artifacts).toEqual([{ uuid: "a1", type: "text", content: "text" }]);
  });

  it("drops what names no source, as there is nothing to render", () => {
    expect(normalizeCitations([{ id: "cite-1" }, null, "text"])).toEqual([]);
  });

  it("returns no citations for something that is not a list", () => {
    expect(normalizeCitations(null)).toEqual([]);
    expect(normalizeCitations(undefined)).toEqual([]);
    expect(normalizeCitations("string")).toEqual([]);
  });
});
