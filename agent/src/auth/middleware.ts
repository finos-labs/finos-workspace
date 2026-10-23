/**
 * Signs every caller of /v1/* in with the Workspace API, and says who they are to the routes.
 *
 * The browser sends the user's session token as a bearer token; the Workspace API is the only one
 * that can say whose it is. The X-User-Id header the web app also sends is not used: a client could
 * put anything in it.
 */

import { createHash } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { getLogger, withContext } from "../lib/logger.ts";
import { metrics } from "../lib/metrics.ts";
import type { ServerConfig } from "../lib/config.ts";
import type { Limits } from "./limits.ts";
import type { Store } from "../lib/store.ts";
import type { WorkspaceClient } from "./workspace-client.ts";

const audit = getLogger(["audit"]);

/** The person making a request. `token` is their session token, kept only to speak for them to the Workspace API. */
export interface Principal {
  userId: string;
  token: string;
}

export interface Services {
  config: ServerConfig;
  /** Null without workspace auth: nobody to ask, and nothing to count. */
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
  /** Whether the Workspace turned this token down a moment ago. */
  rejected(token: string): Promise<boolean>;
  /** Remembers that the Workspace turned this token down. */
  reject(token: string): Promise<void>;
}

/** How long a token the Workspace turned down is not asked about again. */
const REJECTED_SECONDS = 10;
/** The longest bearer token that is asked about: a session token is a few hundred characters. */
const MAX_TOKEN_CHARS = 4096;

/**
 * Remembers who a token belongs to for a few seconds, so that a chat's tool round trips do not each ask the API,
 * and which tokens were turned down, so that a client that sends the same wrong token over and over does not
 * make the agent ask the API each time.
 *
 * It lives in the store (src/lib/store.ts), so with Redis one replica's answer saves every other replica
 * the same question. The token itself is never a key: what is stored is its SHA-256, so a dump of the
 * store is not a list of session tokens.
 */
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

/** Puts the services on the context for every route. */
export function servicesMiddleware(services: Services): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set("services", services);
    await next();
  };
}

type SignIn = Awaited<ReturnType<WorkspaceClient["getUser"]>> | { ok: false; reason: "busy" };

/**
 * Asks the Workspace API who a token belongs to, for callers the cache does not know. Anyone can send a request with
 * any token, so what the API is asked is bounded: one question for the same token however many requests carry it
 * at once, and at most `maxConcurrent` questions under way (some more wait, the rest are told the agent is busy).
 * Without that, a flood of requests with made-up tokens is a flood of requests to the API, which slows the
 * sign-in of everyone else.
 */
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
      await new Promise<void>((resolve) => waiting.push(resolve)); // the place of the one that ended is handed over
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
          audit.error("Could not sign a user in: the Workspace API is not answering");
          return c.json({ error: "The Workspace API is not available" }, 503);
        }
        audit.info("Refused a session token the Workspace API does not accept");
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
