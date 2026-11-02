import { describe, expect, it } from "vitest";
import type { WidgetT } from "~/components/types";

import {
  cleanURL,
  createParamDefs,
  createURLString,
  createWidgetEndpoint,
  createWidgetInitParams,
  currentDateModifier,
  streamEndpointOf,
} from "~/lib/utils/widgetParams";
import { malformed, partial } from "../../mocks";

type CreateParamDefsInput = Parameters<typeof createParamDefs>[0];

describe("Widget Params Utility Functions", () => {
  describe("createParamDefs", () => {
    it("keeps the extraInfo of a choice", () => {
      const extraInfo = { description: "Sites", rightOfDescription: "12" };
      const [param] = createParamDefs(
        partial<CreateParamDefsInput>({
          params: [
            {
              paramName: "region",
              type: "text",
              multiSelect: true,
              options: [{ label: "North", value: "north", extraInfo }],
            },
          ],
        }),
      );
      expect(param.options).toEqual([{ label: "North", value: "north", extraInfo }]);
    });

    it("keeps a form's endpoint input options, on the backend's URL", () => {
      const widget = partial<CreateParamDefsInput>({
        params: [
          {
            paramName: "note",
            type: "form",
            endpoint: "/notes",
            inputParams: [
              {
                paramName: "rate",
                type: "endpoint",
                optionsEndpoint: "/rates",
                optionsParams: { region: "eu" },
              },
            ],
          },
        ],
      });

      const [form] = createParamDefs(widget, "https://backend.test");

      expect(form).toMatchObject({
        endpoint: "https://backend.test/notes",
        inputParams: [
          {
            paramName: "rate",
            optionsEndpoint: "https://backend.test/rates",
            optionsParams: { region: "eu" },
          },
        ],
      });
    });

    it("should create param definitions from widget params", () => {
      const widget = partial<CreateParamDefsInput>({
        params: [
          { paramName: "symbol", type: "text", value: "AAPL" },
          { paramName: "period", type: "text", value: "annual" },
        ],
      });
      const result = createParamDefs(widget);
      expect(result).toHaveLength(2);
      expect(result[0].paramName).toBe("symbol");
      expect(result[1].paramName).toBe("period");
    });

    it("should handle endpoint type params with backendURL", () => {
      const widget = partial<CreateParamDefsInput>({
        params: [
          {
            paramName: "endpoint_param",
            type: "endpoint",
            optionsEndpoint: "/api/options",
          },
        ],
      });
      const result = createParamDefs(widget, "https://example.com");
      expect(result[0]).toMatchObject({
        optionsEndpoint: "https://example.com/api/options",
      });
      expect(result[0]).toMatchObject({ groupById: "options" });
    });

    it("should handle form type params", () => {
      const widget = partial<CreateParamDefsInput>({
        params: [
          {
            type: "form",
            endpoint: "/submit",
            inputParams: [{ paramName: "field1", type: "text" }],
          },
        ],
      });
      const result = createParamDefs(widget, "https://example.com");
      expect(result[0]).toMatchObject({ endpoint: "https://example.com/submit" });
    });

    it("should return empty array for non-array params (preprocess coerces to [])", () => {
      const widget = {
        params: "invalid_params",
      };
      const result = createParamDefs(malformed(widget));
      expect(result).toEqual([]);
    });

    it("should handle empty params array", () => {
      const widget = { params: [] };
      const result = createParamDefs(widget);
      expect(result).toEqual([]);
    });

    it("should handle widget without params", () => {
      const widget = {};
      const result = createParamDefs(malformed(widget));
      expect(result).toEqual([]);
    });
  });

  describe("createWidgetEndpoint", () => {
    it("should create endpoint from string URL, with no credentials", () => {
      const result = createWidgetEndpoint("https://api.example.com/data");
      expect(result).toEqual({ url: "https://api.example.com/data", method: "GET" });
    });

    it("keeps the method the widget declares", () => {
      const urlObj = { url: "https://api.example.com/data", method: "POST" } as const;
      const result = createWidgetEndpoint(urlObj);
      expect(result.url).toBe("https://api.example.com/data");
      expect(result.method).toBe("POST");
    });

    it("should clean duplicate slashes in URL", () => {
      const result = createWidgetEndpoint("https://api.example.com//data//path");
      expect(result.url).toBe("https://api.example.com/data/path");
    });
  });

  describe("createWidgetInitParams", () => {
    it("should create initial params from widget definition", () => {
      const widget = {
        params: [
          { paramName: "symbol", type: "text", value: "AAPL" },
          { paramName: "period", type: "text", value: "annual" },
        ],
      } as unknown as WidgetT;
      const result = createWidgetInitParams(widget);
      expect(result.symbol).toBe("AAPL");
      expect(result.period).toBe("annual");
    });

    it("should use storage params over default values", () => {
      const widget = {
        params: [{ paramName: "symbol", type: "text", value: "AAPL" }],
        storage: {
          params: { symbol: "MSFT" },
        },
      } as unknown as WidgetT;
      const result = createWidgetInitParams(widget);
      expect(result.symbol).toBe("MSFT");
    });

    it("should handle params without values (newParamDef defaults to null)", () => {
      const widget = {
        params: [{ paramName: "empty", type: "text" }],
      } as unknown as WidgetT;
      const result = createWidgetInitParams(widget);
      expect(result).toEqual({ empty: null });
    });
  });

  describe("a default of false or 0", () => {
    const widget = partial<CreateParamDefsInput>({
      params: [
        { paramName: "active", type: "boolean", value: false },
        { paramName: "offset", type: "number", value: 0 },
        { paramName: "limit", type: "number", value: "0" },
        { paramName: "label", type: "text", value: 0 },
        { paramName: "note", type: "text", value: "" },
      ] as unknown as NonNullable<CreateParamDefsInput["params"]>,
    });

    it("is the value of the parameter", () => {
      const [active, offset, limit, label, note] = createParamDefs(widget);
      expect(active.value).toBe(false);
      expect(offset.value).toBe(0);
      expect(limit.value).toBe(0);
      expect(label.value).toBe("0");
      expect(note.value).toBeNull();
    });

    it("is what the widget starts with", () => {
      expect(createWidgetInitParams(widget as WidgetT)).toEqual({
        active: false,
        offset: 0,
        limit: 0,
        label: "0",
        note: null,
      });
    });
  });

  describe("createWidgetEndpoint edge cases", () => {
    it("should handle URL with existing query string", () => {
      const result = createWidgetEndpoint("https://api.example.com?existing=param");
      expect(result.url).toBe("https://api.example.com?existing=param");
    });
  });

  describe("cleanURL", () => {
    it("should remove duplicate slashes", () => {
      expect(cleanURL("https://example.com//api//users")).toBe(
        "https://example.com/api/users",
      );
    });

    it("should preserve protocol slashes", () => {
      expect(cleanURL("https://example.com/path")).toBe("https://example.com/path");
    });

    it("should handle undefined/null", () => {
      expect(cleanURL(malformed(undefined))).toBe(undefined);
      expect(cleanURL(malformed(null))).toBe(undefined);
    });
  });

  describe("streamEndpointOf", () => {
    it("resolves the path of a stream against the backend's address, as the endpoint is", () => {
      expect(
        streamEndpointOf({ streamEndpoint: "/ws/ticks" }, "http://localhost:7798"),
      ).toBe("http://localhost:7798/ws/ticks");
      expect(
        streamEndpointOf({ streamEndpoint: "ws/ticks" }, "http://localhost:7798/"),
      ).toBe("http://localhost:7798/ws/ticks");
    });

    it("keeps an absolute address, and says nothing when the widget has no stream", () => {
      expect(
        streamEndpointOf(
          { streamEndpoint: "https://other.example/ws" },
          "http://localhost:7798",
        ),
      ).toBe("https://other.example/ws");
      expect(streamEndpointOf({}, "http://localhost:7798")).toBeUndefined();
      expect(streamEndpointOf(undefined, "http://localhost:7798")).toBeUndefined();
    });
  });

  describe("createURLString", () => {
    it("should combine base URL and endpoint", () => {
      expect(createURLString("widget.json", "https://example.com/widgets")).toBe(
        "https://example.com/widgets/widget.json",
      );
    });

    it("should return data URIs unchanged", () => {
      const dataUri = "data:application/json;base64,eyJ0ZXN0IjogdHJ1ZX0=";
      expect(createURLString(dataUri)).toBe(dataUri);
    });

    it("should return full URLs unchanged", () => {
      expect(createURLString("https://other.com/api")).toBe("https://other.com/api");
    });

    it("should handle URL objects as base", () => {
      expect(createURLString("api", new URL("https://example.com"))).toBe(
        "https://example.com/api",
      );
    });
  });

  describe("currentDateModifier", () => {
    it("should return regular dates unchanged", () => {
      expect(currentDateModifier("2024-01-15")).toBe("2024-01-15");
    });

    it("should handle date modifiers", () => {
      const result = currentDateModifier("$currentDate-1d");
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});
