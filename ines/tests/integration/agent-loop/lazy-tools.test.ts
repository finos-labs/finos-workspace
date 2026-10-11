/**
 * Tier 2 — the model is given the tools it uses, and knows the rest exist.
 *
 * Drives the real loop with a spy model to see exactly what each model call is given: the definitions in
 * its tool list, and the catalog and instructions in its system prompt.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { runAgentLoop } from "../../../src/agent/loop";
import type { AgentTool, Message, QueryRequest, SSEEvent, Widget, WorkspaceState } from "../../../src/protocol/types";
import { llmCallsTool, llmEmitsText, makeSequencedSpyMockLlm, makeSpyMockLlm } from "../../helpers/mock-llm";
import { collectGenerator } from "../../helpers/sse-reader";
import { clearAllModuleState } from "../../helpers/clear-state";
import { catalogToolNamesOf, systemPromptOf, toolNamesOf } from "../../helpers/offered-tools";

beforeEach(() => clearAllModuleState());

const widget = (uuid: string, name: string, extra: Partial<Widget> = {}): Widget => ({
  uuid,
  origin: "example",
  widget_id: uuid,
  name,
  description: `${name} data`,
  params: [],
  ...extra,
});

const mcp = (name: string, description: string): AgentTool => ({
  name: `Ines Tools_${name}`,
  tool_name: name,
  server_id: "ines-tools",
  url: "http://ines-mcp:8787/mcp",
  description,
  input_schema: { properties: { query: { type: "string" } }, required: ["query"] },
});

const MCP_TOOLS: AgentTool[] = [
  mcp("web_search", "Search the web."),
  mcp("fetch_webpage", "Fetch a page."),
  mcp("query_documents", "Search loaded files."),
  mcp("list_documents", "List loaded files."),
  mcp("execute_code", "Run Python."),
];

interface RunOptions {
  messages?: Message[];
  widgets?: QueryRequest["widgets"];
  tools?: AgentTool[];
  context?: unknown[];
  generativeUi?: boolean;
  workspaceState?: WorkspaceState | null;
}

async function run(model: ReturnType<typeof makeSpyMockLlm>["model"], options: RunOptions = {}): Promise<SSEEvent[]> {
  const widgets = options.widgets ?? { primary: [], secondary: [widget("sales", "Sales")], extra: [] };
  return collectGenerator(
    runAgentLoop({
      request: {
        messages: options.messages ?? [{ role: "human", content: "What is the capital of Japan?" }],
        tools: options.tools ?? MCP_TOOLS,
        widgets,
        ...(options.context ? { context: options.context } : {}),
      } as unknown as QueryRequest,
      rawModelId: "test-provider:test-model",
      model,
      allWidgets: [...(widgets?.primary ?? []), ...(widgets?.secondary ?? [])],
      workspaceState: options.workspaceState ?? null,
      generativeUiEnabled: options.generativeUi ?? false,
      conversationId: "lazy-tools",
    }),
  );
}

const sizeOf = (call: { tools?: unknown }) => JSON.stringify(call.tools ?? []).length;

describe("a question that needs no tool", () => {
  it("is given the core tools and a catalog of the rest, not their definitions", async () => {
    const spy = makeSpyMockLlm(llmEmitsText("Tokyo."));
    await run(spy.model, { generativeUi: true });
    const names = toolNamesOf(spy.calls[0]);
    expect(names.sort()).toEqual(["get_widget_data", "load_tools", "search_widgets"]);

    // The rest is named in the system prompt, by group.
    const catalog = catalogToolNamesOf(spy.calls[0]);
    for (const tool of ["execute_sql", "create_artifact", "update_widget_in_dashboard", "create_html_artifact"]) {
      expect(catalog).toContain(tool);
    }
    expect(catalog.some((n) => n.endsWith("web_search"))).toBe(true);
    expect(catalog.some((n) => n.endsWith("execute_code"))).toBe(true);
    expect(systemPromptOf(spy.calls[0])).toContain("call load_tools with its name");
  });

  it("costs a fraction of what offering every tool did", async () => {
    const spy = makeSpyMockLlm(llmEmitsText("Tokyo."));
    await run(spy.model, { generativeUi: true });
    const tokens = (systemPromptOf(spy.calls[0]).length + sizeOf(spy.calls[0])) / 4;
    // Every tool, with every instruction, was ~10k tokens before the question.
    expect(tokens).toBeLessThan(4_500);
  });

  it("is not given the instructions of the tools it was not given", async () => {
    const spy = makeSpyMockLlm(llmEmitsText("Tokyo."));
    await run(spy.model, { generativeUi: true });
    const prompt = systemPromptOf(spy.calls[0]);
    for (const heading of ["SQL TOOLS:", "DASHBOARD TOOLS:", "RENDER TOOLS:", "CODE TOOLS:", "WEB TOOLS:", "DOCUMENTS TOOLS:"]) {
      expect(prompt).not.toContain(heading);
    }
  });

  it("lists only the groups of tools that exist", async () => {
    const spy = makeSpyMockLlm(llmEmitsText("Tokyo."));
    await run(spy.model, { tools: [] });
    const catalog = catalogToolNamesOf(spy.calls[0]);
    // The agent's own tools are there; the MCP tools, and the dashboard tools of Generative UI, are not.
    expect(catalog).toContain("execute_sql");
    expect(catalog).toContain("create_app");
    expect(catalog.some((n) => n.endsWith("web_search"))).toBe(false);
    expect(catalog.some((n) => n.endsWith("execute_code"))).toBe(false);
    expect(catalog).not.toContain("update_widget_in_dashboard");
  });

  it("lists the dashboard tools when Generative UI is on", async () => {
    const spy = makeSpyMockLlm(llmEmitsText("Tokyo."));
    await run(spy.model, { tools: [], generativeUi: true });
    expect(catalogToolNamesOf(spy.calls[0])).toContain("update_widget_in_dashboard");
  });
});

describe("a question that needs a group", () => {
  it("loads it with load_tools, and the next step has its tools and instructions", async () => {
    const spy = makeSequencedSpyMockLlm([llmCallsTool("load_tools", { groups: ["sql"] }), llmEmitsText("done")]);
    await run(spy.model);

    expect(toolNamesOf(spy.calls[0])).not.toContain("execute_sql");
    expect(systemPromptOf(spy.calls[0])).not.toContain("SQL TOOLS:");

    expect(toolNamesOf(spy.calls[1])).toEqual(expect.arrayContaining(["execute_sql", "peek_table", "peek_column_values", "create_artifact"]));
    expect(systemPromptOf(spy.calls[1])).toContain("SQL TOOLS:");
    expect(systemPromptOf(spy.calls[1])).toContain("- sql [loaded]");
    // What it did not load is still not there.
    expect(toolNamesOf(spy.calls[1])).not.toContain("update_widget_in_dashboard");
  });

  it("tells the model what it loaded, and what it asked for that does not exist", async () => {
    const spy = makeSequencedSpyMockLlm([llmCallsTool("load_tools", { groups: ["sql", "teleport"] }), llmEmitsText("done")]);
    await run(spy.model);
    const result = JSON.stringify(spy.calls[1].messages);
    expect(result).toContain("execute_sql");
    expect(result).toContain("teleport");
    expect(result).toContain("available");
  });

  it("loads several groups in one call", async () => {
    const spy = makeSequencedSpyMockLlm([llmCallsTool("load_tools", { groups: ["sql", "render"] }), llmEmitsText("done")]);
    await run(spy.model);
    expect(toolNamesOf(spy.calls[1])).toEqual(expect.arrayContaining(["execute_sql", "create_html_artifact", "create_table_from_text"]));
  });

  it("loads the web tools, the user's MCP tools included", async () => {
    const spy = makeSequencedSpyMockLlm([llmCallsTool("load_tools", { groups: ["web"] }), llmEmitsText("done")]);
    await run(spy.model);
    const names = toolNamesOf(spy.calls[1]);
    expect(names.some((n) => n.endsWith("web_search"))).toBe(true);
    expect(names.some((n) => n.endsWith("fetch_webpage"))).toBe(true);
    expect(names.some((n) => n.endsWith("execute_code"))).toBe(false);
  });

  it("is not stopped by a tool of a group that was never loaded: using it loads it", async () => {
    const spy = makeSequencedSpyMockLlm([
      llmCallsTool("_llm_think", { plan: "- look", summary: "Planning" }),
      llmEmitsText("done"),
    ]);
    await run(spy.model);
    expect(toolNamesOf(spy.calls[0])).not.toContain("_llm_think");
    expect(toolNamesOf(spy.calls[1])).toContain("_llm_think");
    expect(systemPromptOf(spy.calls[1])).toContain("PLANNING TOOLS:");
  });
});

describe("a group that the state makes certain", () => {
  const TABLE_CONTEXT = [
    {
      uuid: "ctx-1",
      name: "Prices",
      description: "prices",
      data: { items: [{ content: JSON.stringify([{ symbol: "AAPL", close: 7 }]), data_format: { data_type: "object", parse_as: "table" } }] },
    },
  ];

  it("has the SQL tools as soon as there are tables to query", async () => {
    const spy = makeSpyMockLlm(llmEmitsText("done"));
    await run(spy.model, { context: TABLE_CONTEXT, messages: [{ role: "human", content: "What is the highest close?" }] });
    expect(toolNamesOf(spy.calls[0])).toEqual(expect.arrayContaining(["execute_sql", "peek_table", "create_artifact"]));
    expect(systemPromptOf(spy.calls[0])).toContain("SQL TOOLS:");
  });

  it("has the document tools when there is a PDF to read", async () => {
    const spy = makeSpyMockLlm(llmEmitsText("done"));
    await run(spy.model, {
      widgets: { primary: [widget("file-1", "plan.pdf", { metadata: { extension: "pdf" } })], secondary: [], extra: [] },
      messages: [{ role: "human", content: "What does the PDF say about the budget?" }],
    });
    const names = toolNamesOf(spy.calls[0]);
    expect(names.some((n) => n.endsWith("query_documents"))).toBe(true);
    expect(names.some((n) => n.endsWith("list_documents"))).toBe(true);
    expect(systemPromptOf(spy.calls[0])).toContain("DOCUMENTS TOOLS:");
    // ...and nothing else that was not asked for.
    expect(names.some((n) => n.endsWith("web_search"))).toBe(false);
    expect(names).not.toContain("execute_sql");
  });

  it("does not have the document tools for a file that cannot be searched", async () => {
    const spy = makeSpyMockLlm(llmEmitsText("done"));
    await run(spy.model, {
      widgets: { primary: [widget("file-1", "photo.png", { metadata: { extension: "png" } })], secondary: [], extra: [] },
    });
    expect(toolNamesOf(spy.calls[0]).some((n) => n.endsWith("query_documents"))).toBe(false);
  });
});

describe("what is carried from one request of a turn to the next", () => {
  const STATE: WorkspaceState = {
    current_page_context: "page",
    current_dashboard_uuid: "d-1",
    current_dashboard_info: { id: "d-1", name: "Main", current_tab_id: "t1", tabs: [{ tab_id: "t1", widgets: [] }] },
  };

  it("includes the groups the model loaded, so that the model call that follows a round trip has them", async () => {
    const spy = makeSequencedSpyMockLlm([
      llmCallsTool("load_tools", { groups: ["dashboard"] }),
      llmCallsTool("manage_navigation_bar", { operation: "create", tabs: [{ name: "New" }] }),
    ]);
    const events = await run(spy.model, { generativeUi: true, workspaceState: STATE });
    const call = events.find((e) => e.event === "copilotFunctionCall" && (e.data as { function?: string }).function === "manage_navigation_bar");
    expect((call?.data as { extra_state?: { loaded_tool_groups?: string[] } }).extra_state?.loaded_tool_groups).toEqual(["dashboard"]);
  });

  it("restores them: the request after the round trip starts with the tools and instructions", async () => {
    const spy = makeSpyMockLlm(llmEmitsText("Added the tab."));
    await run(spy.model, {
      generativeUi: true,
      workspaceState: STATE,
      messages: [
        { role: "human", content: "Add a tab" },
        {
          role: "tool",
          function: "manage_navigation_bar",
          input_arguments: { operation: "create" },
          data: [{ status: "success", message: "Tab created" }],
          extra_state: { loaded_tool_groups: ["dashboard"] },
        } as unknown as Message,
      ],
    });
    expect(toolNamesOf(spy.calls[0])).toEqual(expect.arrayContaining(["update_widget_in_dashboard", "manage_navigation_bar"]));
    expect(systemPromptOf(spy.calls[0])).toContain("DASHBOARD TOOLS:");
  });

  it("ignores a group name it does not know", async () => {
    const spy = makeSpyMockLlm(llmEmitsText("ok"));
    await run(spy.model, {
      messages: [
        { role: "human", content: "hi" },
        { role: "tool", function: "get_skill_content", input_arguments: { slug: "x" }, data: [], extra_state: { loaded_tool_groups: ["nonsense", 7] } } as unknown as Message,
      ],
    });
    expect(toolNamesOf(spy.calls[0])).not.toContain("nonsense");
  });
});
