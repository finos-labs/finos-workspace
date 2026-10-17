import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Source } from "~/lib/state/backendConnector";
import {
  validateBackend,
  validateBackendEndpoints,
  validateObject,
} from "~/lib/utils/validateBackend";
import type { WidgetsType } from "~/utils/zodForms";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("validateBackend - widgets.json endpoint behavior", () => {
  const mockSource: Source = {
    url: "https://test-backend.com",
    name: "Test Backend",
    endpointHeaders: [
      { key: "Authorization", value: "Bearer test-token", location: "headers" },
    ],
    id: "test-uuid",
  };

  const mockBackendUrl = new URL(mockSource.url);
  const mockHeaders = { Authorization: "Bearer test-token" };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("widgets.json response handling", () => {
    it("should handle jsonify({}) for widgets.json - returns empty widgets, no error message", async () => {
      // Mock widgets.json response with empty object
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({}),
          headers: new Headers(),
        })
        // Mock apps.json response (empty for this test)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([]),
          headers: new Headers(),
        })
        // Mock agents.json response
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([]),
          headers: new Headers(),
        });

      const result = await validateBackend(mockSource, false);

      // Empty object {} is a valid widgets.json format (just means no widgets)
      expect(result.widgets).toEqual({});
      expect(result.errorMessage).toBeNull();
    });

    it("should handle jsonify([]) for widgets.json - shows appropriate error message", async () => {
      // Mock widgets.json response with empty array
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([]),
          headers: new Headers(),
        })
        // Mock apps.json response
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([]),
          headers: new Headers(),
        })
        // Mock agents.json response
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([]),
          headers: new Headers(),
        });

      const result = await validateBackend(mockSource, false);

      expect(result.widgets).toEqual({});
      expect(result.errorMessage).not.toBeNull();
      expect(result.errorMessage).toContain("Invalid format");
      expect(result.errorMessage).toContain("Expected:");
      expect(result.errorMessage).toContain("Received:");
    });

    it("should handle valid widgets.json format correctly", async () => {
      const validWidgets = {
        stock_price: {
          name: "Stock Price",
          description: "Get current stock price",
          category: "Stocks",
          endpoint: "/stock/price",
          type: "html",
          gridData: {
            w: 20,
            h: 9,
          },
          params: [
            {
              type: "text",
              paramName: "symbol",
              value: "AAPL",
              label: "Symbol",
              show: true,
            },
          ],
        },
      };

      // Mock widgets.json response with valid widgets
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(validWidgets),
          headers: new Headers(),
        })
        // Mock apps.json response
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([]),
          headers: new Headers(),
        })
        // Mock agents.json response
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([]),
          headers: new Headers(),
        });

      const result = await validateBackend(mockSource, false);

      expect(result.widgets).toEqual(
        expect.objectContaining({
          stock_price: expect.objectContaining({
            name: "Stock Price",
            description: "Get current stock price",
          }),
        }),
      );
      expect(result.errorMessage).toBeNull();
    });

    it("should leave out widgets whose type this Workspace does not render", async () => {
      const mixedWidgets = {
        report: {
          name: "Report",
          description: "An HTML report",
          endpoint: "/report",
          type: "html",
          params: [],
        },
        prices: {
          name: "Prices",
          description: "A table (the protocol default type)",
          endpoint: "/prices",
          params: [],
        },
        trend: {
          name: "Trend",
          description: "A chart",
          endpoint: "/trend",
          type: "chart",
          params: [],
        },
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mixedWidgets),
          headers: new Headers(),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([]),
          headers: new Headers(),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([]),
          headers: new Headers(),
        });

      const result = await validateBackend(mockSource, false);

      expect(result.errorMessage).toBeNull();
      expect(Object.keys(result.widgets)).toEqual(["report"]);
      expect(result.unsupportedWidgets).toEqual(["prices", "trend"]);
    });

    it("should report unrecognized widget keys when widget schema is otherwise valid", async () => {
      const widgetWithExtraKey = {
        stock_price: {
          name: "Stock Price",
          description: "Get current stock price",
          endpoint: "/stock/price",
          type: "html",
          params: [],
          unsupported_widget_option: true,
        },
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(widgetWithExtraKey),
          headers: new Headers(),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([]),
          headers: new Headers(),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([]),
          headers: new Headers(),
        });

      const result = await validateBackend(mockSource, false);

      expect(result.errorMessage).toBeNull();
      expect(result.unrecognizedKeysMessage).toEqual([
        {
          label: "[widgets.json]",
          entries: [
            {
              name: "Stock Price",
              keys: ["unsupported_widget_option"],
            },
          ],
        },
      ]);
    });

    it("should handle widgets.json with invalid widget schemas", async () => {
      const invalidWidgets = {
        invalid_widget: {
          name: "Invalid Widget",
          type: "html",
          // Missing required fields like endpoint
          description: "This widget is missing required fields",
        },
        another_invalid: {
          // Missing name field
          type: "html",
          endpoint: "/test",
          params: "invalid_params_format", // Should be object not string
        },
      };

      // Mock widgets.json response with invalid widgets
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(invalidWidgets),
          headers: new Headers(),
        })
        // Mock apps.json response
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([]),
          headers: new Headers(),
        })
        // Mock agents.json response
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([]),
          headers: new Headers(),
        });

      const result = await validateBackend(mockSource, false);

      expect(result.widgets).toEqual({});
      expect(result.errorMessage).not.toBeNull();
      expect(result.errorMessage).toContain("Invalid Widget");
    });

    it("should handle widgets.json fetch failure with appropriate error", async () => {
      // Mock widgets.json fetch failure
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => ({}),
        headers: new Headers(),
      });

      await expect(validateBackend(mockSource)).rejects.toThrow(
        "The widgets.json file was not found on the server.",
      );
    });

    it("should handle widgets.json with authentication errors", async () => {
      // Mock widgets.json fetch with 401 error
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: async () => ({}),
        headers: new Headers(),
      });

      await expect(validateBackend(mockSource)).rejects.toThrow(
        "Authentication failed",
      );
    });

    it("should handle widgets.json network timeout", async () => {
      // Mock widgets.json fetch with timeout error
      mockFetch.mockRejectedValueOnce({
        code: 23,
        message: "Request timed out",
      });

      await expect(validateBackend(mockSource)).rejects.toThrow("Request timed out");
    });

    it("should detect Platform from headers", async () => {
      const validWidgets = {
        test_widget: {
          name: "Test Widget",
          endpoint: "/test",
          params: {},
        },
      };

      // Mock widgets.json response with Platform header
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(validWidgets),
          headers: new Headers({ "X-Backend-Type": "Platform" }),
        })
        // Mock apps.json response
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([]),
          headers: new Headers(),
        })
        // Mock agents.json response
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([]),
          headers: new Headers(),
        });

      const result = await validateBackend(mockSource, false);

      expect(result.isPlatform).toBe(true);
    });
  });

  describe("validateObject function", () => {
    it("should return error for array input", () => {
      const arrayInput = [{ name: "widget1" }];
      const result = validateObject(arrayInput);

      expect(result).not.toBeNull();
      expect(result).toContain("Invalid format");
      expect(result).toContain("Expected:");
      expect(result).toContain("Received:");
    });

    it("should return error for single widget object", () => {
      const singleWidget = { name: "widget1", description: "test", endpoint: "/test" };
      const result = validateObject(singleWidget);

      expect(result).not.toBeNull();
      expect(result).toContain("Invalid format");
    });

    it("should return null for valid widgets object", () => {
      const validWidgets = {
        widget1: {
          name: "Widget 1",
          description: "Test widget 1",
          endpoint: "/test1",
          params: [],
        },
        widget2: {
          name: "Widget 2",
          description: "Test widget 2",
          endpoint: "/test2",
          params: [],
        },
      };

      const result = validateObject(validWidgets);
      expect(result).toBeNull();
    });

    it("should return detailed validation errors for invalid widgets", () => {
      const invalidWidgets = {
        invalid_widget: {
          name: "", // Invalid: empty name
          description: "Invalid widget",
          endpoint: "/test2",
          params: "invalid", // Invalid: should be array
        },
        missing_fields: {
          // Missing required name and endpoint
          description: "Missing required fields",
        },
      };

      const result = validateObject(invalidWidgets);

      expect(result).not.toBeNull();
      // Should contain validation details for required fields
      expect(result).toContain("received undefined");
    });
  });

  describe("validateBackendEndpoints function", () => {
    it("should validate widget endpoints successfully", async () => {
      const widgets: WidgetsType = {
        test_widget: {
          name: "Test Widget",
          description: "A test widget",
          endpoint: "/test",
          sub_category: "test",
          subCategory: "test",
          type: "html",
          defaultViz: "html",
          params: [
            {
              paramName: "symbol",
              type: "text",
              value: "AAPL",
              show: true,
            },
          ],
        },
      };

      // Mock successful endpoint response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
        headers: new Headers(),
      });
      const failedEndpoints = await validateBackendEndpoints(
        widgets,
        mockBackendUrl,
        mockHeaders,
        {},
      );

      expect(failedEndpoints).toEqual([]);
    });

    it("should detect failed widget endpoints", async () => {
      const widgets = {
        failing_widget: {
          name: "Failing Widget",
          description: "A failing widget",
          endpoint: "/failing",
          sub_category: "test",
          subCategory: "test",
          type: "html" as const,
          defaultViz: "html" as const,
          params: [],
        },
      };

      // Mock failing endpoint response
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: "Internal server error" }),
        headers: new Headers(),
      });

      const failedEndpoints = await validateBackendEndpoints(
        widgets,
        mockBackendUrl,
        mockHeaders,
        {},
      );

      expect(failedEndpoints).toHaveLength(1);
      expect(failedEndpoints[0]).toContain("failing_widget");
      expect(failedEndpoints[0]).toContain("Internal server error");
    });

    it("should handle network errors for widget endpoints", async () => {
      const widgets = {
        network_error_widget: {
          name: "Network Error Widget",
          description: "A widget that causes network errors",
          endpoint: "/network-error",
          sub_category: "test",
          subCategory: "test",
          type: "html" as const,
          defaultViz: "html" as const,
          params: [],
        },
      };

      // Mock network error
      mockFetch.mockRejectedValueOnce(new Error("Network timeout"));

      const failedEndpoints = await validateBackendEndpoints(
        widgets,
        mockBackendUrl,
        mockHeaders,
        {},
      );

      expect(failedEndpoints).toHaveLength(1);
      expect(failedEndpoints[0]).toContain("network_error_widget");
      expect(failedEndpoints[0]).toContain("Network timeout");
    });

    it("passes the abort signal through to endpoint fetches", async () => {
      const widgets = {
        signal_widget: {
          name: "Signal Widget",
          description: "A widget for signal threading",
          endpoint: "/signal",
          sub_category: "test",
          subCategory: "test",
          type: "html" as const,
          defaultViz: "html" as const,
          params: [],
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
        headers: new Headers(),
      });

      const signal = new AbortController().signal;
      await validateBackendEndpoints(
        widgets,
        mockBackendUrl,
        mockHeaders,
        {},
        false,
        signal,
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ signal }),
      );
    });

    it("should skip 422 validation errors (expected for missing params)", async () => {
      const widgets = {
        param_required_widget: {
          name: "Param Required Widget",
          description: "Widget requiring parameters",
          endpoint: "/requires-params",
          sub_category: "test",
          subCategory: "test",
          type: "html" as const,
          defaultViz: "html" as const,
          params: [
            {
              paramName: "required_param",
              type: "text" as const,
              value: "test",
              label: "Required Param",
              show: true,
            },
          ],
        },
      };

      // Mock 422 response (validation error for missing params)
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: () => Promise.resolve({ detail: "field required" }),
        headers: new Headers(),
      });

      const failedEndpoints = await validateBackendEndpoints(
        widgets,
        mockBackendUrl,
        mockHeaders,
        {},
      );

      // Should skip 422 errors as they're expected for widgets with required params
      expect(failedEndpoints).toEqual([]);
    });
  });

  describe("integrated widgets.json and apps.json validation", () => {
    it("should handle both widgets and apps validation together", async () => {
      const validWidgets = {
        stock_widget: {
          name: "Stock Widget",
          description: "Stock analysis widget",
          endpoint: "/stock",
          type: "html",
          params: [],
        },
      };

      const validApps = [
        {
          name: "Stock App",
          description: "Stock analysis application",
          tabs: {
            main: {
              id: "main",
              name: "Main",
              layout: [],
            },
          },
        },
      ];

      // Mock both responses as successful
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(validWidgets),
          headers: new Headers(),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(validApps),
          url: `${mockSource.url}/apps.json`,
          headers: new Headers(),
        })
        // Mock agents.json response
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([]),
          headers: new Headers(),
        });

      const result = await validateBackend(mockSource, false);

      expect(result.widgets).toEqual(
        expect.objectContaining({
          stock_widget: expect.objectContaining({
            name: "Stock Widget",
          }),
        }),
      );
      expect(result.templates).toHaveLength(1);
      expect(result.templates[0].name).toBe("Stock App");
      expect(result.errorMessage).toBeNull();
      expect(result.templateErrorMessage).toBeNull();
      expect(result.totalFailed).toBe(0);
    });

    it("should handle widgets validation errors alongside template errors", async () => {
      const invalidWidgets = {
        invalid_widget: {
          name: "", // Invalid empty name
          endpoint: "/test",
          type: "html",
        },
      };

      const invalidApps = [
        {
          name: "Invalid App",
          // Missing required tabs field
        },
      ];

      // Mock both responses with invalid data
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(invalidWidgets),
          headers: new Headers(),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(invalidApps),
          url: `${mockSource.url}/apps.json`,
          headers: new Headers(),
        })
        // Mock agents.json response
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([]),
          headers: new Headers(),
        });

      const result = await validateBackend(mockSource, false);

      expect(result.widgets).toEqual({});
      expect(result.templates).toEqual([]);
      expect(result.errorMessage).not.toBeNull();
      expect(result.templateErrorMessage).not.toBeNull();
      expect(result.totalFailed).toBeGreaterThan(0);
    });
  });
});
