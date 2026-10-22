/**
 * Tier 2 — the helper routes (/v1/generate/*, /v1/enhance_prompt) follow the rules of a question.
 *
 * They make a model call with the operator's provider keys on behalf of the signed-in user, so a client's
 * `model` is a request (the deployment must offer it and the user's roles must allow it), the tokens are
 * counted against the user, and a body that is not JSON or is far too long is refused or cut, not paid for.
 */

import { describe, it, beforeEach, afterEach, mock } from "node:test";
import { expect } from "expect";

// What each model call was given. lib/llm is replaced rather than the providers it uses: a module mock lasts
// for the whole run, so the file that loads first decides what the others see.
interface Call {
  prompt: string;
  model?: string;
  maxTokens?: number;
}
const calls: Call[] = [];
mock.module("../../../src/lib/llm.ts", { exports: {
  singleShotLlm: async (
    prompt: string,
    opts?: { model?: string; maxTokens?: number; onUsage?: (u: { inputTokens: number; outputTokens: number; totalTokens: number }) => void },
  ) => {
    calls.push({ prompt, model: opts?.model, maxTokens: opts?.maxTokens });
    // As the real one: no model asked for and none configured is a failure.
    if (!(opts?.model || process.env.DEFAULT_MODEL)) throw new Error("No model configured: set DEFAULT_MODEL.");
    opts?.onUsage?.({ inputTokens: 1, outputTokens: 1, totalTokens: 2 });
    return "A title";
  },
  parseJsonResponse: <T>(raw: string, fallback: T): T => {
    const cleaned = raw.replace(/^```json\n?/, "").replace(/\n?```$/, "");
    try {
      return JSON.parse(cleaned) as T;
    } catch {
      return fallback;
    }
  },
  truncate: (s: string, max: number) => (s.length > max ? s.slice(0, max) + "..." : s),
} });

const { createApp } = await import("../../../src/app.ts");
const { loadConfig } = await import("../../../src/lib/config.ts");
const { createLimits } = await import("../../../src/auth/limits.ts");
const { createLocalStore } = await import("../../../src/lib/store.ts");
import type { Authorization, Result, WorkspaceClient } from "../../../src/auth/workspace-client.ts";

const ENV = {
  WORKSPACE_API_URL: "http://api:8000",
  WORKSPACE_ORIGIN: "http://localhost:3000",
  INES_METERING_TOKEN: "metering-token",
  INES_SCOPE_SECRET: "0123456789abcdef0123",
  INES_CORS_ORIGINS: "http://localhost:3000",
  DEFAULT_MODEL: "test-provider:test-model",
  INES_MODELS: "test-provider:other-model,test-provider:role-denied",
};

function setup(extraEnv: Record<string, string> = {}) {
  const authorized: { model?: string; tools: unknown[] }[] = [];
  const tokens: [string, number][] = [];
  let authorization: (model?: string) => Result<Authorization> = () => ({ ok: true, value: { allowed: true, deniedModel: null, deniedTools: [], disabledCapabilities: [] } });
  const workspace: WorkspaceClient = {
    async getUser(token) {
      const users: Record<string, string> = { "alice-token": "alice", "bob-token": "bob" };
      return users[token] ? { ok: true, value: { userId: users[token] } } : { ok: false, reason: "rejected" };
    },
    async recordQuery() {
      return { ok: true, value: undefined };
    },
    async recordTokens(token, n) {
      tokens.push([token, n]);
    },
    async authorize(_token, request) {
      authorized.push({ model: request.model, tools: request.tools });
      return authorization(request.model);
    },
    async ready() {
      return true;
    },
  };
  const config = loadConfig({ ...ENV, ...extraEnv });
  const store = createLocalStore();
  const app = createApp({
    config,
    workspace,
    store,
    limits: createLimits({ store, maxConcurrent: config.maxConcurrentQueries, maxHelperCallsPerMinute: config.maxHelperCallsPerMinute }),
  });
  return {
    app,
    authorized,
    tokens,
    denyModel: (denied: string) =>
      void (authorization = (model) => ({ ok: true, value: { allowed: model !== denied, deniedModel: model === denied ? denied : null, deniedTools: [], disabledCapabilities: [] } })),
  };
}

const post = (app: ReturnType<typeof setup>["app"], path: string, body: unknown, token: string | null = "alice-token") =>
  app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const TITLE = "/v1/generate/chat/title";
