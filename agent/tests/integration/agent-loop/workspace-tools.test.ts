/**
 * Tier 2 — the FINOS Workspace's own tools.
 *
 * The FINOS Workspace gives the agent in its web app the tools it has for itself, as the tools of a request: the model
 * is given them as the FINOS Workspace describes them, a call is made like a call of any MCP tool (the browser runs it,
 * as the signed-in user), and the agent has no function calls of its own for the same things then. The browser
 * runs one call per round trip, so the calls the model makes together are made one by one.
 */

import { describe, it, beforeEach } from "node:test";
import { expect } from "expect";
import { runAgentLoop } from "../../../src/agent/loop.ts";
import type { AgentTool, QueryRequest, SSEEvent, ToolMessage } from "../../../src/protocol/types.ts";
import { llmEmitsText, makeMockLlm, makeSpyMockLlm } from "../../helpers/mock-llm.ts";
import { collectGenerator } from "../../helpers/sse-reader.ts";
import { clearAllModuleState } from "../../helpers/clear-state.ts";

beforeEach(() => clearAllModuleState());

const workspaceTool = (name: string, description = `${name}.`): AgentTool => ({
  name: `Workspace_${name}`,
  server_id: "workspace",
  url: "http://api:8000/app/workspace-tools",
  description,
  input_schema: {
    properties: { widget_uuid: { type: "string" }, data_args: { type: "object" } },
  },
});

const TOOLS: AgentTool[] = [
  workspaceTool("get_widget_data"),
  workspaceTool("update_widget", "Update one existing widget on a target dashboard."),
  workspaceTool("create_widget"),
  workspaceTool("get_skill_content"),
];

function ask(opts: {
  messages: QueryRequest["messages"];
  model: ReturnType<typeof makeMockLlm>;
  chat: string;
  tools?: AgentTool[];
}): Promise<SSEEvent[]> {
  return collectGenerator(
    runAgentLoop({
      request: { messages: opts.messages, tools: opts.tools ?? TOOLS } as unknown as QueryRequest,
      rawModelId: "openai:gpt-4o-mini",
      model: opts.model,
      allWidgets: [],
      workspaceState: null,
      promptSuggestionsEnabled: false,
      conversationId: opts.chat,
    }),
  );
}

type FunctionCall = {
  function: string;
  input_arguments: { server_id: string; tool_name: string; parameters: Record<string, unknown> };
  extra_state?: { pending_workspace_calls?: Array<{ tool_name: string; input_arguments: Record<string, unknown> }> };
};

const functionCalls = (events: SSEEvent[]): FunctionCall[] =>
  events.filter((e) => e.event === "copilotFunctionCall").map((e) => e.data as unknown as FunctionCall);

const toolNamesOf = (tools: unknown): string[] =>
  Array.isArray(tools) ? tools.map((t) => (t as { name?: string }).name).filter((n): n is string => typeof n === "string") : Object.keys((tools as Record<string, unknown>) ?? {});

/** The step of a model that calls the tool for each of these widgets at once. */
const updates = (...uuids: string[]) => ({
  toolCalls: uuids.map((uuid) => ({
    toolName: "Workspace_update_widget",
    input: { widget_uuid: uuid, data_args: { symbol: "MSFT" }, display_summary: `Update ${uuid}` },
  })),
  finishReason: "tool-calls" as const,
});

/** What the browser re-POSTs after it ran a call of the FINOS Workspace's tool, with the extra state it was sent. */
function result(extraState?: Record<string, unknown>): ToolMessage {
  return {
    role: "tool",
    function: "execute_agent_tool",
    input_arguments: {
      server_id: "workspace",
      tool_name: "Workspace_update_widget",
      parameters: { widget_uuid: "w-1", data_args: { symbol: "MSFT" } },
    },
    data: [{ items: [{ content: JSON.stringify({ ok: true, command: "update_widget", message: "Widget updated." }) }] }],
    ...(extraState ? { extra_state: extraState } : {}),
  } as unknown as ToolMessage;
}

describe("the model is given the FINOS Workspace's tools", () => {
  it("as the FINOS Workspace describes them, when the user lets the agent change the FINOS Workspace", async () => {
    const spy = makeSpyMockLlm(llmEmitsText("ok"));
    await ask({ messages: [{ role: "human", content: "set the symbol to MSFT" }], model: spy.model, chat: "wt-tools" });

    // Its tools are in the model's tool list from the first step, with the description the FINOS Workspace gave
    // them: the model reads them before it acts, and does not have to load them.
    const offered = toolNamesOf(spy.calls[0].tools);
    expect(offered).toContain("Workspace_update_widget");
    expect(offered).toContain("Workspace_create_widget");
    expect(offered).not.toContain("Workspace_get_skill_content");
    expect(JSON.stringify(spy.calls[0].tools)).toContain("Update one existing widget on a target dashboard.");
  });

  it("without the agent's own function calls for the same things", async () => {
    const spy = makeSpyMockLlm(llmEmitsText("ok"));
    await ask({ messages: [{ role: "human", content: "set the symbol to MSFT" }], model: spy.model, chat: "wt-no-native" });

    const system = JSON.stringify(spy.calls[0].messages);
    expect(system).not.toContain("update_widget_in_dashboard");
    expect(system).not.toContain("add_widget_to_dashboard");
    expect(toolNamesOf(spy.calls[0].tools)).not.toContain("update_widget_in_dashboard");
  });

  it("with the agent's own function calls when the request does not have them", async () => {
    const spy = makeSpyMockLlm(llmEmitsText("ok"));
    await ask({ messages: [{ role: "human", content: "set the symbol to MSFT" }], model: spy.model, chat: "wt-native", tools: [] });

    expect(JSON.stringify(spy.calls[0].messages)).toContain("update_widget_in_dashboard");
  });

  it("only the one that reads a widget while the user does not let the agent change the FINOS Workspace", async () => {
    const spy = makeSpyMockLlm(llmEmitsText("ok"));
    await ask({
      messages: [{ role: "human", content: "set the symbol to MSFT" }],
      model: spy.model,
      chat: "wt-read-only",
    });

    const system = JSON.stringify(spy.calls[0].messages);
    expect(system).not.toContain("Workspace_update_widget");
    expect(toolNamesOf(spy.calls[0].tools)).toContain("get_widget_data");
  });
});

