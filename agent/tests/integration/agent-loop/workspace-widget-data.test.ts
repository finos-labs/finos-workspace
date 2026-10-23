import { describe, it, beforeEach } from "node:test";
import { expect } from "expect";
import { runAgentLoop } from "../../../src/agent/loop.ts";
import { buildMessages } from "../../../src/agent/messages.ts";
import type { AgentTool, QueryRequest, SSEEvent, ToolMessage, Widget } from "../../../src/protocol/types.ts";
import { llmCallsTool, llmEmitsText, makeMockLlm, makeSpyMockLlm } from "../../helpers/mock-llm.ts";
import { collectGenerator } from "../../helpers/sse-reader.ts";
import { clearAllModuleState } from "../../helpers/clear-state.ts";

beforeEach(() => clearAllModuleState());

const WORKSPACE_TOOL: AgentTool = {
  name: "Workspace_get_widget_data",
  server_id: "workspace",
  url: "http://api:8000/mcp",
  description: "Fetch current data for one Workspace data source.",
  input_schema: {
    properties: {
      origin: { type: "string" },
      widget_id: { type: "string" },
      data_args: { type: "object" },
      widget_uuid: { type: "string" },
    },
    required: ["origin", "widget_id"],
  },
};

const widget = (): Widget =>
  ({ uuid: "w-1", origin: "ODP", widget_id: "asset_info", name: "Asset Info", description: "", params: [] }) as Widget;

const ROWS = [
  { symbol: "AAPL", price: 336.64 },
  { symbol: "MSFT", price: 521.1 },
];

function result(content: unknown): ToolMessage {
  return {
    role: "tool",
    function: "execute_agent_tool",
    input_arguments: {
      server_id: "workspace",
      tool_name: "Workspace_get_widget_data",
      parameters: { origin: "ODP", widget_id: "asset_info", widget_uuid: "w-1" },
    },
    data: [{ items: [{ content: JSON.stringify([JSON.stringify(content)], null, 2) }], extra_citations: [] }],
  } as unknown as ToolMessage;
}

function ask(opts: { messages: QueryRequest["messages"]; tools?: AgentTool[]; model: ReturnType<typeof makeMockLlm>; chat: string }): Promise<SSEEvent[]> {
  return collectGenerator(
    runAgentLoop({
      request: { messages: opts.messages, ...(opts.tools ? { tools: opts.tools } : {}) } as unknown as QueryRequest,
      rawModelId: "openai:gpt-4o-mini",
      model: opts.model,
      allWidgets: [widget()],
      workspaceState: null,
      promptSuggestionsEnabled: false,
      conversationId: opts.chat,
    }),
  );
}

const toolNames = (tools: unknown): string[] =>
  Array.isArray(tools)
    ? tools.map((t) => (t as { name?: string }).name).filter((n): n is string => typeof n === "string")
    : Object.keys((tools as Record<string, unknown>) ?? {});

const promptOf = (messages: unknown): string =>
  (messages as Array<{ content?: unknown }>)
    .map((m) =>
      typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content)
          ? m.content.map((part) => (part && typeof part === "object" && "text" in part ? String((part as { text: unknown }).text) : JSON.stringify(part))).join("\n")
          : JSON.stringify(m.content),
    )
    .join("\n");

