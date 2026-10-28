import { describe, it, beforeEach, afterEach, mock } from "node:test";
import { expect } from "expect";
import { llmEmitsText, makeMockLlm } from "../../helpers/mock-llm.ts";
import { below, seeded } from "../../helpers/rng.ts";

const realProviders = await import("../../../src/lib/providers.ts");
mock.module("../../../src/lib/providers.ts", { exports: {
  ...realProviders,
  resolveModel: () => makeMockLlm(llmEmitsText("ok")),
} });

const { createApp } = await import("../../../src/app.ts");
const { loadConfig } = await import("../../../src/lib/config.ts");
const { createLimits } = await import("../../../src/auth/limits.ts");
const { createLocalStore } = await import("../../../src/lib/store.ts");
const store = createLocalStore();
const { renderMetrics } = await import("../../../src/lib/metrics.ts");
const { clearAllModuleState } = await import("../../helpers/clear-state.ts");
import type { WorkspaceClient } from "../../../src/auth/workspace-client.ts";

const workspace: WorkspaceClient = {
  async getUser(token) {
    return token === "alice-token" ? { ok: true, value: { userId: "alice" } } : { ok: false, reason: "rejected" };
  },
  async recordQuery() {
    return { ok: true, value: undefined };
  },
  async recordTokens() {},
  async authorize() {
    return { ok: true, value: { allowed: true, deniedModel: null, deniedTools: [], disabledCapabilities: [] } };
  },
  async ready() {
    return true;
  },
};

const config = loadConfig({
  WORKSPACE_API_URL: "http://api:8000",
  WORKSPACE_ORIGIN: "http://localhost:3000",
  INES_METERING_TOKEN: "metering-token",
  INES_SCOPE_SECRET: "0123456789abcdef0123",
  INES_CORS_ORIGINS: "http://localhost:3000",
  DEFAULT_MODEL: "test-provider:test-model",
  INES_MAX_CONCURRENT_QUERIES: "1000",
  INES_INVALID_REQUESTS_PER_MINUTE: "100000",
});
const app = createApp({
  config,
  workspace,
  store,
  limits: createLimits({ store, maxConcurrent: 1000, maxInvalidPerMinute: 100_000, maxHelperCallsPerMinute: 100_000 }),
});

const widget = (i: number) => ({ uuid: `w${i}`, name: `Widget ${i}`, widget_id: `id${i}`, origin: "o", description: "d", params: [], metadata: {} });
const valid = () => ({
  messages: [
    { role: "human", content: "hello" },
    { role: "ai", content: "hi there" },
    { role: "human", content: "what do I have?" },
  ],
  widgets: {
    primary: [{ ...widget(1), mcp_tool: { server_id: "s", tool_name: "web_search", args: { query: "$q", region: "eu" } } }],
    secondary: [widget(2)],
    extra: [],
  },
  context: [{ type: "text", text: "notes" }],
  urls: [],
  timezone: "Europe/Madrid",
  workspace_state: { current_page_context: "dashboard" },
  workspace_options: { "prompt-suggestions": true },
  tools: [{ name: "Ines Tools_web_search", tool_name: "web_search", server_id: "s", url: "http://ines-mcp:8787/mcp", description: "d", input_schema: { properties: { query: { type: "string" } }, required: ["query"] } }],
  documents: [],
});

const ODD_STRINGS = [
  "", " ", "\u0000", "\ud800", "‮", "x".repeat(100_000), "<|start_artifact|>".repeat(5000), "![".repeat(5000), "<suggestions>", "```mermaid\n", "{\"a\":", "__proto__", "constructor", "../../etc/passwd", "%s%n", "'; DROP TABLE x;--",
];

function oddValue(random: () => number, depth = 0): unknown {
  switch (below(random, 12)) {
    case 0: return null;
    case 1: return below(random, 2) === 0;
    case 2: return [0, -1, 1.5, 1e308, -1e308, Number.MAX_SAFE_INTEGER][below(random, 6)];
    case 3: return ODD_STRINGS[below(random, ODD_STRINGS.length)];
    case 4: return [];
    case 5: return {};
    case 6: return depth > 4 ? 0 : Array.from({ length: below(random, 5) }, () => oddValue(random, depth + 1));
    case 7: return depth > 4 ? 0 : Object.fromEntries(Array.from({ length: below(random, 5) }, (_, i) => [`k${i}`, oddValue(random, depth + 1)]));
    case 8: { let nested: unknown = 1; for (let i = 0; i < 50 + below(random, 400); i++) nested = [nested]; return nested; }
    case 9: return Array.from({ length: 2000 }, (_, i) => i);
    case 10: return "x".repeat(below(random, 3_000_000));
    default: return undefined;
  }
}

