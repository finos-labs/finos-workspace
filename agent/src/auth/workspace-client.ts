import { getLogger } from "../lib/logger.ts";
import { metrics } from "../lib/metrics.ts";

const logger = getLogger(["app", "auth", "workspace"]);

const METERING_HEADER = "X-Metering-Authorization";

export type Failure =
  | { ok: false; reason: "rejected" }
  | { ok: false; reason: "limit"; message: string }
  | { ok: false; reason: "unavailable" };
export type Result<T> = { ok: true; value: T } | Failure;

export interface ToolRef {
  url: string;
  toolName: string;
}

export type Capability = "SEARCH_WEB" | "FETCH_FROM_WEB";
const CAPABILITIES: readonly string[] = ["SEARCH_WEB", "FETCH_FROM_WEB"];

export interface Authorization {
  allowed: boolean;
  deniedModel: string | null;
  deniedTools: ToolRef[];
  disabledCapabilities: Capability[];
}

export interface WorkspaceClient {
  getUser(token: string): Promise<Result<{ userId: string }>>;
  recordQuery(token: string): Promise<Result<void>>;
  recordTokens(token: string, tokens: number): Promise<void>;
  authorize(token: string, request: { agentId: string; model?: string; tools: ToolRef[] }): Promise<Result<Authorization>>;
  ready(): Promise<boolean>;
}

export interface WorkspaceClientOptions {
  apiUrl: string;
  origin: string;
  meteringToken: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export function createWorkspaceClient(options: WorkspaceClientOptions): WorkspaceClient {
  const { apiUrl, origin, meteringToken, timeoutMs = 10_000 } = options;
  const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

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
          Origin: origin,
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

  function meteringRefused(res: { status: number; json: unknown }): boolean {
    if (res.status !== 403) return false;
    const detail = (res.json as { detail?: unknown } | null)?.detail;
    return typeof detail === "string" && detail.toLowerCase().includes("metering token");
  }

  function reportMeteringRefused(endpoint: string, res: { json: unknown }): void {
    const detail = (res.json as { detail?: unknown } | null)?.detail;
    logger.error(
      "The Workspace API refused this agent's metering token on {endpoint}: {detail}. " +
        "Until it is replaced no question can be answered. Mint a new one with " +
        "`python -m scripts.create_metering_token` in backend-api/backend and set INES_METERING_TOKEN to it.",
      { endpoint, detail: typeof detail === "string" ? detail : "no reason given" },
    );
  }

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
      if (meteringRefused(res)) {
        reportMeteringRefused("usage", res);
        return { ok: false, reason: "unavailable" };
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
      if (res && meteringRefused(res)) {
        reportMeteringRefused("usage", res);
        return;
      }
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
      if (meteringRefused(res)) {
        reportMeteringRefused("authorize", res);
        return { ok: false, reason: "unavailable" };
      }
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
        const response = await doFetch(`${apiUrl}/health`, {
          headers: { Origin: origin },
          signal: AbortSignal.timeout(3_000),
        });
        return response.ok;
      } catch {
        return false;
      }
    },
  };
}