describe("the model reads widgets with the Workspace's MCP tool", () => {
  it("is given the tool as the server describes it, and not the agent's own", async () => {
    const spy = makeSpyMockLlm(llmEmitsText("ok"));
    await ask({ messages: [{ role: "human", content: "what is on the dashboard" }], tools: [WORKSPACE_TOOL], model: spy.model, chat: "wwd-tools" });

    const tools = spy.calls[0].tools as unknown as Array<{ name: string; description?: string; inputSchema?: { properties?: Record<string, unknown> } }>;
    const widgetData = tools.filter((t) => t.name === "get_widget_data");
    expect(widgetData).toHaveLength(1);
    expect(widgetData[0].description).toBe("Fetch current data for one Workspace data source.");
    expect(Object.keys(widgetData[0].inputSchema?.properties ?? {})).toEqual(expect.arrayContaining(["origin", "widget_id", "data_args", "widget_uuid"]));
    expect(Object.keys(widgetData[0].inputSchema?.properties ?? {})).not.toContain("widgets");
  });

  it("still has the agent's own get_widget_data when the request does not have the Workspace's", async () => {
    const spy = makeSpyMockLlm(llmEmitsText("ok"));
    await ask({ messages: [{ role: "human", content: "what is on the dashboard" }], model: spy.model, chat: "wwd-native" });

    const tools = spy.calls[0].tools as unknown as Array<{ name: string; inputSchema?: { properties?: Record<string, unknown> } }>;
    const widgetData = tools.find((t) => t.name === "get_widget_data");
    expect(Object.keys(widgetData?.inputSchema?.properties ?? {})).toContain("widgets");
  });

  it("calls it as it calls any MCP tool: the browser runs it, not a function call of the agent", async () => {
    const events = await ask({
      messages: [{ role: "human", content: "show the asset info" }],
      tools: [WORKSPACE_TOOL],
      model: makeMockLlm(llmCallsTool("get_widget_data", { origin: "ODP", widget_id: "asset_info", widget_uuid: "w-1", data_args: { symbol: "AAPL" } })),
      chat: "wwd-call",
    });

    const calls = events.filter((e) => e.event === "copilotFunctionCall").map((e) => e.data as { function: string; input_arguments: Record<string, unknown> });
    expect(calls).toHaveLength(1);
    expect(calls[0].function).toBe("execute_agent_tool");
    expect(calls[0].input_arguments).toMatchObject({
      server_id: "workspace",
      tool_name: "Workspace_get_widget_data",
      parameters: { origin: "ODP", widget_id: "asset_info", widget_uuid: "w-1", data_args: { symbol: "AAPL" } },
    });
  });

  it("takes the result in as the widget's data: tables the model queries", async () => {
    const spy = makeSpyMockLlm(llmEmitsText("Both are loaded."));
    const events = await ask({
      messages: [{ role: "human", content: "show the asset info" }, result({ ok: true, message: "Widget data fetched.", data: [{ items: [{ content: ROWS }] }] })],
      tools: [WORKSPACE_TOOL],
      model: spy.model,
      chat: "wwd-result",
    });

    const statuses = events.filter((e) => e.event === "copilotStatusUpdate").map((e) => (e.data as { message?: string }).message);
    expect(statuses).toContain('Loaded "Asset Info" data.');
    const prompt = promptOf(spy.calls[0].messages);
    expect(prompt).toContain("Already Loaded Queryable Tables");
    expect(prompt).toContain('2 rows available as queryable table "asset_info"');
    expect(prompt).toContain('"symbol" (TEXT)');
    expect(prompt).toContain('"price" (REAL)');
  });

  it("leaves a failure for the model to read, with nothing loaded", async () => {
    const spy = makeSpyMockLlm(llmEmitsText("It could not be read."));
    const events = await ask({
      messages: [{ role: "human", content: "show the asset info" }, result({ ok: false, message: "No Workspace browser is connected." })],
      tools: [WORKSPACE_TOOL],
      model: spy.model,
      chat: "wwd-failure",
    });

    const statuses = events.filter((e) => e.event === "copilotStatusUpdate").map((e) => (e.data as { message?: string }).message ?? "");
    expect(statuses.some((m) => m.startsWith("Loaded"))).toBe(false);
    expect(promptOf(spy.calls[0].messages)).toContain("No Workspace browser is connected.");
  });
});

describe("what an earlier result of the turn leaves in the model's input", () => {
  const request = (earlier: ToolMessage) =>
    ({ messages: [{ role: "human", content: "compare them" }, earlier, { role: "tool", function: "execute_agent_tool", input_arguments: { tool_name: "x_web_search", parameters: {} }, data: [{ items: [{ content: "second" }] }] }] }) as unknown as QueryRequest;

  it("is nothing for widget data, which is in the tables, as the agent's own results leave it", () => {
    const messages = buildMessages(request(result({ ok: true, data: [{ items: [{ content: ROWS }] }] })));
    expect(promptOf(messages)).not.toContain("Earlier tool result from Workspace_get_widget_data");
  });

  it("is the result for any other tool", () => {
    const other = { ...result({ ok: true }), input_arguments: { tool_name: "x_web_search", parameters: {} }, data: [{ items: [{ content: "found it" }] }] } as unknown as ToolMessage;
    expect(promptOf(buildMessages(request(other)))).toContain("Earlier tool result from x_web_search");
  });
});