function paths(value: unknown, prefix: (string | number)[] = [], depth = 0): (string | number)[][] {
  if (depth > 3 || value === null || typeof value !== "object") return [prefix];
  const entries = Array.isArray(value) ? value.map((_, i) => i) : Object.keys(value);
  return [prefix, ...entries.flatMap((key) => paths((value as Record<string | number, unknown>)[key], [...prefix, key], depth + 1))];
}

function mutate(random: () => number): string {
  const body = valid() as Record<string, unknown>;
  for (let n = 1 + below(random, 4); n > 0; n--) {
    const all = paths(body).filter((p) => p.length > 0);
    const path = all[below(random, all.length)];
    let target: Record<string | number, unknown> = body;
    for (const key of path.slice(0, -1)) target = target[key] as Record<string | number, unknown>;
    const last = path.at(-1)!;
    if (below(random, 6) === 0) delete target[last];
    else target[last] = oddValue(random);
  }
  return JSON.stringify(body) ?? "null";
}

const unhandledCount = () => {
  return [...renderMetrics().matchAll(/^ines_unhandled_errors_total\{[^}]*\} ([0-9.e+-]+)$/gm)].reduce((n, m) => n + Number(m[1]), 0);
};

const send = (body: string, token = "alice-token", chat = "fuzz-chat") =>
  app.request("/v1/query", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Trace-Id": chat, Authorization: `Bearer ${token}` },
    body,
  });

const savedDefaultModel = process.env.DEFAULT_MODEL;
beforeEach(() => {
  clearAllModuleState();
  process.env.DEFAULT_MODEL = "test-provider:test-model";
});
afterEach(() => {
  if (savedDefaultModel === undefined) delete process.env.DEFAULT_MODEL;
  else process.env.DEFAULT_MODEL = savedDefaultModel;
});

describe("questions that are made to be wrong", () => {
  it("are refused or answered, never a crash, never a hang, whatever is wrong in them", { timeout: 600_000 }, async () => {
    const random = seeded(Number(process.env.FUZZ_SEED ?? 2026));
    const iterations = Number(process.env.FUZZ_ITERATIONS ?? 400);
    const unhandledBefore = unhandledCount();
    const statuses = new Map<number, number>();
    for (let i = 0; i < iterations; i++) {
      const body = mutate(random);
      const started = performance.now();
      const res = await send(body, "alice-token", `fuzz-${i}`);
      const text = await res.text();
      const took = performance.now() - started;
      statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1);
      if (res.status >= 500 || took > 5000) {
        throw new Error(`request ${i} gave ${res.status} in ${Math.round(took)} ms: ${text.slice(0, 200)}\nbody: ${body.slice(0, 300)}`);
      }
    }
    expect([...statuses.keys()].every((s) => [200, 400, 413, 429].includes(s))).toBe(true);
    expect(statuses.get(200) ?? 0).toBeGreaterThan(10);
    expect(statuses.get(400) ?? 0).toBeGreaterThan(10);
    expect(unhandledCount()).toBe(unhandledBefore);
  });

  it("are refused when they are not JSON at all, in any way a client can make them", async () => {
    const random = seeded(7);
    const pieces = ["{", "}", "[", "]", "\"", ":", ",", "null", "\\", "\u0000", "﻿", "{\"messages\":", "{\"messages\":[{\"role\":\"human\",\"content\":\"hi\"}]}"];
    for (let i = 0; i < 300; i++) {
      let body = "";
      for (let n = 1 + below(random, 12); n > 0; n--) body += pieces[below(random, pieces.length)];
      const res = await send(body);
      await res.text();
      expect(res.status).toBeLessThan(500);
    }
  });

  it("leave the agent answering the next, ordinary question", async () => {
    const res = await send(JSON.stringify(valid()));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("ok");
  });
});