const titleBody = (model?: string) => ({ messages: [{ role: "human", content: "How are my holdings doing?" }], ...(model ? { model } : {}) });
const promptSent = () => calls.at(-1)?.prompt ?? "";
const modelsUsed = () => calls.map((call) => call.model);

let savedDefault: string | undefined;
beforeEach(() => {
  savedDefault = process.env.DEFAULT_MODEL;
  process.env.DEFAULT_MODEL = "test-provider:test-model";
  calls.length = 0;
});
afterEach(() => {
  if (savedDefault === undefined) delete process.env.DEFAULT_MODEL;
  else process.env.DEFAULT_MODEL = savedDefault;
});

describe("the model of a helper", () => {
  it("is the default when the client names none", async () => {
    const t = setup();
    const res = await post(t.app, TITLE, titleBody());
    expect(res.status).toBe(200);
    expect(modelsUsed()).toEqual(["test-provider:test-model"]);
    expect(t.authorized).toHaveLength(0);
  });

  it("is the default when the client names a model the deployment does not offer", async () => {
    const t = setup();
    await post(t.app, TITLE, titleBody("openai:an-expensive-model"));
    expect(modelsUsed()).toEqual(["test-provider:test-model"]);
    // The Workspace is not even asked about a model that is not offered here.
    expect(t.authorized).toHaveLength(0);
  });

  it("is the model the client names when the deployment offers it and the user's roles allow it", async () => {
    const t = setup();
    await post(t.app, TITLE, titleBody("test-provider:other-model"));
    expect(modelsUsed()).toEqual(["test-provider:other-model"]);
    expect(t.authorized).toEqual([{ model: "test-provider:other-model", tools: [] }]);
  });

  it("is the default when the client names a model that the user's roles do not allow", async () => {
    const t = setup();
    t.denyModel("test-provider:role-denied");
    await post(t.app, TITLE, titleBody("test-provider:role-denied"));
    expect(t.authorized).toHaveLength(1);
    expect(modelsUsed()).toEqual(["test-provider:test-model"]);
  });

  it("holds for every helper route", async () => {
    const t = setup();
    const routes: [string, unknown][] = [
      ["/v1/enhance_prompt", { messages: [{ role: "human", content: "tell me" }], model: "openai:x" }],
      ["/v1/generate/dashboard/title", { widgets: [{ name: "Prices" }], model: "openai:x" }],
      ["/v1/generate/code", { widget_uuid: "w", user_prompt: "sum it", language: "sql", model: "openai:x" }],
      ["/v1/generate/widget_info", { widget_generation_request: { widget_data: "a,b" }, model: "openai:x" }],
    ];
    for (const [path, body] of routes) {
      calls.length = 0;
      const res = await post(t.app, path, body);
      expect(res.status).toBe(200);
      expect(modelsUsed()).toEqual(["test-provider:test-model"]);
    }
  });
});

describe("the tokens of a helper", () => {
  it("count against the user who asked", async () => {
    const t = setup();
    await post(t.app, TITLE, titleBody());
    expect(t.tokens).toEqual([["alice-token", 2]]);
  });

  it("are counted for the file helper too", async () => {
    const t = setup();
    const form = new FormData();
    form.append("file", new File(["a,b\n1,2"], "data.csv", { type: "text/csv" }));
    const res = await t.app.request("/v1/generate/widget_info/file", { method: "POST", headers: { Authorization: "Bearer alice-token" }, body: form });
    expect(res.status).toBe(200);
    expect(t.tokens).toHaveLength(1);
  });
});

describe("who may use a helper", () => {
  it("only a signed-in user", async () => {
    const t = setup();
    for (const path of [TITLE, "/v1/enhance_prompt", "/v1/generate/code", "/v1/generate/dashboard/title", "/v1/generate/widget_info"]) {
      expect((await post(t.app, path, titleBody(), null)).status).toBe(401);
    }
    expect(calls).toHaveLength(0);
  });
});

