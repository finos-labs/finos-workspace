/**
 * What the agent needs to run for more than one user, read from the environment and checked at
 * start, so that a deployment with something missing says what instead of running open.
 *
 *   INES_AUTH                    workspace (default) | none. `workspace` signs every caller in with the
 *                                FINOS Workspace API; `none` runs without users, for a development machine.
 *   WORKSPACE_API_URL            The FINOS Workspace API as this agent can reach it (not the browser's address).
 *   WORKSPACE_ORIGIN             The Origin header of every call the agent makes to the FINOS Workspace API: the web app's
 *                                origin, one the API allows (BACKEND_CORS_ORIGINS), since the API refuses the calls of
 *                                an origin it does not allow. Required with INES_AUTH=workspace or WORKSPACE_PUBLIC_URL.
 *   INES_METERING_TOKEN          The service token the FINOS Workspace API checks usage reports and access
 *                                checks with: `python -m scripts.create_metering_token` in backend-api/backend.
 *   INES_SCOPE_SECRET            Signs the scope of each chat that the MCP tools receive, so that a user
 *                                cannot name another user's chat. Shared with the MCP server.
 *   WORKSPACE_PUBLIC_URL         The FINOS Workspace API as the browser addresses it. The links the FINOS Workspace gives
 *                                out to its users' files are on this address; the agent fetches them from
 *                                WORKSPACE_API_URL instead (see lib/safe-fetch.ts). Without it such links
 *                                are fetched as they are, which only works where the browser's address is
 *                                also the agent's.
 *   INES_CORS_ORIGINS            Comma-separated origins of the web app; `*` allows every origin.
 *                                Required with INES_AUTH=workspace, `*` otherwise.
 *   INES_MODELS                  Comma-separated <provider>:<model> that users may pick, besides DEFAULT_MODEL.
 *   INES_TRANSCRIBE_MODEL        <provider>:<model> for dictation in the chat (groq, openai or nvidia; see
 *                                lib/transcribe.ts). Unset, there is no dictation.
 *   INES_AUTH_CACHE_SECONDS      How long a signed-in user is remembered (default 30).
 *   INES_MAX_BODY_MB             Largest request accepted (default 64).
 *   INES_MAX_CONCURRENT_QUERIES  Queries one user may have running at once (default 4).
 *   INES_MAX_TOTAL_QUERIES       Queries the whole agent runs at once; past it a query is refused with 503 (default 200).
 *   INES_MAX_TURN_REQUESTS       Requests one question may be made of, counting every return from a tool (default 60).
 *   INES_HELPER_CALLS_PER_MINUTE Helper calls (titles, rewritten prompts, widget descriptions, dictation) one user may make in a minute; past it they get 429 (default 60).
 *   INES_INVALID_REQUESTS_PER_MINUTE  Questions that are not questions (not JSON, wrong shape) one user may send in a minute; past it their questions are turned away unread (default 20).
 *   INES_METRICS_PORT            Port of the /metrics listener (default 9464, 0 turns it off).
 */

import { transcribeModelProblem } from "./transcribe.ts";

export type AuthConfig =
  | { mode: "none" }
  | { mode: "workspace"; apiUrl: string; origin: string; meteringToken: string; cacheSeconds: number };

export interface ServerConfig {
  auth: AuthConfig;
  corsOrigins: string[] | "*";
  /** Needed with workspace auth; unset with none, in which case the tools do not check scopes. */
  scopeSecret: string | null;
  /** The models a user may pick: INES_MODELS and DEFAULT_MODEL. Empty when none is configured. */
  models: string[];
  /** Where the FINOS Workspace's file links point, where the agent fetches them from and with which Origin; null when not set. */
  workspaceFiles: { publicUrl: string; internalUrl: string; origin: string } | null;
  maxBodyBytes: number;
  maxConcurrentQueries: number;
  maxTotalQueries: number;
  maxTurnRequests: number;
  maxHelperCallsPerMinute: number;
  maxInvalidPerMinute: number;
  metricsPort: number | null;
}

type Env = Record<string, string | undefined>;

function list(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/** The models users may pick: DEFAULT_MODEL first, then INES_MODELS, without repeats. */
export function configuredModels(env: Env = process.env): string[] {
  return [...new Set([env.DEFAULT_MODEL?.trim(), ...list(env.INES_MODELS)].filter((m): m is string => !!m))];
}

function integer(env: Env, name: string, fallback: number, min: number, problems: string[]): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    problems.push(`${name} must be a whole number of at least ${min}; got "${raw}".`);
    return fallback;
  }
  return value;
}

function isOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.origin === value;
  } catch {
    return false;
  }
}

