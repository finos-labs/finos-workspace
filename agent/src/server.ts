import "./lib/logger";
import { getLogger } from "./lib/logger";
import { initTelemetry, shutdownTelemetry } from "./lib/telemetry";
import { loadConfig } from "./lib/config";
import { metrics, renderMetrics } from "./lib/metrics";
import { createLimits } from "./auth/limits";
import { createStore } from "./lib/store";
import { keepChatDataIn } from "./agent/row-cache";
import { createWorkspaceClient } from "./auth/workspace-client";
import { configureFetchPolicy } from "./lib/safe-fetch";
import { createApp } from "./app";
import { liveDebugIgnored } from "./lib/debug-traces";
import { installErrorGuards, installShutdown } from "./lib/process-guards";

const logger = getLogger(["app", "server"]);

// Must run before any span is created. No-op unless an OTLP endpoint is set.
initTelemetry();

// A deployment that is missing something it needs says so and stops, instead of running without users.
let config: ReturnType<typeof loadConfig>;
try {
  config = loadConfig();
} catch (error) {
  logger.fatal(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

if (config.auth.mode === "none") {
  logger.warn("INES_AUTH=none: there are no users. Every request is anonymous and nothing is counted. Do not use this where others can reach the agent.");
}

// The links to the Workspace's own files are the one internal address the agent may fetch from.
configureFetchPolicy({ workspace: config.workspaceFiles ?? undefined });

// Shared between replicas when REDIS_URL names a Redis, in this process otherwise.
const store = createStore();
// A chat's rows and widget data are kept in Redis alone, never in this process; without REDIS_URL they are not kept.
keepChatDataIn(store.sharedOnly());

const limits = createLimits({
  store,
  maxConcurrent: config.maxConcurrentQueries,
  maxTotal: config.maxTotalQueries,
  maxRequestsPerTurn: config.maxTurnRequests,
  maxHelperCallsPerMinute: config.maxHelperCallsPerMinute,
  maxInvalidPerMinute: config.maxInvalidPerMinute,
});

const app = createApp({
  config,
  workspace:
    config.auth.mode === "workspace"
      ? createWorkspaceClient({
          apiUrl: config.auth.apiUrl,
          origin: config.auth.origin,
          meteringToken: config.auth.meteringToken,
        })
      : null,
  limits,
  store,
});

const PORT = Number(process.env.PORT ?? 7777);

// Prometheus scrapes this on its own port, which is not published with the agent's: metrics say how
// the deployment is being used, and are for the operator.
if (config.metricsPort !== null) {
  metrics.activeQueries.set(0);
  Bun.serve({
    port: config.metricsPort,
    fetch(request) {
      return new URL(request.url).pathname === "/metrics"
        ? new Response(renderMetrics(), { headers: { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" } })
        : new Response("Not found", { status: 404 });
    },
  });
  logger.info("Metrics on port {port}", { port: config.metricsPort });
}

if (liveDebugIgnored()) {
  logger.warn("LIVE_DEBUG_TRACES is ignored in production: it would write whole conversations to the log. Set INES_ALLOW_DEBUG_TRACES=true to allow it.");
}

installErrorGuards(process, logger);

// A deploy sends SIGTERM: take no new queries, give the running ones time to end, then flush telemetry
// (without an explicit flush the batch processor drops what it holds, and the last trace would vanish).
let listening: { stop(closeActiveConnections?: boolean): void } | null = null;
installShutdown(process, {
  stopAccepting: () => listening?.stop(false),
  inFlight: () => limits.running(),
  graceMs: Number(process.env.INES_SHUTDOWN_GRACE_SECONDS ?? 25) * 1000,
  finish: shutdownTelemetry,
  exit: (code) => process.exit(code),
  log: logger,
});

logger.info("Server starting", { port: PORT, auth: config.auth.mode });

export default {
  port: PORT,
  // Bun hands the server it runs to the handler: that is what a shutdown has to stop.
  fetch(request: Request, server: { stop(closeActiveConnections?: boolean): void }) {
    listening ??= server;
    return app.fetch(request);
  },
  idleTimeout: 255,
};
