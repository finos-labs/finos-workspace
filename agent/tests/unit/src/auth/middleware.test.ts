import { describe, it, expect } from "bun:test";
import { Hono } from "hono";
import {
  ANONYMOUS,
  authMiddleware,
  createAuthCache,
  createSignIn,
  servicesMiddleware,
  type AppEnv,
  type Services,
} from "../../../../src/auth/middleware";
import { createLimits } from "../../../../src/auth/limits";
import { createLocalStore } from "../../../../src/lib/store";
import type { Result, WorkspaceClient } from "../../../../src/auth/workspace-client";

function workspaceStub(users: Record<string, Result<{ userId: string }>>) {
  const asked: string[] = [];
  const workspace: WorkspaceClient = {
    async getUser(token) {
      asked.push(token);
      return users[token] ?? { ok: false, reason: "rejected" };
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
  return { workspace, asked };
}

function appWith(workspace: WorkspaceClient | null, cacheSeconds = 30, now = Date.now) {
  const store = createLocalStore(now);
  const services = {
    config: {} as Services["config"],
    workspace,
    store,
    limits: createLimits({ store, maxConcurrent: 4 }),
  } satisfies Services;
  const app = new Hono<AppEnv>();
  app.use("/v1/*", servicesMiddleware(services), authMiddleware(services, createAuthCache(store, cacheSeconds)));
  app.get("/v1/me", (c) => c.json({ userId: c.get("principal").userId, hasToken: Boolean(c.get("principal").token) }));
  app.get("/open", (c) => c.text("open"));
  return app;
}

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

describe("authMiddleware — workspace auth", () => {
  it("lets in a user the Workspace API recognises and tells the route who they are", async () => {
    const { workspace } = workspaceStub({ good: { ok: true, value: { userId: "user-1" } } });
    const res = await appWith(workspace).request("/v1/me", bearer("good"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: "user-1", hasToken: true });
  });

  it("refuses a request without a token, with a challenge", async () => {
    const { workspace, asked } = workspaceStub({});
    const res = await appWith(workspace).request("/v1/me");
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
    expect(asked).toHaveLength(0);
  });

  it("refuses a token the Workspace API rejects, and anything that is not a bearer token", async () => {
    const { workspace } = workspaceStub({});
    expect((await appWith(workspace).request("/v1/me", bearer("forged"))).status).toBe(401);
    expect((await appWith(workspace).request("/v1/me", { headers: { Authorization: "Basic abc" } })).status).toBe(401);
  });

  it("does not trust the X-User-Id header", async () => {
    const { workspace } = workspaceStub({ good: { ok: true, value: { userId: "user-1" } } });
    const res = await appWith(workspace).request("/v1/me", {
      headers: { Authorization: "Bearer good", "X-User-Id": "someone-else" },
    });
    expect(((await res.json()) as { userId: string }).userId).toBe("user-1");
  });

  it("fails closed with a 503 when the Workspace API cannot be asked", async () => {
    const { workspace } = workspaceStub({ t: { ok: false, reason: "unavailable" } });
    const res = await appWith(workspace).request("/v1/me", bearer("t"));
    expect(res.status).toBe(503);
  });

  it("leaves routes outside /v1 alone", async () => {
    const { workspace } = workspaceStub({});
    expect((await appWith(workspace).request("/open")).status).toBe(200);
  });

  it("asks the Workspace API once for a token it saw a moment ago, and again after the cache expires", async () => {
    let now = 1_000_000;
    const { workspace, asked } = workspaceStub({ good: { ok: true, value: { userId: "user-1" } } });
    const app = appWith(workspace, 30, () => now);
    await app.request("/v1/me", bearer("good"));
    await app.request("/v1/me", bearer("good"));
    expect(asked).toHaveLength(1);
    now += 31_000;
    await app.request("/v1/me", bearer("good"));
    expect(asked).toHaveLength(2);
  });

  it("remembers a refusal only for a few seconds, so that a token that is good a moment later is asked about again", async () => {
    let now = 5_000_000;
    const users: Record<string, Result<{ userId: string }>> = {};
    const { workspace, asked } = workspaceStub(users);
    const app = appWith(workspace, 30, () => now);
    expect((await app.request("/v1/me", bearer("late"))).status).toBe(401);
    users.late = { ok: true, value: { userId: "user-1" } };
    expect((await app.request("/v1/me", bearer("late"))).status).toBe(401); // still the answer of a moment ago
    expect(asked).toHaveLength(1);
    now += 11_000;
    expect((await app.request("/v1/me", bearer("late"))).status).toBe(200);
    expect(asked).toHaveLength(2);
  });

  it("asks every time when the cache is off", async () => {
    const { workspace, asked } = workspaceStub({ good: { ok: true, value: { userId: "user-1" } } });
    const app = appWith(workspace, 0);
    await app.request("/v1/me", bearer("good"));
    await app.request("/v1/me", bearer("good"));
    expect(asked).toHaveLength(2);
  });
});

describe("authMiddleware — without a Workspace API", () => {
  it("treats everyone as anonymous", async () => {
    const res = await appWith(null).request("/v1/me");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: ANONYMOUS.userId, hasToken: false });
  });
});