export function loadConfig(env: Env = process.env): ServerConfig {
  const problems: string[] = [];

  const mode = env.INES_AUTH ?? "workspace";
  if (mode !== "workspace" && mode !== "none") {
    problems.push(`INES_AUTH must be workspace or none; got "${mode}".`);
  }

  // The Origin of every call the agent makes to the FINOS Workspace API: with workspace auth, and for its file links.
  const origin = (env.WORKSPACE_ORIGIN ?? "").trim().replace(/\/+$/, "");
  const publicUrl = (env.WORKSPACE_PUBLIC_URL ?? "").trim().replace(/\/+$/, "");
  if (mode === "workspace" || publicUrl) {
    if (!origin) {
      problems.push("WORKSPACE_ORIGIN is required with INES_AUTH=workspace or WORKSPACE_PUBLIC_URL: the web app's origin, which the FINOS Workspace API allows (BACKEND_CORS_ORIGINS).");
    } else if (!isOrigin(origin)) {
      problems.push(`WORKSPACE_ORIGIN must be an origin like https://workspace.example.com without a path; got "${env.WORKSPACE_ORIGIN}".`);
    }
  }

  let auth: AuthConfig = { mode: "none" };
  if (mode === "workspace") {
    const apiUrl = (env.WORKSPACE_API_URL ?? "").trim().replace(/\/+$/, "");
    if (!apiUrl) {
      problems.push("WORKSPACE_API_URL is required with INES_AUTH=workspace (for example the API service's address inside the deployment).");
    } else {
      try {
        const { protocol } = new URL(apiUrl);
        if (protocol !== "http:" && protocol !== "https:") throw new Error("not http");
      } catch {
        problems.push(`WORKSPACE_API_URL must be an http(s) URL; got "${env.WORKSPACE_API_URL}".`);
      }
    }
    const meteringToken = (env.INES_METERING_TOKEN ?? "").trim();
    if (!meteringToken) {
      problems.push("INES_METERING_TOKEN is required with INES_AUTH=workspace (python -m scripts.create_metering_token in backend-api/backend prints it).");
    }
    auth = {
      mode: "workspace",
      apiUrl,
      origin,
      meteringToken,
      cacheSeconds: integer(env, "INES_AUTH_CACHE_SECONDS", 30, 0, problems),
    };
  }

  let workspaceFiles: ServerConfig["workspaceFiles"] = null;
  if (publicUrl) {
    if (!isOrigin(publicUrl)) {
      problems.push(`WORKSPACE_PUBLIC_URL must be an address like https://api.workspace.example.com without a path; got "${env.WORKSPACE_PUBLIC_URL}".`);
    } else {
      const internalUrl =
        auth.mode === "workspace" ? auth.apiUrl : (env.WORKSPACE_API_URL ?? "").trim().replace(/\/+$/, "") || publicUrl;
      workspaceFiles = { publicUrl, internalUrl, origin };
    }
  }

  const scopeSecret = (env.INES_SCOPE_SECRET ?? "").trim() || null;
  if (mode === "workspace" && (!scopeSecret || scopeSecret.length < 16)) {
    problems.push("INES_SCOPE_SECRET is required with INES_AUTH=workspace and must be at least 16 characters.");
  }

  let corsOrigins: string[] | "*";
  const origins = list(env.INES_CORS_ORIGINS);
  if (origins.length === 0) {
    corsOrigins = "*";
    if (mode === "workspace") {
      problems.push("INES_CORS_ORIGINS is required with INES_AUTH=workspace: the origin of the web app, or * for every origin.");
    }
  } else if (origins.includes("*")) {
    corsOrigins = "*";
  } else {
    corsOrigins = origins;
    for (const origin of origins) {
      if (!isOrigin(origin)) problems.push(`INES_CORS_ORIGINS has "${origin}", which is not an origin like https://workspace.example.com.`);
    }
  }

  const transcribeProblem = transcribeModelProblem(env);
  if (transcribeProblem) problems.push(transcribeProblem);

  const models = configuredModels(env);
  for (const model of models) {
    const colon = model.indexOf(":");
    if (colon <= 0 || colon === model.length - 1) {
      problems.push(`The model "${model}" must be written <provider>:<model>.`);
    }
  }

  const metricsPort = integer(env, "INES_METRICS_PORT", 9464, 0, problems);
  const maxBodyMb = integer(env, "INES_MAX_BODY_MB", 64, 1, problems);
  const maxConcurrentQueries = integer(env, "INES_MAX_CONCURRENT_QUERIES", 4, 1, problems);
  const maxTotalQueries = integer(env, "INES_MAX_TOTAL_QUERIES", 200, 1, problems);
  const maxTurnRequests = integer(env, "INES_MAX_TURN_REQUESTS", 60, 1, problems);
  const maxHelperCallsPerMinute = integer(env, "INES_HELPER_CALLS_PER_MINUTE", 60, 1, problems);
  const maxInvalidPerMinute = integer(env, "INES_INVALID_REQUESTS_PER_MINUTE", 20, 1, problems);

  if (problems.length > 0) {
    throw new Error(`Invalid configuration:\n${problems.map((p) => ` - ${p}`).join("\n")}`);
  }

  return {
    auth,
    corsOrigins,
    scopeSecret,
    models,
    workspaceFiles,
    maxBodyBytes: maxBodyMb * 1024 * 1024,
    maxConcurrentQueries,
    maxTotalQueries,
    maxTurnRequests,
    maxHelperCallsPerMinute,
    maxInvalidPerMinute,
    metricsPort: metricsPort === 0 ? null : metricsPort,
  };
}