describe("what a helper is given", () => {
  it("is refused when it is not JSON", async () => {
    const t = setup();
    for (const path of [TITLE, "/v1/enhance_prompt", "/v1/generate/code", "/v1/generate/dashboard/title", "/v1/generate/widget_info"]) {
      const res = await post(t.app, path, "{not json");
      expect(res.status).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });

  it("is refused when it is not a form, for the file helper", async () => {
    const t = setup();
    const res = await t.app.request("/v1/generate/widget_info/file", {
      method: "POST",
      headers: { Authorization: "Bearer alice-token", "Content-Type": "multipart/form-data; boundary=x" },
      body: "garbage",
    });
    expect(res.status).toBe(400);
  });

  it("is cut when it is a long question: the model is given the start of it", async () => {
    const t = setup();
    await post(t.app, "/v1/enhance_prompt", { messages: [{ role: "human", content: `START ${"q".repeat(500_000)} END` }] });
    expect(promptSent().length).toBeLessThan(6_000);
    expect(promptSent()).toContain("START");
    expect(promptSent()).not.toContain("END");
  });

  it("is cut when it is long code, and refused when the instruction is absurd", async () => {
    const t = setup();
    await post(t.app, "/v1/generate/code", {
      widget_uuid: "w",
      user_prompt: "refactor",
      language: "python",
      current_code: `${"x = 1\n".repeat(200_000)}LAST_LINE`,
      sql_schema: { big: "s".repeat(500_000) },
    });
    expect(promptSent().length).toBeLessThan(60_000);
    expect(promptSent()).not.toContain("LAST_LINE");

    const res = await post(t.app, "/v1/generate/code", { widget_uuid: "w", user_prompt: "p".repeat(30_000), language: "sql" });
    expect(res.status).toBe(400);
  });

  it("is refused when it is a model name that is absurd", async () => {
    const t = setup();
    expect((await post(t.app, TITLE, titleBody("m".repeat(500)))).status).toBe(400);
  });
});

describe("a helper with no model at all", () => {
  it("falls back to what it returns when it fails, and says nothing it should not", async () => {
    const t = setup();
    delete process.env.DEFAULT_MODEL;
    const res = await post(t.app, TITLE, titleBody("openai:not-offered"));
    expect(res.status).toBe(200);
    // The call was made without a model: the real singleShotLlm refuses it, and the route answers its fallback.
    expect(modelsUsed()).toEqual([undefined]);
  });
});

describe("how often a user may call a helper", () => {
  it("is so many times a minute, then 429, and no model is paid for", async () => {
    const t = setup({ INES_HELPER_CALLS_PER_MINUTE: "3" });
    for (let i = 0; i < 3; i++) {
      expect(await (await post(t.app, TITLE, titleBody())).json()).toBe("A title");
    }
    expect(calls).toHaveLength(3);
    const refused = await post(t.app, TITLE, titleBody());
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("60");
    expect(calls).toHaveLength(3);
    // The tokens of the calls that were made are counted, none are for the one that was not.
    expect(t.tokens).toHaveLength(3);
  });

  it("is counted for each user, and for all the helpers together", async () => {
    const t = setup({ INES_HELPER_CALLS_PER_MINUTE: "2" });
    expect((await post(t.app, TITLE, titleBody())).status).toBe(200);
    expect((await post(t.app, "/v1/enhance_prompt", { messages: [{ role: "human", content: "hello" }] })).status).toBe(200);
    expect((await post(t.app, TITLE, titleBody())).status).toBe(429);
    expect((await post(t.app, "/v1/generate/dashboard/title", { widgets: [] })).status).toBe(429);
    // Another user has their own.
    expect((await post(t.app, TITLE, titleBody(), "bob-token")).status).toBe(200);
  });

  it("is checked before the body is read: a user over it is turned away at no cost, whatever they send", async () => {
    const t = setup({ INES_HELPER_CALLS_PER_MINUTE: "1" });
    await post(t.app, TITLE, titleBody());
    expect((await post(t.app, TITLE, "{ not json")).status).toBe(429);
    expect((await post(t.app, "/v1/generate/code", { nonsense: true })).status).toBe(429);
  });

  it("is not asked of a caller who is not signed in", async () => {
    const t = setup({ INES_HELPER_CALLS_PER_MINUTE: "1" });
    expect((await post(t.app, TITLE, titleBody(), null)).status).toBe(401);
    expect((await post(t.app, TITLE, titleBody())).status).toBe(200);
  });
});

describe("how much a helper is sent", () => {
  it("is a few megabytes at most, where a question may be far more", async () => {
    const t = setup();
    const big = JSON.stringify({ messages: [{ role: "human", content: "x".repeat(9 * 1024 * 1024) }] });
    expect((await post(t.app, TITLE, big)).status).toBe(413);
    expect((await post(t.app, "/v1/enhance_prompt", big)).status).toBe(413);
    expect(calls).toHaveLength(0);
    // The same text is not too large for a question (it is refused for its shape, which is read).
    const question = await t.app.request("/v1/query", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer alice-token" },
      body: JSON.stringify({ messages: "no", pad: "x".repeat(9 * 1024 * 1024) }),
    });
    expect(question.status).toBe(400);
  });
});
