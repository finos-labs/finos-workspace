/**
 * The Workspace API as the agent uses it. The Workspace owns the users, the roles and the usage
 * limits, so the agent asks it instead of keeping a user database of its own:
 *
 *   GET  /app/user              who the session token belongs to
 *   PUT  /app/usage             count a query against the daily limit; add the tokens a query used
 *   POST /app/copilot/authorize whether the user's roles allow a model and some MCP tools
 *
 * The user's own session token authenticates them. Usage and access checks also carry the metering
 * token, which only the operator and this service hold, so users cannot write their own usage.
 */

import { getLogger } from "../lib/logger";
import { metrics } from "../lib/metrics";

const logger = getLogger(["app", "auth", "workspace"]);

const METERING_HEADER = "X-Metering-Authorization";

export type Failure =
  /** The Workspace does not accept the token (or the user may not do this). */
  | { ok: false; reason: "rejected" }
  /** The daily limit of queries is reached; `message` is the Workspace's wording. */
  | { ok: false; reason: "limit"; message: string }
  /** The Workspace could not be asked or did not answer sensibly. */
  | { ok: false; reason: "unavailable" };
export type Result<T> = { ok: true; value: T } | Failure;

export interface ToolRef {
  url: string;
  toolName: string;
}

/** What an administrator can switch off for a user: the agent's tools for the web. */
export type Capability = "SEARCH_WEB" | "FETCH_FROM_WEB";
const CAPABILITIES: readonly string[] = ["SEARCH_WEB", "FETCH_FROM_WEB"];

export interface Authorization {
  allowed: boolean;
  deniedModel: string | null;
  deniedTools: ToolRef[];
  /** What is switched off for the user, whether or not the request has tools of it. */
  disabledCapabilities: Capability[];
}

export interface WorkspaceClient {
  getUser(token: string): Promise<Result<{ userId: string }>>;
  /** Counts one query; fails with `limit` when the user's daily limit of queries is used up. */
  recordQuery(token: string): Promise<Result<void>>;
  /** Adds the tokens a query used. Never throws: failing to report is logged, not shown to the user. */
  recordTokens(token: string, tokens: number): Promise<void>;
  authorize(token: string, request: { agentId: string; model?: string; tools: ToolRef[] }): Promise<Result<Authorization>>;
  /** Whether the Workspace API answers. */
  ready(): Promise<boolean>;
}

export interface WorkspaceClientOptions {
  apiUrl: string;
  meteringToken: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export function createWorkspaceClient(options: WorkspaceClientOptions): WorkspaceClient {
  const { apiUrl, meteringToken, timeoutMs = 10_000 } = options;
  const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  /** One call; `outcome` for the metrics is decided by the caller from the response. */
  async function call(
    endpoint: string,
    path: string,
    token: string,
    init: { method: string; body?: unknown; metering?: boolean },
    outcomeOf: (status: number) => string,
  ): Promise<{ status: number; json: unknown } | null> {
    const started = performance.now();
    try {
      const response = await doFetch(`${apiUrl}${path}`, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(init.metering ? { [METERING_HEADER]: `Bearer ${meteringToken}` } : {}),
          ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const json = await response.json().catch(() => null);
      metrics.workspaceRequests.inc({ endpoint, outcome: outcomeOf(response.status) });
      return { status: response.status, json };
    } catch (error) {
      metrics.workspaceRequests.inc({ endpoint, outcome: "error" });
      logger.warn("Workspace API request failed: {endpoint}", { endpoint, error });
      return null;
    } finally {
      metrics.workspaceDuration.observe((performance.now() - started) / 1000, { endpoint });
    }
  }

  const rejected = (status: number) => status === 401 || status === 403;

  return {
    async getUser(token) {
      const res = await call("user", "/app/user", token, { method: "GET" }, (s) =>
        s === 200 ? "ok" : rejected(s) ? "rejected" : "error",
      );
      if (!res) return { ok: false, reason: "unavailable" };
      if (rejected(res.status)) return { ok: false, reason: "rejected" };
      const userId = res.status === 200 ? (res.json as { uuid?: unknown } | null)?.uuid : undefined;
      if (typeof userId !== "string" || !userId) {
        logger.warn("Workspace API answered /app/user with status {status} and no user", { status: res.status });
        return { ok: false, reason: "unavailable" };
      }
      return { ok: true, value: { userId } };
    },

    async recordQuery(token) {
      const res = await call(
        "usage",
        "/app/usage",
        token,
        { method: "PUT", body: { add_copilot_count: 1 }, metering: true },
        (s) => (s === 200 ? "ok" : s === 422 ? "limit" : rejected(s) ? "rejected" : "error"),
      );
      if (!res) return { ok: false, reason: "unavailable" };
      if (res.status === 200) return { ok: true, value: undefined };
      if (res.status === 422) {
        const message = (res.json as { message?: unknown } | null)?.message;
        return {
          ok: false,
          reason: "limit",
          message: typeof message === "string" ? message : "You have reached your usage limit.",
        };
      }
      return { ok: false, reason: rejected(res.status) ? "rejected" : "unavailable" };
    },

    async recordTokens(token, tokens) {
      if (!(tokens > 0)) return;
      const res = await call(
        "usage",
        "/app/usage",
        token,
        { method: "PUT", body: { add_copilot_tokens: Math.round(tokens) }, metering: true },
        (s) => (s === 200 ? "ok" : rejected(s) ? "rejected" : "error"),
      );
      if (!res || res.status !== 200) {
        logger.warn("Could not report {tokens} tokens of usage (status {status})", { tokens, status: res?.status ?? "none" });
      }
    },

    async authorize(token, request) {
      const res = await call(
        "authorize",
        "/app/copilot/authorize",
        token,
        {
          method: "POST",
          metering: true,
          body: {
            agent_id: request.agentId,
            ...(request.model ? { model: request.model } : {}),
            tools: request.tools.map((t) => ({ url: t.url, tool_name: t.toolName })),
          },
        },
        (s) => (s === 200 ? "ok" : rejected(s) ? "rejected" : "error"),
      );
      if (!res) return { ok: false, reason: "unavailable" };
      if (rejected(res.status)) return { ok: false, reason: "rejected" };
      const body = res.json as {
        allowed?: unknown;
        denied_model?: unknown;
        denied_tools?: { url?: unknown; tool_name?: unknown }[];
        disabled_capabilities?: unknown;
      } | null;
      if (res.status !== 200 || typeof body?.allowed !== "boolean") return { ok: false, reason: "unavailable" };
      return {
        ok: true,
        value: {
          allowed: body.allowed,
          deniedModel: typeof body.denied_model === "string" ? body.denied_model : null,
          deniedTools: (body.denied_tools ?? []).flatMap((t) =>
            typeof t.url === "string" && typeof t.tool_name === "string" ? [{ url: t.url, toolName: t.tool_name }] : [],
          ),
          disabledCapabilities: Array.isArray(body.disabled_capabilities)
            ? body.disabled_capabilities.filter((c): c is Capability => typeof c === "string" && CAPABILITIES.includes(c))
            : [],
        },
      };
    },

    async ready() {
      try {
        const response = await doFetch(`${apiUrl}/health`, { signal: AbortSignal.timeout(3_000) });
        return response.ok;
      } catch {
        return false;
      }
    },
  };
}
