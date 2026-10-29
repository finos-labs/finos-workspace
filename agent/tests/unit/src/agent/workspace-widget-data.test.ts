import { describe, it } from "node:test";
import { expect } from "expect";
import { asWidgetDataMessage, isWidgetDataMcpResult, isWidgetDataToolName } from "../../../../src/agent/workspace-widget-data.ts";
import type { ToolMessage, Widget } from "../../../../src/protocol/types.ts";

const widget = (overrides: Partial<Widget> = {}): Widget =>
  ({ uuid: "w-1", origin: "ODP", widget_id: "asset_info", name: "Asset Info", description: "", params: [], ...overrides }) as Widget;

const ROWS = [{ symbol: "AAPL", price: 336.64 }];

function mcpMessage(result: unknown, parameters: Record<string, unknown> = { origin: "ODP", widget_id: "asset_info", widget_uuid: "w-1" }): ToolMessage {
  return {
    role: "tool",
    function: "execute_agent_tool",
    input_arguments: { server_id: "workspace", tool_name: "Workspace_get_widget_data", parameters },
    data: [{ items: [{ content: JSON.stringify([JSON.stringify(result)], null, 2) }], extra_citations: [] }],
  } as unknown as ToolMessage;
}

const OK = { ok: true, message: "Widget data fetched.", data: [{ items: [{ content: ROWS }] }] };

describe("isWidgetDataToolName", () => {
  it("knows the tool by its name on the server, with or without the server's name in front", () => {
    expect(isWidgetDataToolName("get_widget_data")).toBe(true);
    expect(isWidgetDataToolName("Workspace_get_widget_data")).toBe(true);
    expect(isWidgetDataToolName("Open Data Platform_get_widget_data")).toBe(true);
    expect(isWidgetDataToolName("get_widget_data_extra")).toBe(false);
    expect(isWidgetDataToolName("xget_widget_data")).toBe(false);
    expect(isWidgetDataToolName(undefined)).toBe(false);
  });
});

describe("asWidgetDataMessage", () => {
  it("reads the result of the FINOS Workspace's tool as the tool message of a widget-data round trip", () => {
    const message = asWidgetDataMessage(mcpMessage(OK), [widget()]);
    expect(message).toMatchObject({
      role: "tool",
      function: "get_widget_data",
      input_arguments: { data_sources: [{ widget_uuid: "w-1", origin: "ODP", id: "asset_info", input_args: {} }] },
    });
    expect(message?.data).toEqual([{ items: [{ content: JSON.stringify(ROWS) }] }]);
  });

  it("carries the arguments the model chose for the widget", () => {
    const message = asWidgetDataMessage(
      mcpMessage(OK, { origin: "ODP", widget_id: "asset_info", widget_uuid: "w-1", data_args: { symbol: "MSFT" } }),
      [widget()],
    );
    expect((message?.input_arguments as { data_sources: Array<{ input_args: unknown }> }).data_sources[0].input_args).toEqual({ symbol: "MSFT" });
  });

  it("finds the widget by its origin and id when the model did not give the uuid", () => {
    const message = asWidgetDataMessage(mcpMessage(OK, { origin: "ODP", widget_id: "asset_info" }), [widget({ uuid: "w-9" })]);
    expect((message?.input_arguments as { data_sources: Array<{ widget_uuid: string }> }).data_sources[0].widget_uuid).toBe("w-9");
  });

  it("finds a file attached to the chat when the model names it by the stored file's uuid alone", () => {
    const stored = "98569980-e380-46d4-b3c6-c23db2e75180";
    const attachment = widget({ uuid: `file-${stored}`, origin: "the backend", widget_id: `file-${stored}`, name: "notes.txt" });
    const message = asWidgetDataMessage(mcpMessage(OK, { origin: "the backend", widget_id: "file", widget_uuid: stored }), [widget(), attachment]);
    expect((message?.input_arguments as { data_sources: Array<{ widget_uuid: string }> }).data_sources[0].widget_uuid).toBe(`file-${stored}`);
  });

  it("finds the widget by its origin and id when the uuid the model gave names no widget", () => {
    const message = asWidgetDataMessage(mcpMessage(OK, { origin: "ODP", widget_id: "asset_info", widget_uuid: "made-up" }), [widget({ uuid: "w-9" })]);
    expect((message?.input_arguments as { data_sources: Array<{ widget_uuid: string }> }).data_sources[0].widget_uuid).toBe("w-9");
  });

  it("leaves text content, and content that is already text, as it is", () => {
    const result = { ok: true, data: [{ items: [{ content: "plain text" }, { content: JSON.stringify(ROWS) }, { url: "https://f", data_format: { data_type: "pdf" } }] }] };
    const message = asWidgetDataMessage(mcpMessage(result), [widget()]);
    expect(message?.data).toEqual([{ items: [{ content: "plain text" }, { content: JSON.stringify(ROWS) }, { url: "https://f", data_format: { data_type: "pdf" } }] }]);
  });

  it("reads a result that came as the object itself, and one whose text items are not wrapped in a list", () => {
    const asObject = { ...mcpMessage(OK), data: [{ items: [{ content: JSON.stringify(OK) }] }] } as unknown as ToolMessage;
    expect(asWidgetDataMessage(asObject, [widget()])?.function).toBe("get_widget_data");
    const asList = { ...mcpMessage(OK), data: [{ items: [{ content: [JSON.stringify(OK)] }] }] } as unknown as ToolMessage;
    expect(asWidgetDataMessage(asList, [widget()])?.function).toBe("get_widget_data");
  });

  it("does not take a failure, or an answer that has no data, for data: the model reads those as they are", () => {
    expect(asWidgetDataMessage(mcpMessage({ ok: false, message: "No browser is connected." }), [widget()])).toBeNull();
    expect(asWidgetDataMessage(mcpMessage({ ok: true, message: "done" }), [widget()])).toBeNull();
    expect(asWidgetDataMessage(mcpMessage({ ok: true, data: "rows" }), [widget()])).toBeNull();
    const noResult = { ...mcpMessage(OK), data: [{ items: [{ content: "not json" }] }] } as unknown as ToolMessage;
    expect(asWidgetDataMessage(noResult, [widget()])).toBeNull();
    expect(asWidgetDataMessage({ ...mcpMessage(OK), data: [] } as unknown as ToolMessage, [widget()])).toBeNull();
  });

  it("is only for the FINOS Workspace's widget-data tool", () => {
    const other = { ...mcpMessage(OK), input_arguments: { server_id: "x", tool_name: "x_web_search", parameters: {} } } as unknown as ToolMessage;
    expect(isWidgetDataMcpResult(other)).toBe(false);
    expect(asWidgetDataMessage(other, [widget()])).toBeNull();
    const native = { role: "tool", function: "get_widget_data", input_arguments: { data_sources: [] }, data: [] } as unknown as ToolMessage;
    expect(isWidgetDataMcpResult(native)).toBe(false);
    expect(asWidgetDataMessage(native, [widget()])).toBeNull();
  });
});
