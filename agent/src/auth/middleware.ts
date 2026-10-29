import { createHash } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { getLogger, withContext } from "../lib/logger.ts";
import { metrics } from "../lib/metrics.ts";
import type { ServerConfig } from "../lib/config.ts";
import type { Limits } from "./limits.ts";
import type { Store } from "../lib/store.ts";
import type { WorkspaceClient } from "./workspace-client.ts";

const audit = getLogger(["audit"]);

export interface Principal {
  userId: string;
  token: string;
}

export interface Services {
  config: ServerConfig;
  workspace: WorkspaceClient | null;
  limits: Limits;
  store: Store;
}

export interface AppEnv {
  Variables: { principal: Principal; services: Services };
}

export const ANONYMOUS: Principal = { userId: "anonymous", token: "" };

export interface AuthCache {
  get(token: string): Promise<string | null>;
  set(token: string, userId: string): Promise<void>;
  rejected(token: string): Promise<boolean>;
  reject(token: string): Promise<void>;
}

const REJECTED_SECONDS = 10;
const MAX_TOKEN_CHARS = 4096;

export function createAuthCache(store: Store, ttlSeconds: number): AuthCache {
  const keyOf = (token: string) => createHash("sha256").update(token).digest("base64url");
  const signedIn = (token: string) => `auth:${keyOf(token)}`;
  const turnedDown = (token: string) => `auth-no:${keyOf(token)}`;
  return {
    async rejected(token) {
      if (ttlSeconds <= 0) return false;
      return (await store.get(turnedDown(token))) !== null;
    },
    async reject(token) {
      if (ttlSeconds <= 0) return;
      await store.set(turnedDown(token), "1", Math.min(ttlSeconds, REJECTED_SECONDS));
    },
    async get(token) {
      if (ttlSeconds <= 0) return null;
      return store.get(signedIn(token));
    },
    async set(token, userId) {
      if (ttlSeconds <= 0) return;
      await store.set(signedIn(token), userId, ttlSeconds);
    },
  };
}

function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "");
  return match ? match[1] : null;
}

export function servicesMiddleware(services: Services): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set("services", services);
    await next();
  };
}

type SignIn = Awaited<ReturnType<WorkspaceClient["getUser"]>> | { ok: false; reason: "busy" };

export function createSignIn(
  workspace: WorkspaceClient,
  { maxConcurrent = 32, maxWaiting = 256 }: { maxConcurrent?: number; maxWaiting?: number } = {},
): (token: string) => Promise<SignIn> {
  const pending = new Map<string, Promise<SignIn>>();
  const waiting: Array<() => void> = [];
  let running = 0;

  async function ask(token: string): Promise<SignIn> {
    if (running >= maxConcurrent) {
      if (waiting.length >= maxWaiting) return { ok: false, reason: "busy" };
      await new Promise<void>((resolve) => waiting.push(resolve));
    } else {
      running++;
    }
    try {
      return await workspace.getUser(token);
    } finally {
      const next = waiting.shift();
      if (next) next();
      else running--;
    }
  }

  return (token) => {
    const key = createHash("sha256").update(token).digest("base64url");
    let question = pending.get(key);
    if (!question) {
      question = ask(token).finally(() => pending.delete(key));
      pending.set(key, question);
    }
    return question;
  };
}

export function authMiddleware(services: Services, cache: AuthCache): MiddlewareHandler<AppEnv> {
  const { workspace } = services;
  const signIn = workspace ? createSignIn(workspace) : null;
  return async (c, next) => {
    if (!workspace || !signIn) {
      c.set("principal", ANONYMOUS);
      return next();
    }

    const token = bearerToken(c.req.header("Authorization"));
    if (!token) {
      audit.info("Refused a request without a session token to {path}", { path: new URL(c.req.url).pathname });
      return c.json({ error: "Not signed in" }, 401, { "WWW-Authenticate": "Bearer" });
    }

    if (token.length > MAX_TOKEN_CHARS || (await cache.rejected(token))) {
      metrics.authCache.inc({ result: "rejected" });
      return c.json({ error: "Not signed in" }, 401, { "WWW-Authenticate": "Bearer" });
    }

    let userId = await cache.get(token);
    metrics.authCache.inc({ result: userId ? "hit" : "miss" });
    if (!userId) {
      const user = await signIn(token);
      if (!user.ok) {
        if (user.reason === "busy") {
          metrics.queries.inc({ outcome: "busy" });
          return c.json({ error: "The agent is busy signing users in. Try again in a moment." }, 503, { "Retry-After": "1" });
        }
        if (user.reason === "unavailable") {
          audit.error("Could not sign a user in: the FINOS Workspace API is not answering");
          return c.json({ error: "The FINOS Workspace API is not available" }, 503);
        }
        audit.info("Refused a session token the FINOS Workspace API does not accept");
        await cache.reject(token);
        return c.json({ error: "Not signed in" }, 401, { "WWW-Authenticate": "Bearer" });
      }
      userId = user.value.userId;
      await cache.set(token, userId);
    }

    c.set("principal", { userId, token });
    return withContext({ user: userId }, next);
  };
}
