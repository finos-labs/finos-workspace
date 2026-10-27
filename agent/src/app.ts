import { Hono, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { honoLogger, withContext } from "./lib/logger.ts";
import { metrics } from "./lib/metrics.ts";
import { ANONYMOUS, authMiddleware, createAuthCache, servicesMiddleware, type AppEnv, type Services } from "./auth/middleware.ts";
import { agentsRouter } from "./routes/agents.ts";
import { createStatusRouter } from "./routes/status.ts";
import { queryRouter } from "./routes/query.ts";
import { generateRouter } from "./routes/generate/index.ts";
import { MAX_AUDIO_BYTES, transcribeRouter } from "./routes/transcribe.ts";

export const HELPER_BODY_BYTES = 8 * 1024 * 1024;
export const TRANSCRIBE_BODY_BYTES = MAX_AUDIO_BYTES + 64 * 1024;
export const HELPER_JSON_PATHS = ["/v1/generate/chat/title", "/v1/generate/dashboard/title", "/v1/generate/widget_info", "/v1/generate/code", "/v1/enhance_prompt"];

function routeLabel(pattern: string, status: number): string {
  return status === 404 || pattern === "/*" || pattern === "*" ? "other" : pattern;
}

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
  app.use("/v1/generate/*", helperGate);
  app.use("/v1/enhance_prompt", helperGate);
  app.use("/v1/transcribe", helperGate);
  app.use(
    "/v1/transcribe",
    bodyLimit({ maxSize: TRANSCRIBE_BODY_BYTES, onError: (c) => c.json({ error: "The recording is too long." }, 413) }),
  );
  for (const path of HELPER_JSON_PATHS) {
    app.use(path, bodyLimit({ maxSize: HELPER_BODY_BYTES, onError: (c) => c.json({ error: "The request is too large" }, 413) }));
  }
  app.route("/", queryRouter);
  app.route("/", generateRouter);
  app.route("/", transcribeRouter);

  return app;
}
