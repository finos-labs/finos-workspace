import { Hono, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { honoLogger, withContext } from "./lib/logger";
import { metrics } from "./lib/metrics";
import { ANONYMOUS, authMiddleware, createAuthCache, servicesMiddleware, type AppEnv, type Services } from "./auth/middleware";
import { agentsRouter } from "./routes/agents";
import { createStatusRouter } from "./routes/status";
import { queryRouter } from "./routes/query";
import { generateRouter } from "./routes/generate";

/** The helpers (a title, a rewritten prompt) take a few lines of text: what they are sent is far less than a question is. */
const HELPER_BODY_BYTES = 8 * 1024 * 1024;
/** The helper routes that take a JSON body (the file route takes a file, and has the limit of a question). */
const HELPER_JSON_PATHS = ["/v1/generate/chat/title", "/v1/generate/dashboard/title", "/v1/generate/widget_info", "/v1/generate/code", "/v1/enhance_prompt"];

/** The route as a metrics label: the pattern that matched, never the path a client asked for. */
function routeLabel(pattern: string, status: number): string {
  return status === 404 || pattern === "/*" || pattern === "*" ? "other" : pattern;
}

/**
 * The agent's HTTP application.
 *
 * Public: /agents.json (the Workspace reads it before anyone is signed in), /status and /ready.
 * Everything under /v1 needs a signed-in user when the deployment has users.
 */
const helperGate: MiddlewareHandler<AppEnv> = async (c, next) => {
  const services = c.get("services");
  const principal = c.get("principal") ?? ANONYMOUS;
  if (services && !(await services.limits.helperCall(principal.userId))) {
    metrics.helperRefused.inc();
    return c.json({ error: "Too many requests. Try again in a minute." }, 429, { "Retry-After": "60" });
  }
  await next();
};

export function createApp(services: Services): Hono<AppEnv> {
  const { config, workspace } = services;
  const app = new Hono<AppEnv>();

  // First, so that a browser's preflight request is answered before it reaches anything that checks a token.
  app.use(
    "*",
    cors({
      origin: config.corsOrigins === "*" ? "*" : config.corsOrigins,
      exposeHeaders: ["X-Trace-Id", "X-Completion-Id"],
    }),
  );

  app.use("*", async (c, next) => {
    const traceId = c.req.header("x-trace-id") ?? crypto.randomUUID();
    const started = performance.now();
    c.header("X-Trace-Id", traceId);
    c.header("X-Completion-Id", crypto.randomUUID());
    await withContext({ requestId: traceId }, next);
    const route = routeLabel(c.req.routePath, c.res.status);
    metrics.httpRequests.inc({ route, method: c.req.method, status: c.res.status });
    metrics.httpDuration.observe((performance.now() - started) / 1000, { route, method: c.req.method });
  });
  app.use("*", honoLogger);

  app.route("/", agentsRouter);
  app.route("/", createStatusRouter(services.store));
  // Ready when what the agent depends on answers; /status only says that the process is up.
  app.get("/ready", async (c) => {
    if (workspace && !(await workspace.ready())) {
      return c.json({ status: "not ready", reason: "the Workspace API does not answer" }, 503);
    }
    return c.json({ status: "ready" });
  });

  app.use(
    "/v1/*",
    bodyLimit({
      maxSize: config.maxBodyBytes,
      onError: (c) => c.json({ error: "The request is too large" }, 413),
    }),
    servicesMiddleware(services),
    authMiddleware(services, createAuthCache(services.store, config.auth.mode === "workspace" ? config.auth.cacheSeconds : 0)),
  );
  // A helper call is counted against the user before its body is read, so that a user who makes too many is
  // turned away at no cost: reading a body takes the whole agent a moment, and a model call is paid for.
  app.use("/v1/generate/*", helperGate);
  app.use("/v1/enhance_prompt", helperGate);
  for (const path of HELPER_JSON_PATHS) {
    app.use(path, bodyLimit({ maxSize: HELPER_BODY_BYTES, onError: (c) => c.json({ error: "The request is too large" }, 413) }));
  }
  app.route("/", queryRouter);
  app.route("/", generateRouter);

  return app;
}
