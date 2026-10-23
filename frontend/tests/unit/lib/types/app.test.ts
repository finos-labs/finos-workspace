import { describe, expect, it } from "vitest";
import {
  _GridDataSchema,
  ExternalWidgetSchema,
  InternalWidgetSchema,
  isBuiltInVizType,
  ParamDefSchema,
  ParamsSchema,
  StorageSchema,
  TickerSchema,
  WidgetSchemaBase,
  WidgetVizTypes,
  widgetTypesSchema,
} from "~/lib/types/app";

describe("Zod Schemas from app.ts", () => {
  describe("TickerSchema", () => {
    it("should have a consistent shape", () => {
      const shapeKeys = Object.keys(TickerSchema.shape).sort();
      expect(shapeKeys).toMatchInlineSnapshot(`
        [
          "category",
          "cik",
          "color",
          "country",
          "currency",
          "cusip",
          "exchange",
          "has_options",
          "id",
          "industry",
          "isin",
          "name",
          "sector",
          "symbol",
          "type",
        ]
      `);
    });

    it("should validate a valid ticker object", () => {
      const validTicker = {
        id: "123",
        symbol: "AAPL",
        category: "equity",
        color: "#FF0000",
        type: "Common Stock",
        name: "Apple Inc.",
        exchange: "NASDAQ",
        currency: "USD",
        industry: "Technology",
        sector: "Information Technology",
        country: "USA",
        cik: "0000320193",
        isin: "US0378331005",
        cusip: "037833100",
        has_options: true,
      };
      expect(TickerSchema.safeParse(validTicker).success).toBe(true);
    });

    it("should validate with minimal required fields (id, symbol, category)", () => {
      const minimalTicker = {
        id: "456",
        symbol: "GOOG",
        category: "equity",
      };
      const result = TickerSchema.safeParse(minimalTicker);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({
          ...minimalTicker,
        });
      }
    });

    it("should invalidate if required fields are missing", () => {
      const invalidTicker = { id: "123", symbol: "TSLA" };
      const result = TickerSchema.safeParse(invalidTicker);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((issue) => issue.path.includes("category")),
        ).toBe(true);
      }
    });

    it("should invalidate with incorrect category enum", () => {
      const invalidTicker = {
        id: "789",
        symbol: "MSFT",
        category: "invalidCategory",
      };
      const result = TickerSchema.safeParse(invalidTicker);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.find((issue) => issue.path.includes("category"))?.message,
        ).toContain("Invalid input");
      }
    });
  });

  describe("ParamDefSchema (and base/form variants)", () => {
    it("ParamDefSchemaBase: should have a consistent shape", () => {
      const validBaseParam = {
        paramName: "testParam",
        type: "text",
        label: "Test Param",
        show: true,
      };

      const result = ParamDefSchema.safeParse(validBaseParam);
      expect(result.success).toBe(true);

      const baseParamKeys = [
        "paramName",
        "type",
        "label",
        "show",
        "value",
        "description",
        "style",
        "options",
        "multiSelect",
        "optionsEndpoint",
        "optionsParams",
        "groupById",
        "roles",
      ];

      expect(Object.keys(validBaseParam)).toEqual(
        expect.arrayContaining(baseParamKeys.slice(0, 4)),
      );
    });

    it("FormParamDefSchema: should have a consistent shape", () => {
      const validFormParam = {
        type: "form",
        paramName: "testFormParam",
        label: "Test Form Param",
        endpoint: "/api/test",
        method: "POST",
        inputParams: [
          {
            paramName: "innerParam",
            type: "text",
            label: "Inner Param",
          },
        ],
      };

      const result = ParamDefSchema.safeParse(validFormParam);
      expect(result.success).toBe(true);

      const formParamKeys = [
        "paramName",
        "label",
        "value",
        "description",
        "type",
        "show",
        "style",
        "options",
        "multiSelect",
        "optionsEndpoint",
        "optionsParams",
        "groupById",
        "roles",
        "endpoint",
        "method",
        "inputParams",
      ].sort();

      expect(Object.keys(validFormParam).sort()).toEqual(
        expect.arrayContaining([
          "type",
          "paramName",
          "label",
          "endpoint",
          "method",
          "inputParams",
        ]),
      );
    });

    it("should validate a basic ParamDefSchema (text type)", () => {
      const validParam = { paramName: "myText", label: "My Text Input", type: "text" };
      const result = ParamDefSchema.safeParse(validParam);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.show).toBe(true);
        expect(result.data.options).toEqual([]);
      }
    });

    it("should validate a FormParamDefSchema", () => {
      const validFormParam = {
        type: "form",
        label: "My Form",
        endpoint: "/submit",
        method: "POST",
        inputParams: [{ paramName: "field1", type: "text" }],
      };
      const result = ParamDefSchema.safeParse(validFormParam);
      expect(result.success).toBe(true);
    });

    it("should invalidate if paramName is missing for non-form type", () => {
      const invalidParam = { label: "My Text Input", type: "text" };
      const result = ParamDefSchema.safeParse(invalidParam);
      if (!result.success) {
        expect(
          result.error.issues.some((i) => i.message.includes("received undefined")),
        ).toBe(true);
      }
    });

    it("should invalidate if type is 'form' but other form fields are missing (e.g. endpoint)", () => {
      const formParamMinimal = { type: "form" };
      const result = ParamDefSchema.safeParse(formParamMinimal);
      expect(result.success).toBe(true);
    });

    it("should invalidate unsupported type", () => {
      const invalidParam = { paramName: "q", type: "invalidType" };
      const result = ParamDefSchema.safeParse(invalidParam);
      expect(result.success).toBe(false);

      if (!result.success) {
        expect(result.error.issues[0].code).toBe("invalid_union");
        expect(result.error.issues[0].message).toContain("Invalid discriminator value");
      }
    });
  });

  describe("ParamsSchema", () => {
    it("should validate an empty array", () => {
      expect(ParamsSchema.safeParse([]).success).toBe(true);
    });

    it("should validate an array of valid ParamDef objects", () => {
      const validParams = [
        { paramName: "p1", type: "text" },
        { paramName: "p2", type: "number", value: 100 },
      ];
      expect(ParamsSchema.safeParse(validParams).success).toBe(true);
    });

    it("should allow one param with role 'fileSelector'", () => {
      const params = [{ paramName: "file", type: "endpoint", roles: ["fileSelector"] }];
      expect(ParamsSchema.safeParse(params).success).toBe(true);
    });

    it("should invalidate with more than one 'fileSelector' role", () => {
      const invalidParams = [
        { paramName: "f1", type: "endpoint", roles: ["fileSelector"] },
        { paramName: "f2", type: "endpoint", roles: ["fileSelector"] },
      ];
      const result = ParamsSchema.safeParse(invalidParams);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe(
          "Only one parameter can have the role 'fileSelector'.",
        );
      }
    });
  });

  describe("widgetTypesSchema", () => {
    it("should validate known widget types", () => {
      for (const type of WidgetVizTypes) {
        expect(widgetTypesSchema.safeParse(type).data).toBe(type);
      }
    });

    it("should accept other well-formed types, which widget plugins may render", () => {
      for (const type of ["table", "chart", "note", "rich_note"])
        expect(widgetTypesSchema.safeParse(type).success).toBe(true);
    });

    it("should be nullish", () => {
      expect(widgetTypesSchema.safeParse(null).success).toBe(true);
      expect(widgetTypesSchema.safeParse(undefined).success).toBe(true);
    });

    it("should invalidate malformed types", () => {
      for (const type of ["invalidWidgetType", "a", "has space", "9lives", ""]) {
        const result = widgetTypesSchema.safeParse(type);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].message).toContain("Built-in types are");
        }
      }
    });
  });

  describe("InternalWidgetSchema", () => {
    it("should have a consistent shape", () => {
      const shapeKeys = Object.keys(InternalWidgetSchema.shape).sort();
      expect(shapeKeys).toMatchInlineSnapshot(`
        [
          "data",
          "dataUpdateDisplay",
          "description",
          "disableRetrievalForCopilot",
          "exportable",
          "external",
          "groupById",
          "groupId",
          "id",
          "innerTab",
          "name",
          "params",
          "plugin",
          "raw",
          "refetchInterval",
          "runButton",
          "showTitle",
          "staleTime",
          "storage",
          "type",
          "widgetId",
        ]
      `);
    });

    it("should validate a minimal valid internal widget", () => {
      const minimalWidget = { id: "widget1", widgetId: "internal1" };
      const result = InternalWidgetSchema.safeParse(minimalWidget);
      console.log(result.data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.staleTime).toBe(1000 * 60 * 5);
        expect(result.data.refetchInterval).toBe(1000 * 60 * 15);
        expect(result.data.data).toEqual({});
      }
    });

    it("should validate with specific data", () => {
      const widget = {
        id: "widget2",
        widgetId: "internal2",
        type: "html",
        data: {
          mainTicker: { id: "t1", symbol: "AAPL", category: "equity" },
        },
      };
      const result = InternalWidgetSchema.safeParse(widget);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe("html");
        expect(result.data.data?.mainTicker?.symbol).toBe("AAPL");
      }
    });

    it("should invalidate if required fields (id, widgetId) are missing", () => {
      const result = InternalWidgetSchema.safeParse({ name: "Test" });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some(
            (i) => i.path.includes("id") && i.message.includes("received undefined"),
          ),
        ).toBe(true);
        expect(
          result.error.issues.some(
            (i) =>
              i.path.includes("widgetId") && i.message.includes("received undefined"),
          ),
        ).toBe(true);
      }
    });
  });

  describe("ExternalWidgetSchema", () => {
    it("should have a consistent shape", () => {
      const underlyingSchema = ExternalWidgetSchema.def.in._zod.def;
      const shapeKeys = Object.keys(underlyingSchema.shape).sort();
      expect(shapeKeys).toMatchInlineSnapshot(`
        [
          "category",
          "connectionType",
          "data",
          "dataUpdateDisplay",
          "description",
          "disableRetrievalForCopilot",
          "endpoint",
          "exportable",
          "external",
          "groupById",
          "groupId",
          "id",
          "innerTab",
          "isSharedWidget",
          "name",
          "params",
          "raw",
          "refetchInterval",
          "runButton",
          "showTitle",
          "source",
          "sourceId",
          "sourceName",
          "staleTime",
          "storage",
          "subCategory",
          "type",
          "widgetId",
        ]
      `);
    });

    it("should validate a minimal valid external widget", () => {
      const minimalWidget = { id: "extWidget1", widgetId: "external1" };
      const result = ExternalWidgetSchema.safeParse(minimalWidget);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.staleTime).toBe(1000 * 60 * 5);
        expect(result.data.refetchInterval).toBe(1000 * 60 * 15);
        expect(result.data.data).toEqual({});
      }
    });

    it("transform logic: runButton=true, refetchInterval=undefined/false -> staleTime=Infinity, refetchInterval=false", () => {
      const widget1 = { id: "w", widgetId: "w", runButton: true };
      const result1 = ExternalWidgetSchema.safeParse(widget1);
      expect(result1.success).toBe(true);
      if (result1.success) {
        expect(result1.data.staleTime).toBe(Number.POSITIVE_INFINITY);
        expect(result1.data.refetchInterval).toBe(false);
      }

      const widget2 = {
        id: "w",
        widgetId: "w",
        runButton: true,
        refetchInterval: false,
      };
      const result2 = ExternalWidgetSchema.safeParse(widget2);
      expect(result2.success).toBe(true);
      if (result2.success) {
        expect(result2.data.staleTime).toBe(Number.POSITIVE_INFINITY);
        expect(result2.data.refetchInterval).toBe(false);
      }
    });

    it("transform logic: runButton=false (or undefined), refetchInterval=undefined -> refetchInterval=default", () => {
      const widget = { id: "w", widgetId: "w", runButton: false };
      const result = ExternalWidgetSchema.safeParse(widget);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.staleTime).toBe(1000 * 60 * 5);
        expect(result.data.refetchInterval).toBe(1000 * 60 * 15);
      }
    });

    it("should validate endpoint object structure", () => {
      const widget = {
        id: "w",
        widgetId: "w",
        endpoint: { url: "/api/data", method: "POST", headers: { "X-Token": "test" } },
      };
      const result = ExternalWidgetSchema.safeParse(widget);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.endpoint?.method).toBe("POST");
      }

      const invalidWidget = {
        id: "w",
        widgetId: "w",
        endpoint: { url: "/api/data", method: "PATCH" },
      };
      const resultInvalid = ExternalWidgetSchema.safeParse(invalidWidget);
      expect(resultInvalid.success).toBe(false);
    });
  });

  describe("isBuiltInVizType utility function", () => {
    it("should return true for valid WidgetVizTypes", () => {
      expect(isBuiltInVizType("html")).toBe(true);
      expect(isBuiltInVizType("markdown")).toBe(true);
      expect(isBuiltInVizType("pdf")).toBe(true);
    });

    it("should return false for other types", () => {
      expect(isBuiltInVizType("unknown_type")).toBe(false);
      expect(isBuiltInVizType("Note")).toBe(false);
      expect(isBuiltInVizType("")).toBe(false);
    });

    it("should correctly identify all known WidgetVizTypes", () => {
      WidgetVizTypes.forEach((type) => {
        expect(isBuiltInVizType(type)).toBe(true);
      });
    });
  });

  describe("_GridDataSchema", () => {
    it("should have a consistent shape", () => {
      const shapeKeys = Object.keys(_GridDataSchema.shape).sort();
      expect(shapeKeys).toMatchInlineSnapshot(`
        [
          "h",
          "isDraggable",
          "maxH",
          "maxW",
          "minH",
          "minW",
          "moved",
          "static",
          "w",
          "x",
          "y",
        ]
      `);
    });

    it("should validate a valid grid data object with all fields", () => {
      const validGridData = {
        x: 0,
        y: 0,
        w: 6,
        h: 4,
        minH: 2,
        minW: 2,
        maxH: 10,
        maxW: 12,
        moved: false,
        static: true,
        isDraggable: false,
      };
      const result = _GridDataSchema.safeParse(validGridData);
      expect(result.success).toBe(true);
    });

    it("should validate with only required fields", () => {
      const minimalGridData = { x: 1, y: 1, w: 2, h: 2 };
      const result = _GridDataSchema.safeParse(minimalGridData);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.minH).toBeUndefined();
        expect(result.data.static).toBeUndefined();
      }
    });

    it("should allow null for nullish fields", () => {
      const gridDataWithNulls = {
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        minH: null,
        static: null,
      };
      const result = _GridDataSchema.safeParse(gridDataWithNulls);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.minH).toBeNull();
        expect(result.data.static).toBeNull();
      }
    });

    it("should invalidate if a required field is missing", () => {
      const invalidGridData = { y: 0, w: 6, h: 4 };
      const result = _GridDataSchema.safeParse(invalidGridData);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some(
            (issue) =>
              issue.path.includes("x") && issue.message.includes("received undefined"),
          ),
        ).toBe(true);
      }
    });

    it("should invalidate if a field has an incorrect type", () => {
      const invalidGridData = { x: "0", y: 0, w: 6, h: 4 };
      const result = _GridDataSchema.safeParse(invalidGridData);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some(
            (issue) => issue.path.includes("x") && issue.code === "invalid_type",
          ),
        ).toBe(true);
      }
    });
  });

  describe("StorageSchema", () => {
    it("should have a consistent shape (empty by definition, but check behavior)", () => {
      const innerSchema = StorageSchema._def.innerType;
      const shapeKeys = Object.keys(innerSchema.shape).sort();
      expect(shapeKeys).toMatchInlineSnapshot("[]");
    });

    it("should validate an empty object", () => {
      const result = StorageSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({});
      }
    });

    it("should validate an object with arbitrary keys due to passthrough", () => {
      const data = { customKey: "value", another: 123 };
      const result = StorageSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(data);
      }
    });

    it("should apply default empty object if input is undefined", () => {
      const result = StorageSchema.safeParse(undefined);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({});
      }
    });
  });

  describe("WidgetSchemaBase", () => {
    it("should have a consistent shape", () => {
      const shapeKeys = Object.keys(WidgetSchemaBase.shape).sort();
      expect(shapeKeys).toMatchInlineSnapshot(`
        [
          "dataUpdateDisplay",
          "description",
          "disableRetrievalForCopilot",
          "exportable",
          "external",
          "groupById",
          "groupId",
          "id",
          "innerTab",
          "name",
          "params",
          "raw",
          "refetchInterval",
          "runButton",
          "showTitle",
          "staleTime",
          "storage",
          "type",
          "widgetId",
        ]
      `);
    });

    it("should validate a minimal valid widget base object", () => {
      const minimalWidget = { id: "widget1", widgetId: "base1" };
      const result = WidgetSchemaBase.safeParse(minimalWidget);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.staleTime).toBe(1000 * 60 * 5);
        expect(result.data.params).toEqual([]);
        expect(result.data.refetchInterval).toBeUndefined();
      }
    });

    it("should validate with all fields populated", () => {
      const fullWidget = {
        id: "fullId",
        widgetId: "fullWidgetId",
        type: "html" as const,
        name: "My Widget",
        showTitle: false,
        description: "A detailed description.",
        groupId: "groupA",
        groupById: "item1",
        innerTab: "details",
        disableRetrievalForCopilot: true,
        storage: { myKey: "myValue" },
        external: false,
        params: [{ paramName: "p1", type: "text" as const }],
        staleTime: 10000,
        refetchInterval: 5000,
        runButton: true,
      };
      const result = WidgetSchemaBase.safeParse(fullWidget);
      expect(result.success).toBe(true);
      if (!result.success) console.log(result.error.issues);
      expect(result.data?.storage).toEqual({ myKey: "myValue" });
    });

    it("should invalidate if required fields (id, widgetId) are missing", () => {
      const invalidWidget = { name: "Test Widget" };
      const result = WidgetSchemaBase.safeParse(invalidWidget);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some(
            (i) => i.path.includes("id") && i.message.includes("received undefined"),
          ),
        ).toBe(true);
        expect(
          result.error.issues.some(
            (i) =>
              i.path.includes("widgetId") && i.message.includes("received undefined"),
          ),
        ).toBe(true);
      }
    });

    it("should validate staleTime minimum", () => {
      const invalidStaleTime = { id: "w", widgetId: "w", staleTime: 500 };
      const result = WidgetSchemaBase.safeParse(invalidStaleTime);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some(
            (i) =>
              i.path.includes("staleTime") &&
              i.message.includes("expected number to be >=1000"),
          ),
        ).toBe(true);
      }
    });

    it("should validate refetchInterval minimum if number", () => {
      const invalidRefetch = { id: "w", widgetId: "w", refetchInterval: 500 };
      const result = WidgetSchemaBase.safeParse(invalidRefetch);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((i) => {
            return (
              i.path.includes("refetchInterval") &&
              i.message.includes("expected number to be >=1000")
            );
          }),
        ).toBe(true);
      }

      const validRefetchBoolean = { id: "w", widgetId: "w", refetchInterval: false };
      expect(WidgetSchemaBase.safeParse(validRefetchBoolean).success).toBe(true);

      const validRefetchCron = {
        id: "w",
        widgetId: "w",
        refetchInterval: "*/15 * * * *",
        dataUpdateDisplay: "0 8 * * 1-5",
      };
      expect(WidgetSchemaBase.safeParse(validRefetchCron).success).toBe(true);
    });

    it("should allow showTitle to be null", () => {
      const widget = { id: "w", widgetId: "w", showTitle: null };
      const result = WidgetSchemaBase.safeParse(widget);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.showTitle).toBeNull();
      }
    });
  });
});
