import { AUTH_MODES } from "./env-reference.ts";
import { transcribeModelProblem } from "./transcribe.ts";

export type AuthConfig =
  | { mode: "none" }
  | { mode: "workspace"; apiUrl: string; origin: string; meteringToken: string; cacheSeconds: number };

export interface ServerConfig {
  auth: AuthConfig;
  corsOrigins: string[] | "*";
  scopeSecret: string | null;
  models: string[];
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
  if (!(AUTH_MODES as readonly string[]).includes(mode)) {
    problems.push(`INES_AUTH must be ${AUTH_MODES.join(" or ")}; got "${mode}".`);
  }

  const origin = (env.WORKSPACE_ORIGIN ?? "").trim().replace(/\/+$/, "");
  const publicUrl = (env.WORKSPACE_PUBLIC_URL ?? "").trim().replace(/\/+$/, "");
  if (mode === "workspace" || publicUrl) {
    if (!origin) {
      problems.push("WORKSPACE_ORIGIN is required with INES_AUTH=workspace or WORKSPACE_PUBLIC_URL: the web app's origin, which the Workspace API allows (BACKEND_CORS_ORIGINS).");
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
