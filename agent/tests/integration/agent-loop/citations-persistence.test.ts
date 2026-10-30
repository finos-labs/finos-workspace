import { describe, it, beforeEach } from "node:test";
import { expect } from "expect";
import { runAgentLoop } from "../../../src/agent/loop.ts";
import type {
  AgentTool,
  Citation,
  QueryRequest,
  SSEEvent,
  ToolMessage,
} from "../../../src/protocol/types.ts";
import {
  llmCallsTool,
  llmEmitsText,
  makeSequencedMockLlm,
} from "../../helpers/mock-llm.ts";
import { collectGenerator } from "../../helpers/sse-reader.ts";
import { clearAllModuleState } from "../../helpers/clear-state.ts";

beforeEach(() => clearAllModuleState());

const FIRST: Citation = {
  id: "first-cite",
  source_info: { type: "web", name: "First", citable: true },
  details: [{ link: "https://first.example", title: "First" }],
  signature: "",
};

function findFunctionCall(events: SSEEvent[], fn: string): SSEEvent | undefined {
  return events.find(
    (e) =>
      e.event === "copilotFunctionCall" &&
      (e.data as { function?: string }).function === fn,
  );
}

function tools(): AgentTool[] {
  return [
    {
      name: "fetch_webpage",
      server_id: "agent",
      url: "http://localhost:8787/mcp",
      description: "Fetch",
      input_schema: { properties: { url: { type: "string" } }, required: ["url"] },
    },
    {
      name: "web_search",
      server_id: "agent",
      url: "http://localhost:8787/mcp",
      description: "Search",
      input_schema: { properties: { q: { type: "string" } }, required: ["q"] },
    },
  ];
}

describe("citations persist across two MCP round-trips and a terminal turn", () => {
  it("step 2 re-POST carries citations from step 1; terminal collection surfaces them", async () => {
    const step1Result: ToolMessage = {
      role: "tool",
      function: "execute_agent_tool",
      input_arguments: { tool_name: "fetch_webpage", server_id: "agent" },
      data: [
        {
          items: [
            {
              text: JSON.stringify({
                $agent_kind: "citation",
                citation: {
                  type: "web",
                  url: "https://first.example",
                  title: "First",
                  id: "first-cite",
                },
              }),
            },
          ],
        },
      ],
    };

    const events = await collectGenerator(
      runAgentLoop({
        request: {
          messages: [
            { role: "human", content: "research" },
            step1Result,
          ],
          tools: tools(),
        } as unknown as QueryRequest,
        rawModelId: "openai:gpt-4o-mini",
        model: makeSequencedMockLlm([
          llmCallsTool("web_search", { q: "follow up" }),
        ]),
        allWidgets: [],
        workspaceState: null,
        conversationId: "persist-1",
      }),
    );

    const step2 = findFunctionCall(events, "execute_agent_tool");
    expect(step2).toBeDefined();
    const extra = (step2!.data as { extra_state?: { intermediate_citations?: Citation[] } })
      .extra_state;
    const carried = extra?.intermediate_citations ?? [];
    expect(carried.find((c) => c.id === "first-cite")).toBeDefined();
  });

  it("terminal turn re-emits citation registered via prior MCP result", async () => {
    const step1Result: ToolMessage = {
      role: "tool",
      function: "execute_agent_tool",
      input_arguments: { tool_name: "fetch_webpage", server_id: "agent" },
      data: [
        {
          items: [
            {
              text: JSON.stringify({
                $agent_kind: "citation",
                citation: {
                  type: "web",
                  url: "https://first.example",
                  title: "First",
                  id: "first-cite",
                },
              }),
            },
          ],
        },
      ],
    };
    const events = await collectGenerator(
      runAgentLoop({
        request: {
          messages: [
            { role: "human", content: "summarize" },
            step1Result,
          ],
          tools: tools(),
        } as unknown as QueryRequest,
        rawModelId: "openai:gpt-4o-mini",
        model: makeSequencedMockLlm([llmEmitsText("done")]),
        allWidgets: [],
        workspaceState: null,
        conversationId: "persist-2",
      }),
    );
    const collection = events.find((e) => e.event === "copilotCitationCollection");
    expect(collection).toBeDefined();
    const list = (collection!.data as { citations: Citation[] }).citations;
    expect(list.find((c) => c.id === "first-cite")).toBeDefined();
  });

  it("regression: intermediate_citations from extra_state are restored even when MCP body is empty", async () => {
    const stashOnly: ToolMessage = {
      role: "tool",
      function: "execute_agent_tool",
      input_arguments: { tool_name: "fetch_webpage", server_id: "agent" },
      data: [{ items: [{ text: "" }] }],
      extra_state: { intermediate_citations: [FIRST] },
    };
    const events = await collectGenerator(
      runAgentLoop({
        request: {
          messages: [
            { role: "human", content: "go on" },
            stashOnly,
          ],
        } as unknown as QueryRequest,
        rawModelId: "openai:gpt-4o-mini",
        model: makeSequencedMockLlm([llmEmitsText("ok")]),
        allWidgets: [],
        workspaceState: null,
        conversationId: "persist-3",
      }),
    );
    const collection = events.find((e) => e.event === "copilotCitationCollection");
    expect(collection).toBeDefined();
    const list = (collection!.data as { citations: Citation[] }).citations;
    expect(list.find((c) => c.id === "first-cite")).toBeDefined();
  });
});