describe("createAuthCache", () => {
  it("remembers a token's user until the time it was given runs out", async () => {
    let now = 1_000_000;
    const cache = createAuthCache(createLocalStore(() => now), 30);
    await cache.set("a-token", "alice");
    expect(await cache.get("a-token")).toBe("alice");
    now += 31_000;
    expect(await cache.get("a-token")).toBeNull();
  });

  it("keeps the token itself out of the store: what is kept is its hash", async () => {
    const store = createLocalStore();
    const cache = createAuthCache(store, 30);
    await cache.set("a-secret-session-token", "alice");
    // Asked under the token itself, the store has nothing; only the cache knows how to look it up.
    expect(await store.get("auth:a-secret-session-token")).toBeNull();
    expect(await cache.get("a-secret-session-token")).toBe("alice");
  });

  it("remembers nothing at all when it is given no time to remember it for", async () => {
    const cache = createAuthCache(createLocalStore(), 0);
    await cache.set("a-token", "alice");
    expect(await cache.get("a-token")).toBeNull();
    await cache.reject("a-token");
    expect(await cache.rejected("a-token")).toBe(false);
  });
});

describe("signing in callers the cache does not know", () => {
  it("asks the API once for a token that is turned down, however often it is sent, until a few seconds have passed", async () => {
    let now = 1_000_000;
    const stub = workspaceStub({});
    const app = appWith(stub.workspace, 30, () => now);
    for (let i = 0; i < 5; i++) expect((await app.request("/v1/me", bearer("forged-token"))).status).toBe(401);
    expect(stub.asked).toEqual(["forged-token"]);
    now += 11_000;
    expect((await app.request("/v1/me", bearer("forged-token"))).status).toBe(401);
    expect(stub.asked).toEqual(["forged-token", "forged-token"]);
  });

  it("does not remember a turned-down token when users are not remembered at all", async () => {
    const stub = workspaceStub({});
    const app = appWith(stub.workspace, 0);
    await app.request("/v1/me", bearer("forged-token"));
    await app.request("/v1/me", bearer("forged-token"));
    expect(stub.asked).toHaveLength(2);
  });

  it("does not let a turned-down token take the place of another: a token that is good is still signed in", async () => {
    const stub = workspaceStub({ "good-token": { ok: true, value: { userId: "alice" } } });
    const app = appWith(stub.workspace);
    expect((await app.request("/v1/me", bearer("bad-token"))).status).toBe(401);
    const good = await app.request("/v1/me", bearer("good-token"));
    expect(good.status).toBe(200);
    expect(await good.json()).toEqual({ userId: "alice", hasToken: true });
  });

  it("does not ask about a token longer than a session token is", async () => {
    const stub = workspaceStub({});
    const res = await appWith(stub.workspace).request("/v1/me", bearer("a".repeat(5000)));
    expect(res.status).toBe(401);
    expect(stub.asked).toHaveLength(0);
  });

  it("asks the API one question for one token however many requests carry it at once", async () => {
    let calls = 0;
    const { workspace } = workspaceStub({});
    const slow: WorkspaceClient = {
      ...workspace,
      async getUser() {
        calls++;
        await new Promise((r) => setTimeout(r, 30));
        return { ok: true, value: { userId: "alice" } };
      },
    };
    const app = appWith(slow, 0); // no memory of users: only the single flight is in the way
    const answers = await Promise.all(Array.from({ length: 50 }, () => app.request("/v1/me", bearer("same-token"))));
    expect(answers.every((a) => a.status === 200)).toBe(true);
    expect(calls).toBe(1);
  });

  it("asks the API about so many tokens at once and no more, lets some wait, and tells the rest it is busy", async () => {
    let inFlight = 0;
    let mostInFlight = 0;
    let calls = 0;
    const { workspace } = workspaceStub({});
    const slow: WorkspaceClient = {
      ...workspace,
      async getUser(token) {
        calls++;
        mostInFlight = Math.max(mostInFlight, ++inFlight);
        await new Promise((r) => setTimeout(r, 20));
        inFlight--;
        return { ok: false, reason: "rejected" };
      },
    };
    const signIn = createSignIn(slow, { maxConcurrent: 4, maxWaiting: 6 });
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => signIn(`token-${i}`)));
    expect(mostInFlight).toBe(4);
    const busy = results.filter((r) => !r.ok && r.reason === "busy").length;
    expect(calls).toBe(10); // 4 running and 6 waiting
    expect(busy).toBe(20);
    // And when it is over, it asks again.
    expect(await signIn("token-again")).toEqual({ ok: false, reason: "rejected" });
  });

  it("answers 503 with Retry-After to the callers it has no room for, and a user who was remembered is not one of them", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { workspace } = workspaceStub({});
    const stalled: WorkspaceClient = {
      ...workspace,
      async getUser(token) {
        if (token === "known") return { ok: true, value: { userId: "alice" } };
        await gate;
        return { ok: false, reason: "rejected" };
      },
    };
    const store = createLocalStore();
    const services = { config: {} as Services["config"], workspace: stalled, store, limits: createLimits({ store, maxConcurrent: 4 }) } satisfies Services;
    const app = new Hono<AppEnv>();
    const cache = createAuthCache(store, 30);
    await cache.set("remembered", "alice");
    app.use("/v1/*", servicesMiddleware(services), authMiddleware(services, cache));
    app.get("/v1/me", (c) => c.json({ userId: c.get("principal").userId }));

    // 32 asking and 256 waiting is all there is room for: the next one is told to try again.
    const flood = Array.from({ length: 32 + 256 }, (_, i) => app.request("/v1/me", bearer(`made-up-${i}`)));
    await new Promise((r) => setTimeout(r, 50));
    const refused = await app.request("/v1/me", bearer("one-more"));
    expect(refused.status).toBe(503);
    expect(refused.headers.get("retry-after")).toBe("1");
    // A user the agent remembers does not wait for the API at all.
    const remembered = await app.request("/v1/me", bearer("remembered"));
    expect(remembered.status).toBe(200);
    release();
    expect((await Promise.all(flood)).every((r) => r.status === 401)).toBe(true);
  });
});
