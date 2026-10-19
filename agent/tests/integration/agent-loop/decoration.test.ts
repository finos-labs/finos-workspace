/**
 * Tier 2 — agent-loop decoration & schema-strip scenarios.
 *
 * Pinned to CLAUDE.md gotchas:
 * - the SQL family runs in-process, with no decoration
 * - every round-trip emission carries the continuation extra_state
 * - earlier MCP results of the turn, and their artifacts, stay visible
 * - x-ines-* keys never appear in the model-facing tool schema
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { runAgentLoop } from "../../../src/agent/loop";
import type { AgentTool, QueryRequest, SSEEvent, ToolMessage, Widget } from "../../../src/protocol/types";
import { llmCallsTool, llmEmitsText, makeMockLlm, makeSpyMockLlm } from "../../helpers/mock-llm";
import { collectGenerator } from "../../helpers/sse-reader";
import { clearAllModuleState } from "../../helpers/clear-state";
import { rememberRows } from "../../../src/agent/row-cache";

beforeEach(() => {
  clearAllModuleState();
});

// MCP tools of the ines tool server: a renderer, and a tool that keeps state per chat and so
// carries decoration. The SQL family lives in-process on the agent and never round-trips through MCP.
function tools(): AgentTool[] {
  return [
    {
      name: "mermaid_diagram",
      server_id: "ines",
      url: "http://localhost:8787/mcp",
      description: "Render a Mermaid diagram",
      input_schema: {
        properties: { code: { type: "string" } },
        required: ["code"],
      },
    },
    {
      name: "query_documents",
      server_id: "ines",
      url: "http://localhost:8787/mcp",
      description: "Search the loaded documents",
      input_schema: {
        properties: {
          query: { type: "string" },
          "x-ines-conversation-id": { type: "string" },
          "x-ines-documents": { type: "array" },
        },
        required: ["query"],
      },
    },
  ];
}

function mermaidResult(items: Array<{ text: string }>, extraState?: Record<string, unknown>): ToolMessage {
  return {
    role: "tool",
    function: "execute_agent_tool",
    input_arguments: { tool_name: "mermaid_diagram", server_id: "ines" },
    data: [{ items }],
    ...(extraState ? { extra_state: extraState } : {}),
  };
}

function findExecuteAgentTool(events: SSEEvent[]): SSEEvent | undefined {
  return events.find(
    (e) =>
      e.event === "copilotFunctionCall" &&
      (e.data as { function?: string }).function === "execute_agent_tool",
  );
}

describe("decoration — the SQL family needs none", () => {
  it("execute_sql runs in-process even when conversationId is missing — no executeAgentTool emit", async () => {
    await rememberRows("", "prices", [{ symbol: "NVDA" }]);
    const events = await collectGenerator(
      runAgentLoop({
        request: { messages: [{ role: "human", content: "select" }], tools: tools() } as QueryRequest,
        rawModelId: "openai:gpt-4o-mini",
        model: makeMockLlm(llmEmitsText("nothing to do")),
        allWidgets: [],
        workspaceState: null,
        conversationId: "",
      }),
    );
    expect(findExecuteAgentTool(events)).toBeUndefined();
  });
});

describe("round-trip extra_state — continuation state survives every emission", () => {
  beforeEach(() => clearAllModuleState());

  it("get_widget_data emission carries documents_shipped forward", async () => {
    // A prior query_documents call shipped "doc-1"; the model now fetches a
    // widget. If the widget emission drops documents_shipped, the re-POST
    // restores nothing and the next query_documents re-ships the document.
    const widget: Widget = {
      uuid: "w-1",
      origin: "example",
      widget_id: "tbl",
      name: "Tbl",
      description: "",
      params: [],
    };
    const events = await collectGenerator(
      runAgentLoop({
        request: {
          messages: [
            { role: "human", content: "fetch the widget" },
            mermaidResult([{ text: "[No output]" }], { documents_shipped: ["doc-1"] }),
          ],
          tools: tools(),
        } as unknown as QueryRequest,
        rawModelId: "openai:gpt-4o-mini",
        model: makeMockLlm(
          llmCallsTool("get_widget_data", { widgets: [{ widget_uuid: "w-1" }] }),
        ),
        allWidgets: [widget],
        workspaceState: null,
        conversationId: "conv-cont-1",
      }),
    );
    const fetchEvent = events.find(
      (e) =>
        e.event === "copilotFunctionCall" &&
        (e.data as { function?: string }).function === "get_widget_data",
    );
    expect(fetchEvent).toBeDefined();
    const extra = (fetchEvent!.data as { extra_state?: Record<string, unknown> }).extra_state;
    expect(extra?.documents_shipped).toEqual(["doc-1"]);
  });

  it("execute_agent_tool emission carries loaded_skill_slugs forward", async () => {
    // Prior re-POST loaded a skill; the model now calls mermaid_diagram. If the
    // MCP emission drops loaded_skill_slugs, the skill inventory is lost for
    // the rest of the turn and the model may reload the skill.
    const skillResult: ToolMessage = {
      role: "tool",
      function: "get_skill_content",
      input_arguments: { slug: "summarize-table" },
      data: [
        { status: "success", data: { skill: { contentMarkdown: "Be concise." } } },
      ] as unknown as ToolMessage["data"],
    };
    const events = await collectGenerator(
      runAgentLoop({
        request: {
          messages: [{ role: "human", content: "analyze" }, skillResult],
          tools: tools(),
        } as unknown as QueryRequest,
        rawModelId: "openai:gpt-4o-mini",
        model: makeMockLlm(llmCallsTool("mermaid_diagram", { code: "flowchart TD\n  A --> B" })),
        allWidgets: [],
        workspaceState: null,
        conversationId: "conv-cont-2",
      }),
    );
    const exec = findExecuteAgentTool(events);
    expect(exec).toBeDefined();
    const extra = (exec!.data as { extra_state?: Record<string, unknown> }).extra_state;
    expect(extra?.loaded_skill_slugs).toContain("summarize-table");
  });
});

describe("history — earlier MCP results from the turn stay visible to the model", () => {
  beforeEach(() => clearAllModuleState());

  it("the prompt includes the earlier call's artifact ack, not just the last result", async () => {
    const earlier = mermaidResult([
      {
        text: JSON.stringify({
          $ines_kind: "artifact",
          artifact: { type: "html", uuid: "u1", name: "First Diagram", description: "", content: "<svg/>" },
        }),
      },
      { text: "first call parse error" },
    ]);
    const spy = makeSpyMockLlm(llmEmitsText("done"));
    await collectGenerator(
      runAgentLoop({
        request: {
          messages: [
            { role: "human", content: "draw it" },
            earlier,
            mermaidResult([{ text: "[No output]" }]),
          ],
          tools: tools(),
        } as unknown as QueryRequest,
        rawModelId: "openai:gpt-4o-mini",
        model: spy.model,
        allWidgets: [],
        workspaceState: null,
        conversationId: "conv-hist-1",
      }),
    );
    const prompt = JSON.stringify(spy.calls[0]?.messages ?? []);
    expect(prompt).toContain('[Artifact \\"First Diagram\\" (html) delivered to the user');
    expect(prompt).toContain("first call parse error");
  });
});

describe("MCP artifacts — land in the message stream, not the status timeline", () => {
  beforeEach(() => clearAllModuleState());

  function mermaidResultWithArtifact(name: string): ToolMessage {
    return mermaidResult([
      {
        text: JSON.stringify({
          $ines_kind: "artifact",
          artifact: { type: "html", uuid: "u1", name, description: "", content: "<svg/>" },
        }),
      },
      { text: "diagram rendered" },
    ]);
  }

  it("artifact from an MCP result is emitted as copilotMessageArtifact when the model answers", async () => {
    const events = await collectGenerator(
      runAgentLoop({
        request: {
          messages: [
            { role: "human", content: "draw it" },
            mermaidResultWithArtifact("Top Chart"),
          ],
          tools: tools(),
        } as unknown as QueryRequest,
        rawModelId: "openai:gpt-4o-mini",
        model: makeMockLlm(llmEmitsText("Here is the analysis.")),
        allWidgets: [],
        workspaceState: null,
        conversationId: "conv-art-1",
      }),
    );
    const artifactEvent = events.find(
      (e) =>
        e.event === "copilotMessageArtifact" &&
        (e.data as { name?: string }).name === "Top Chart",
    );
    expect(artifactEvent).toBeDefined();
    // Status update also carries the output artifact so the tool-call details
    // can show both input and output artifacts.
    const status = events.find(
      (e) =>
        e.event === "copilotStatusUpdate" &&
        (e.data as { message?: string }).message === "Output from ines - mermaid_diagram",
    );
    expect(status).toBeDefined();
    expect((status!.data as { details?: unknown }).details).toBeUndefined();
    expect((status!.data as { artifacts?: Array<{ name?: string }> }).artifacts?.[0])
      .toMatchObject({ name: "Top Chart" });
  });

  it("strips repeated Mermaid code from final text when an MCP artifact is emitted", async () => {
    const events = await collectGenerator(
      runAgentLoop({
        request: {
          messages: [
            { role: "human", content: "draw it" },
            mermaidResultWithArtifact("Rendered Diagram"),
          ],
          tools: tools(),
        } as unknown as QueryRequest,
        rawModelId: "openai:gpt-4o-mini",
        model: makeMockLlm(
          llmEmitsText(
            "Here is the rendered diagram:\n\n```mermaid\nflowchart TD\n  A --> B\n```\n\nIt groups the products.",
          ),
        ),
        allWidgets: [],
        workspaceState: null,
        conversationId: "conv-art-mermaid-strip",
      }),
    );

    const finalText = events
      .filter((e) => e.event === "copilotMessageChunk")
      .map((e) => (e.data as { delta?: string }).delta ?? "")
      .join("");
    expect(finalText).toContain("Here is the rendered diagram:");
    expect(finalText).toContain("It groups the products.");
    expect(finalText).not.toContain("```mermaid");
    expect(finalText).not.toContain("flowchart TD");
    expect(events.some((e) => e.event === "copilotMessageArtifact")).toBe(true);
  });

  it("artifact is not lost when the model follows up with another round-trip call", async () => {
    const events = await collectGenerator(
      runAgentLoop({
        request: {
          messages: [
            { role: "human", content: "draw it" },
            mermaidResultWithArtifact("Mid-turn Chart"),
          ],
          tools: tools(),
        } as unknown as QueryRequest,
        rawModelId: "openai:gpt-4o-mini",
        model: makeMockLlm(llmCallsTool("mermaid_diagram", { code: "flowchart TD\n  A --> B" })),
        allWidgets: [],
        workspaceState: null,
        conversationId: "conv-art-2",
      }),
    );
    const artifactIdx = events.findIndex(
      (e) =>
        e.event === "copilotMessageArtifact" &&
        (e.data as { name?: string }).name === "Mid-turn Chart",
    );
    const callIdx = events.findIndex(
      (e) =>
        e.event === "copilotFunctionCall" &&
        (e.data as { function?: string }).function === "execute_agent_tool",
    );
    // Artifact must be emitted before the turn pauses for the next round-trip
    // — the artifactQueue is request-scoped and dies at the re-POST.
    expect(artifactIdx).toBeGreaterThanOrEqual(0);
    expect(callIdx).toBeGreaterThanOrEqual(0);
    expect(artifactIdx).toBeLessThan(callIdx);
  });
});

describe("decoration — x-ines-* never reaches the model", () => {
  it("the tools surfaced to doGenerate have no x-ines-* keys in their input schema", async () => {
    const spy = makeSpyMockLlm(llmEmitsText("ok"));
    const widget: Widget = {
      uuid: "w-1",
      origin: "example",
      widget_id: "w",
      name: "Sample",
      description: "",
      params: [],
    };
    await collectGenerator(
      runAgentLoop({
        request: { messages: [{ role: "human", content: "go" }], tools: tools() } as QueryRequest,
        rawModelId: "openai:gpt-4o-mini",
        model: spy.model,
        allWidgets: [widget],
        workspaceState: null,
        conversationId: "conv-5",
      }),
    );
    expect(spy.calls.length).toBeGreaterThan(0);
    const surfacedTools = spy.calls[0].tools as Record<string, { inputSchema: { jsonSchema?: { properties?: Record<string, unknown> } } } | undefined>;
    // The Vercel AI SDK shapes tools as { name: { type, inputSchema, ... } }; we
    // assert no key on any tool's input schema starts with x-ines-.
    for (const t of Object.values(surfacedTools)) {
      const schema = (t as unknown as { inputSchema?: { jsonSchema?: { properties?: Record<string, unknown> } } } | undefined)?.inputSchema?.jsonSchema?.properties;
      if (schema) {
        for (const k of Object.keys(schema)) {
          expect(k.startsWith("x-ines-")).toBe(false);
        }
      }
    }
  });
});
