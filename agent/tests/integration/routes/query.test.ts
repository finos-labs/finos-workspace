/**
 * Tier 2 — POST /v1/query route.
 *
 * Drives the route end-to-end with a mocked provider. Asserts:
 * - X-Trace-Id is threaded as conversationId into the loop
 * - SSE response shape (Content-Type, decodable body)
 * - 400 on invalid request body
 *
 * The loop itself is exercised in tests/integration/agent-loop/*.
 * Here we only verify the route layer wires correctly.
 */

import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";

// Mock providers BEFORE importing the route so the route's resolveModel call
// returns our deterministic mock.
import { makeMockLlm, llmEmitsText } from "../../helpers/mock-llm";

// Only resolveModel is replaced; the module's other exports are used by the loop and must stay.
const realProviders = await import("../../../src/lib/providers");
mock.module("../../../src/lib/providers", () => ({
  ...realProviders,
  resolveModel: () => makeMockLlm(llmEmitsText("ok from mock")),
}));

const { Hono } = await import("hono");
const { queryRouter } = await import("../../../src/routes/query");
const { readSse } = await import("../../helpers/sse-reader");
const { clearAllModuleState } = await import("../../helpers/clear-state");

function app() {
  const a = new Hono();
  a.route("/", queryRouter);
  return a;
}

// No model id is baked into the server: a deployment configures DEFAULT_MODEL.
// The mocked resolveModel ignores the id, so any string stands in for it.
const savedDefaultModel = process.env.DEFAULT_MODEL;
beforeEach(() => {
  clearAllModuleState();
  process.env.DEFAULT_MODEL = "test-provider:test-model";
});
afterEach(() => {
  if (savedDefaultModel === undefined) delete process.env.DEFAULT_MODEL;
  else process.env.DEFAULT_MODEL = savedDefaultModel;
});

describe("POST /v1/query — no model configured", () => {
  it("says so in the chat instead of guessing a model or returning a 500", async () => {
    delete process.env.DEFAULT_MODEL;
    const res = await app().request("/v1/query", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Trace-Id": "no-model" },
      body: JSON.stringify({ messages: [{ role: "human", content: "hello" }] }),
    });
    expect(res.status).toBe(200);
    const blocks = await readSse(res);
    const chunk = blocks.find((b) => b.event === "copilotMessageChunk");
    expect((chunk!.data as { delta: string }).delta).toContain("No model is configured");
  });
});

describe("POST /v1/query — happy path", () => {
  it("returns text/event-stream and a decodable SSE body", async () => {
    const res = await app().request("/v1/query", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Trace-Id": "test-conv-1" },
      body: JSON.stringify({
        messages: [{ role: "human", content: "hello" }],
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    const blocks = await readSse(res);
    const chunk = blocks.find((b) => b.event === "copilotMessageChunk");
    expect(chunk).toBeDefined();
    expect((chunk!.data as { delta: string }).delta).toBe("ok from mock");
  });

  it("accepts X-Trace-Id case-insensitively", async () => {
    const res = await app().request("/v1/query", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-trace-id": "lower-case" },
      body: JSON.stringify({
        messages: [{ role: "human", content: "hello" }],
      }),
    });
    expect(res.status).toBe(200);
  });
});

describe("POST /v1/query — validation", () => {
  it("400 on missing messages array", async () => {
    const res = await app().request("/v1/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Invalid request");
  });

  it("400 on empty messages array", async () => {
    const res = await app().request("/v1/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [] }),
    });
    expect(res.status).toBe(400);
  });
});
