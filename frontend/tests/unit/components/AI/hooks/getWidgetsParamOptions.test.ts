import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getWidgetsParamOptions } from "~/components/AI/hooks/useFunctionCall";
import type { WidgetT } from "~/components/types";
import { type Source, useBackendConnectorStore } from "~/lib/state/backendConnector";
import { malformed, partial } from "../../../mocks";

const createMockWidget = (overrides: Partial<WidgetT> = {}): WidgetT =>
  ({
    id: "test-widget-id",
    name: "Test Widget",
    description: "Test description",
    endpoint: "https://api.example.com/data",
    params: [],
    ...overrides,
  }) as WidgetT;

describe("getWidgetsParamOptions", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          json: () => Promise.resolve(["option1", "option2"]),
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("widget lookup", () => {
    it("should throw CopilotError when widget is not found", async () => {
      const getWidgetFromBackend = vi.fn().mockReturnValue(null);

      await expect(
        getWidgetsParamOptions(
          {
            origin: "TestOrigin",
            id: "non-existent-widget",
            param: "region",
            options_endpoint_input_args: {},
          },
          getWidgetFromBackend,
        ),
      ).rejects.toThrow("Widget with id non-existent-widget not found");

      expect(getWidgetFromBackend).toHaveBeenCalledWith(
        "TestOrigin",
        "non-existent-widget",
      );
    });
  });

  describe("param validation", () => {
    it("should throw error when param is not found in widget", async () => {
      const widget = createMockWidget({
        params: [
          {
            paramName: "otherParam",
            type: "text",
          },
        ],
      });
      const getWidgetFromBackend = vi.fn().mockReturnValue(widget);

      await expect(
        getWidgetsParamOptions(
          {
            origin: "TestOrigin",
            id: "test-widget",
            param: "region",
            options_endpoint_input_args: {},
          },
          getWidgetFromBackend,
        ),
      ).rejects.toThrow("Param region not found");
    });

    it("should throw error when param exists but is not of type endpoint", async () => {
      const widget = createMockWidget({
        params: [
          {
            paramName: "region",
            type: "text",
          },
        ],
      });
      const getWidgetFromBackend = vi.fn().mockReturnValue(widget);

      await expect(
        getWidgetsParamOptions(
          {
            origin: "TestOrigin",
            id: "test-widget",
            param: "region",
            options_endpoint_input_args: {},
          },
          getWidgetFromBackend,
        ),
      ).rejects.toThrow("Param region not found");
    });

    it("should throw error when endpoint param has no optionsEndpoint", async () => {
      const widget = createMockWidget({
        params: [
          {
            paramName: "region",
            type: "endpoint",
            optionsEndpoint: undefined,
          },
        ],
      });
      const getWidgetFromBackend = vi.fn().mockReturnValue(widget);

      await expect(
        getWidgetsParamOptions(
          {
            origin: "TestOrigin",
            id: "test-widget",
            param: "region",
            options_endpoint_input_args: {},
          },
          getWidgetFromBackend,
        ),
      ).rejects.toThrow("Endpoint not found for param region");
    });
  });

  describe("optionsParams variable substitution", () => {
    it("should substitute $ prefixed values with input args", async () => {
      const widget = createMockWidget({
        params: [
          {
            paramName: "portfolio",
            type: "endpoint",
            optionsEndpoint: "https://api.example.com/portfolios",
            optionsParams: {
              region: "$selectedRegion",
            },
          },
        ],
      });
      const getWidgetFromBackend = vi.fn().mockReturnValue(widget);

      await getWidgetsParamOptions(
        {
          origin: "TestOrigin",
          id: "test-widget",
          param: "portfolio",
          options_endpoint_input_args: {
            selectedRegion: "america",
          },
        },
        getWidgetFromBackend,
      );

      expect(fetch).toHaveBeenCalledWith(
        "https://api.example.com/portfolios?region=america",
        expect.anything(),
      );
    });

    it("should preserve static string values without $ prefix", async () => {
      const widget = createMockWidget({
        params: [
          {
            paramName: "portfolio",
            type: "endpoint",
            optionsEndpoint: "https://api.example.com/portfolios",
            optionsParams: {
              staticParam: "staticValue",
            },
          },
        ],
      });
      const getWidgetFromBackend = vi.fn().mockReturnValue(widget);

      await getWidgetsParamOptions(
        {
          origin: "TestOrigin",
          id: "test-widget",
          param: "portfolio",
          options_endpoint_input_args: {},
        },
        getWidgetFromBackend,
      );

      expect(fetch).toHaveBeenCalledWith(
        "https://api.example.com/portfolios?staticParam=staticValue",
        expect.anything(),
      );
    });

    it("should handle number values in optionsParams without throwing TypeError", async () => {
      const widget = createMockWidget({
        params: [
          {
            paramName: "portfolio",
            type: "endpoint",
            optionsEndpoint: "https://api.example.com/portfolios",
            optionsParams: malformed({
              limit: 10,
              region: "$selectedRegion",
            }),
          },
        ],
      });
      const getWidgetFromBackend = vi.fn().mockReturnValue(widget);

      await getWidgetsParamOptions(
        {
          origin: "TestOrigin",
          id: "test-widget",
          param: "portfolio",
          options_endpoint_input_args: {
            selectedRegion: "europe",
          },
        },
        getWidgetFromBackend,
      );

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("limit=10"),
        expect.anything(),
      );
    });

    it("should handle boolean values in optionsParams without throwing TypeError", async () => {
      const widget = createMockWidget({
        params: [
          {
            paramName: "portfolio",
            type: "endpoint",
            optionsEndpoint: "https://api.example.com/portfolios",
            optionsParams: malformed({
              active: true,
              includeDeleted: false,
            }),
          },
        ],
      });
      const getWidgetFromBackend = vi.fn().mockReturnValue(widget);

      await expect(
        getWidgetsParamOptions(
          {
            origin: "TestOrigin",
            id: "test-widget",
            param: "portfolio",
            options_endpoint_input_args: {},
          },
          getWidgetFromBackend,
        ),
      ).resolves.not.toThrow();
    });

    it("should handle mixed types in optionsParams", async () => {
      const widget = createMockWidget({
        params: [
          {
            paramName: "portfolio",
            type: "endpoint",
            optionsEndpoint: "https://api.example.com/portfolios",
            optionsParams: malformed({
              stringVar: "$myString",
              staticString: "hello",
              numberValue: 42,
              booleanValue: true,
            }),
          },
        ],
      });
      const getWidgetFromBackend = vi.fn().mockReturnValue(widget);

      await expect(
        getWidgetsParamOptions(
          {
            origin: "TestOrigin",
            id: "test-widget",
            param: "portfolio",
            options_endpoint_input_args: {
              myString: "resolved",
            },
          },
          getWidgetFromBackend,
        ),
      ).resolves.not.toThrow();
    });
  });

  describe("response handling", () => {
    it("should convert string options to label/value objects", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(() =>
          Promise.resolve({
            json: () => Promise.resolve(["option1", "option2", "option3"]),
          }),
        ),
      );

      const widget = createMockWidget({
        params: [
          {
            paramName: "region",
            type: "endpoint",
            optionsEndpoint: "https://api.example.com/regions",
            optionsParams: {},
          },
        ],
      });
      const getWidgetFromBackend = vi.fn().mockReturnValue(widget);

      const result = await getWidgetsParamOptions(
        {
          origin: "TestOrigin",
          id: "test-widget",
          param: "region",
          options_endpoint_input_args: {},
        },
        getWidgetFromBackend,
      );

      expect(result.param_options[0].options).toEqual([
        { label: "option1", value: "option1" },
        { label: "option2", value: "option2" },
        { label: "option3", value: "option3" },
      ]);
    });

    it("should preserve object options with label/value structure", async () => {
      const objectOptions = [
        { label: "America", value: "america" },
        { label: "Europe", value: "europe" },
      ];
      vi.stubGlobal(
        "fetch",
        vi.fn(() =>
          Promise.resolve({
            json: () => Promise.resolve(objectOptions),
          }),
        ),
      );

      const widget = createMockWidget({
        params: [
          {
            paramName: "region",
            type: "endpoint",
            optionsEndpoint: "https://api.example.com/regions",
            optionsParams: {},
          },
        ],
      });
      const getWidgetFromBackend = vi.fn().mockReturnValue(widget);

      const result = await getWidgetsParamOptions(
        {
          origin: "TestOrigin",
          id: "test-widget",
          param: "region",
          options_endpoint_input_args: {},
        },
        getWidgetFromBackend,
      );

      expect(result.param_options[0].options).toEqual(objectOptions);
    });

    it("should return correct param name in result", async () => {
      const widget = createMockWidget({
        params: [
          {
            paramName: "customParam",
            type: "endpoint",
            optionsEndpoint: "https://api.example.com/options",
            optionsParams: {},
          },
        ],
      });
      const getWidgetFromBackend = vi.fn().mockReturnValue(widget);

      const result = await getWidgetsParamOptions(
        {
          origin: "TestOrigin",
          id: "test-widget",
          param: "customParam",
          options_endpoint_input_args: {},
        },
        getWidgetFromBackend,
      );

      expect(result.param_options[0].param).toBe("customParam");
    });
  });

  describe("the data backend", () => {
    beforeEach(() => {
      useBackendConnectorStore.setState({
        apiSources: [
          partial<Source>({
            id: "src-1",
            url: "https://api.example.com",
            endpointHeaders: [
              { key: "Authorization", value: "" },
              { key: "X-Custom-Header", value: "", location: "headers" },
              { key: "apikey", value: "", location: "query" },
            ],
          }),
        ],
      });
    });

    afterEach(() => {
      useBackendConnectorStore.setState({ apiSources: [] });
    });

    const askForOptions = (optionsEndpoint: string) =>
      getWidgetsParamOptions(
        {
          origin: "TestOrigin",
          id: "test-widget",
          param: "region",
          options_endpoint_input_args: {},
        },
        vi.fn().mockReturnValue(
          createMockWidget({
            sourceId: "src-1",
            params: [
              {
                paramName: "region",
                type: "endpoint",
                optionsEndpoint,
                optionsParams: {},
              },
            ],
          }),
        ),
      );

    it("is asked through the API by its id, with no credentials in the request", async () => {
      await askForOptions("https://api.example.com/regions");

      const [route, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
      expect(route).toMatch(/\/app\/data-connectors\/api-source\/src-1\/request$/);
      expect(JSON.parse(String(init.body))).toMatchObject({
        url: "https://api.example.com/regions",
        method: "GET",
      });
      expect(String(init.body)).not.toContain("apikey");
      expect(new Headers(init.headers).has("Authorization")).toBe(false);
    });

    it("is not asked through the API for an options endpoint on another origin", async () => {
      await askForOptions("https://elsewhere.test/regions");

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://elsewhere.test/regions");
      expect(new Headers(init.headers).has("Authorization")).toBe(false);
    });
  });
});