describe("a call of the FINOS Workspace's tool", () => {
  it("is made as a call of any MCP tool: the browser runs it", async () => {
    const events = await ask({
      messages: [{ role: "human", content: "set the symbol to MSFT" }],
      model: makeMockLlm(updates("w-1")),
      chat: "wt-call",
    });

    const calls = functionCalls(events);
    expect(calls).toHaveLength(1);
    expect(calls[0].function).toBe("execute_agent_tool");
    expect(calls[0].input_arguments).toEqual({
      server_id: "workspace",
      tool_name: "Workspace_update_widget",
      parameters: { widget_uuid: "w-1", data_args: { symbol: "MSFT" } },
    });
    expect(calls[0].extra_state?.pending_workspace_calls).toBeUndefined();
  });

  it("is made one at a time when the model calls several together: the rest wait for their turn", async () => {
    const events = await ask({
      messages: [{ role: "human", content: "set the symbol to MSFT everywhere" }],
      model: makeMockLlm(updates("w-1", "w-2", "w-3")),
      chat: "wt-several",
    });

    const calls = functionCalls(events);
    expect(calls).toHaveLength(1);
    expect(calls[0].input_arguments.parameters).toEqual({ widget_uuid: "w-1", data_args: { symbol: "MSFT" } });
    expect(calls[0].extra_state?.pending_workspace_calls).toEqual([
      { tool_name: "Workspace_update_widget", input_arguments: { widget_uuid: "w-2", data_args: { symbol: "MSFT" } } },
      { tool_name: "Workspace_update_widget", input_arguments: { widget_uuid: "w-3", data_args: { symbol: "MSFT" } } },
    ]);
  });

  it("does not make another server's calls wait with the FINOS Workspace's", async () => {
    const events = await ask({
      messages: [{ role: "human", content: "search the web and update the widget" }],
      tools: [...TOOLS, { name: "Ines_Tools_web_search", server_id: "ines", url: "http://ines:8787/mcp", description: "Search the web." }],
      model: makeMockLlm({
        toolCalls: [
          { toolName: "Workspace_update_widget", input: { widget_uuid: "w-1" } },
          { toolName: "Ines_Tools_web_search", input: { query: "MSFT" } },
        ],
        finishReason: "tool-calls",
      }),
      chat: "wt-mixed",
    });

    const calls = functionCalls(events);
    expect(calls).toHaveLength(1);
    expect(calls[0].input_arguments.server_id).toBe("workspace");
    expect(calls[0].extra_state?.pending_workspace_calls).toBeUndefined();
  });
});

describe("the calls that wait", () => {
  it("are made one per re-POST, before the model runs again", async () => {
    const queued = [
      { tool_name: "Workspace_update_widget", input_arguments: { widget_uuid: "w-2", data_args: { symbol: "MSFT" } } },
      { tool_name: "Workspace_update_widget", input_arguments: { widget_uuid: "w-3", data_args: { symbol: "MSFT" } } },
    ];
    const events = await ask({
      messages: [{ role: "human", content: "set the symbol to MSFT everywhere" }, result({ pending_workspace_calls: queued })],
      model: makeMockLlm(llmEmitsText("MODEL SHOULD NOT RUN")),
      chat: "wt-drain",
    });

    const calls = functionCalls(events);
    expect(calls).toHaveLength(1);
    expect(calls[0].input_arguments).toEqual({
      server_id: "workspace",
      tool_name: "Workspace_update_widget",
      parameters: { widget_uuid: "w-2", data_args: { symbol: "MSFT" } },
    });
    expect(calls[0].extra_state?.pending_workspace_calls).toEqual([queued[1]]);
    // The model is not asked while calls are still owed to the browser.
    expect(events.some((e) => e.event === "copilotMessageChunk")).toBe(false);
  });

  it("are done when the last of them was made: the model is asked again, and has every result", async () => {
    const spy = makeSpyMockLlm(llmEmitsText("All three are updated."));
    const events = await ask({
      messages: [{ role: "human", content: "set the symbol to MSFT everywhere" }, result({})],
      model: spy.model,
      chat: "wt-done",
    });

    expect(functionCalls(events)).toHaveLength(0);
    expect(spy.calls).toHaveLength(1);
    expect(events.some((e) => e.event === "copilotMessageChunk")).toBe(true);
  });

  it("are made only of the FINOS Workspace's tools that the request has: what comes back from the browser is not trusted", async () => {
    const spy = makeSpyMockLlm(llmEmitsText("Done."));
    const events = await ask({
      tools: [...TOOLS, { name: "Ines_Tools_web_search", server_id: "ines", url: "http://ines:8787/mcp", description: "Search the web." }],
      messages: [
        { role: "human", content: "set the symbol to MSFT" },
        result({
          pending_workspace_calls: [
            { tool_name: "Workspace_delete_everything", input_arguments: {} },
            { tool_name: "Ines_Tools_web_search", input_arguments: { query: "x" } },
          ],
        }),
      ],
      model: spy.model,
      chat: "wt-untrusted",
    });

    expect(functionCalls(events)).toHaveLength(0);
    expect(spy.calls).toHaveLength(1);
  });
});
