import { describe, expect, it } from "vitest";
import {
  type ComposedWidgetsSchema,
  pluginConfigProblems,
  validateWidgetDefinition,
} from "~/lib/utils/widgetsSchemaValidation";
import composed from "../../../mocks/widgets-schema.json";

const schema = composed as unknown as ComposedWidgetsSchema;
const ok = { name: "N", description: "D", endpoint: "/n", type: "markdown" };

const problems = (widget: Record<string, unknown>) =>
  validateWidgetDefinition(schema, widget);

describe("validating a widget against the composed schema", () => {
  it("accepts a definition that keeps to the contract", () => {
    expect(problems(ok)).toEqual([]);
    expect(
      problems({
        ...ok,
        type: "test_chart",
        method: "POST",
        data: { dataKey: "rows", test_chart: { title: "T", series: [{ field: "a" }] } },
        params: [
          { paramName: "region", type: "text", value: "eu" },
          { paramName: "X-Team", type: "text", in: "header", value: "core" },
          [
            { paramName: "from", type: "date", value: "$currentDate-1M", in: "body" },
            { paramName: "limit", type: "number", value: 10, in: "body" },
          ],
        ],
      }),
    ).toEqual([]);
  });

  it("names the type it does not know, and the types it does", () => {
    expect(problems({ ...ok, type: "table" })).toEqual([
      {
        pointer: "/type",
        message:
          "`table` is not a widget type here, which has `markdown`, `html`, `newsfeed`, `pdf`, `iframe`, `test_chart`",
      },
    ]);
    expect(problems({ name: "N", description: "D", endpoint: "/n" })).toEqual([
      { pointer: "", message: "missing `type`" },
    ]);
  });

  it("reports each problem once, at its pointer", () => {
    expect(problems({ ...ok, defaultViz: "x" })).toEqual([
      { pointer: "", message: "unknown key `defaultViz`" },
    ]);
    expect(
      problems({ ...ok, params: [{ paramName: "p", type: "text", color: 1 }] }),
    ).toEqual([{ pointer: "/params/0", message: "unknown key `color`" }]);
    expect(
      problems({ ...ok, params: [[{ paramName: "p", type: "number", value: "abc" }]] }),
    ).toEqual([
      {
        pointer: "/params/0/0/value",
        message: "must be a number or a string matching `^-?\\d*\\.?\\d*$` or null",
      },
    ]);
    expect(
      problems({
        ...ok,
        type: "test_chart",
        data: { test_chart: { series: [{ kind: "pie" }] } },
      }),
    ).toEqual([
      { pointer: "/data/test_chart/series/0", message: "missing `field`" },
      {
        pointer: "/data/test_chart/series/0/kind",
        message: "must be one of `line`, `bar`",
      },
    ]);
  });

  it("checks a param against the branch of its own type", () => {
    expect(problems({ ...ok, params: [{ paramName: "p", type: "colour" }] })).toEqual([
      {
        pointer: "/params/0",
        message:
          "`type` must be one of `text`, `tabs`, `ticker`, `date`, `number`, `boolean`, `button`, `endpoint`, `form`",
      },
    ]);
    expect(
      problems({
        ...ok,
        params: [
          {
            type: "form",
            endpoint: "/f",
            inputParams: [{ paramName: "a", type: "ticker" }],
          },
        ],
      }),
    ).toEqual([
      {
        pointer: "/params/0/inputParams/0",
        message:
          "`type` must be one of `text`, `date`, `number`, `boolean`, `button`, `endpoint`",
      },
    ]);
  });

  it("explains the request rules it enforces", () => {
    expect(
      problems({ ...ok, params: [{ paramName: "p", type: "text", in: "body" }] }),
    ).toEqual([
      { pointer: "", message: 'Body params are sent only with "method": "POST"' },
    ]);
    const [header] = problems({
      ...ok,
      params: [{ paramName: "Cookie", type: "text", in: "header" }],
    });
    expect(header.pointer).toBe("/params/0");
    expect(header.message).toMatch(/^A header param's paramName is the header name/);
    expect(problems({ ...ok, params: [{ paramName: "theme", type: "text" }] })).toEqual(
      [
        {
          pointer: "",
          message:
            "theme: query params the FINOS Workspace adds to this type's requests",
        },
      ],
    );
    expect(problems({ ...ok, endpoint: "/a?b" })).toEqual([
      {
        pointer: "/endpoint",
        message:
          "must be a path or an absolute URL with no `?` and no `#` (a static query value is a param with show: false)",
      },
    ]);
    expect(problems({ ...ok, type: "iframe", method: "POST" })).toEqual([
      { pointer: "/method", message: "must be one of `GET`" },
    ]);
  });
});

describe("a template's plugin configuration (WIDGETS-JSON 3.10)", () => {
  it("follows the settings of the plugin that renders the type", () => {
    expect(
      pluginConfigProblems(schema, "test_chart", { palette: "cool", smooth: true }),
    ).toEqual([]);
    expect(pluginConfigProblems(schema, "test_chart", { points: 1 })).toEqual([
      { pointer: "/points", message: "must be >= 2" },
    ]);
  });

  it("is refused for a type no plugin renders", () => {
    expect(pluginConfigProblems(schema, "markdown", {})).toEqual([
      {
        pointer: "",
        message:
          "no plugin renders `markdown` here, so it takes no plugin configuration",
      },
    ]);
  });
});
