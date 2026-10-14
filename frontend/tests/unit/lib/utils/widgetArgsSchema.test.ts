import { afterEach, describe, expect, it } from "vitest";
import type { ParamDef, WidgetT } from "~/components/types";
import {
  argsProblems,
  dataArgsSchema,
  paramPlace,
  uiArgsSchema,
} from "~/lib/utils/widgetArgsSchema";
import { usePluginRegistryStore } from "~/plugins/registry";
import type { AvailablePlugin } from "~/plugins/types";

const params = [
  { paramName: "team", type: "endpoint", optionsEndpoint: "https://b.example/teams" },
  { paramName: "period", type: "text", options: [{ label: "Month", value: "month" }] },
  { paramName: "X-Region", type: "text", in: "header" },
  { paramName: "limit", type: "number", in: "body", description: "Rows at most" },
  { paramName: "tags", type: "text", multiple: true },
  { type: "form", endpoint: "https://b.example/submit", inputParams: [] },
] as unknown as ParamDef[];

describe("where a param goes (WIDGETS-JSON 3.8)", () => {
  it("is the path for a placeholder, else its `in`, else the query", () => {
    const url = "https://b.example/teams/{team}/report";
    expect(params.map((p) => paramPlace(p, url))).toEqual([
      "path",
      "query",
      "header",
      "body",
      "query",
      null,
    ]);
  });
});

describe("the data_args schema", () => {
  const schema = dataArgsSchema({ params });
  const problems = (value: unknown) => argsProblems(schema, value, "data_args");

  it("has one property per declared param and nothing else", () => {
    expect(Object.keys(schema.properties as object)).toEqual([
      "team",
      "period",
      "X-Region",
      "limit",
      "tags",
    ]);
    expect(schema.additionalProperties).toBe(false);
    expect(problems({ other: 1 })).toEqual([
      "`data_args.other` is not a key this widget accepts",
    ]);
  });

  it("takes enums from static options and types from the param", () => {
    expect(problems({ period: "month", limit: 5, tags: ["a", "b"] })).toEqual([]);
    expect(problems({ period: "year" })).toEqual([
      '`data_args.period` must be one of "month"',
    ]);
    expect(problems({ limit: "x" })).toEqual(["`data_args.limit` must be a number"]);
  });

  it("carries the param's description", () => {
    expect(
      (schema.properties as Record<string, { description?: string }>).limit,
    ).toEqual(expect.objectContaining({ description: "Rows at most" }));
  });
});

describe("the ui_args schema", () => {
  afterEach(() => usePluginRegistryStore.setState({ plugins: [], vizHandlers: {} }));

  const keys = (widget: Partial<WidgetT>) =>
    Object.keys(uiArgsSchema(widget as WidgetT).properties as object);

  it("adds the keys the widget's component reads", () => {
    const common = ["name", "description", "source", "innerTab", "gridData"];
    expect(keys({ type: "newsfeed" })).toEqual(common);
    expect(keys({ type: "markdown" })).toEqual([...common, "text"]);
    expect(keys({ type: "html" })).toEqual([...common, "html"]);
    // A note is rendered by its id, whatever its type says
    expect(keys({ type: "custom" as WidgetT["type"], widgetId: "markdown" })).toEqual([
      ...common,
      "text",
    ]);
  });

  it("gives a plugin widget its plugin's settings as `config`, closed", () => {
    usePluginRegistryStore.setState({
      plugins: [
        {
          id: "acme-charts",
          widgets: [
            {
              id: "chart",
              settings: {
                schema: {
                  properties: {
                    palette: {
                      type: "string",
                      enum: ["warm", "cool"],
                      title: "Palette",
                    },
                    smooth: { type: "boolean" },
                  },
                },
                defaults: {},
              },
            },
          ],
        } as unknown as AvailablePlugin,
      ],
      vizHandlers: { chart: { plugin: "acme-charts", widget: "chart" } },
    });
    const schema = uiArgsSchema({ type: "chart" } as unknown as WidgetT);
    expect(
      argsProblems(schema, { config: { palette: "warm", smooth: true } }, "ui_args"),
    ).toEqual([]);
    expect(
      argsProblems(schema, { config: { palette: "neon", glow: 1 } }, "ui_args"),
    ).toEqual([
      "`ui_args.config.glow` is not a key this widget accepts",
      '`ui_args.config.palette` must be one of "warm", "cool"',
    ]);
  });
});
