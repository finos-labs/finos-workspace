import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Source } from "~/lib/state/backendConnector";
import { validateBackend, validateBackendEndpoints } from "~/lib/utils/validateBackend";
import type { WidgetsType } from "~/utils/zodForms";
import { throughSourceProxy } from "../../../mocks/sourceProxy";
import { installWidgetsSchemaFixture } from "../../../mocks/widgetsSchema";

const mockFetch = vi.fn();
global.fetch = throughSourceProxy(mockFetch);
installWidgetsSchemaFixture();

describe("validateBackend - widgets.json endpoint behavior", () => {
  const mockSource: Source = {
    url: "https://test-backend.com",
    name: "Test Backend",
    endpointHeaders: [
      { key: "Authorization", value: "Bearer test-token", location: "headers" },
    ],
    id: "test-uuid",
  };

  const mockHeaders = { Authorization: "Bearer test-token" };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("widgets.json response handling", () => {
    it("should handle jsonify({}) for widgets.json - returns empty widgets, no error message", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({}),
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

      expect(result.widgets).toEqual({});
      expect(result.errorMessage).toBeNull();
    });

    it("should handle jsonify([]) for widgets.json - shows appropriate error message", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([]),
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

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(validWidgets),
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

    it("should report untyped widgets, leave out unhandled types and keep enabled plugin types", async () => {
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
          description: "No type: the contract requires one",
          endpoint: "/prices",
          params: [],
        },
        trend: {
          name: "Trend",
          description: "A type no plugin enabled for the entity handles",
          endpoint: "/trend",
          type: "chart",
          params: [],
        },
        chart: {
          name: "Chart",
          description: "A type an enabled plugin handles",
          endpoint: "/chart",
          type: "test_chart",
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

      expect(Object.keys(result.validWidgets ?? {})).toEqual(["report", "chart"]);
      expect(result.invalidItems?.map((item) => item.id)).toEqual(["prices"]);
      expect(result.unsupportedWidgets).toEqual(["trend"]);
      expect(result.unrenderedWidgets).toEqual(["chart"]);
    });

    it("should load a widget without a key the contract does not define, and name the key", async () => {
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

      expect(Object.keys(result.validWidgets ?? {})).toEqual(["stock_price"]);
      expect(result.validWidgets?.stock_price).not.toHaveProperty(
        "unsupported_widget_option",
      );
      expect(result.errorMessage).toBeNull();
      expect(result.unrecognizedKeysMessage).toEqual([
        {
          label: "[widgets.json]",
          entries: [
            { name: "Stock Price (stock_price)", keys: ["unsupported_widget_option"] },
          ],
        },
      ]);
    });

    it("should handle widgets.json with invalid widget schemas", async () => {
      const invalidWidgets = {
        invalid_widget: {
          name: "Invalid Widget",
          type: "html",
          description: "This widget is missing required fields",
        },
        another_invalid: {
          type: "html",
          endpoint: "/test",
          params: "invalid_params_format",
        },
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(invalidWidgets),
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

      expect(result.widgets).toEqual({});
      expect(result.errorMessage).not.toBeNull();
      expect(result.errorMessage).toContain("Invalid Widget");
    });

    it("should handle widgets.json fetch failure with appropriate error", async () => {
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
      mockFetch.mockRejectedValueOnce({
        code: 23,
        message: "Request timed out",
      });

      await expect(validateBackend(mockSource)).rejects.toThrow("Request timed out");
    });
  });

  describe("validateBackendEndpoints: the route probe (WIDGETS-JSON 4.8)", () => {
    const widget = (endpoint: string, params: unknown[] = []) => ({
      name: "Widget",
      description: "A widget",
      endpoint,
      type: "html" as const,
      params,
    });

    function answer(
      statuses: Record<string, number | "unreachable">,
      fallback: number | "unreachable" = 404,
    ) {
      mockFetch.mockImplementation(async (url: string) => {
        const status = statuses[new URL(url).pathname] ?? fallback;
        if (status === "unreachable") throw new TypeError("Failed to fetch");
        return { ok: status < 400, status, headers: new Headers() };
      });
    }

    const probedPaths = () =>
      mockFetch.mock.calls.map(([url]) => new URL(url as string).pathname);

    it("has the API send one plain OPTIONS per distinct route", async () => {
      answer({ "/a": 405, "/teams/eu": 405, "/rows/1": 405, "/items/7": 200 });
      const widgets = {
        first: widget("/a"),
        same_route: widget("/a?view=compact"),
        with_path: widget("/items/{id}", [
          { paramName: "id", type: "number", value: 7 },
        ]),
        with_lookups: widget("/a", [
          { paramName: "region", type: "text", value: "eu" },
          {
            paramName: "team",
            type: "endpoint",
            optionsEndpoint: "/teams/{region}",
            optionsParams: { region: "$region" },
          },
          {
            paramName: "edit",
            type: "form",
            endpoint: "/rows/{row}",
            method: "POST",
            inputParams: [{ paramName: "row", type: "text", value: "1" }],
          },
        ]),
      } as unknown as WidgetsType;

      const report = await validateBackendEndpoints(widgets, mockSource);

      expect(report).toEqual({ failed: [], unchecked: [] });
      const [canary, ...routes] = probedPaths();
      expect(canary).toMatch(/^\/__workspace_route_probe_\w+$/);
      expect(routes.sort()).toEqual(["/a", "/items/7", "/rows/1", "/teams/eu"]);
      for (const [url, init] of mockFetch.mock.calls) {
        expect(new URL(url as string).search).toBe("");
        expect(init).toMatchObject({ method: "OPTIONS", headers: {} });
        expect(init).not.toHaveProperty("body");
      }
    });

    it("reports a route the backend does not have, with what refers to it", async () => {
      answer({ "/a": 405 });
      const widgets = {
        present: widget("/a"),
        missing: widget("/gone"),
        also_missing: widget("/gone"),
      } as unknown as WidgetsType;

      const report = await validateBackendEndpoints(widgets, mockSource);

      expect(report.failed).toEqual([
        "Widget: missing; Widget: also_missing - `/gone`: no such route (404)",
      ]);
    });

    it("says a backend that answers every OPTIONS cannot be checked, not that it is valid", async () => {
      answer({}, 200);
      const report = await validateBackendEndpoints(
        { a: widget("/gone") } as unknown as WidgetsType,
        mockSource,
      );

      expect(report.failed).toEqual([]);
      expect(report.unchecked[0]).toContain(
        "answers OPTIONS for a path that does not exist",
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("says routes were not checked when the backend does not answer OPTIONS", async () => {
      answer({}, "unreachable");
      const report = await validateBackendEndpoints(
        { a: widget("/a") } as unknown as WidgetsType,
        mockSource,
      );

      expect(report.failed).toEqual([]);
      expect(report.unchecked[0]).toContain("did not answer OPTIONS");
    });

    it("skips a route whose placeholder has no default, and routes on other origins", async () => {
      answer({});
      const widgets = {
        no_default: widget("/items/{id}", [{ paramName: "id", type: "text" }]),
        elsewhere: widget("https://elsewhere.invalid/page"),
      } as unknown as WidgetsType;

      const report = await validateBackendEndpoints(widgets, mockSource);

      expect(report.failed).toEqual([]);
      expect(report.unchecked).toEqual([
        "Widget: no_default - `/items/{id}`: a placeholder has no default value",
        "Widget: elsewhere - `https://elsewhere.invalid/page`: not on the backend's origin",
      ]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("encodes a placeholder value as one path segment", async () => {
      answer({ "/files/a%2Fb%20c": 405 });
      const report = await validateBackendEndpoints(
        {
          a: widget("/files/{name}", [
            { paramName: "name", type: "text", value: "a/b c" },
          ]),
        } as unknown as WidgetsType,
        mockSource,
      );

      expect(report.failed).toEqual([]);
      expect(probedPaths()).toContain("/files/a%2Fb%20c");
    });

    it("reports a route that does not answer once the canary has", async () => {
      answer({ "/slow": "unreachable" });
      const report = await validateBackendEndpoints(
        { slow: widget("/slow") } as unknown as WidgetsType,
        mockSource,
      );

      expect(report.failed).toEqual(["Widget: slow - `/slow`: no response"]);
    });

    it("sends nothing once the abort signal has fired", async () => {
      answer({ "/a": 405 });
      const controller = new AbortController();
      controller.abort();

      await expect(
        validateBackendEndpoints(
          { a: widget("/a") } as unknown as WidgetsType,
          mockSource,
          controller.signal,
        ),
      ).rejects.toBeDefined();
      expect(mockFetch).not.toHaveBeenCalled();
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
          name: "",
          endpoint: "/test",
          type: "html",
        },
      };

      const invalidApps = [
        {
          name: "Invalid App",
        },
      ];

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
