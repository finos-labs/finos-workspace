import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ParamDef, WidgetT } from "~/components/types";
import { dataArgsSchema, uiArgsSchema } from "~/lib/utils/widgetArgsSchema";
import { usePluginRegistryStore } from "~/plugins/registry";
import type { AvailablePlugin } from "~/plugins/types";

const OUT = process.env.REFERENCE_OUT ?? "";

const NAME = "param_name";

const dataCases: { label: string; param: Record<string, unknown> }[] = [
  { label: "text", param: { type: "text" } },
  { label: "number", param: { type: "number" } },
  { label: "date", param: { type: "date" } },
  { label: "boolean", param: { type: "boolean" } },
  { label: "endpoint", param: { type: "endpoint" } },
  { label: "button", param: { type: "button" } },
  {
    label: "text with options",
    param: { type: "text", options: [{ label: "Label", value: "value" }] },
  },
  {
    label: "tabs",
    param: { type: "tabs", options: [{ label: "Label", value: "value" }] },
  },
  {
    label: "options with numbers",
    param: { type: "text", options: [{ label: "Label", value: 1 }] },
  },
  { label: "multiSelect or multiple", param: { type: "text", multiple: true } },
  {
    label: "with a description",
    param: { type: "text", description: "<description>" },
  },
  { label: "with a label only", param: { type: "text", label: "<label>" } },
  { label: "form", param: { type: "form", inputParams: [] } },
];

const withName = (param: Record<string, unknown>) =>
  ({ paramName: NAME, ...param }) as unknown as ParamDef;

const plugin = {
  id: "plugin",
  widgets: [
    {
      id: "widget",
      settings: {
        schema: {
          description: "<description of the settings>",
          properties: {
            setting: {
              type: "string",
              enum: ["value"],
              title: "<title>",
              description: "<description>",
              minimum: 1,
              maximum: 2,
              maxLength: 3,
              pattern: "^.*$",
              default: "value",
            },
          },
        },
        defaults: {},
      },
    },
  ],
} as unknown as AvailablePlugin;

const uiCases: { label: string; widget: Partial<WidgetT> }[] = [
  { label: "markdown", widget: { type: "markdown" } },
  { label: "html", widget: { type: "html" } },
  { label: "newsfeed", widget: { type: "newsfeed" } },
  { label: "pdf", widget: { type: "pdf" } },
  { label: "iframe", widget: { type: "iframe" } },
  { label: "plugin types", widget: { type: "chart" as WidgetT["type"] } },
];

describe("the schemas that get_widget_schema returns", () => {
  afterEach(() => usePluginRegistryStore.setState({ plugins: [], vizHandlers: {} }));

  it("has a schema for each kind of param and each kind of widget", () => {
    usePluginRegistryStore.setState({
      plugins: [plugin],
      vizHandlers: { chart: { plugin: "plugin", widget: "widget" } },
    });
    const data = dataCases.map(({ label, param }) => ({
      label,
      schema: dataArgsSchema({ params: [withName(param)] }),
    }));
    const ui = uiCases.map(({ label, widget }) => ({
      label,
      schema: uiArgsSchema(widget as WidgetT),
    }));
    expect(data.every(({ schema }) => schema.description !== undefined)).toBe(true);
    expect(ui.every(({ schema }) => schema.description !== undefined)).toBe(true);
    if (OUT === "") return;
    mkdirSync(resolve(OUT), { recursive: true });
    writeFileSync(
      resolve(OUT, "widget-args-reference.json"),
      `${JSON.stringify({ paramName: NAME, data, ui }, null, 2)}\n`,
    );
  });
});
