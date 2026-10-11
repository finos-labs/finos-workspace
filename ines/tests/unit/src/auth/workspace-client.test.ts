import { describe, it, expect } from "bun:test";
import { createWorkspaceClient } from "../../../../src/auth/workspace-client";

interface Seen {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
}

function clientAnswering(respond: (seen: Seen) => Response | Promise<Response>) {
  const calls: Seen[] = [];
  const client = createWorkspaceClient({
    apiUrl: "http://api:8000",
    meteringToken: "metering-secret",
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const seen: Seen = {
        url: String(input),
        method: init?.method ?? "GET",
        headers: new Headers(init?.headers),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(seen);
      return respond(seen);
    }) as typeof fetch,
  });
  return { client, calls };
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

describe("getUser", () => {
  it("asks the Workspace API who the token belongs to, with the user's own token and nothing else", async () => {
    const { client, calls } = clientAnswering(() => json({ uuid: "11111111-2222-3333-4444-555555555555", email: "x@example.com" }));
    expect(await client.getUser("user-token")).toEqual({ ok: true, value: { userId: "11111111-2222-3333-4444-555555555555" } });
    expect(calls[0].url).toBe("http://api:8000/app/user");
    expect(calls[0].method).toBe("GET");
    expect(calls[0].headers.get("authorization")).toBe("Bearer user-token");
    expect(calls[0].headers.get("x-metering-authorization")).toBeNull();
  });

  it("is rejected for a token the Workspace refuses", async () => {
    for (const status of [401, 403]) {
      const { client } = clientAnswering(() => json({ detail: "no" }, status));
      expect(await client.getUser("t")).toEqual({ ok: false, reason: "rejected" });
    }
  });

  it("is unavailable when the Workspace fails, answers nonsense or cannot be reached", async () => {
    expect(await clientAnswering(() => json({}, 500)).client.getUser("t")).toEqual({ ok: false, reason: "unavailable" });
    expect(await clientAnswering(() => json({ nothing: true })).client.getUser("t")).toEqual({ ok: false, reason: "unavailable" });
    const unreachable = createWorkspaceClient({
      apiUrl: "http://api:8000",
      meteringToken: "m",
      fetch: (() => Promise.reject(new Error("connection refused"))) as unknown as typeof fetch,
    });
    expect(await unreachable.getUser("t")).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("recordQuery", () => {
  it("counts one query, with the user's token and the metering token", async () => {
    const { client, calls } = clientAnswering(() => json({ number_copilot_calls_day_count: 1 }));
    expect(await client.recordQuery("user-token")).toEqual({ ok: true, value: undefined });
    expect(calls[0].url).toBe("http://api:8000/app/usage");
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].body).toEqual({ add_copilot_count: 1 });
    expect(calls[0].headers.get("authorization")).toBe("Bearer user-token");
    expect(calls[0].headers.get("x-metering-authorization")).toBe("Bearer metering-secret");
  });

  it("reports the daily limit in the Workspace's own words", async () => {
    const { client } = clientAnswering(() =>
      json({ error: "Maximum usage limit reached", message: "Cannot increment usage beyond the maximum limit of 50", current_usage: 50 }, 422),
    );
    expect(await client.recordQuery("t")).toEqual({
      ok: false,
      reason: "limit",
      message: "Cannot increment usage beyond the maximum limit of 50",
    });
  });

  it("is rejected for a bad token and unavailable on a server error", async () => {
    expect(await clientAnswering(() => json({}, 401)).client.recordQuery("t")).toEqual({ ok: false, reason: "rejected" });
    expect(await clientAnswering(() => json({}, 502)).client.recordQuery("t")).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("recordTokens", () => {
  it("adds the tokens and nothing else", async () => {
    const { client, calls } = clientAnswering(() => json({}));
    await client.recordTokens("t", 1234.4);
    expect(calls[0].body).toEqual({ add_copilot_tokens: 1234 });
    expect(calls[0].headers.get("x-metering-authorization")).toBe("Bearer metering-secret");
  });

  it("makes no call for no tokens, and never throws when the Workspace fails", async () => {
    const quiet = clientAnswering(() => json({}));
    await quiet.client.recordTokens("t", 0);
    expect(quiet.calls).toHaveLength(0);
    await clientAnswering(() => json({}, 500)).client.recordTokens("t", 5);
    const unreachable = createWorkspaceClient({
      apiUrl: "http://api:8000",
      meteringToken: "m",
      fetch: (() => Promise.reject(new Error("down"))) as unknown as typeof fetch,
    });
    await unreachable.recordTokens("t", 5);
  });
});

describe("authorize", () => {
  it("sends the agent, the model and the tools, and reads what is denied", async () => {
    const { client, calls } = clientAnswering(() =>
      json({ allowed: false, denied_model: "nvidia:x", denied_tools: [{ url: "http://tools/mcp", tool_name: "execute_code" }] }),
    );
    const result = await client.authorize("t", {
      agentId: "default_agent",
      model: "nvidia:x",
      tools: [{ url: "http://tools/mcp", toolName: "execute_code" }],
    });
    expect(calls[0].url).toBe("http://api:8000/app/copilot/authorize");
    expect(calls[0].body).toEqual({
      agent_id: "default_agent",
      model: "nvidia:x",
      tools: [{ url: "http://tools/mcp", tool_name: "execute_code" }],
    });
    expect(calls[0].headers.get("x-metering-authorization")).toBe("Bearer metering-secret");
    expect(result).toEqual({
      ok: true,
      value: {
        allowed: false,
        deniedModel: "nvidia:x",
        deniedTools: [{ url: "http://tools/mcp", toolName: "execute_code" }],
        disabledCapabilities: [],
      },
    });
  });

  it("carries what an administrator has switched off for the user, and only what it knows", async () => {
    const { client } = clientAnswering(() =>
      json({
        allowed: false,
        denied_tools: [{ url: "http://tools/mcp", tool_name: "web_search" }],
        disabled_capabilities: ["SEARCH_WEB", "SOMETHING_NEW", 7, "FETCH_FROM_WEB"],
      }),
    );
    const result = await client.authorize("t", { agentId: "default_agent", tools: [{ url: "http://tools/mcp", toolName: "web_search" }] });
    expect(result).toEqual({
      ok: true,
      value: {
        allowed: false,
        deniedModel: null,
        deniedTools: [{ url: "http://tools/mcp", toolName: "web_search" }],
        disabledCapabilities: ["SEARCH_WEB", "FETCH_FROM_WEB"],
      },
    });
  });

  it("takes an answer without the list (an older Workspace) as nothing being switched off", async () => {
    const { client } = clientAnswering(() => json({ allowed: true, denied_tools: [] }));
    const result = await client.authorize("t", { agentId: "default_agent", tools: [] });
    expect(result.ok && result.value.disabledCapabilities).toEqual([]);
  });

  it("allows a request the Workspace allows, and leaves out a model that was not named", async () => {
    const { client, calls } = clientAnswering(() => json({ allowed: true, denied_model: null, denied_tools: [] }));
    const result = await client.authorize("t", { agentId: "default_agent", tools: [] });
    expect(result).toEqual({ ok: true, value: { allowed: true, deniedModel: null, deniedTools: [], disabledCapabilities: [] } });
    expect(calls[0].body).toEqual({ agent_id: "default_agent", tools: [] });
  });

  it("is unavailable when the answer is not an authorization", async () => {
    expect(await clientAnswering(() => json({ unexpected: 1 })).client.authorize("t", { agentId: "a", tools: [] })).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});

describe("ready", () => {
  it("is whether the Workspace API's health check answers", async () => {
    expect(await clientAnswering(() => json({ status: "ok" })).client.ready()).toBe(true);
    expect(await clientAnswering(() => json({}, 503)).client.ready()).toBe(false);
  });
});
