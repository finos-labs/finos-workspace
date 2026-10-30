import { describe, it, beforeEach, afterEach, mock } from "node:test";
import { expect } from "expect";

import { makeMockLlm, llmEmitsText } from "../../helpers/mock-llm.ts";

const realProviders = await import("../../../src/lib/providers.ts");
mock.module("../../../src/lib/providers.ts", { exports: {
  ...realProviders,
  resolveModel: () => makeMockLlm(llmEmitsText("ok from mock")),
} });

const { Hono } = await import("hono");
const { queryRouter } = await import("../../../src/routes/query.ts");
const { readSse } = await import("../../helpers/sse-reader.ts");
const { clearAllModuleState } = await import("../../helpers/clear-state.ts");
const { bodyBudget } = await import("../../../src/lib/body-budget.ts");

function app() {
  const a = new Hono();
  a.route("/", queryRouter);
  return a;
}

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

describe("POST /v1/query — memory held by requests", () => {
  const post = (headers: Record<string, string> = {}) =>
    app().request("/v1/query", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Trace-Id": "budget", ...headers },
      body: JSON.stringify({ messages: [{ role: "human", content: "hello" }] }),
    });

  it("turns a request away with 503 and Retry-After when the requests already held leave no room", async () => {
    const held = bodyBudget.reserve(Math.floor(bodyBudget.capacity / 3));
    try {
      const res = await post({ "Content-Length": String(Math.floor(bodyBudget.capacity / 3)) });
      expect(res.status).toBe(503);
      expect(res.headers.get("Retry-After")).toBe("5");
      expect(((await res.json()) as { error: string }).error).toContain("busy");
    } finally {
      held?.();
    }
  });

  it("holds the room for the life of the answer and gives it back when the answer ends", async () => {
    const res = await post({ "Content-Length": "1000" });
    expect(res.status).toBe(200);
    expect(bodyBudget.held).toBe(3000);
    await readSse(res);
    expect(bodyBudget.held).toBe(0);
  });

  it("gives the room back when the request is refused before an answer starts", async () => {
    const res = await app().request("/v1/query", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": "2" },
      body: "{}",
    });
    expect(res.status).toBe(400);
    expect(bodyBudget.held).toBe(0);
  });

  it("counts a request without a declared size as the largest body that may be sent", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(bodyBudget.held).toBeGreaterThanOrEqual(64 * 1024 * 1024 * 3);
    await readSse(res);
    expect(bodyBudget.held).toBe(0);
  });
});
